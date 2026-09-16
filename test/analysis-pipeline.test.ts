import test from 'node:test';
import assert from 'node:assert/strict';

import { runAnalysisPipeline } from '../runtime/analysis-pipeline.js';

test('Scout output becomes evidence-safe Analyst input', () => {
  const result = runAnalysisPipeline({
    run_id: 'run-1',
    task_id: 'task-1',

    scout_output: {
      report: 'Repository inspection.',

      claims: [
        {
          claim_id: 'claim-known',
          statement: 'README.md exists.',
          classification: 'KNOWN',
          evidence_ids: ['evidence-1'],
          predicate: null,
          agent_id: 'SINK-01'
        },
        {
          claim_id: 'claim-inferred',
          statement: 'The repository may support a commercial website.',
          classification: 'INFERRED',
          evidence_ids: ['evidence-1'],
          predicate: null,
          agent_id: 'SINK-01'
        },
        {
          claim_id: 'claim-unknown',
          statement: 'Production conversion performance is unknown.',
          classification: 'UNKNOWN',
          evidence_ids: [],
          predicate: null,
          agent_id: 'SINK-01'
        }
      ],

      uncertainty: [
        'Customer adoption was not observed.'
      ]
    }
  });

  assert.deepEqual(
    result.analyst.facts,
    ['README.md exists.']
  );

  assert.deepEqual(
    result.analyst.hypotheses,
    ['The repository may support a commercial website.']
  );

  assert.ok(
    result.analyst.uncertainties.includes(
      'Production conversion performance is unknown.'
    )
  );

  assert.ok(
    result.analyst.uncertainties.includes(
      'Customer adoption was not observed.'
    )
  );

  assert.equal(
    result.blackboard_entries.filter(
      entry => entry.kind === 'FACT'
    ).length,
    1
  );
});

test('pipeline refuses KNOWN claims without evidence', () => {
  assert.throws(
    () => runAnalysisPipeline({
      run_id: 'run-2',
      task_id: 'task-2',

      scout_output: {
        report: 'Invalid worker output.',

        claims: [
          {
            claim_id: 'fake-known',
            statement: 'Unsupported fact.',
            classification: 'KNOWN',
            evidence_ids: [],
            predicate: null,
            agent_id: 'SINK-01'
          }
        ],

        uncertainty: []
      }
    }),
    /ANALYSIS_PIPELINE_INVALID_FACT/
  );
});
