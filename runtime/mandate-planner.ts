import { z } from 'zod';

import {
  FounderMandateSchema,
  proposeMandateMission,
  type FounderMandate
} from './founder-mandate.js';

import {
  FounderMandateStore
} from './founder-mandate-store.js';

import {
  LakeYangeStore
} from './lake-yange-store.js';

export const MandatePlanSchema =
  z.object({
    schema_version:
      z.literal(1),

    mandate_id:
      z.string().min(1),

    mandate_status:
      z.literal('PLANNING'),

    inspected_state:
      z.object({
        population:
          z.number().int().nonnegative(),

        generation:
          z.number().int().nonnegative(),

        cognition:
          z.literal('LOCAL'),

        external_model_api:
          z.literal(false)
      }),

    selected_primitive:
      z.literal(
        'CONSTITUTIONAL_MISSION_LIFECYCLE'
      ),

    reason:
      z.string().min(1),

    proposal:
      z.object({
        proposal_id:
          z.string().min(1),

        title:
          z.string().min(1),

        objective:
          z.string().min(1),

        target_system:
          z.string().min(1),

        status:
          z.literal('PROPOSED'),

        execution_authority:
          z.literal(false)
      }),

    execution_authority:
      z.literal(false),

    executed:
      z.literal(false)
  });

export type MandatePlan =
  z.infer<
    typeof MandatePlanSchema
  >;

export async function planFounderMandate(
  repositoryRoot: string,
  mandateId: string
): Promise<{
  mandate: FounderMandate;
  plan: MandatePlan;
}> {
  const mandateStore =
    new FounderMandateStore(
      `${repositoryRoot}/.sink/lake-yange/mandates`
    );

  const lakeStore =
    new LakeYangeStore(
      `${repositoryRoot}/.sink/lake-yange/state.json`
    );

  const loaded =
    await mandateStore.load(
      mandateId
    );

  const mandate =
    FounderMandateSchema.parse(
      loaded
    );

  if (
    mandate.status !==
      'REGISTERED' &&
    mandate.status !==
      'PLANNING'
  ) {
    throw new Error(
      `MANDATE_NOT_PLANNABLE:${mandate.status}`
    );
  }

  const state =
    await lakeStore.load();

  /*
   * Founding Mandate I establishes many institutions.
   *
   * The smallest high-leverage missing primitive is not
   * another institution. It is the lifecycle connecting
   * constitutional direction to bounded implementation:
   *
   * REGISTERED
   *   -> PROPOSED
   *   -> separately AUTHORISED
   *   -> Workshop
   *   -> Vera
   *   -> Rook
   *   -> evidence-backed implementation state.
   *
   * This planner creates only the PROPOSED step.
   */
  const planned =
    proposeMandateMission(
      mandate,
      {
        title:
          'Establish constitutional mission lifecycle',

        objective:
          [
            'Create the typed and persisted lifecycle that',
            'allows a registered Founder Mandate proposal',
            'to become separately Founder-authorised,',
            'bounded engineering work without allowing',
            'planning itself to grant execution authority.'
          ].join(' '),

        target_system:
          'STATE_HOUSE_MANDATE_AUTHORITY'
      }
    );

  const proposal =
    planned.proposed_missions[
      planned.proposed_missions.length - 1
    ];

  if (!proposal) {
    throw new Error(
      'MANDATE_PLANNER_PROPOSAL_MISSING'
    );
  }

  const plan =
    MandatePlanSchema.parse({
      schema_version: 1,

      mandate_id:
        mandate.mandate_id,

      mandate_status:
        'PLANNING',

      inspected_state: {
        population:
          state.citizens.length,

        generation:
          state.generation,

        cognition:
          'LOCAL',

        external_model_api:
          false
      },

      selected_primitive:
        'CONSTITUTIONAL_MISSION_LIFECYCLE',

      reason:
        [
          'The mandate is registered but registration',
          'currently has no constitutional bridge to',
          'separately authorised implementation.',
          'Building that lifecycle first prevents later',
          'institutions from bypassing Founder authority.'
        ].join(' '),

      proposal,

      execution_authority:
        false,

      executed:
        false
    });

  /*
   * Deliberately do NOT persist `planned` yet.
   *
   * Planning is currently a read/derive operation.
   * Persistence of proposals should become an explicit
   * constitutional transition with its own receipt.
   */
  return {
    mandate,
    plan
  };
}
