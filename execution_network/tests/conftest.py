from datetime import datetime, timedelta, timezone
from decimal import Decimal

import pytest
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey
from cryptography.hazmat.primitives import serialization

from lake_yange.agents.forge import Forge, SandboxExecutor
from lake_yange.agents.prime import Prime
from lake_yange.agents.red_sink import RedSinkAgent
from lake_yange.agents.vera import Vera
from lake_yange.audit.ledger import RedSinkLedger
from lake_yange.middleware.auth_gate import AuthGate
from lake_yange.middleware.circuit_breaker import CircuitBreaker
from lake_yange.middleware.gateway import BoundedAgentGateway


class Clock:
    def __init__(self):
        self.now = datetime(2026, 1, 1, tzinfo=timezone.utc)

    def __call__(self):
        return self.now

    def advance(self, **kw):
        self.now += timedelta(**kw)


class World:
    pass


@pytest.fixture
def w(tmp_path):
    w = World()
    w.clock = Clock()
    w.ledger = RedSinkLedger(tmp_path / "ledger.jsonl", clock=w.clock)
    w.breaker = CircuitBreaker(w.ledger)
    w.gate = AuthGate(clock=w.clock)
    w.gateway = BoundedAgentGateway(w.gate, w.breaker, RedSinkAgent(w.ledger), clock=w.clock)
    w.keys = {}
    for sid in ("s1", "s2", "s3"):
        k = Ed25519PrivateKey.generate()
        w.keys[sid] = k
        w.gate.register_steward(sid, k.public_key().public_bytes(serialization.Encoding.Raw, serialization.PublicFormat.Raw))
    w.session = {a: w.breaker.issue_session_key(a) for a in ("prime", "vera", "forge")}
    w.prime = Prime(w.gateway, w.session["prime"])
    w.vera = Vera(w.gateway, w.session["vera"])
    w.forge = Forge(w.gateway, w.session["forge"], SandboxExecutor({"noop": lambda p: "done", "boom": lambda p: 1 / 0}))
    w.path = tmp_path / "ledger.jsonl"
    return w
