export type PrimeAuthorizationInterpretation =
  | {
      status: 'NOT_AUTHORIZATION';
    }
  | {
      status: 'AUTHORIZE_PLAN';
      plan_id: string;
    };

const AUTHORIZE_PLAN =
  /^\s*prime,?\s+authori[sz]e\s+(?:and\s+begin\s+)?(?:the\s+)?(?:constitutional\s+)?plan\s+(LY-PLAN-[A-Za-z0-9-]+)\s*[.!]?\s*$/i;

export function interpretPrimeAuthorization(
  input: string
): PrimeAuthorizationInterpretation {
  const match =
    input.match(AUTHORIZE_PLAN);

  if (!match?.[1]) {
    return {
      status: 'NOT_AUTHORIZATION'
    };
  }

  return {
    status: 'AUTHORIZE_PLAN',
    plan_id: match[1]
  };
}
