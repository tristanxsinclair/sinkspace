import { mkdir, readFile, readdir, rename, writeFile, lstat } from 'node:fs/promises';
import { join } from 'node:path';
import { Id, RunSchema, ReceiptSchema, type Run, type Receipt } from './contracts.js';
import { canonical, ControlError, hash } from './security.js';
export interface RunStore { save(run: Run): Promise<void>; get(id: string): Promise<Run>; list(): Promise<Run[]>; seal(receipt: Receipt): Promise<void> }
export function receiptDigest(receipt: Receipt): string { const {hash: _digest, ...payload} = receipt; void _digest; return hash(payload); }
export function verifyReceipt(receipt: Receipt): void {
  ReceiptSchema.parse(receipt);
  if (receiptDigest(receipt) !== receipt.hash) throw new ControlError('RECEIPT_TAMPERED');
  const artifacts = new Map(receipt.artifacts_created.map(a => [a.artifact_id,a]));
  const evidence = new Map(receipt.evidence.map(e => [e.evidence_id,e]));
  if (artifacts.size !== receipt.artifacts_created.length || evidence.size !== receipt.evidence.length || new Set(receipt.claims.map(c=>c.claim_id)).size !== receipt.claims.length) throw new ControlError('DUPLICATE_EVIDENCE_ID');
  for (const a of artifacts.values()) if (hash(a.content) !== a.sha256) throw new ControlError('ARTIFACT_TAMPERED');
  for (const e of evidence.values()) {
    const a = artifacts.get(e.artifact_id);
    if (!a || a.agent_id !== e.agent_id || a.task_id !== e.task_id || e.commit_sha !== receipt.commit_sha) throw new ControlError('EVIDENCE_MISMATCH');
  }
  const miningReceipt =
    receipt.mission !== undefined &&
    receipt.mission !== null;

  for (const c of receipt.claims) {
    if (
      c.evidence_ids.some(
        id => !evidence.has(id)
      )
    ) {
      throw new ControlError(
        'MISSING_EVIDENCE'
      );
    }

    if (
      receipt.final_status === 'COMPLETED' &&
      c.classification === 'KNOWN'
    ) {
      if (miningReceipt) {
        if (
          c.agent_id !== 'SINK-06' ||
          c.predicate !== null ||
          c.evidence_ids.length === 0
        ) {
          throw new ControlError(
            'UNSUPPORTED_CLAIM'
          );
        }

        for (const evidenceId of c.evidence_ids) {
          const item =
            evidence.get(evidenceId);

          if (
            !item ||
            item.agent_id !== 'SINK-06' ||
            item.tool !== 'system_probe' ||
            item.source !== 'host:system_probe'
          ) {
            throw new ControlError(
              'UNSUPPORTED_CLAIM'
            );
          }
        }
      } else if (
        !c.predicate ||
        c.evidence_ids.length === 0
      ) {
        throw new ControlError(
          'UNSUPPORTED_CLAIM'
        );
      }
    }
  }

  for (
    const entry
    of receipt.blackboard_entries ?? []
  ) {
    if (
      entry.run_id !== receipt.run_id
    ) {
      throw new ControlError(
        'BLACKBOARD_RUN_MISMATCH'
      );
    }

    if (
      entry.kind === 'FACT' &&
      entry.evidence_ids.length === 0
    ) {
      throw new ControlError(
        'BLACKBOARD_FACT_REQUIRES_EVIDENCE'
      );
    }

    if (
      entry.evidence_ids.some(
        id => !evidence.has(id)
      )
    ) {
      throw new ControlError(
        'BLACKBOARD_EVIDENCE_MISMATCH'
      );
    }
  }
  for (const v of receipt.verification) {
    if (v.evidence_ids.some(id=>!evidence.has(id) || evidence.get(id)!.agent_id!==v.agent_id)) throw new ControlError('VERIFIER_EVIDENCE_MISMATCH');
    if (!receipt.agent_configs.some(a=>a.id===v.agent_id && a.version===v.agent_version)) throw new ControlError('VERIFIER_VERSION_MISMATCH');
  }
  if (receipt.final_status === 'COMPLETED') {
    const audit = receipt.verification.find(v=>v.agent_id === 'SINK-03');
    const red = receipt.verification.find(v=>v.agent_id === 'RED-SINK');
    if (!audit || !red || ![audit,red].every(v=>['PASS','PASS_WITH_LIMITATIONS'].includes(v.verdict))) throw new ControlError('UNVERIFIED_COMPLETION');
    const known = receipt.claims.filter(c=>c.classification === 'KNOWN');
    if (!known.length || !receipt.artifacts_created.length || known.some(c=>c.agent_id === audit.agent_id || c.agent_id === red.agent_id || !audit.checked_claim_ids.includes(c.claim_id) || !red.checked_claim_ids.includes(c.claim_id))) throw new ControlError('INDEPENDENCE_REQUIRED');
  }
}
export class FileRunStore implements RunStore {
  constructor(private readonly directory: string) {}
  private async init(): Promise<void> {
    await mkdir(this.directory, {recursive:true,mode:0o700});
    if ((await lstat(this.directory)).isSymbolicLink()) throw new ControlError('STORE_SYMLINK');
  }
  async save(run: Run): Promise<void> {
    RunSchema.parse(run); await this.init();
    const path = join(this.directory,`${Id.parse(run.run_id)}.json`);
    // Single-writer development adapter. Atomic snapshots; final receipts use exclusive create.
    await writeFile(`${path}.tmp`,canonical(run),{mode:0o600}); await rename(`${path}.tmp`,path);
  }
  async get(id: string): Promise<Run> {
    const run = RunSchema.parse(JSON.parse(await readFile(join(this.directory,`${Id.parse(id)}.json`),'utf8')));
    if (run.run_id !== id) throw new ControlError('RUN_ID_MISMATCH');
    if (run.receipt) verifyReceipt(run.receipt);
    return run;
  }
  async list(): Promise<Run[]> {
    await this.init(); const files = (await readdir(this.directory)).filter(f=>/^[a-zA-Z0-9_-]+\.json$/.test(f));
    return (await Promise.all(files.map(f=>this.get(f.slice(0,-5))))).sort((a,b)=>b.created_at.localeCompare(a.created_at));
  }
  async seal(receipt: Receipt): Promise<void> {
    verifyReceipt(receipt); await this.init();
    const dir = join(this.directory,'receipts'); await mkdir(dir,{recursive:true,mode:0o700});
    await writeFile(join(dir,`${Id.parse(receipt.receipt_id)}.json`),canonical(receipt),{flag:'wx',mode:0o400});
  }
}
export class MemoryRunStore implements RunStore {
  private runs = new Map<string,Run>(); private receipts = new Map<string,Receipt>();
  async save(run: Run): Promise<void> { this.runs.set(run.run_id,structuredClone(RunSchema.parse(run))); }
  async get(id: string): Promise<Run> { const run=this.runs.get(id); if (!run) throw new ControlError('RUN_NOT_FOUND'); return structuredClone(run); }
  async list(): Promise<Run[]> { return structuredClone([...this.runs.values()]); }
  async seal(receipt: Receipt): Promise<void> { verifyReceipt(receipt); if (this.receipts.has(receipt.receipt_id)) throw new ControlError('RECEIPT_EXISTS'); this.receipts.set(receipt.receipt_id,structuredClone(receipt)); }
}
