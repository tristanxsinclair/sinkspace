import {
  WorkerOutputSchema,
  type Claim,
  type Verification,
  type WorkerOutput
} from './contracts.js';

import type {
  ExecutionContext
} from './context.js';

import {
  ControlError,
  hash
} from './security.js';

import {
  SystemProbeSchema,
  type SystemProbe
} from './system-probe.js';

function hostStatements(
  probe: SystemProbe
): string[] {
  return [
    `Host platform is ${JSON.stringify(probe.platform)}.`,
    `Host architecture is ${JSON.stringify(probe.architecture)}.`,
    `Host CPU model is ${JSON.stringify(probe.cpu_model)}.`,
    `Host physical CPU cores: ${probe.physical_cores}.`,
    `Host logical CPU cores: ${probe.logical_cores}.`,
    `Host memory bytes: ${probe.memory_bytes}.`,
    `Host OS version is ${JSON.stringify(probe.os_version)}.`,
    `Host hardware model is ${JSON.stringify(probe.hardware_model)}.`,
    `Rosetta translation active: ${probe.rosetta_translated}.`,
    `XMRig installed: ${probe.xmrig.installed}.`
  ];
}

export function miningOutputFromProbe(
  probe: SystemProbe,
  evidenceId: string,
  id: () => string
): WorkerOutput {
  const claims: Claim[] =
    hostStatements(probe).map(
      statement => ({
        claim_id: id(),
        statement,
        classification: 'KNOWN',
        evidence_ids: [evidenceId],
        predicate: null,
        agent_id: 'SINK-06'
      })
    );

  const uncertainty = [
    'NEEDS_VERIFICATION: Host metadata alone does not establish mining profitability.',
    'NEEDS_VERIFICATION: No sustained mining workload or hashrate measurement was executed.',
    'UNKNOWN: Wall power, electricity cost, live rewards and thermal behaviour were not measured.'
  ];

  return WorkerOutputSchema.parse({
    claims,
    uncertainty,
    report: [
      '# Sink Clones Mining Assessment',
      '',
      'Mode: ASSESS',
      '',
      '## Observed host',
      '',
      ...hostStatements(probe).map(
        item => `- ${item}`
      ),
      '',
      '## Limits',
      '',
      ...uncertainty.map(
        item => `- ${item}`
      )
    ].join('\n')
  });
}

function verification(
  ctx: ExecutionContext,
  verdict: Verification['verdict'],
  reasons: string[],
  checked: string[],
  evidence: string[]
): Verification {
  const config =
    ctx.run.agent_configs.find(
      agent =>
        agent.id === ctx.task.assigned_agent
    );

  if (!config) {
    throw new ControlError(
      'MISSING_AGENT_CONFIGURATION'
    );
  }

  return {
    agent_id: config.id,
    agent_version: config.version,
    verdict,
    reasons,
    checked_claim_ids: checked,
    evidence_ids: [...new Set(evidence)],
    timestamp: ctx.now()
  };
}

export async function miningAssessment(
  ctx: ExecutionContext
): Promise<WorkerOutput> {
  if (
    ctx.task.assigned_agent !== 'SINK-06'
  ) {
    throw new ControlError(
      'INVALID_SPECIALIST'
    );
  }

  if (!ctx.systemProbe) {
    throw new ControlError(
      'TOOL_NOT_IMPLEMENTED'
    );
  }

  const observation =
    await ctx.systemProbe();

  const probe =
    SystemProbeSchema.parse(
      JSON.parse(observation.content)
    );

  const output =
    miningOutputFromProbe(
      probe,
      observation.evidence.evidence_id,
      () => ctx.id()
    );

  ctx.artifact(
    output.report,
    'text/markdown'
  );

  ctx.artifact(
    JSON.stringify(output, null, 2),
    'application/json'
  );

  return output;
}

