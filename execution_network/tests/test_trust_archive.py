import json
import os
import stat
from datetime import date
from decimal import Decimal

import pytest

from lake_yange.audit.archive import ArchiveError, EvidenceArchiveExporter, verify_archive
from lake_yange.audit.ledger import RedSinkLedger
from lake_yange.experiments.mode_a_b_harness import ModeABHarness
from lake_yange.treasury.simulator import Simulator
from lake_yange.treasury.three_tier_ledger import ThreeTierLedger
from lake_yange.treasury.trust_deed import (Movement, MovementKind, TrustComplianceError, TrustDeedEngine,
                                            TrustStructure)


def make_ledger(tmp_path, n=4):
    led = RedSinkLedger(tmp_path / "l.jsonl")
    for i in range(n):
        led.append(agent_id="prime", decision="PROPOSED", reason=f"r{i}")
    return led


def export(tmp_path, led):
    h = ModeABHarness(seed=1)
    h.record_mode_b("p1", 80.0); h.record_mode_a_cold_defense("p1", 60.0)
    sim = Simulator(ThreeTierLedger(Decimal(240000), Decimal(500000), Decimal(100000), Decimal(10000)))
    dest = tmp_path / "a.jsonl"
    EvidenceArchiveExporter().export(led, dest, [h], [sim.run_scenario_c_major_loss()])
    return dest


def test_archive_roundtrip_and_readonly(tmp_path):
    dest = export(tmp_path, make_ledger(tmp_path))
    info = verify_archive(dest)
    assert info["entries"] == 4 and info["proofs"] == 2
    assert not os.stat(dest).st_mode & stat.S_IWUSR
    with pytest.raises(FileExistsError):
        EvidenceArchiveExporter().export(make_ledger(tmp_path / "x"), dest)


def test_archive_tamper_detected(tmp_path):
    dest = export(tmp_path, make_ledger(tmp_path))
    os.chmod(dest, 0o644)
    lines = dest.read_text().splitlines()
    obj = json.loads(lines[2]); obj["reason"] = "forged"; lines[2] = json.dumps(obj, sort_keys=True, separators=(",", ":"))
    dest.write_text("\n".join(lines) + "\n")
    with pytest.raises(ArchiveError):
        verify_archive(dest)


def test_archive_tamper_with_recomputed_footer_still_fails_chain_or_proof(tmp_path):
    import hashlib
    dest = export(tmp_path, make_ledger(tmp_path))
    os.chmod(dest, 0o644)
    lines = dest.read_text().splitlines()[:-1]
    obj = json.loads(lines[-1]); obj["payload"]["passed"] = False; lines[-1] = json.dumps(obj, sort_keys=True, separators=(",", ":"))
    body = "".join(l + "\n" for l in lines)
    body += json.dumps({"type": "FOOTER", "sha256": hashlib.sha256(body.encode()).hexdigest()}) + "\n"
    dest.write_text(body)
    with pytest.raises(ArchiveError, match="Proof"):
        verify_archive(dest)


def test_archive_dropped_entry_detected(tmp_path):
    import hashlib
    dest = export(tmp_path, make_ledger(tmp_path))
    os.chmod(dest, 0o644)
    lines = dest.read_text().splitlines()[:-1]
    del lines[2]
    body = "".join(l + "\n" for l in lines)
    dest.write_text(body + json.dumps({"type": "FOOTER", "sha256": hashlib.sha256(body.encode()).hexdigest()}) + "\n")
    with pytest.raises(ArchiveError):
        verify_archive(dest)


def engine(tmp_path=None):
    s = TrustStructure(trust_name="LY Trust", trustee_company="LY Trustee Pty Ltd", trustee_acn="000 000 000",
                       established=date(2026, 1, 1))
    return TrustDeedEngine(s, ThreeTierLedger(Decimal(240000), Decimal(500000), Decimal(100000), Decimal(10000)))


def mv(**kw):
    base = dict(kind=MovementKind.TRANSFER, amount=Decimal(1000), from_tier=2, to_tier=1,
                trustee_resolution_ref="R1", steward_authorization_hash="h", on=date(2027, 1, 1))
    base.update(kw)
    return Movement(**base)


def test_sunset_date_and_transfer_ok():
    e = engine()
    assert e.structure.sunset_date == date(2041, 1, 1)
    e.apply(mv())
    assert e.ledger.tier1 == Decimal(241000)


def test_trust_rules_block():
    e = engine()
    for bad in (mv(trustee_resolution_ref=""),
                mv(from_tier=1, to_tier=2, amount=Decimal(1)),                      # breaks 24-month runway
                mv(to_tier=3, amount=Decimal(100000)),                              # tier 3 cap
                mv(commitment_end=date(2045, 1, 1)),                                # beyond sunset
                mv(on=date(2041, 1, 1)),                                            # after sunset, not wind-up
                mv(kind=MovementKind.WIND_UP),                                      # wind-up before sunset
                mv(kind=MovementKind.DISTRIBUTION, to_tier=None, amount=Decimal(100000))):  # Art 16.1 outflow cap
        before = (e.ledger.tier1, e.ledger.tier2, e.ledger.tier3)
        with pytest.raises(TrustComplianceError):
            e.apply(bad)
        assert (e.ledger.tier1, e.ledger.tier2, e.ledger.tier3) == before


def test_wind_up_after_sunset():
    e = engine()
    e.apply(mv(kind=MovementKind.WIND_UP, to_tier=None, on=date(2041, 1, 2), from_tier=2, amount=Decimal(500000)))
