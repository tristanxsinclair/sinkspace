import {
  readdir,
  readFile,
  stat
} from 'node:fs/promises';

import { join } from 'node:path';

import {
  RevenueLedgerSchema,
  type RevenueLedger
} from './contracts.js';

/**
 * LAKE YANGE — ECONOMY PROJECTION
 * ===============================
 *
 * Ledger House truth for the console Economy view.
 *
 * Every number is aggregated from persisted run revenue ledgers under
 * `.sink/runs`. Nothing is simulated, estimated or projected forward:
 *
 * - Malformed runs are counted, never silently parsed.
 * - Opportunities / actions / outcomes are de-duplicated by id so the
 *   same persisted record cannot be counted twice across runs.
 * - Financial totals are recomputed from de-duplicated outcomes only.
 * - Unknown quantities stay unknown; there is no forecast here.
 *
 * The projection is cached against a cheap directory signature
 * (name + size + mtime) so the console can poll without re-reading
 * megabytes of run JSON on every request.
 */

export const LAKE_YANGE_ECONOMY_VERSION = 1 as const;

export interface LakeYangeEconomyOpportunity {
  opportunity_id: string;
  title: string;
  target_customer: string;
  proposed_offer: string;
  proposed_price_aud: number;
  priority_score: number;
  confidence: number;
  status:
    | 'DISCOVERED'
    | 'VALIDATING'
    | 'APPROVED_FOR_TEST'
    | 'REJECTED'
    | 'WON'
    | 'LOST';
  evidence_count: number;
}

export interface LakeYangeEconomyProjection {
  projection_version: typeof LAKE_YANGE_ECONOMY_VERSION;
  generated_at: string;
  source: 'PERSISTED_RUN_REVENUE_LEDGERS';
  currency: 'AUD';

  runs_scanned: number;
  runs_with_ledger: number;
  runs_with_invalid_ledger: number;

  opportunities_total: number;
  opportunities_by_status: Record<
    LakeYangeEconomyOpportunity['status'],
    number
  >;

  top_opportunities: LakeYangeEconomyOpportunity[];

  actions_total: number;
  actions_executed: number;

  outcomes_total: number;
  customers_won: number;

  gross_revenue_aud: number;
  direct_costs_aud: number;
  net_cash_aud: number;
  tristan_minutes: number;

  last_ledger_update: string | null;

  realised_revenue: boolean;
}

function isMissing(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code?: unknown }).code === 'ENOENT'
  );
}

interface RunLedgerFile {
  name: string;
  signature: string;
  path: string;
}

async function listRunLedgerFiles(
  runsDirectory: string
): Promise<RunLedgerFile[]> {
  let entries;

  try {
    entries = await readdir(runsDirectory, {
      withFileTypes: true
    });
  } catch (error) {
    if (isMissing(error)) {
      return [];
    }

    throw error;
  }

  const files: RunLedgerFile[] = [];

  for (const entry of entries) {
    if (
      !entry.isFile() ||
      !entry.name.endsWith('.json') ||
      entry.name.includes('backup') ||
      entry.name.includes('interrupted')
    ) {
      continue;
    }

    const path = join(runsDirectory, entry.name);

    try {
      const info = await stat(path);

      files.push({
        name: entry.name,
        signature: `${entry.name}:${info.size}:${info.mtimeMs}`,
        path
      });
    } catch {
      /* File vanished between readdir and stat; skip truthfully. */
    }
  }

  return files;
}

function opportunityProjection(
  ledger: RevenueLedger
): LakeYangeEconomyOpportunity[] {
  return ledger.opportunities.map(opportunity => ({
    opportunity_id: opportunity.opportunity_id,
    title: opportunity.title,
    target_customer: opportunity.target_customer,
    proposed_offer: opportunity.proposed_offer,
    proposed_price_aud: opportunity.proposed_price_aud,
    priority_score: opportunity.priority_score,
    confidence: opportunity.confidence,
    status: opportunity.status,
    evidence_count: opportunity.evidence_ids.length
  }));
}

const EMPTY_BY_STATUS: Record<
  LakeYangeEconomyOpportunity['status'],
  number
> = {
  DISCOVERED: 0,
  VALIDATING: 0,
  APPROVED_FOR_TEST: 0,
  REJECTED: 0,
  WON: 0,
  LOST: 0
};

interface EconomyCache {
  root: string;
  signature: string;
  projection: LakeYangeEconomyProjection;
}

let economyCache: EconomyCache | null = null;