export async function auditMining(
  ctx: ExecutionContext,
  raw: WorkerOutput
): Promise<Verification> {
  if (
    ctx.task.assigned_agent !== 'SINK-03'
  ) {
    throw new ControlError(
      'AUDITOR_IDENTITY_REQUIRED'
    );
  }

  if (!ctx.systemProbe) {
    throw new ControlError(
      'TOOL_NOT_IMPLEMENTED'
    );
  }

  const output =
    WorkerOutputSchema.parse(raw);

  const failures: string[] = [];

  const fresh =
    await ctx.systemProbe();

  const freshProbe =
    SystemProbeSchema.parse(
      JSON.parse(fresh.content)
    );

  const expected =
    hostStatements(freshProbe);

  const known =
    output.claims.filter(
      claim =>
        claim.classification === 'KNOWN'
    );

  for (const statement of expected) {
    if (
      !known.some(
        claim =>
          claim.statement === statement &&
          claim.agent_id === 'SINK-06'
      )
    ) {
      failures.push(
        `Fresh host observation not represented by SINK-06 claim: ${statement}`
      );
    }
  }

  const structured =
    ctx.run.artifacts.find(
      artifact => {
        if (
          artifact.agent_id !== 'SINK-06' ||
          artifact.media_type !==
            'application/json' ||
          artifact.sha256 !==
            hash(artifact.content)
        ) {
          return false;
        }

        try {
          return (
            hash(
              WorkerOutputSchema.parse(
                JSON.parse(
                  artifact.content
                )
              )
            ) ===
            hash(output)
          );
        } catch {
          return false;
        }
      }
    );

  if (!structured) {
    failures.push(
      'No intact SINK-06 structured assessment artifact.'
    );
  }

  for (const claim of known) {
    for (
      const evidenceId
      of claim.evidence_ids
    ) {
      const evidence =
        ctx.run.evidence.find(
          item =>
            item.evidence_id === evidenceId
        );

      const artifact =
        evidence &&
        ctx.run.artifacts.find(
          item =>
            item.artifact_id ===
            evidence.artifact_id
        );

      if (
        !evidence ||
        !artifact ||
        evidence.tool !==
          'system_probe' ||
        evidence.source !==
          'host:system_probe' ||
        evidence.agent_id !==
          'SINK-06' ||
        artifact.agent_id !==
          'SINK-06' ||
        artifact.sha256 !==
          hash(artifact.content)
      ) {
        failures.push(
          `Invalid mining evidence provenance: ${claim.claim_id}.`
        );
      }
    }
  }

  return verification(
    ctx,
    failures.length
      ? 'FAIL'
      : 'PASS_WITH_LIMITATIONS',
    failures.length
      ? failures
      : [
          'Independent host re-probe matched the SINK-06 assessment. Profitability and sustained mining performance remain unverified.'
        ],
    known.map(
      claim => claim.claim_id
    ),
    [fresh.evidence.evidence_id]
  );
}

export async function redSinkMining(
  ctx: ExecutionContext,
  raw: WorkerOutput,
  prior: Verification
): Promise<{
  verification: Verification;
  findings: string[];
}> {
  if (
    ctx.task.assigned_agent !==
      'RED-SINK'
  ) {
    throw new ControlError(
      'INDEPENDENT_REVIEW_REQUIRED'
    );
  }

  if (!ctx.systemProbe) {
    throw new ControlError(
      'TOOL_NOT_IMPLEMENTED'
    );
  }

  const output =
    WorkerOutputSchema.parse(raw);

  const failures: string[] = [];

  if (
    ![
      'PASS',
      'PASS_WITH_LIMITATIONS'
    ].includes(prior.verdict)
  ) {
    failures.push(
      'Auditor rejected the mining assessment.'
    );
  }

  const fresh =
    await ctx.systemProbe();

  const freshProbe =
    SystemProbeSchema.parse(
      JSON.parse(fresh.content)
    );

  for (
    const statement
    of hostStatements(freshProbe)
  ) {
    if (
      !output.claims.some(
        claim =>
          claim.statement === statement &&
          claim.classification ===
            'KNOWN'
      )
    ) {
      failures.push(
        `Red Sink fresh observation mismatch: ${statement}`
      );
    }
  }

  const required = [
    'NEEDS_VERIFICATION: Host metadata alone does not establish mining profitability.',
    'NEEDS_VERIFICATION: No sustained mining workload or hashrate measurement was executed.',
    'UNKNOWN: Wall power, electricity cost, live rewards and thermal behaviour were not measured.'
  ];

  for (const limitation of required) {
    if (
      !output.uncertainty.includes(
        limitation
      )
    ) {
      failures.push(
        `Required uncertainty missing: ${limitation}`
      );
    }
  }

  const findings = [
    ...failures,
    'Scope limit: ASSESS performed host metadata probes only. No miner process, pool connection, payout action or mining benchmark occurred.'
  ];

  return {
    verification:
      verification(
        ctx,
        failures.length
          ? 'FAIL'
          : 'PASS_WITH_LIMITATIONS',
        findings,
        output.claims.map(
          claim => claim.claim_id
        ),
        [fresh.evidence.evidence_id]
      ),
    findings
  };
}
