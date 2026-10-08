"""Human authorization gate: Ed25519 steward signatures, spending tiers, time-locks, single-use 60s JWT.

Tier boundaries (the brief overlaps at the edges; chosen here): T0 < $100; T1 $100..$1,000 inclusive;
T2 > $1,000..$10,000 inclusive; T3 > $10,000.
The JWT is HS256 with a per-gate random secret: only this gate can mint or verify it (not a public credential).
"""
from __future__ import annotations

import base64
import hashlib
import hmac
import json
import secrets
from datetime import datetime, timedelta, timezone
from decimal import Decimal
from typing import Any, Callable, Dict, FrozenSet, List, Optional, Set

from cryptography.exceptions import InvalidSignature as _CryptoInvalid
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey, Ed25519PublicKey
from pydantic import BaseModel, ConfigDict, Field

TOKEN_TTL_SECONDS = 60
SIGNATURES_REQUIRED = {0: 0, 1: 1, 2: 2, 3: 3}
TIME_LOCKS = {0: timedelta(0), 1: timedelta(0), 2: timedelta(hours=6), 3: timedelta(hours=24)}
DOMAIN = "LAKE-YANGE-GATE/1"


class AgentActionProposal(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)
    agent_id: str = Field(min_length=1)
    action_type: str = Field(min_length=1)
    target_system: str = Field(min_length=1)
    payload: Dict[str, Any]
    requested_tier: int = Field(ge=0, le=3)
    justification: str = Field(min_length=1)
    amount_usd: Decimal = Field(default=Decimal("0"), ge=0, allow_inf_nan=False)


OVERRIDE_DECISION = "TIER_3_EMERGENCY_OVERRIDE"
OVERRIDE_SIGNATURES_REQUIRED = 3


class GateError(Exception):
    pass


class InvalidSignature(GateError):
    pass


class BadSignature(InvalidSignature):
    def __init__(self, message: str, steward_id: Optional[str] = None, key_origin: Optional[str] = None) -> None:
        super().__init__(message)
        self.steward_id, self.key_origin = steward_id, key_origin


class InsufficientSignatures(GateError):
    pass


class TimeLockActive(GateError):
    pass


class TokenError(GateError):
    pass


class StewardSignature(BaseModel):
    model_config = ConfigDict(frozen=True)
    steward_id: str
    signature_b64: str


def required_tier(amount: Decimal) -> int:
    if amount < Decimal("100"):
        return 0
    if amount <= Decimal("1000"):
        return 1
    if amount <= Decimal("10000"):
        return 2
    return 3


def proposal_hash(proposal: AgentActionProposal) -> str:
    body = json.dumps(proposal.model_dump(mode="json"), sort_keys=True, separators=(",", ":"), default=str)
    return hashlib.sha256(body.encode()).hexdigest()


def approval_message(proposal_id: str, p_hash: str, tier: int, decision: str = "APPROVE") -> bytes:
    return json.dumps({"domain": DOMAIN, "proposal_id": proposal_id, "proposal_hash": p_hash,
                       "tier": tier, "decision": decision}, sort_keys=True, separators=(",", ":")).encode()


def sign_approval(key: Ed25519PrivateKey, steward_id: str, proposal_id: str, p_hash: str, tier: int,
                  decision: str = "APPROVE") -> StewardSignature:
    sig = key.sign(approval_message(proposal_id, p_hash, tier, decision))
    return StewardSignature(steward_id=steward_id, signature_b64=base64.b64encode(sig).decode())


def _b64u(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).rstrip(b"=").decode()


def _unb64u(text: str) -> bytes:
    return base64.urlsafe_b64decode(text + "=" * (-len(text) % 4))


