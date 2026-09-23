export type ConstitutionalSeverity =
  | "info"
  | "warning"
  | "critical";

export type ConstitutionalDecision =
  | "ALLOW"
  | "ESCALATE"
  | "REFUSE"
  | "JUDICIAL_REVIEW";

export type ConstitutionalRule = {
  id: string;
  article: string;
  title: string;
  principle: string;
  severity: ConstitutionalSeverity;
  evaluates: string[];
};

export const CONSTITUTION_VERSION = "0.1.0";

export const CONSTITUTIONAL_RULES: ConstitutionalRule[] = [
  {
    id: "SUPREMACY_OF_CONSTITUTION",
    article: "I.1",
    title: "Constitutional Supremacy",
    principle:
      "All public authority is subordinate to the Constitution.",
    severity: "critical",
    evaluates: [
      "authority.source",
      "authority.scope",
      "action.legality",
    ],
  },

  {
    id: "NO_FOUNDER_SOVEREIGNTY",
    article: "VIII.22",
    title: "No Founder Sovereignty",
    principle:
      "Founder status creates no authority above the Constitution.",
    severity: "critical",
    evaluates: [
      "authority.actor",
      "authority.source",
      "authority.scope",
    ],
  },

  {
    id: "AI_NO_SOVEREIGNTY",
    article: "XV.45",
    title: "AI Cannot Become Sovereign",
    principle:
      "No artificial intelligence system may possess sovereign authority.",
    severity: "critical",
    evaluates: [
      "actor.type",
      "authority.source",
      "authority.scope",
    ],
  },

  {
    id: "LAWFUL_ORDERS",
    article: "XII.35",
    title: "Lawful Orders",
    principle:
      "Public officers shall obey lawful authority and may refuse manifestly unlawful orders.",
    severity: "critical",
    evaluates: [
      "order.issuer",
      "order.authority",
      "order.legality",
    ],
  },

  {
    id: "INDEPENDENT_REVIEW",
    article: "XIII.39",
    title: "Independent Review",
    principle:
      "A disputed exercise of public authority must be capable of independent review.",
    severity: "critical",
    evaluates: [
      "review.available",
      "review.independence",
      "conflict.present",
    ],
  },
];
