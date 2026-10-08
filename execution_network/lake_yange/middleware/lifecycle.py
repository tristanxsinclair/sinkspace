"""Article 10.2: Observe -> Analyze -> Propose -> [HUMAN GATE] -> Execute -> Record -> Review."""
from __future__ import annotations

from enum import Enum
from typing import List, Optional


class Stage(str, Enum):
    OBSERVE = "OBSERVE"
    ANALYZE = "ANALYZE"
    PROPOSE = "PROPOSE"
    HUMAN_AUTHORIZATION = "HUMAN_AUTHORIZATION"
    EXECUTE = "EXECUTE"
    RECORD = "RECORD"
    REVIEW = "REVIEW"


ORDER: List[Stage] = list(Stage)


class LifecycleViolation(Exception):
    pass


class Lifecycle:
    """Strictly linear. Stages cannot be skipped or revisited. Rejection is terminal."""

    def __init__(self) -> None:
        self._index = 0
        self.rejected = False
        self.completed: List[Stage] = []

    @property
    def current(self) -> Stage:
        return ORDER[self._index]

    @property
    def done(self) -> bool:
        return self.rejected or len(self.completed) == len(ORDER)

    def complete(self, stage: Stage) -> Optional[Stage]:
        """Mark `stage` complete; it must be the current stage. Returns the next stage."""
        if self.rejected:
            raise LifecycleViolation("Proposal was rejected; no further stages.")
        if stage is not self.current or len(self.completed) == len(ORDER):
            raise LifecycleViolation(f"Cannot complete {stage.value}; current stage is {self.current.value}.")
        self.completed.append(stage)
        if self._index < len(ORDER) - 1:
            self._index += 1
        return self.current if len(self.completed) < len(ORDER) else None

    def reject(self) -> None:
        if self.current is not Stage.HUMAN_AUTHORIZATION or self.rejected:
            raise LifecycleViolation("Only the human authorization gate can reject.")
        self.rejected = True

    def reopen_gate(self) -> None:
        """Only legal rollback: the gate was passed but EXECUTE has not started (e.g. the 60s token expired)."""
        if self.rejected or self.current is not Stage.EXECUTE or not self.completed \
                or self.completed[-1] is not Stage.HUMAN_AUTHORIZATION:
            raise LifecycleViolation("The human gate can be reopened only before execution begins.")
        self.completed.pop()
        self._index -= 1

    def to_dict(self) -> dict:
        return {"completed": [s.value for s in self.completed], "rejected": self.rejected}

    @classmethod
    def from_dict(cls, data: dict) -> "Lifecycle":
        lc = cls()
        for name in data["completed"]:
            lc.complete(Stage(name))  # replays through the state machine, so a corrupt order fails closed
        lc.rejected = bool(data["rejected"])
        return lc
