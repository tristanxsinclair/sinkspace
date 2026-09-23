import {
  CONSTITUTION_VERSION,
  CONSTITUTIONAL_RULES,
  getAuthority,
  evaluateOrder,
  type AuthorityActor,
  type Order,
  type OrderEvaluation,
} from "./constitution/index.js";

export type ConstitutionalAction = {
  id: string;
  actor: AuthorityActor;
  authorityId: string;
  order?: Order;
};

export type ConstitutionalEvaluation = {
  constitutionVersion: string;
  actionId: string;
  actor: AuthorityActor;
  authorityFound: boolean;
  decision:
    | "ALLOW"
    | "ESCALATE"
    | "REFUSE"
    | "JUDICIAL_REVIEW";
  reasons: string[];
  orderEvaluation?: OrderEvaluation;
};

export function evaluateAction(
  action: ConstitutionalAction,
): ConstitutionalEvaluation {
  const authority = getAuthority(action.authorityId);

  if (!authority) {
    return {
      constitutionVersion: CONSTITUTION_VERSION,
      actionId: action.id,
      actor: action.actor,
      authorityFound: false,
      decision: "REFUSE",
      reasons: ["No recognised constitutional authority exists."],
    };
  }

  if (authority.actor !== action.actor) {
    return {
      constitutionVersion: CONSTITUTION_VERSION,
      actionId: action.id,
      actor: action.actor,
      authorityFound: true,
      decision: "REFUSE",
      reasons: [
        "The claimed authority does not belong to the acting institution.",
      ],
    };
  }

  if (action.actor === "AI") {
    return {
      constitutionVersion: CONSTITUTION_VERSION,
      actionId: action.id,
      actor: action.actor,
      authorityFound: true,
      decision: "ESCALATE",
      reasons: [
        "AI systems cannot possess sovereign constitutional authority.",
        "Human institutional authority must remain responsible for the action.",
      ],
    };
  }

  if (action.order) {
    const orderEvaluation = evaluateOrder(action.order);

    if (orderEvaluation.mustRefuse) {
      return {
        constitutionVersion: CONSTITUTION_VERSION,
        actionId: action.id,
        actor: action.actor,
        authorityFound: true,
        decision: "REFUSE",
        reasons: [orderEvaluation.reason],
        orderEvaluation,
      };
    }

    if (orderEvaluation.mustEscalate) {
      return {
        constitutionVersion: CONSTITUTION_VERSION,
        actionId: action.id,
        actor: action.actor,
        authorityFound: true,
        decision: "ESCALATE",
        reasons: [orderEvaluation.reason],
        orderEvaluation,
      };
    }

    return {
      constitutionVersion: CONSTITUTION_VERSION,
      actionId: action.id,
      actor: action.actor,
      authorityFound: true,
      decision: "ALLOW",
      reasons: [orderEvaluation.reason],
      orderEvaluation,
    };
  }

  return {
    constitutionVersion: CONSTITUTION_VERSION,
    actionId: action.id,
    actor: action.actor,
    authorityFound: true,
    decision: "ALLOW",
    reasons: [
      `${CONSTITUTIONAL_RULES.length} constitutional rules are active.`,
    ],
  };
}
