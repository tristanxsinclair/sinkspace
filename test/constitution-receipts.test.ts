import { test } from "node:test";
import assert from "node:assert/strict";

import { evaluateAction } from "../runtime/constitution-engine.js";
import {
  createConstitutionalReceipt,
} from "../runtime/constitution/receipts.js";

test("constitutional receipt records the engine decision", () => {
  const action = {
    id: "ACTION-RECEIPT-001",
    actor: "POLICE" as const,
    authorityId: "POLICE",
    order: {
      id: "ORDER-RECEIPT-001",
      issuerAuthority: "STATUTE" as const,
      targetAuthority: "COMMAND" as const,
      legalBasis: ["STATUTE-001"],
      prohibitedByConstitution: true,
      criminalityObvious: false,
      seriousRightsViolation: false,
    },
  };

  const evaluation = evaluateAction(action);

  const receipt = createConstitutionalReceipt(
    action,
    evaluation,
    "2026-09-23T13:00:00.000Z",
  );

  assert.equal(receipt.receiptType, "constitutional_decision");
  assert.equal(receipt.receiptVersion, 1);
  assert.equal(receipt.actionId, action.id);
  assert.equal(receipt.actor, "POLICE");
  assert.equal(receipt.authorityId, "POLICE");
  assert.equal(receipt.constitutionVersion, evaluation.constitutionVersion);
  assert.equal(receipt.decision, "REFUSE");
  assert.equal(receipt.createdAt, "2026-09-23T13:00:00.000Z");
  assert.ok(receipt.receiptId.length > 0);
});

test("identical constitutional decisions produce identical receipt IDs", () => {
  const action = {
    id: "ACTION-RECEIPT-002",
    actor: "EXECUTIVE" as const,
    authorityId: "EXECUTIVE",
  };

  const evaluation = evaluateAction(action);
  const timestamp = "2026-09-23T13:00:00.000Z";

  const first = createConstitutionalReceipt(
    action,
    evaluation,
    timestamp,
  );

  const second = createConstitutionalReceipt(
    action,
    evaluation,
    timestamp,
  );

  assert.equal(first.receiptId, second.receiptId);
});

test("different decisions produce different receipt IDs", () => {
  const action = {
    id: "ACTION-RECEIPT-003",
    actor: "POLICE" as const,
    authorityId: "POLICE",
  };

  const allowed = evaluateAction(action);

  const refusedAction = {
    ...action,
    order: {
      id: "ORDER-RECEIPT-003",
      issuerAuthority: "COMMAND" as const,
      targetAuthority: "COMMAND" as const,
      legalBasis: ["INVALID-001"],
      prohibitedByConstitution: true,
      criminalityObvious: false,
      seriousRightsViolation: false,
    },
  };

  const refused = evaluateAction(refusedAction);

  const allowedReceipt = createConstitutionalReceipt(
    action,
    allowed,
    "2026-09-23T13:00:00.000Z",
  );

  const refusedReceipt = createConstitutionalReceipt(
    refusedAction,
    refused,
    "2026-09-23T13:00:00.000Z",
  );

  assert.notEqual(
    allowedReceipt.receiptId,
    refusedReceipt.receiptId,
  );
});

test("receipt reasons are copied rather than shared", () => {
  const action = {
    id: "ACTION-RECEIPT-004",
    actor: "AI" as const,
    authorityId: "AI",
  };

  const evaluation = evaluateAction(action);

  const receipt = createConstitutionalReceipt(
    action,
    evaluation,
    "2026-09-23T13:00:00.000Z",
  );

  assert.notEqual(receipt.reasons, evaluation.reasons);
  assert.deepEqual(receipt.reasons, evaluation.reasons);
});
