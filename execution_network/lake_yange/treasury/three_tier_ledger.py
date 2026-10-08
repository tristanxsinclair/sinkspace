"""Three-tier treasury balance sheet. All amounts Decimal; nothing here moves real money."""
from __future__ import annotations

from decimal import Decimal
from typing import Dict, List

RUNWAY_MONTHS = 24


class TreasuryRuleViolation(Exception):
    pass


class ThreeTierLedger:
    """Tier 1 core reserve (zero volatility), Tier 2 productive assets, Tier 3 capped volatile growth.

    `tier3_cap_fraction` (default 20% of total) is an assumption: the brief says "capped" without a number.
    """

    DRAWDOWN_PAUSE_THRESHOLD = Decimal("0.20")

    def __init__(self, tier1_cash: Decimal, tier2_assets: Decimal, tier3_assets: Decimal,
                 monthly_essential_burn: Decimal, tier3_cap_fraction: Decimal = Decimal("0.20")) -> None:
        for name, v in (("tier1", tier1_cash), ("tier2", tier2_assets), ("tier3", tier3_assets)):
            if not v.is_finite() or v < 0:
                raise ValueError(f"{name} must be a non-negative finite amount")
        if not monthly_essential_burn.is_finite() or monthly_essential_burn <= 0:
            raise ValueError("monthly_essential_burn must be positive")
        self.tier1, self.tier2, self.tier3 = tier1_cash, tier2_assets, tier3_assets
        self.monthly_essential_burn = monthly_essential_burn
        self.tier3_cap_fraction = tier3_cap_fraction
        self.tier3_projects: Dict[str, bool] = {}  # name -> paused

    @property
    def tier1_required(self) -> Decimal:
        return self.monthly_essential_burn * RUNWAY_MONTHS

    @property
    def tier1_runway_months(self) -> Decimal:
        return self.tier1 / self.monthly_essential_burn

    @property
    def tier1_funded_pct(self) -> Decimal:
        return min(Decimal(100), self.tier1 / self.tier1_required * 100)

    @property
    def total(self) -> Decimal:
        return self.tier1 + self.tier2 + self.tier3

    @property
    def tier3_over_cap(self) -> bool:
        return self.total > 0 and self.tier3 > self.total * self.tier3_cap_fraction

    def start_growth_project(self, name: str) -> None:
        if self.tier1_funded_pct < 100 or self.tier3_over_cap:
            raise TreasuryRuleViolation("Tier 3 projects need a fully funded Tier 1 and Tier 3 within its cap.")
        self.tier3_projects[name] = False

    def transfer_from_tier1(self, to_tier: int, amount: Decimal) -> None:
        """Only surplus above the 24-month requirement may leave Tier 1; Tier 3 must stay under its cap."""
        if to_tier not in (2, 3) or amount <= 0:
            raise ValueError("Invalid transfer")
        if self.tier1 - amount < self.tier1_required:
            raise TreasuryRuleViolation("Transfer would breach the 24-month Tier 1 runway.")
        if to_tier == 3 and (self.tier3 + amount) > self.total * self.tier3_cap_fraction:
            raise TreasuryRuleViolation("Transfer would exceed the Tier 3 cap.")
        self.tier1 -= amount
        if to_tier == 2:
            self.tier2 += amount
        else:
            self.tier3 += amount

    def pause_tier3_projects(self) -> List[str]:
        for name in self.tier3_projects:
            self.tier3_projects[name] = True
        return list(self.tier3_projects)

    def enforce_rules(self) -> List[str]:
        """Auto-pause Tier 3 growth if Tier 1 is underfunded or Tier 3 exceeds its cap."""
        if self.tier1_funded_pct < 100 or self.tier3_over_cap:
            return self.pause_tier3_projects()
        return []

    def apply_market_move(self, tier2_loss: Decimal, tier3_loss: Decimal) -> None:
        """Tier 1 is zero-volatility by definition and is never touched by market moves."""
        for v in (tier2_loss, tier3_loss):
            if not (Decimal(0) <= v <= Decimal(1)):
                raise ValueError("Loss fractions must be within [0, 1]")
        self.tier2 *= (1 - tier2_loss)
        self.tier3 *= (1 - tier3_loss)
        if max(tier2_loss, tier3_loss) >= self.DRAWDOWN_PAUSE_THRESHOLD:
            self.pause_tier3_projects()
        self.enforce_rules()

    def apply_burn_shock(self, multiplier: Decimal) -> None:
        if multiplier <= 0:
            raise ValueError("multiplier must be positive")
        self.monthly_essential_burn *= multiplier
        self.enforce_rules()
