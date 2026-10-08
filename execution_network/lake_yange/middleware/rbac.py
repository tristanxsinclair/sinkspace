"""Role ACLs. No agent role holds an authorization or signing permission: intelligence is not authority."""
from __future__ import annotations

from enum import Enum
from typing import Dict, FrozenSet


class Action(str, Enum):
    OBSERVE = "OBSERVE"
    ANALYZE = "ANALYZE"
    PROPOSE = "PROPOSE"
    EXECUTE = "EXECUTE"
    RECORD = "RECORD"
    REVIEW = "REVIEW"


ROLE_ACLS: Dict[str, FrozenSet[Action]] = {
    "prime": frozenset({Action.OBSERVE, Action.ANALYZE, Action.PROPOSE}),
    "vera": frozenset({Action.OBSERVE, Action.ANALYZE, Action.REVIEW}),
    "forge": frozenset({Action.OBSERVE, Action.EXECUTE}),
    "red_sink": frozenset({Action.RECORD}),
}


class PermissionDenied(Exception):
    pass


def check(agent_id: str, action: Action) -> None:
    allowed = ROLE_ACLS.get(agent_id)
    if allowed is None:
        raise PermissionDenied(f"Unknown agent {agent_id!r}.")
    if action not in allowed:
        raise PermissionDenied(f"Agent {agent_id!r} may not {action.value}.")
