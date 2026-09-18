import {
  test
} from 'node:test';

import assert
  from 'node:assert/strict';

import {
  brierScore,
  buildGoldRushLedger,
  canonicalGoldRushKey,
  modelGoldRushEconomics,
  rankGoldRush,
  type GoldRushOpportunity
} from '../runtime/gold-rush.js';

function opportunity(
  overrides:
    Partial<GoldRushOpportunity> = {}
): GoldRushOpportunity {
  return {
    opportunity_id:
      'gold-1',

    canonical_key:
      'https://example.com/program',

    category:
      'BUILDER_GRANT',

    title:
      'Verified builder program',

    provider:
      'Example',

    official_source_url:
      'https://example.com/program',

    discovered_at:
      '2026-09-18T00:00:00.000Z',

    source_observed_at:
      '2026-09-18T00:00:00.000Z',

    deadline:
      null,

    reward_aud: {
      low: 1000,
      base: 2000,
      high: 3000
    },

    success_probability: {
      low: 0.25,
      base: 0.5,
      high: 0.75
    },

    hours: {
      low: 4,
      base: 8,
      high: 12
    },

    direct_cost_aud: {
      low: 0,
      base: 50,
      high: 100
    },

    capital_required_aud: {
      low: 0,
      base: 0,
      high: 0
    },

    hourly_time_value_aud:
      40,

    strategic_option_value_aud: {
      low: 0,
      base: 100,
      high: 200
    },

    evidence_ids: [
      'ev-1',
      'ev-2'
    ],

    evidence_confidence:
      0.9,

    authorization_verified:
      true,

    eligibility_verified:
      true,

    source_verified:
      true,

    audit_passed:
      true,

    red_team_passed:
      true,

    freshness_days:
      1,

    state:
      'RED_TEAMED',

    constraints:
      [],

    rejection_reasons:
      [],

    ...overrides
  };
}

test(
  'Gold Rush distinguishes headline, expected, attainable and realized value',
  () => {
    const item =
      opportunity();

    const economics =
      modelGoldRushEconomics(
        item
      );

    assert.ok(
      economics.headline_value_aud !== null
    );

    assert.ok(
      economics.expected_value_aud !== null
    );

    assert.ok(
      economics.attainable_value_aud !== null
    );

    assert.equal(
      economics.headline_value_aud.base,
      2000
    );

    assert.ok(
      economics.expected_value_aud.base <
        economics.headline_value_aud.base
    );

    assert.ok(
      economics.attainable_value_aud.base <
        economics.expected_value_aud.base
    );

    const ledger =
      buildGoldRushLedger({
        opportunities: [
          item
        ],
        generated_at:
          '2026-09-18T00:00:00.000Z'
      });

    assert.equal(
      ledger.realized_value_aud,
      0
    );
  }
);

test(
  'huge headline reward cannot outrank a smaller genuinely attainable opportunity',
  () => {
    const lottery =
      opportunity({
        opportunity_id:
          'lottery',

        canonical_key:
          'https://example.com/lottery',

        title:
          'Huge but implausible',

        reward_aud: {
          low: 0,
          base: 1_000_000,
          high: 2_000_000
        },

        success_probability: {
          low: 0,
          base: 0.00001,
          high: 0.00002
        },

        hours: {
          low: 50,
          base: 100,
          high: 150
        },

        strategic_option_value_aud: {
          low: 0,
          base: 0,
          high: 0
        }
      });

    const attainable =
      opportunity({
        opportunity_id:
          'attainable',

        canonical_key:
          'https://example.com/attainable',

        title:
          'Smaller attainable',

        reward_aud: {
          low: 1200,
          base: 1800,
          high: 2200
        },

        success_probability: {
          low: 0.6,
          base: 0.75,
          high: 0.9
        },

        hours: {
          low: 3,
          base: 5,
          high: 8
        }
      });

    const ranked =
      rankGoldRush([
        lottery,
        attainable
      ]);

    assert.equal(
      ranked[0]?.opportunity
        .opportunity_id,
      'attainable'
    );
  }
);

test(
  'missing authority hard-gates ranking regardless of reward',
  () => {
    const result =
      modelGoldRushEconomics(
        opportunity({
          reward_aud: {
            low: 1_000_000,
            base: 2_000_000,
            high: 3_000_000
          },

          authorization_verified:
            false
        })
      );

    assert.equal(
      result.actionable,
      false
    );

    assert.equal(
      result.priority_score,
      0
    );

    assert.equal(
      result.authorization_factor,
      0
    );
  }
);

test(
  'expired opportunity cannot become actionable',
  () => {
    const result =
      modelGoldRushEconomics(
        opportunity({
          state:
            'EXPIRED'
        })
      );

    assert.equal(
      result.actionable,
      false
    );

    assert.ok(
      result.blockers.some(
        item =>
          item.includes(
            'EXPIRED'
          )
      )
    );
  }
);

test(
  'missing official source remains blocked',
  () => {
    const result =
      modelGoldRushEconomics(
        opportunity({
          official_source_url:
            null,

          source_verified:
            false
        })
      );

    assert.equal(
      result.actionable,
      false
    );

    assert.ok(
      result.blockers.includes(
        'Missing official source.'
      )
    );
  }
);

