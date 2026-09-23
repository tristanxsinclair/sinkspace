export type PrimeConstitutionalEngineeringAction =
  | {
      status:
        'NOT_CONSTITUTIONAL_ENGINEERING';
    }
  | {
      status:
        'EXECUTE_AUTHORIZATION';
      authorization_id:
        string;
    };

export function interpretPrimeConstitutionalEngineering(
  input: string
): PrimeConstitutionalEngineeringAction {
  const match =
    input.match(
      /^\s*prime,?\s*execute\s+authorization\s+(LY-AUTH-[a-f0-9]{32})\s*[.!]?\s*$/i
    );

  if (!match) {
    return {
      status:
        'NOT_CONSTITUTIONAL_ENGINEERING'
    };
  }

  const authorizationId =
    match[1];

  if (!authorizationId) {
    return {
      status:
        'NOT_CONSTITUTIONAL_ENGINEERING'
    };
  }

  return {
    status:
      'EXECUTE_AUTHORIZATION',

    authorization_id:
      authorizationId
  };
}
