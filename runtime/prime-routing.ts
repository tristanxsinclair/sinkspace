/**
 * Distinguishes historical run readback from new Prime commands.
 *
 * Agent names and run IDs are references, not intent by themselves.
 * Explicit new/execution/governance intent always outranks readback.
 */
export function looksLikePrimeRunQuestion(
  message: string
): boolean {
  const input = message.trim();

  if (!input) {
    return false;
  }

  const explicitNewIntent =
    /\b(?:execute|launch|start|begin|create|deploy|decompose|implement|establish|register|build|perform|conduct)\b/i
      .test(input) ||
    /\bnew\s+(?:run|mission|revenue|experiment|task)\b/i
      .test(input) ||
    /\bmust\s+(?:review|verify|audit|challenge|inspect|build|implement|create|execute)\b/i
      .test(input);

  if (explicitNewIntent) {
    return false;
  }

  const explicitQuestion =
    /\bwhat did\b/i.test(input) ||
    /\bwhat (?:have|did) (?:you|they|the agents?)\b/i
      .test(input) ||
    /\bwhat happened\b/i.test(input);

  const explicitReadbackVerb =
    /\b(?:summari[sz]e|show me|tell me|give me)\b/i
      .test(input);

  const historicalReference =
    /\b(?:results?|summary|last run|current run|previous run|persisted run|run\s+[0-9a-f-]{8,})\b/i
      .test(input);

  const agentReference =
    /\b(?:sink[- ]?0[345]|prospector|economist|analyst|auditor|red[- ]?sink|red team)\b/i
      .test(input);

  return (
    explicitQuestion ||
    explicitReadbackVerb ||
    historicalReference &&
      agentReference
  );
}
