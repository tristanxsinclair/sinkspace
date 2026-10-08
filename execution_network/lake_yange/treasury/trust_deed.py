"""Software model of a corporate-trustee trust structure for the three treasury tiers.

NOT LEGAL ADVICE and NOT a trust deed. This encodes rules the Lake Yange Codex asks for so that movements
can be checked mechanically. A real structure (trustee company, deed, ASIC/ATO registrations, state
perpetuity-period rules, trustee duties under the Trustee Acts and general law) needs an Australian solicitor.

ASSUMPTIONS (the Codex text of Article 16.1 was not available to this code):
  * 16.1 "Intergenerational Capacity Guardrail" is modelled as: net outflow to non-trust parties in any
    12-month window must not exceed `max_annual_outflow_fraction` (default 5%) of the opening corpus, and no
    commitment may run past the sunset date.  Replace with the Codex numbers once confirmed.
  * The 15-year sunset covenant is modelled as a hard end date: after it only WIND_UP movements are allowed.
"""
from __future__ import annotations

from datetime import date, datetime, timedelta
from decimal import Decimal
from enum import Enum
from typing import Dict, List, Optional

from pydantic import BaseModel, ConfigDict, Field

from lake_yange.treasury.three_tier_ledger import RUNWAY_MONTHS, ThreeTierLedger

SUNSET_YEARS = 15


class MovementKind(str, Enum):
    TRANSFER = "TRANSFER"          # between tiers inside the trust
    DISTRIBUTION = "DISTRIBUTION"  # out of the trust to a beneficiary / third party
    WIND_UP = "WIND_UP"            # sunset distribution


class SubFund(BaseModel):
    tier: int
    name: str
    permitted_assets: List[str]


class TrustStructure(BaseModel):
    model_config = ConfigDict(frozen=True)
    trust_name: str
    trustee_company: str
    trustee_acn: str = Field(description="Placeholder until the company exists; not validated against ASIC.")
    established: date
    sunset_years: int = SUNSET_YEARS
    max_annual_outflow_fraction: Decimal = Decimal("0.05")
    sub_funds: List[SubFund] = [
        SubFund(tier=1, name="Core Human Reserve Sub-Fund", permitted_assets=["cash", "cash equivalents"]),
        SubFund(tier=2, name="Productive Infrastructure Sub-Fund", permitted_assets=["IP", "operating businesses", "software"]),
        SubFund(tier=3, name="Strategic Growth Sub-Fund", permitted_assets=["capped digital assets", "growth projects"]),
    ]

    @property
    def sunset_date(self) -> date:
        try:
            return self.established.replace(year=self.established.year + self.sunset_years)
        except ValueError:  # 29 February
            return self.established.replace(year=self.established.year + self.sunset_years, day=28)


class Movement(BaseModel):
    model_config = ConfigDict(frozen=True)
    kind: MovementKind
    amount: Decimal = Field(gt=0, allow_inf_nan=False)
    from_tier: int = Field(ge=1, le=3)
    to_tier: Optional[int] = Field(default=None, ge=1, le=3)
    trustee_resolution_ref: str = ""
    steward_authorization_hash: str = ""
    commitment_end: Optional[date] = None
    on: date


class Finding(BaseModel):
    rule: str
    ok: bool
    detail: str


class TrustComplianceError(Exception):
    def __init__(self, findings: List[Finding]) -> None:
        super().__init__("; ".join(f"{f.rule}: {f.detail}" for f in findings if not f.ok))
        self.findings = findings


class TrustDeedEngine:
    def __init__(self, structure: TrustStructure, ledger: ThreeTierLedger) -> None:
        self.structure, self.ledger = structure, ledger
        self._outflows: List[tuple] = []  # (date, amount)

    def _opening_corpus(self, on: date) -> Decimal:
        recent = sum((a for d, a in self._outflows if on - d < timedelta(days=365)), Decimal(0))
        return self.ledger.total + recent

    def check(self, m: Movement) -> List[Finding]:
        t, led, out = self.structure, self.ledger, []
        sunset = t.sunset_date
        out.append(Finding(rule="TRUSTEE_RESOLUTION", ok=bool(m.trustee_resolution_ref and m.steward_authorization_hash),
                           detail="Movement needs a trustee resolution reference and a steward authorization hash."))
        if m.on >= sunset:
            out.append(Finding(rule="SUNSET_COVENANT", ok=m.kind is MovementKind.WIND_UP,
                               detail=f"Trust sunset on {sunset}; only WIND_UP is allowed."))
        else:
            out.append(Finding(rule="SUNSET_COVENANT", ok=m.kind is not MovementKind.WIND_UP,
                               detail=f"WIND_UP is only valid on or after {sunset}."))
        if m.commitment_end is not None:
            out.append(Finding(rule="SUNSET_COMMITMENT", ok=m.commitment_end <= sunset,
                               detail="No commitment may extend beyond the sunset date."))
        bal = {1: led.tier1, 2: led.tier2, 3: led.tier3}
        out.append(Finding(rule="SUFFICIENT_BALANCE", ok=bal[m.from_tier] >= m.amount, detail=f"Tier {m.from_tier} balance."))
        if m.kind is MovementKind.TRANSFER:
            out.append(Finding(rule="TRANSFER_TARGET", ok=m.to_tier is not None and m.to_tier != m.from_tier,
                               detail="TRANSFER needs a different destination tier."))
        if m.kind is not MovementKind.WIND_UP and m.from_tier == 1:
            ok = (led.tier1 - m.amount) >= led.tier1_required
            out.append(Finding(rule="TIER1_RUNWAY", ok=ok, detail=f"Tier 1 must keep {RUNWAY_MONTHS} months of burn."))
        if m.kind is MovementKind.TRANSFER and m.to_tier == 3:
            out.append(Finding(rule="TIER3_CAP", ok=(led.tier3 + m.amount) <= led.total * led.tier3_cap_fraction,
                               detail="Tier 3 must stay within its cap (<=20% by default)."))
        if m.kind is MovementKind.DISTRIBUTION:
            window = sum((a for d, a in self._outflows if m.on - d < timedelta(days=365)), Decimal(0)) + m.amount
            limit = self._opening_corpus(m.on) * t.max_annual_outflow_fraction
            out.append(Finding(rule="ART_16_1_INTERGENERATIONAL_CAPACITY", ok=window <= limit,
                               detail=f"12-month outflow {window} vs limit {limit} (assumed {t.max_annual_outflow_fraction:.0%})."))
            if m.from_tier == 3:
                pass
        return out

    def apply(self, m: Movement) -> List[Finding]:
        """Check, then mutate the ledger. Any failed rule raises and nothing changes."""
        findings = self.check(m)
        if not all(f.ok for f in findings):
            raise TrustComplianceError(findings)
        attr = {1: "tier1", 2: "tier2", 3: "tier3"}
        setattr(self.ledger, attr[m.from_tier], getattr(self.ledger, attr[m.from_tier]) - m.amount)
        if m.kind is MovementKind.TRANSFER and m.to_tier:
            setattr(self.ledger, attr[m.to_tier], getattr(self.ledger, attr[m.to_tier]) + m.amount)
        else:
            self._outflows.append((m.on, m.amount))
        return findings
