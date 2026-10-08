"""Steward signing devices and multi-steward signature aggregation.

HONEST STATUS: there is no hardware in this environment. `SoftwareSigner` is a stand-in (key_origin
"SOFTWARE") used by tests. `Pkcs11Ed25519Signer` is an adapter written against the PyKCS11 API but has NOT
been run against a real token; PyKCS11 is not installed here and CKM_EDDSA support depends on the device
(many YubiKey PIV applets do not offer Ed25519). Treat it as an integration seam to be validated on hardware.
"""
from __future__ import annotations

import base64
from typing import Callable, List, Optional, Protocol

from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey

from lake_yange.middleware.auth_gate import StewardSignature, approval_message


class HsmUnavailable(Exception):
    pass


class StewardSigner(Protocol):
    steward_id: str
    key_origin: str  # "HSM" or "SOFTWARE"

    def public_key_raw(self) -> bytes: ...
    def sign(self, message: bytes) -> bytes: ...


class SoftwareSigner:
    key_origin = "SOFTWARE"

    def __init__(self, steward_id: str, key: Optional[Ed25519PrivateKey] = None) -> None:
        self.steward_id = steward_id
        self._key = key or Ed25519PrivateKey.generate()

    def public_key_raw(self) -> bytes:
        return self._key.public_key().public_bytes(serialization.Encoding.Raw, serialization.PublicFormat.Raw)

    def sign(self, message: bytes) -> bytes:
        return self._key.sign(message)


class Pkcs11Ed25519Signer:
    """PKCS#11 adapter (UNTESTED against hardware). The private key never leaves the token."""
    key_origin = "HSM"

    def __init__(self, steward_id: str, module_path: str, key_label: str, pin_provider: Callable[[], str],
                 slot: int = 0, public_key_raw: Optional[bytes] = None) -> None:
        try:
            import PyKCS11  # type: ignore
        except ImportError as exc:
            raise HsmUnavailable("PyKCS11 is not installed; no hardware signing is available.") from exc
        self.steward_id = steward_id
        self._pk = PyKCS11
        self._lib = PyKCS11.PyKCS11Lib()
        self._lib.load(module_path)
        self._session = self._lib.openSession(slot)
        self._session.login(pin_provider())
        found = self._session.findObjects([(PyKCS11.CKA_CLASS, PyKCS11.CKO_PRIVATE_KEY), (PyKCS11.CKA_LABEL, key_label)])
        if not found:
            raise HsmUnavailable(f"No private key labelled {key_label!r} on the token.")
        self._key = found[0]
        if public_key_raw is None:
            raise HsmUnavailable("Provide the steward's public key bytes (read from the token during enrolment).")
        self._pub = public_key_raw

    def public_key_raw(self) -> bytes:
        return self._pub

    def sign(self, message: bytes) -> bytes:
        mech = self._pk.Mechanism(self._pk.CKM_EDDSA, None)
        return bytes(self._session.sign(self._key, message, mech))


class SignatureAggregator:
    """Collects one signature per distinct steward over the exact proposal hash and tier."""

    def __init__(self, proposal_id: str, p_hash: str, tier: int, decision: str = "APPROVE") -> None:
        self.proposal_id, self.p_hash, self.tier, self.decision = proposal_id, p_hash, tier, decision
        self._sigs: List[StewardSignature] = []

    def collect(self, signer: StewardSigner) -> StewardSignature:
        if any(s.steward_id == signer.steward_id for s in self._sigs):
            raise ValueError(f"{signer.steward_id} already signed this proposal.")
        message = approval_message(self.proposal_id, self.p_hash, self.tier, self.decision)
        sig = StewardSignature(steward_id=signer.steward_id, signature_b64=base64.b64encode(signer.sign(message)).decode())
        self._sigs.append(sig)
        return sig

    def bundle(self) -> List[StewardSignature]:
        return list(self._sigs)