export async function projectLakeYangeEconomy(
  repositoryRoot: string,
  options: {
    now?: () => Date;
  } = {}
): Promise<LakeYangeEconomyProjection> {
  const now = options.now ?? (() => new Date());

  const runsDirectory = join(
    repositoryRoot,
    '.sink/runs'
  );

  const files = await listRunLedgerFiles(runsDirectory);

  const signature = files
    .map(file => file.signature)
    .sort()
    .join('|');

  if (
    economyCache &&
    economyCache.root === runsDirectory &&
    economyCache.signature === signature
  ) {
    return economyCache.projection;
  }

  const ledgers: RevenueLedger[] = [];

  let runsScanned = 0;
  let invalidLedgers = 0;

  for (const file of files) {
    let candidate: unknown;

    try {
      const raw = await readFile(file.path, 'utf8');
      candidate = JSON.parse(raw);
    } catch {
      runsScanned += 1;
      invalidLedgers += 1;
      continue;
    }

    runsScanned += 1;

    const run = candidate as {
      revenue_ledger?: unknown;
    };

    if (
      run.revenue_ledger === null ||
      run.revenue_ledger === undefined
    ) {
      continue;
    }

    const parsed =
      RevenueLedgerSchema.safeParse(run.revenue_ledger);

    if (!parsed.success) {
      invalidLedgers += 1;
      continue;
    }

    ledgers.push(parsed.data);
  }

  /* De-duplicate persisted records across run ledgers. */

  const opportunityById = new Map<
    string,
    LakeYangeEconomyOpportunity
  >();

  const actionById = new Map<string, string>();

  const outcomeByKey = new Map<
    string,
    {
      paid: boolean;
      gross: number;
      cost: number;
      minutes: number;
    }
  >();

  let lastLedgerUpdate: string | null = null;

  for (const ledger of ledgers) {
    for (const opportunity of opportunityProjection(ledger)) {
      if (!opportunityById.has(opportunity.opportunity_id)) {
        opportunityById.set(
          opportunity.opportunity_id,
          opportunity
        );
      }
    }

    for (const action of ledger.actions) {
      actionById.set(action.action_id, action.status);
    }

    for (const outcome of ledger.outcomes) {
      const key = `${outcome.action_id}:${outcome.opportunity_id}`;

      if (!outcomeByKey.has(key)) {
        outcomeByKey.set(key, {
          paid: outcome.paid,
          gross: outcome.gross_revenue_aud,
          cost: outcome.direct_cost_aud,
          minutes: outcome.tristan_minutes
        });
      }
    }

    if (
      lastLedgerUpdate === null ||
      Date.parse(ledger.updated_at) >
        Date.parse(lastLedgerUpdate)
    ) {
      lastLedgerUpdate = ledger.updated_at;
    }
  }

  const opportunities = [
    ...opportunityById.values()
  ].sort(
    (left, right) =>
      right.priority_score - left.priority_score ||
      left.title.localeCompare(right.title)
  );

  const opportunitiesByStatus = { ...EMPTY_BY_STATUS };

  for (const opportunity of opportunities) {
    opportunitiesByStatus[opportunity.status] += 1;
  }

  const dedupedOutcomes = [...outcomeByKey.values()];

  const gross = dedupedOutcomes.reduce(
    (sum, outcome) => sum + outcome.gross,
    0
  );

  const costs = dedupedOutcomes.reduce(
    (sum, outcome) => sum + outcome.cost,
    0
  );

  const minutes = dedupedOutcomes.reduce(
    (sum, outcome) => sum + outcome.minutes,
    0
  );

  const projection: LakeYangeEconomyProjection = {
    projection_version: LAKE_YANGE_ECONOMY_VERSION,
    generated_at: now().toISOString(),
    source: 'PERSISTED_RUN_REVENUE_LEDGERS',
    currency: 'AUD',

    runs_scanned: runsScanned,
    runs_with_ledger: ledgers.length,
    runs_with_invalid_ledger: invalidLedgers,

    opportunities_total: opportunities.length,
    opportunities_by_status: opportunitiesByStatus,

    top_opportunities: opportunities.slice(0, 8),

    actions_total: actionById.size,
    actions_executed: [...actionById.values()].filter(
      status => status === 'EXECUTED'
    ).length,

    outcomes_total: dedupedOutcomes.length,
    customers_won: dedupedOutcomes.filter(
      outcome => outcome.paid
    ).length,

    gross_revenue_aud: Number(gross.toFixed(2)),
    direct_costs_aud: Number(costs.toFixed(2)),
    net_cash_aud: Number((gross - costs).toFixed(2)),
    tristan_minutes: minutes,

    last_ledger_update: lastLedgerUpdate,

    realised_revenue: gross > 0
  };

  economyCache = {
    root: runsDirectory,
    signature,
    projection
  };

  return projection;
}

/** Test helper: clears the cached economy projection. */
export function resetLakeYangeEconomyCache(): void {
  economyCache = null;
}