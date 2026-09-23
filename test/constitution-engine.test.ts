import { test } from "node:test";
import assert from "node:assert/strict";

import {
  evaluateAction,
  type ConstitutionalAction,
} from "../runtime/constitution-engine.js";

test("unknown authority is refused", () => {
  const action: ConstitutionalAction = {
    id: "ACTION-001",
    actor: "FOUNDER",
    authorityId: "DOES-NOT-EXIST",
  };

  const result = evaluateAction(action);

  assert.equal(result.authorityFound, false);
  assert.equal(result.decision, "REFUSE");
});

test("authority cannot be claimed by the wrong actor", () => {
  const action: ConstitutionalAction = {
    id: "ACTION-002",
    actor: "FOUNDER",
    authorityId: "PARLIAMENT",
  };

  const result = evaluateAction(action);

  assert.equal(result.authorityFound, true);
  assert.equal(result.decision, "REFUSE");
});

test("AI action requires human institutional review", () => {
  const action: ConstitutionalAction = {
    id: "ACTION-003",
    actor: "AI",
    authorityId: "AI",
  };

  const result = evaluateAction(action);

  assert.equal(result.authorityFound, true);
  assert.equal(result.decision, "ESCALATE");
});

test("lawful institutional action is allowed", () => {
  const action: ConstitutionalAction = {
    id: "ACTION-004",
    actor: "POLICE",
    authorityId: "POLICE",
    order: {
      id: "ORDER-004",
      issuerAuthority: "STATUTE",
      targetAuthority: "COMMAND",
      legalBasis: ["STATUTE-001"],
      prohibitedByConstitution: false,
      criminalityObvious: false,
      seriousRightsViolation: false,
    },
  };

  const result = evaluateAction(action);

  assert.equal(result.authorityFound, true);
  assert.equal(result.decision, "ALLOW");
});

test("manifestly unlawful action is refused", () => {
  const action: ConstitutionalAction = {
    id: "ACTION-005",
    actor: "POLICE",
    authorityId: "POLICE",
    order: {
      id: "ORDER-005",
      issuerAuthority: "COMMAND",
      targetAuthority: "COMMAND",
      legalBasis: ["INVALID-001"],
      prohibitedByConstitution: true,
      criminalityObvious: false,
      seriousRightsViolation: false,
    },
  };

  const result = evaluateAction(action);

  assert.equal(result.authorityFound, true);
  assert.equal(result.decision, "REFUSE");
});

test("serious rights concern escalates for independent review", () => {
  const action: ConstitutionalAction = {
    id: "ACTION-006",
    actor: "EXECUTIVE",
    authorityId: "EXECUTIVE",
    order: {
      id: "ORDER-006",
      issuerAuthority: "STATUTE",
      targetAuthority: "COMMAND",
      legalBasis: ["STATUTE-002"],
      prohibitedByConstitution: false,
      criminalityObvious: false,
      seriousRightsViolation: true,
    },
  };

  const result = evaluateAction(action);

  assert.equal(result.authorityFound, true);
  assert.equal(result.decision, "ESCALATE");
});