test(
  'negative base attainable value is not actionable',
  () => {
    const result =
      modelGoldRushEconomics(
        opportunity({
          reward_aud: {
            low: 50,
            base: 100,
            high: 150
          },

          success_probability: {
            low: 0.1,
            base: 0.2,
            high: 0.3
          },

          hours: {
            low: 20,
            base: 30,
            high: 40
          }
        })
      );

    assert.equal(
      result.actionable,
      false
    );

    assert.equal(
      result.priority_score,
      0
    );
  }
);

test(
  'canonical key strips marketing parameters and fragments',
  () => {
    assert.equal(
      canonicalGoldRushKey(
        'https://Example.com/program?utm_source=x#apply'
      ),
      'https://example.com/program'
    );
  }
);

test(
  'duplicate canonical opportunities collapse to stronger evidence',
  () => {
    const weak =
      opportunity({
        opportunity_id:
          'weak',

        evidence_confidence:
          0.4
      });

    const strong =
      opportunity({
        opportunity_id:
          'strong',

        evidence_confidence:
          0.9
      });

    const ranked =
      rankGoldRush([
        weak,
        strong
      ]);

    assert.equal(
      ranked.length,
      1
    );

    assert.equal(
      ranked[0]?.opportunity
        .opportunity_id,
      'strong'
    );
  }
);

test(
  'realized value remains zero without proof receipt and changes only with receipt',
  () => {
    const item =
      opportunity();

    const empty =
      buildGoldRushLedger({
        opportunities: [
          item
        ],
        generated_at:
          '2026-09-18T00:00:00.000Z'
      });

    assert.equal(
      empty.realized_value_aud,
      0
    );

    const realized =
      buildGoldRushLedger({
        opportunities: [
          item
        ],

        realization_receipts: [
          {
            receipt_id:
              'receipt-1',

            opportunity_id:
              item.opportunity_id,

            realized_value_aud:
              500,

            direct_cost_aud:
              20,

            evidence_ids: [
              'payment-evidence-1'
            ],

            realized_at:
              '2026-09-18T01:00:00.000Z'
          }
        ],

        generated_at:
          '2026-09-18T02:00:00.000Z'
      });

    assert.equal(
      realized.realized_value_aud,
      500
    );
  }
);

test(
  'stale evidence decays attainable value',
  () => {
    const fresh =
      modelGoldRushEconomics(
        opportunity({
          freshness_days:
            1
        })
      );

    const old =
      modelGoldRushEconomics(
        opportunity({
          freshness_days:
            120
        })
      );

    assert.ok(
      fresh.attainable_value_aud !== null
    );

    assert.ok(
      old.attainable_value_aud !== null
    );

    assert.ok(
      old.attainable_value_aud.base <
        fresh.attainable_value_aud.base
    );
  }
);

test(
  'ranking is deterministic',
  () => {
    const input = [
      opportunity({
        opportunity_id:
          'b',

        canonical_key:
          'https://example.com/b'
      }),

      opportunity({
        opportunity_id:
          'a',

        canonical_key:
          'https://example.com/a'
      })
    ];

    assert.deepEqual(
      rankGoldRush(input),
      rankGoldRush(input)
    );
  }
);

test(
  'Brier calibration score is deterministic',
  () => {
    assert.equal(
      brierScore([
        {
          probability: 0.8,
          outcome: 1
        },
        {
          probability: 0.25,
          outcome: 0
        }
      ]),
      0.05125
    );

    assert.equal(
      brierScore([]),
      null
    );
  }
);

test(
  'unknown economic inputs remain UNKNOWN rather than becoming observed zero',
  () => {
    const result =
      modelGoldRushEconomics(
        opportunity({
          reward_aud: null,
          success_probability: null,
          hours: null
        })
      );

    assert.equal(
      result.headline_value_aud,
      null
    );

    assert.equal(
      result.expected_value_aud,
      null
    );

    assert.equal(
      result.attainable_value_aud,
      null
    );

    assert.equal(
      result.attainable_value_per_hour_aud,
      null
    );

    assert.equal(
      result.actionable,
      false
    );

    assert.equal(
      result.priority_score,
      0
    );

    assert.ok(
      result.blockers.includes(
        'Reward is unknown.'
      )
    );

    assert.ok(
      result.blockers.includes(
        'Success probability is unknown.'
      )
    );

    assert.ok(
      result.blockers.includes(
        'Required effort is unknown.'
      )
    );
  }
);

test(
  'ledger preserves unknown economics without converting them into opportunity value',
  () => {
    const ledger =
      buildGoldRushLedger({
        opportunities: [
          opportunity({
            opportunity_id:
              'unknown-economics',

            canonical_key:
              'https://example.com/unknown',

            reward_aud:
              null,

            success_probability:
              null,

            hours:
              null
          })
        ],

        generated_at:
          '2026-09-18T03:00:00.000Z'
      });

    assert.equal(
      ledger.opportunities[0]
        ?.economics
        .attainable_value_aud,
      null
    );

    assert.deepEqual(
      ledger.estimated_attainable_value_aud,
      {
        low: 0,
        base: 0,
        high: 0
      }
    );

    assert.equal(
      ledger.actionable,
      0
    );

    assert.equal(
      ledger.realized_value_aud,
      0
    );
  }
);
