import test from 'node:test';
import assert from 'node:assert/strict';

import {
  MissionIntakeSchema,
  ReceiptSchema,
  RevenueOutcomeSchema,
  RevenueOpportunitySchema
} from '../runtime/contracts.js';

import {
  buildRevenueLedger,
  scoreRevenueOpportunity
} from '../runtime/revenue.js';

const now =
  '2026-09-17T10:00:00.000Z';

test(
  'revenue mission parses with zero autonomous spend',
  () => {
    const intake =
      MissionIntakeSchema.parse({
        workflow:'revenue',
        objective:
          'Generate verified revenue experiments.',
        mission:{
          mode:'DISCOVER',
          cash_target_aud:1000,
          horizon_days:30,
          max_spend_aud:0,
          max_tristan_minutes:60,
          target_market:
            'Perth service businesses',
          allowed_channels:[
            'EMAIL',
            'IN_PERSON'
          ],
          offer_constraints:[
            'No fabricated claims.',
            'No outbound execution without approval.'
          ],
          operator_email:
            'tjsinkspace@gmail.com'
        }
      });

    assert.equal(
      intake.workflow,
      'revenue'
    );

    assert.equal(
      intake.mission.max_spend_aud,
      0
    );
  }
);

test(
  'opportunity score prioritises evidence, speed and leverage without claiming income',
  () => {
    const weak =
      scoreRevenueOpportunity({
        evidence_strength:0.2,
        time_to_cash_days:60,
        proposed_price_aud:300,
        estimated_delivery_cost_aud:100,
        estimated_tristan_minutes:600,
        recurring_revenue_aud:0
      });

    const strong =
      scoreRevenueOpportunity({
        evidence_strength:0.9,
        time_to_cash_days:7,
        proposed_price_aud:750,
        estimated_delivery_cost_aud:50,
        estimated_tristan_minutes:120,
        recurring_revenue_aud:249
      });

    assert.ok(
      strong > weak
    );

    assert.ok(
      strong <= 100
    );
  }
);

test(
  'paid revenue requires payment evidence',
  () => {
    assert.throws(
      () =>
        RevenueOutcomeSchema.parse({
          action_id:'action-1',
          opportunity_id:'opp-1',
          contacted:true,
          replied:true,
          meeting_booked:true,
          proposal_sent:true,
          paid:true,
          gross_revenue_aud:750,
          direct_cost_aud:0,
          tristan_minutes:30,
          payment_evidence_ids:[],
          loss_reason:null
        })
    );
  }
);

test(
  'ledger computes verified cash economics deterministically',
  () => {
    const opportunity =
      RevenueOpportunitySchema.parse({
        opportunity_id:'opp-1',
        title:
          'Quote follow-up system',
        target_customer:
          'Perth landscaping business',
        observed_pain:
          'Manual quote follow-up',
        proposed_offer:
          'Lead and quote follow-up implementation',
        proposed_price_aud:750,
        estimated_delivery_cost_aud:50,
        estimated_tristan_minutes:120,
        estimated_time_to_cash_days:7,
        potential_recurring_revenue_aud:249,
        evidence_ids:[
          'evidence-1'
        ],
        confidence:0.8,
        priority_score:82,
        score_basis:[
          'Observed business workflow pain.'
        ],
        status:
          'APPROVED_FOR_TEST'
      });

    const outcome =
      RevenueOutcomeSchema.parse({
        action_id:'action-1',
        opportunity_id:'opp-1',
        contacted:true,
        replied:true,
        meeting_booked:true,
        proposal_sent:true,
        paid:true,
        gross_revenue_aud:750,
        direct_cost_aud:50,
        tristan_minutes:120,
        payment_evidence_ids:[
          'payment-1'
        ],
        loss_reason:null
      });

    const ledger =
      buildRevenueLedger({
        opportunities:[
          opportunity
        ],
        outcomes:[
          outcome
        ],
        updated_at:now
      });

    assert.equal(
      ledger.gross_revenue_aud,
      750
    );

    assert.equal(
      ledger.net_cash_aud,
      700
    );

    assert.equal(
      ledger.net_cash_per_tristan_hour,
      350
    );

    assert.equal(
      ledger.customers_won,
      1
    );
  }
);

test(
  'historical receipt compatibility does not require revenue ledger',
  () => {
    const result =
      ReceiptSchema.safeParse({
        schema_version:'1.0.0',
        receipt_id:'receipt-1',
        run_id:'run-1',
        objective:'Historical receipt',
        agent:'SINK-00',
        adapter:'local-deterministic-v1',
        commit_sha:
          'a'.repeat(40),
        started_at:now,
        completed_at:now,
        actions_taken:[],
        artifacts_created:[],
        evidence:[],
        claims:[],
        verification:[],
        tests:[
          'historical'
        ],
        unresolved_items:[],
        red_sink_findings:[],
        confidence:'UNVERIFIED',
        cost:{
          tool_calls:0,
          tokens:0,
          estimated_cost_usd:0,
          model:null
        },
        human_approvals:[],
        final_status:'FAILED',
        agent_configs:[],
        hash:'0'.repeat(64)
      });

    assert.equal(
      result.success,
      true
    );
  }
);
