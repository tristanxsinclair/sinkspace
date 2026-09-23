import { createHash } from "node:crypto";

import type {
  ConstitutionalEvaluation,
  ConstitutionalAction,
} from "../constitution-engine.js";

export type ConstitutionalReceipt = {
  receiptType: "constitutional_decision";
  receiptVersion: 1;
  receiptId: string;
  actionId: string;
  actor: ConstitutionalAction["actor"];
  authorityId: string;
  constitutionVersion: string;
  decision: ConstitutionalEvaluation["decision"];
  reasons: string[];
  createdAt: string;
};

function canonicalReceiptInput(
  receipt: Omit<ConstitutionalReceipt, "receiptId">,
): string {
  return JSON.stringify({
    receiptType: receipt.receiptType,
    receiptVersion: receipt.receiptVersion,
    actionId: receipt.actionId,
    actor: receipt.actor,
    authorityId: receipt.authorityId,
    constitutionVersion: receipt.constitutionVersion,
    decision: receipt.decision,
    reasons: receipt.reasons,
    createdAt: receipt.createdAt,
  });
}

export function createConstitutionalReceipt(
  action: ConstitutionalAction,
  evaluation: ConstitutionalEvaluation,
  createdAt = new Date().toISOString(),
): ConstitutionalReceipt {
  const unsigned: Omit<ConstitutionalReceipt, "receiptId"> = {
    receiptType: "constitutional_decision",
    receiptVersion: 1,
    actionId: action.id,
    actor: action.actor,
    authorityId: action.authorityId,
    constitutionVersion: evaluation.constitutionVersion,
    decision: evaluation.decision,
    reasons: [...evaluation.reasons],
    createdAt,
  };

  const receiptId = createHash("sha256")
    .update(canonicalReceiptInput(unsigned))
    .digest("hex");

  return {
    ...unsigned,
    receiptId,
  };
}
