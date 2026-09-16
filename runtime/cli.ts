import { resolve } from 'node:path';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { GitRepository } from './repository.js';
import { Orchestrator, healthIntake, services } from './orchestrator.js';
import { FileRunStore, verifyReceipt } from './store.js';
import { ReceiptSchema } from './contracts.js';
import { commandCentre } from './server.js';

async function main():Promise<void> {
  const [command,...args]=process.argv.slice(2);
  if(command==='verify') {
    if(args.length!==1)throw new Error('Usage: npm run clones:verify -- <receipt.json>');
    const rawReceipt=JSON.parse(
      await readFile(
        resolve(args[0]!),
        'utf8'
      )
    );

    verifyReceipt(rawReceipt);

    const receipt=
      ReceiptSchema.parse(
        rawReceipt
      );
    console.log(JSON.stringify({receipt_id:receipt.receipt_id,integrity:'PASS',status:receipt.final_status,note:'Local integrity check, not an external signature or production verification.'},null,2));return;
  }
  if(command!=='run' && command!=='serve' && command!=='mission')throw new Error('Use run, mission, serve or verify.');
  if(command!=='mission' && args.length>1)throw new Error('Pass at most one repository root.');
  if(process.env.SINK_ADAPTER && process.env.SINK_ADAPTER!=='local-deterministic-v1')throw new Error('Unsupported SINK_ADAPTER; no live model adapter is installed.');
  const repository=await GitRepository.open(
      resolve(
        command === 'mission'
          ? '.'
          : args[0] ?? '.'
      )
    );
  const store=new FileRunStore(resolve(repository.root,'.sink/runs'));
  // Process restarts do not resume old executions as if they had succeeded.
  const stale=(await store.list()).filter(r=>!['COMPLETED','FAILED','BLOCKED','CANCELLED','QUEUED'].includes(r.status));
  if(stale.length)throw new Error('Interrupted run detected. Preserve .sink evidence and review before starting a new process; automatic recovery is not implemented.');
  const runner=new Orchestrator(store,services(repository));
  if(command==='run' || command==='mission') {
    const intake =
      command === 'mission'
        ? (() => {
            if (
              args[0] !== 'crypto-mining' ||
              args[1] !== 'ASSESS'
            ) {
              throw new Error(
                'Usage: npm run clones:mission -- crypto-mining ASSESS'
              );
            }

            return {
              workflow:'crypto-mining' as const,
              objective:
                'Assess this host for cryptocurrency mining readiness without launching a mining workload.',
              mission:{
                mode:'ASSESS' as const,
                miner:'xmrig' as const,
                pool:null,
                wallet:null,
                worker:'sink-clone',
                max_minutes:15,
                threads:1
              }
            };
          })()
        : healthIntake;

    const created =
      await runner.create(
        intake
      );

    const run =
      await runner.run(
        created.run_id
      );
    const runsRoot=resolve(repository.root,'agents/runs');
    await mkdir(runsRoot,{recursive:true,mode:0o700});
    const preserved=resolve(runsRoot,run.run_id);
    await mkdir(preserved,{recursive:false,mode:0o700});
    const report=run.artifacts.find(
      a =>
        a.media_type === 'text/markdown' &&
        (
          a.agent_id === 'SINK-02' ||
          a.agent_id === 'SINK-06'
        )
    );
    if(!report||!run.receipt)throw new Error('Completed run is missing its report artifact or receipt.');
    const reportName =
      run.workflow === 'crypto-mining'
        ? 'mining-assessment.md'
        : 'capability-inventory.md';

    await writeFile(
      resolve(preserved,reportName),
      report.content,
      {flag:'wx',mode:0o600}
    );
    await writeFile(resolve(preserved,'receipt.json'),JSON.stringify(run.receipt,null,2)+'\n',{flag:'wx',mode:0o600});
    console.log(JSON.stringify({run_id:run.run_id,status:run.status,adapter:run.adapter,commit:run.commit_sha,artifact:`agents/runs/${run.run_id}/${run.workflow === 'crypto-mining' ? 'mining-assessment.md' : 'capability-inventory.md'}`,receipt:`agents/runs/${run.run_id}/receipt.json`,verdicts:run.verification.map(v=>({agent:v.agent_id,verdict:v.verdict})),uncertainty:run.uncertainty},null,2));
    if(run.status!=='COMPLETED')process.exitCode=1;
  } else {
    const port=Number(process.env.SINK_PORT??4310);if(!Number.isInteger(port)||port<1024||port>65535)throw new Error('SINK_PORT must be 1024–65535.');
    const server=commandCentre(store,runner,repository.root);
    server.listen(port,'127.0.0.1',()=>console.log(`Sink Prime: http://127.0.0.1:${port} (local deterministic adapter; no model calls)`));
  }
}
main().catch(error=>{console.error(error instanceof Error?error.message:'Execution failed.');process.exitCode=1;});
