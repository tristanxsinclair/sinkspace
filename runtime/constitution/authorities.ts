export type AuthorityLevel =
  | "CONSTITUTION"
  | "JUDICIARY"
  | "STATUTE"
  | "REGULATION"
  | "COMMAND";

export type AuthorityActor =
  | "PEOPLE"
  | "PARLIAMENT"
  | "EXECUTIVE"
  | "JUDICIARY"
  | "POLICE"
  | "INTELLIGENCE"
  | "DEFENCE"
  | "FOUNDER"
  | "AI";

export type Authority = {
  id: string;
  actor: AuthorityActor;
  level: AuthorityLevel;
  scope: string[];
  independentReviewRequired: boolean;
};

export const AUTHORITY_LEVELS: Record<AuthorityLevel, number> = {
  CONSTITUTION: 100,
  JUDICIARY: 90,
  STATUTE: 80,
  REGULATION: 70,
  COMMAND: 60,
};

export const AUTHORITIES: Authority[] = [
  {
    id: "PEOPLE",
    actor: "PEOPLE",
    level: "CONSTITUTION",
    scope: ["constitutional sovereignty"],
    independentReviewRequired: true,
  },

  {
    id: "PARLIAMENT",
    actor: "PARLIAMENT",
    level: "STATUTE",
    scope: ["legislation", "public oversight"],
    independentReviewRequired: true,
  },

  {
    id: "JUDICIARY",
    actor: "JUDICIARY",
    level: "JUDICIARY",
    scope: ["judicial review", "warrants", "constitutional interpretation"],
    independentReviewRequired: true,
  },

  {
    id: "EXECUTIVE",
    actor: "EXECUTIVE",
    level: "REGULATION",
    scope: ["administration", "lawful execution"],
    independentReviewRequired: true,
  },

  {
    id: "POLICE",
    actor: "POLICE",
    level: "COMMAND",
    scope: ["law enforcement"],
    independentReviewRequired: true,
  },

  {
    id: "INTELLIGENCE",
    actor: "INTELLIGENCE",
    level: "COMMAND",
    scope: ["intelligence gathering"],
    independentReviewRequired: true,
  },

  {
    id: "DEFENCE",
    actor: "DEFENCE",
    level: "COMMAND",
    scope: ["national defence"],
    independentReviewRequired: true,
  },

  {
    id: "FOUNDER",
    actor: "FOUNDER",
    level: "COMMAND",
    scope: ["founding responsibilities"],
    independentReviewRequired: true,
  },

  {
    id: "AI",
    actor: "AI",
    level: "COMMAND",
    scope: [],
    independentReviewRequired: true,
  },
];

export function getAuthority(id: string): Authority | undefined {
  return AUTHORITIES.find((authority) => authority.id === id);
}

export function outranks(
  higher: AuthorityLevel,
  lower: AuthorityLevel,
): boolean {
  return AUTHORITY_LEVELS[higher] > AUTHORITY_LEVELS[lower];
}
