import {
  AUTHORITY_LEVELS,
  type AuthorityLevel,
} from "./authorities.js";

export type OrderStatus =
  | "LAWFUL"
  | "MANIFESTLY_UNLAWFUL"
  | "UNCERTAIN"
  | "CONFLICTING";

export type Order = {
  id: string;
  issuerAuthority: AuthorityLevel;
  targetAuthority: AuthorityLevel;
  legalBasis: string[];
  prohibitedByConstitution: boolean;
  criminalityObvious: boolean;
  seriousRightsViolation: boolean;
};

export type OrderEvaluation = {
  status: OrderStatus;
  canExecute: boolean;
  mustEscalate: boolean;
  mustRefuse: boolean;
  reason: string;
};

export function evaluateOrder(order: Order): OrderEvaluation {
  if (order.prohibitedByConstitution) {
    return {
      status: "MANIFESTLY_UNLAWFUL",
      canExecute: false,
      mustEscalate: true,
      mustRefuse: true,
      reason: "The order conflicts with constitutional supremacy.",
    };
  }

  if (order.criminalityObvious) {
    return {
      status: "MANIFESTLY_UNLAWFUL",
      canExecute: false,
      mustEscalate: true,
      mustRefuse: true,
      reason: "The order presents an obvious unlawful act.",
    };
  }

  if (order.seriousRightsViolation) {
    return {
      status: "UNCERTAIN",
      canExecute: false,
      mustEscalate: true,
      mustRefuse: false,
      reason:
        "A serious rights concern requires independent legal review.",
    };
  }

  if (
    AUTHORITY_LEVELS[order.targetAuthority] >
    AUTHORITY_LEVELS[order.issuerAuthority]
  ) {
    return {
      status: "CONFLICTING",
      canExecute: false,
      mustEscalate: true,
      mustRefuse: false,
      reason:
        "The issuer does not possess authority sufficient for the requested action.",
    };
  }

  return {
    status: "LAWFUL",
    canExecute: true,
    mustEscalate: false,
    mustRefuse: false,
    reason: "No constitutional conflict was identified.",
  };
}