class AuthGate:
    """`store` (an EncryptedStore) makes stewards, the token secret, issued tokens and spent tokens survive
    restarts. `hsm_required_tiers`: for those tiers only signatures from stewards enrolled with key_origin
    "HSM" count; the default is empty so software keys remain usable in development."""

    def __init__(self, clock: Optional[Callable[[], datetime]] = None, secret: Optional[bytes] = None,
                 store: Any = None, hsm_required_tiers: FrozenSet[int] = frozenset()) -> None:
        self._clock = clock or (lambda: datetime.now(timezone.utc))
        self._store = store
        self.hsm_required_tiers = hsm_required_tiers
        self._stewards: Dict[str, Ed25519PublicKey] = {}
        self._origin: Dict[str, str] = {}
        self._revoked_stewards: Set[str] = set()
        self._spent_jti: Set[str] = set()
        if store is not None:
            saved = store.get("gate", "secret")
            if saved is None:
                self._secret = secret or secrets.token_bytes(32)
                store.put("gate", "secret", {"hex": self._secret.hex()})
            else:
                self._secret = bytes.fromhex(saved["hex"])
            for sid, rec in store.all("steward").items():
                self._stewards[sid] = Ed25519PublicKey.from_public_bytes(bytes.fromhex(rec["public_hex"]))
                self._origin[sid] = rec["origin"]
                if rec.get("revoked"):
                    self._revoked_stewards.add(sid)
        else:
            self._secret = secret or secrets.token_bytes(32)

    def register_steward(self, steward_id: str, public_key_raw: bytes, origin: str = "SOFTWARE") -> None:
        if steward_id in self._stewards:
            raise GateError(f"Steward {steward_id} already registered.")
        if origin not in ("HSM", "SOFTWARE"):
            raise GateError("origin must be HSM or SOFTWARE")
        self._stewards[steward_id] = Ed25519PublicKey.from_public_bytes(public_key_raw)
        self._origin[steward_id] = origin
        self._persist_steward(steward_id, public_key_raw.hex())

    def _persist_steward(self, steward_id: str, public_hex: Optional[str] = None) -> None:
        if self._store is None:
            return
        existing = self._store.get("steward", steward_id) or {}
        self._store.put("steward", steward_id, {
            "public_hex": public_hex or existing["public_hex"], "origin": self._origin[steward_id],
            "revoked": steward_id in self._revoked_stewards})

    def revoke_steward(self, steward_id: str) -> None:
        if steward_id not in self._stewards:
            raise GateError(f"Unknown steward {steward_id!r}.")
        self._revoked_stewards.add(steward_id)
        self._persist_steward(steward_id)

    def is_steward_revoked(self, steward_id: str) -> bool:
        return steward_id in self._revoked_stewards

    def verify_signatures(self, proposal_id: str, p_hash: str, tier: int, decision: str,
                          signatures: List[StewardSignature]) -> Set[str]:
        message = approval_message(proposal_id, p_hash, tier, decision)
        valid: Set[str] = set()
        for item in signatures:
            key = self._stewards.get(item.steward_id)
            if key is None:
                raise InvalidSignature(f"Unknown steward {item.steward_id!r}.")
            if item.steward_id in self._revoked_stewards:
                raise InvalidSignature(f"Steward key {item.steward_id!r} is revoked.")
            if item.steward_id in valid:
                raise InvalidSignature(f"Duplicate signature from {item.steward_id!r}.")
            if decision in ("APPROVE", OVERRIDE_DECISION) and tier in self.hsm_required_tiers and self._origin[item.steward_id] != "HSM":
                raise InvalidSignature(f"Tier {tier} requires hardware-backed (HSM) steward keys; "
                                       f"{item.steward_id!r} is {self._origin[item.steward_id]}.")
            try:
                key.verify(base64.b64decode(item.signature_b64, validate=True), message)
            except (_CryptoInvalid, ValueError) as exc:
                raise BadSignature(f"Invalid signature from {item.steward_id!r}.", item.steward_id,
                                   self._origin[item.steward_id]) from exc
            valid.add(item.steward_id)
        return valid

    def authorize(self, proposal_id: str, p_hash: str, tier: int, submitted_at: datetime,
                  signatures: List[StewardSignature], auto_approvable: bool) -> str:
        """Verify, enforce quorum and time-lock, then mint a single-use token. Fails closed."""
        valid = self.verify_signatures(proposal_id, p_hash, tier, "APPROVE", signatures)
        need = SIGNATURES_REQUIRED[tier]
        if tier == 0 and not auto_approvable:
            need = 1
        if len(valid) < need:
            raise InsufficientSignatures(f"Tier {tier} needs {need} steward signature(s); got {len(valid)}.")
        unlock = submitted_at + TIME_LOCKS[tier]
        if self._clock() < unlock:
            raise TimeLockActive(f"Time-lock active until {unlock.isoformat()}.")
        return self._mint(proposal_id, p_hash, tier)

    def _mint(self, proposal_id: str, p_hash: str, tier: int) -> str:
        now = int(self._clock().timestamp())
        claims = {"sub": proposal_id, "ph": p_hash, "tier": tier, "aud": "forge",
                  "iat": now, "exp": now + TOKEN_TTL_SECONDS, "jti": secrets.token_hex(16)}
        head = _b64u(json.dumps({"alg": "HS256", "typ": "JWT"}, separators=(",", ":")).encode())
        body = _b64u(json.dumps(claims, separators=(",", ":")).encode())
        sig = hmac.new(self._secret, f"{head}.{body}".encode(), hashlib.sha256).digest()
        if self._store is not None:
            self._store.put("token", claims["jti"], {"proposal_id": proposal_id, "tier": tier, "exp": claims["exp"],
                                                     "status": "ISSUED"})
        return f"{head}.{body}.{_b64u(sig)}"

    def active_tokens(self) -> Dict[str, Dict[str, Any]]:
        if self._store is None:
            return {}
        now = int(self._clock().timestamp())
        return {j: t for j, t in self._store.all("token").items() if t["status"] == "ISSUED" and t["exp"] > now}

    def inspect_token(self, token: str, proposal_id: str, p_hash: str) -> Dict[str, Any]:
        """Read-only validity check (signature, binding, expiry, unspent). Never consumes the token."""
        try:
            head, body, sig = token.split(".")
            expected = hmac.new(self._secret, f"{head}.{body}".encode(), hashlib.sha256).digest()
            if not hmac.compare_digest(expected, _unb64u(sig)):
                raise TokenError("Bad token signature.")
            claims = json.loads(_unb64u(body))
        except TokenError:
            raise
        except Exception as exc:
            raise TokenError("Malformed token.") from exc
        if claims.get("sub") != proposal_id or claims.get("ph") != p_hash:
            raise TokenError("Token is bound to a different proposal.")
        now = int(self._clock().timestamp())
        if now >= int(claims["exp"]):
            raise TokenError("Token expired.")
        jti = claims["jti"]
        spent = jti in self._spent_jti
        if self._store is not None:
            rec = self._store.get("token", jti)
            spent = spent or rec is None or rec["status"] != "ISSUED"
        if spent:
            raise TokenError("Token already used or unknown.")
        return {"expires_at": int(claims["exp"]), "seconds_left": int(claims["exp"]) - now, "tier": claims["tier"]}

    def redeem(self, token: str, proposal_id: str, p_hash: str) -> Dict[str, Any]:
        """Single use. Bound to the exact proposal hash; expired, replayed or mismatched tokens fail."""
        try:
            head, body, sig = token.split(".")
            expected = hmac.new(self._secret, f"{head}.{body}".encode(), hashlib.sha256).digest()
            if not hmac.compare_digest(expected, _unb64u(sig)):
                raise TokenError("Bad token signature.")
            claims = json.loads(_unb64u(body))
        except TokenError:
            raise
        except Exception as exc:
            raise TokenError("Malformed token.") from exc
        if claims.get("sub") != proposal_id or claims.get("ph") != p_hash:
            raise TokenError("Token is bound to a different proposal.")
        if int(self._clock().timestamp()) >= int(claims["exp"]):
            raise TokenError("Token expired.")
        jti = claims["jti"]
        if jti in self._spent_jti:
            raise TokenError("Token already used.")
        if self._store is not None:
            rec = self._store.get("token", jti)
            if rec is None or rec["status"] != "ISSUED":
                raise TokenError("Token already used or unknown.")
            self._store.put("token", jti, {**rec, "status": "SPENT"})
        self._spent_jti.add(jti)
        return claims
