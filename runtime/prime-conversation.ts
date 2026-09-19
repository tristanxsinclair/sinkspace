import type {
  Artifact,
  Event,
  Run
} from './contracts.js';

export type PrimeAgentId =
  | 'SINK-PRIME'
  | 'SINK-04'
  | 'SINK-05'
  | 'SINK-03'
  | 'RED-SINK';

export type PrimeRunAnswer = {
  status:
    | 'ANSWERED'
    | 'NEEDS_CLARIFICATION';

  reply: string;

  run_id: string;

  evidence: {
    agent_id: string;
    event_ids: string[];
    artifact_ids: string[];
  }[];
};

function requestedAgent(
  input: string
): PrimeAgentId | null {
  if (
    /\b(sink[- ]?04|prospector)\b/i
      .test(input)
  ) {
    return 'SINK-04';
  }

  if (
    /\b(sink[- ]?05|economist|analyst)\b/i
      .test(input)
  ) {
    return 'SINK-05';
  }

  if (
    /\b(sink[- ]?03|auditor|audit)\b/i
      .test(input)
  ) {
    return 'SINK-03';
  }

  if (
    /\b(red[- ]?sink|red team)\b/i
      .test(input)
  ) {
    return 'RED-SINK';
  }

  return null;
}

function agentEvents(
  run: Run,
  agentId: string
): Event[] {
  return run.events.filter(
    event =>
      event.agent_id === agentId
  );
}

function agentArtifacts(
  run: Run,
  agentId: string
): Artifact[] {
  return run.artifacts.filter(
    artifact =>
      artifact.agent_id === agentId
  );
}

function cleanText(
  value: string
): string {
  return value
    .replace(
      /\[([^\]]+)\]\([^)]+\)/g,
      '$1'
    )
    .replace(
      /https?:\/\/\S+/g,
      ''
    )
    .replace(
      /[`#*_>{}[\]]/g,
      ' '
    )
    .replace(
      /\s+/g,
      ' '
    )
    .trim();
}

function usefulEvent(
  event: Event
): boolean {
  return [
    'ARTIFACT_CREATED',
    'CLAIM_CREATED',
    'EVIDENCE_ATTACHED',
    'BLACKBOARD_ENTRY_CREATED',
    'AUDIT_PASSED',
    'RED_SINK_COMPLETED'
  ].includes(event.type);
}

function humanEventSummary(
  events: Event[]
): string[] {
  const summaries =
    events
      .filter(usefulEvent)
      .map(
        event =>
          cleanText(
            event.summary
          )
      )
      .filter(
        summary =>
          summary.length >= 20 &&
          !summary.startsWith(
            'public_research completed'
          ) &&
          !/^[0-9a-f-]{20,}$/i
            .test(summary)
      );

  return [
    ...new Set(summaries)
  ].slice(-3);
}

function parseJsonArtifact(
  artifact: Artifact
): unknown | null {
  if (
    artifact.media_type !==
      'application/json' ||
    typeof artifact.content !==
      'string'
  ) {
    return null;
  }

  try {
    return JSON.parse(
      artifact.content
    );
  } catch {
    return null;
  }
}

function opportunityCount(
  artifacts: Artifact[]
): number | null {
  for (
    const artifact of
      [...artifacts].reverse()
  ) {
    const parsed =
      parseJsonArtifact(
        artifact
      );

    if (
      parsed &&
      typeof parsed === 'object' &&
      'opportunities' in parsed &&
      Array.isArray(
        (
          parsed as {
            opportunities?: unknown[];
          }
        ).opportunities
      )
    ) {
      return (
        parsed as {
          opportunities: unknown[];
        }
      ).opportunities.length;
    }
  }

  return null;
}

function markdownHeadline(
  artifacts: Artifact[]
): string | null {
  const artifact =
    [...artifacts]
      .reverse()
      .find(
        candidate =>
          candidate.media_type ===
            'text/markdown' &&
          typeof candidate.content ===
            'string'
      );

  if (
    !artifact ||
    typeof artifact.content !==
      'string'
  ) {
    return null;
  }

  const lines =
    artifact.content
      .split('\n')
      .map(cleanText)
      .filter(Boolean)
      .filter(
        line =>
          !line.startsWith(
            'http'
          )
      );

  const useful =
    lines.filter(
      line =>
        !/^sink clones/i
          .test(line) &&
        line.length > 15
    );

  return useful
    .slice(0, 3)
    .join(' ');
}

function describeAgent(
  run: Run,
  agentId: string
): {
  text: string;
  evidence:
    PrimeRunAnswer['evidence'][number];
} {
  const events =
    agentEvents(
      run,
      agentId
    );

  const artifacts =
    agentArtifacts(
      run,
      agentId
    );

  const eventSummaries =
    humanEventSummary(
      events
    );

  const count =
    opportunityCount(
      artifacts
    );

  const headline =
    markdownHeadline(
      artifacts
    );

  const statements: string[] = [];

  if (
    agentId === 'SINK-04' &&
    count !== null
  ) {
    statements.push(
      `discovered ${count} persisted opportunity candidates`
    );
  }

  if (headline) {
    statements.push(
      headline
    );
  }

  statements.push(
    ...eventSummaries
  );

  const unique =
    [...new Set(statements)]
      .filter(Boolean)
      .slice(0, 3);

  return {
    text:
      unique.length
        ? `${agentId}: ${unique
            .map(value =>
              value.replace(/[.]+$/, '')
            )
            .join('. ')}.`
        : `${agentId}: no substantive persisted output was found for this run.`,

    evidence: {
      agent_id: agentId,

      event_ids:
        events
          .filter(usefulEvent)
          .slice(-5)
          .map(
            event =>
              event.event_id
          ),

      artifact_ids:
        artifacts
          .slice(-5)
          .map(
            artifact =>
              artifact.artifact_id
          )
    }
  };
}

export function answerPrimeRunQuestion(
  input: string,
  run: Run
): PrimeRunAnswer {
  const question =
    input.trim();

  const agent =
    requestedAgent(
      question
    );

  if (agent) {
    const result =
      describeAgent(
        run,
        agent
      );

    return {
      status: 'ANSWERED',

      reply:
        `${result.text}\n\nSource: persisted run ${run.run_id}.`,

      run_id:
        run.run_id,

      evidence: [
        result.evidence
      ]
    };
  }

  if (
    /\b(what did (?:you|your agents|they|the agents) find|what (?:have|did) you find|results?|summari[sz]e|summary|what happened|last run)\b/i
      .test(question)
  ) {
    const agents = [
      'SINK-04',
      'SINK-05',
      'SINK-03',
      'RED-SINK'
    ];

    const results =
      agents.map(
        agentId =>
          describeAgent(
            run,
            agentId
          )
      );

    return {
      status: 'ANSWERED',

      reply: [
        `Latest run ${run.run_id} is ${run.status}.`,
        ...results.map(
          result =>
            result.text
        ),
        'No result above should be treated as realised revenue unless payment evidence exists.'
      ].join('\n\n'),

      run_id:
        run.run_id,

      evidence:
        results.map(
          result =>
            result.evidence
        )
    };
  }

  return {
    status:
      'NEEDS_CLARIFICATION',

    reply:
      'I can inspect the persisted work from this run. Ask what the agents found or ask specifically about SINK-04, SINK-05, SINK-03 or RED-SINK.',

    run_id:
      run.run_id,

    evidence: []
  };
}
