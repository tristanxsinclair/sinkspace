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
  if(command!=='run' && command!=='serve' && command!=='mission' && command!=='prime-mission')throw new Error('Use run, mission, prime-mission, serve or verify.');
  if(command!=='mission' && command!=='prime-mission' && args.length>1)throw new Error('Pass at most one repository root.');
  if(process.env.SINK_ADAPTER && process.env.SINK_ADAPTER!=='local-deterministic-v1')throw new Error('Unsupported SINK_ADAPTER; no live model adapter is installed.');
  const repository=await GitRepository.open(
      resolve(
        command === 'mission' ||
        command === 'prime-mission'
          ? '.'
          : args[0] ?? '.'
      )
    );
  const store=new FileRunStore(resolve(repository.root,'.sink/runs'));
  // Process restarts do not resume old executions as if they had succeeded.
  const stale=(await store.list()).filter(r=>!['COMPLETED','FAILED','BLOCKED','CANCELLED','QUEUED'].includes(r.status));
  if(stale.length)throw new Error('Interrupted run detected. Preserve .sink evidence and review before starting a new process; automatic recovery is not implemented.');
  const runner=new Orchestrator(store,services(repository));
  if(
    command==='run' ||
    command==='mission' ||
    command==='prime-mission'
  ) {
    const intake =
      command === 'prime-mission'
        ? (
            args.length === 1
              ? JSON.parse(
                  await readFile(
                    resolve(args[0]!),
                    'utf8'
                  )
                )
              : (() => {
                  throw new Error(
                    'Usage: npm run clones:prime-mission -- <mission.json>'
                  );
                })()
          )
        : command === 'mission'
          ? (() => {
            if (
              args[0] === 'crypto-mining' &&
              args[1] === 'ASSESS'
            ) {
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
            }

            if (
              args[0] === 'gold-rush' &&
              args[1] === 'DISCOVER'
            ) {
              return {
                workflow:'gold-rush' as const,
                objective:
                  'Discover, verify and economically model legitimate public opportunities without executing transactions, spending money, using credentials or claiming unrealized value.',
                mission:{
                  mode:'DISCOVER' as const,
                  horizon_days:30,
                  max_spend_aud:0,
                  max_operator_minutes:120,
                  target_categories:[
                    'BUG_BOUNTY',
                    'BUILDER_GRANT',
                    'HACKATHON',
                    'OPEN_SOURCE_BOUNTY',
                    'UNCLAIMED_ENTITLEMENT',
                    'NETWORK_OPERATOR',
                    'DEPIN',
                    'KEEPER',
                    'SOLVER',
                    'PROVER',
                    'RESTAKING',
                    'ARBITRAGE'
                  ],
                  constraints:[
                    'Read-only public research only.',
                    'Official or independently verifiable source evidence is required.',
                    'Public accessibility does not imply authority to acquire or exploit.',
                    'No wallet signing or transaction execution.',
                    'No private keys, seed phrases or credentials.',
                    'No spending.',
                    'No outbound communication.',
                    'No Sybil behaviour or eligibility evasion.',
                    'Security research requires explicit bounty or safe-harbour scope.',
                    'No realized-value claim without realization evidence.'
                  ]
                }
              };
            }

            if (
              args[0] === 'revenue' &&
              typeof args[1] === 'string' && ['DISCOVER','VALIDATE'].includes(args[1])
            ) {
              const revenueMode =
                args[1] as 'DISCOVER' | 'VALIDATE';

              return {
                workflow:'revenue' as const,
                objective:
                  revenueMode === 'VALIDATE'
                    ? 'Validate the strongest evidence-backed revenue opportunities without outbound execution or spending.'
                    : 'Discover evidence-backed revenue opportunities that can increase verified Sink Space revenue without outbound execution.',
                mission:{
                  mode:revenueMode,
                  cash_target_aud:1000,
                  horizon_days:30,
                  max_spend_aud:0,
                  max_tristan_minutes:60,
                  target_market:
                    'Perth service businesses',
                  allowed_channels:[
                    'EMAIL',
                    'PHONE',
                    'INSTAGRAM',
                    'LINKEDIN',
                    'IN_PERSON',
                    'WEB_FORM'
                  ],
                  offer_constraints:[
                    'No fabricated claims.',
                    'No outbound execution.',
                    'No spending.',
                    'No revenue claim without payment evidence.',
                    'Prefer services that can later become recurring software revenue.'
                  ],
                  operator_email:
                    'tjsinkspace@gmail.com'
                }
              };
            }

            throw new Error(
              'Usage: npm run clones:mission -- crypto-mining ASSESS | revenue DISCOVER | revenue VALIDATE | gold-rush DISCOVER'
            );
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
    const report =
      run.workflow === 'gold-rush'
        ? run.artifacts.find(
            a =>
              a.agent_id === 'RED-SINK' &&
              a.media_type === 'text/markdown' &&
              a.content.startsWith(
                '# SINK // GOLD RUSH'
              )
          )
        : run.artifacts.find(
            a =>
              a.media_type === 'text/markdown' &&
              (
                a.agent_id === 'SINK-02' ||
                a.agent_id === 'SINK-06' ||
                a.agent_id === 'SINK-04'
              )
          );
    if(!report||!run.receipt)throw new Error('Completed run is missing its report artifact or receipt.');
    const reportName =
      run.workflow === 'gold-rush'
        ? 'gold-rush-report.md'
        : run.workflow === 'crypto-mining'
          ? 'mining-assessment.md'
          : run.workflow === 'revenue'
            ? run.mission?.mode === 'VALIDATE'
              ? 'revenue-validation.md'
              : 'revenue-discovery.md'
            : 'capability-inventory.md';

    await writeFile(
      resolve(preserved,reportName),
      report.content,
      {flag:'wx',mode:0o600}
    );

    if (run.workflow === 'gold-rush') {
      const ledger =
        run.artifacts.find(
          artifact => {
            if (
              artifact.agent_id !==
                'RED-SINK' ||
              artifact.media_type !==
                'application/json'
            ) {
              return false;
            }

            try {
              const parsed =
                JSON.parse(
                  artifact.content
                );

              return (
                parsed &&
                parsed.schema_version ===
                  '1.0.0' &&
                parsed.currency ===
                  'AUD' &&
                Array.isArray(
                  parsed.opportunities
                ) &&
                typeof parsed.discovered ===
                  'number' &&
                typeof parsed.source_verified ===
                  'number' &&
                typeof parsed.actionable ===
                  'number' &&
                typeof parsed.realized_value_aud ===
                  'number'
              );
            } catch {
              return false;
            }
          }
        );

      if (!ledger) {
        throw new Error(
          'Completed Gold Rush run is missing gold-rush-ledger.json artifact.'
        );
      }

      await writeFile(
        resolve(
          preserved,
          'gold-rush-ledger.json'
        ),
        ledger.content.endsWith('\n')
          ? ledger.content
          : ledger.content + '\n',
        {
          flag:'wx',
          mode:0o600
        }
      );
    }

    await writeFile(resolve(preserved,'receipt.json'),JSON.stringify(run.receipt,null,2)+'\n',{flag:'wx',mode:0o600});
    console.log(JSON.stringify({run_id:run.run_id,status:run.status,adapter:run.adapter,commit:run.commit_sha,artifact:`agents/runs/${run.run_id}/${run.workflow === 'gold-rush' ? 'gold-rush-report.md' : run.workflow === 'crypto-mining' ? 'mining-assessment.md' : run.workflow === 'revenue' ? (run.mission?.mode === 'VALIDATE' ? 'revenue-validation.md' : 'revenue-discovery.md') : 'capability-inventory.md'}`,ledger:run.workflow === 'gold-rush' ? `agents/runs/${run.run_id}/gold-rush-ledger.json` : null,receipt:`agents/runs/${run.run_id}/receipt.json`,verdicts:run.verification.map(v=>({agent:v.agent_id,verdict:v.verdict})),uncertainty:run.uncertainty},null,2));
    if(run.status!=='COMPLETED')process.exitCode=1;
  } else {
    const port=Number(process.env.SINK_PORT??4310);if(!Number.isInteger(port)||port<1024||port>65535)throw new Error('SINK_PORT must be 1024–65535.');
    const server=commandCentre(store,runner,repository.root);
    server.listen(port,'127.0.0.1',()=>console.log(`Sink Prime: http://127.0.0.1:${port} (local deterministic adapter; no model calls)`));
  }
}
main().catch(error=>{console.error(error instanceof Error?error.message:'Execution failed.');process.exitCode=1;});
