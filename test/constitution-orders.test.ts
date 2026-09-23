import { test } from "node:test";
import assert from "node:assert/strict";

import {
  evaluateOrder,
  type Order,
} from "../runtime/constitution/orders.js";

test("lawful order can proceed", () => {
  const order: Order = {
    id: "ORDER-001",
    issuerAuthority: "STATUTE",
    targetAuthority: "COMMAND",
    legalBasis: ["STATUTE-001"],
    prohibitedByConstitution: false,
    criminalityObvious: false,
    seriousRightsViolation: false,
  };

  const result = evaluateOrder(order);

  assert.equal(result.status, "LAWFUL");
  assert.equal(result.canExecute, true);
  assert.equal(result.mustEscalate, false);
  assert.equal(result.mustRefuse, false);
});

test("constitutionally prohibited order must be refused", () => {
  const order: Order = {
    id: "ORDER-002",
    issuerAuthority: "COMMAND",
    targetAuthority: "COMMAND",
    legalBasis: ["COMMAND-001"],
    prohibitedByConstitution: true,
    criminalityObvious: false,
    seriousRightsViolation: false,
  };

  const result = evaluateOrder(order);

  assert.equal(result.status, "MANIFESTLY_UNLAWFUL");
  assert.equal(result.canExecute, false);
  assert.equal(result.mustEscalate, true);
  assert.equal(result.mustRefuse, true);
});

test("obviously criminal order must be refused", () => {
  const order: Order = {
    id: "ORDER-003",
    issuerAuthority: "COMMAND",
    targetAuthority: "COMMAND",
    legalBasis: ["COMMAND-002"],
    prohibitedByConstitution: false,
    criminalityObvious: true,
    seriousRightsViolation: false,
  };

  const result = evaluateOrder(order);

  assert.equal(result.status, "MANIFESTLY_UNLAWFUL");
  assert.equal(result.canExecute, false);
  assert.equal(result.mustEscalate, true);
  assert.equal(result.mustRefuse, true);
});

test("serious rights concern requires review", () => {
  const order: Order = {
    id: "ORDER-004",
    issuerAuthority: "STATUTE",
    targetAuthority: "COMMAND",
    legalBasis: ["STATUTE-002"],
    prohibitedByConstitution: false,
    criminalityObvious: false,
    seriousRightsViolation: true,
  };

  const result = evaluateOrder(order);

  assert.equal(result.status, "UNCERTAIN");
  assert.equal(result.canExecute, false);
  assert.equal(result.mustEscalate, true);
  assert.equal(result.mustRefuse, false);
});

test("insufficient authority cannot authorize a higher-level action", () => {
  const order: Order = {
    id: "ORDER-005",
    issuerAuthority: "COMMAND",
    targetAuthority: "JUDICIARY",
    legalBasis: ["COMMAND-003"],
    prohibitedByConstitution: false,
    criminalityObvious: false,
    seriousRightsViolation: false,
  };

  const result = evaluateOrder(order);

  assert.equal(result.status, "CONFLICTING");
  assert.equal(result.canExecute, false);
  assert.equal(result.mustEscalate, true);
});
