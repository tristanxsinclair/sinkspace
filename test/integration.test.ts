import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, symlink, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { once } from 'node:events';
import { get } from 'node:http';
import { GitRepository } from '../runtime/repository.js';
import { FileRunStore, receiptDigest, verifyReceipt } from '../runtime/store.js';
import { harness } from '../runtime/eval-scenarios.js';
import { healthIntake, localAdapter } from '../runtime/orchestrator.js';
import { commandCentre } from '../runtime/server.js';
import type { ExecutionContext } from '../runtime/context.js';
import { ControlError } from '../runtime/security.js';
import { interpretPrimeCommand } from '../runtime/prime.js';
import { coreCapabilityRegistry } from '../runtime/capabilities.js';
import { loadRegistry } from '../runtime/registry.js';

const exec=promisify(execFile);
test('Git tool pins immutable blobs, ignores replacement refs and rejects paths and symlinks',async()=>{
  const dir=await mkdtemp(join(tmpdir(),'sink-git-'));
  const git=(args:string[])=>exec('git',args,{cwd:dir});
  await git(['init','-q']);await git(['config','user.name','Sink Test']);await git(['config','user.email','test@example.invalid']);
  await mkdir(join(dir,'dist'));await writeFile(join(dir,'dist/app.js'),'original');await writeFile(join(dir,'README.md'),'original');
  await symlink('../README.md',join(dir,'dist/index.html'));await git(['add','.']);await git(['commit','-qm','fixture original']);
  const repo=await GitRepository.open(dir);const original=await repo.pin();
  await writeFile(join(dir,'dist/app.js'),'replacement');await git(['add','.']);await git(['commit','-qm','fixture replacement']);
  const replaced=await repo.pin();await git(['replace',original,replaced]);
  assert.equal(await repo.read(original,'dist/app.js'),'original');
  await writeFile(join(dir,'dist/app.js'),'uncommitted');assert.equal(await repo.read(replaced,'dist/app.js'),'replacement');
  for(const path of ['../README.md','.env','dist/../README.md','dist/index.html'])await assert.rejects(repo.read(original,path));
  await assert.rejects(repo.inventory('HEAD; echo injected'),/INVALID_COMMIT/);
});
test('file persistence reopens receipts, detects tampering, and refuses resealing',async()=>{
  const dir=await mkdtemp(join(tmpdir(),'sink-store-'));const store=new FileRunStore(dir);const r=await harness().run();
  await store.seal(r.receipt!);await store.save(r);assert.deepEqual(await new FileRunStore(dir).get(r.run_id),r);
  const snapshots=Array.from({length:32},(_,index)=>({...r,errors:[...r.errors,`concurrent-save-${index}`]}));
  await Promise.all(snapshots.map(snapshot=>store.save(snapshot)));
  assert.deepEqual(await store.get(r.run_id),snapshots.at(-1));
  assert.deepEqual((await readdir(dir)).filter(name=>name.endsWith('.tmp')),[]);
  await assert.rejects(store.seal(r.receipt!));
  const path=join(dir,`${r.run_id}.json`);const data=JSON.parse(await readFile(path,'utf8'));data.receipt.objective='forged';await writeFile(path,JSON.stringify(data));await assert.rejects(store.get(r.run_id),/RECEIPT_TAMPERED/);
});
test('receipt rejects dangling verifier evidence even after digest recomputed',async()=>{
  const r=await harness().run();const receipt=r.receipt!;receipt.verification[0]!.evidence_ids=['absent'];receipt.hash=receiptDigest(receipt);assert.throws(()=>verifyReceipt(receipt),/VERIFIER_EVIDENCE_MISMATCH/);
});
test('Prime mission discovers bounded capabilities and persists linked evidence and scoped memory',async()=>{
  let discovered:string[]=[];
  const h=harness({
    ...localAdapter,
    research:async ctx=>{
      discovered=ctx.discoverCapabilities?.().map(capability=>capability.id) ?? [];
      assert.deepEqual(discovered,['repo_read','repo_inventory','mission_memory_write']);
      const invokeCapability=ctx.invokeCapability;
      assert.ok(invokeCapability);
      await assert.rejects(invokeCapability('repo_read',{path:'../README.md'}),/PATH_DENIED/);
      const output=await localAdapter.research!(ctx);
      assert.ok(ctx.memory?.list().some(item=>item.item.kind==='RUN'));
      return output;
    }
  });
  const interpreted=interpretPrimeCommand('Prime, run a system scan');
  assert.equal(interpreted.status,'READY');
  assert.ok(interpreted.mission);
  const created=await h.runner.create(interpreted.mission);
  const run=await h.runner.run(created.run_id);
  assert.equal(run.status,'COMPLETED');
  assert.deepEqual(discovered,['repo_read','repo_inventory','mission_memory_write']);
  const capabilityEvents=run.events.filter(event=>event.type==='CAPABILITY_EXECUTED');
  assert.ok(capabilityEvents.length>=7);
  for(const event of capabilityEvents) {
    assert.ok(event.capability_id);
    assert.ok(event.evidence_ids?.length);
    assert.ok(event.evidence_ids.every(id=>run.evidence.some(evidence=>evidence.evidence_id===id)));
  }
  assert.ok(run.events.some(event=>event.type==='CAPABILITY_FAILED' && event.capability_id==='repo_read'));
  assert.equal(run.receipt?.memories?.length,1);
  assert.ok(run.receipt?.memories?.[0]?.provenance.every(id=>run.evidence.some(evidence=>evidence.evidence_id===id)));
  const auditor=loadRegistry().find(agent=>agent.id==='SINK-03')!;
  const auditorTask=run.tasks.find(task=>task.assigned_agent===auditor.id)!;
  assert.deepEqual(
    coreCapabilityRegistry().discover(auditor,auditorTask).map(capability=>capability.id),
    ['repo_read','repo_inventory']
  );
  verifyReceipt(run.receipt!);
});
test('cancellation interrupts a stalled adapter and revokes its context',async()=>{
  let capture:ExecutionContext|undefined;let ready!:()=>void;const started=new Promise<void>(r=>{ready=r;});
  const h=harness({...localAdapter,research:async ctx=>{capture=ctx;ready();return new Promise(()=>{});}});
  const created=await h.runner.create(healthIntake);const running=h.runner.run(created.run_id);await started;await h.runner.cancel(created.run_id);const r=await running;
  assert.equal(r.status,'CANCELLED');assert.equal(r.receipt!.final_status,'CANCELLED');assert.throws(()=>capture!.artifact('late forged output'),/CONTEXT_EXPIRED/);
});
test('duplicate worker claims fail cleanly and still produce a failure receipt',async()=>{
  const h=harness({...localAdapter,research:async ctx=>{const raw=await localAdapter.research!(ctx) as {claims:unknown[]};raw.claims.push(raw.claims[0]);return raw;}});
  const r=await h.run();assert.equal(r.status,'FAILED');assert.equal(r.receipt!.final_status,'FAILED');
});
test('server validates authority transport, fixed intake, real history, and forbidden files',async()=>{
  const h=harness();const server=commandCentre(h.store,h.runner,'/fixture');server.listen(0,'127.0.0.1');await once(server,'listening');
  const address=server.address();assert.ok(address && typeof address==='object');const base=`http://127.0.0.1:${address.port}`;
  try {
    assert.equal((await fetch(base)).status,200);
    assert.equal((await fetch(`${base}/.env`)).status,404);
    const badHost=await new Promise<number|undefined>((resolve,reject)=>{get(`${base}/api/state`,{headers:{Host:'attacker.example'}},res=>{res.resume();resolve(res.statusCode);}).on('error',reject);});
    assert.equal(badHost,403);
    assert.equal((await fetch(`${base}/api/state`,{headers:{Origin:'https://evil.example'}})).status,403);
    assert.equal((await fetch(`${base}/api/runs`,{method:'POST',body:JSON.stringify(healthIntake)})).status,403);
    const headers={'content-type':'application/json','x-sink-request':'operator-console'};
    assert.equal((await fetch(`${base}/api/runs`,{method:'POST',headers,body:JSON.stringify({...healthIntake,objective:'Deploy production'})})).status,400);
    const response=await fetch(`${base}/api/runs`,{method:'POST',headers,body:JSON.stringify(healthIntake)});assert.equal(response.status,202);
    const created=await response.json() as {run_id:string};let status='QUEUED';
    for(let i=0;i<100 && status!=='COMPLETED';i++){await new Promise(r=>setTimeout(r,5));const detail=await fetch(`${base}/api/runs/${created.run_id}`);status=(await detail.json() as {status:string}).status;}
    assert.equal(status,'COMPLETED');const state=await fetch(`${base}/api/state`);const data=await state.json() as {runs:unknown[]};assert.equal(data.runs.length,1);
  } finally {server.close();server.closeAllConnections();await once(server,'close');}
});
test('late tool writes after budget expiry cannot forge completion',async()=>{
  let ctx:ExecutionContext|undefined;const h=harness({...localAdapter,research:async c=>{ctx=c;return new Promise(()=>{});}});
  const r=await h.run({...((await import('../runtime/contracts.js')).DEFAULT_BUDGET),max_wall_ms:25});assert.equal(r.status,'BLOCKED');await assert.rejects(ctx!.read('dist/app.js'),ControlError);
});
