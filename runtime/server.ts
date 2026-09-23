import { createServer, type IncomingMessage, type ServerResponse, type Server } from 'node:http';
import { readFile } from 'node:fs/promises';
import { IntakeSchema } from './contracts.js';
import { loadRegistry } from './registry.js';
import { ControlError } from './security.js';
import type { Orchestrator } from './orchestrator.js';
import type { RunStore } from './store.js';

export function commandCentre(store:RunStore, runner:Orchestrator, repository:string):Server {
  let pending=false;
  const json=(response:ServerResponse,status:number,data:unknown)=>{response.writeHead(status,{'Content-Type':'application/json'});response.end(JSON.stringify(data));};
  const body=async(request:IncomingMessage):Promise<unknown>=>{
    let content='';for await(const chunk of request){content+=String(chunk);if(content.length>4096) throw new ControlError('BODY_LIMIT');}return JSON.parse(content||'{}');
  };
  return createServer(async(request,response)=>{
    response.setHeader('Cache-Control','no-store');response.setHeader('X-Content-Type-Options','nosniff');response.setHeader('Referrer-Policy','no-referrer');
    response.setHeader('Content-Security-Policy',"default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
    try {
      // Bind to IPv4 loopback only. Exact Host + Origin checks also prevent DNS rebinding and drive-by requests.
      const address=request.socket.localAddress;
      const host=`127.0.0.1:${request.socket.localPort}`;
      if(address!=='127.0.0.1' || request.headers.host!==host) return json(response,403,{error:'LOOPBACK_HOST_REQUIRED'});
      if(request.headers.origin && request.headers.origin!==`http://${host}`) return json(response,403,{error:'ORIGIN_DENIED'});
      if(request.headers['sec-fetch-site']==='cross-site') return json(response,403,{error:'CROSS_SITE_DENIED'});
      const path=new URL(request.url??'/',`http://${host}`).pathname;
      if(request.method==='GET') {
        if(path==='/api/state') return json(response,200,{system:'online',adapter:'local-deterministic-v1',repository,agents:loadRegistry(),runs:await store.list(),approvals:(await store.list()).flatMap(r=>r.approvals)});
        const match=path.match(/^\/api\/runs\/([a-zA-Z0-9_-]+)$/);
        if(match) return json(response,200,await store.get(match[1]!));
        const assets:Record<string,[string,string]>={'/':['index.html','text/html'],'/app.js':['app.js','text/javascript'],'/styles.css':['styles.css','text/css']};
        const asset=assets[path];if(!asset)return json(response,404,{error:'NOT_FOUND'});
        response.writeHead(200,{'Content-Type':asset[1]});response.end(await readFile(new URL(`../console/${asset[0]}`,import.meta.url)));return;
      }
      if(request.method!=='POST')return json(response,405,{error:'METHOD_DENIED'});
      if(request.headers['x-sink-request']!=='operator-console' || request.headers['content-type']!=='application/json')return json(response,403,{error:'OPERATOR_REQUEST_REQUIRED'});
      if(path==='/api/runs') {
        const input=IntakeSchema.parse(await body(request));
        if(pending)return json(response,409,{error:'RUNNER_BUSY'});pending=true;
        try {const run=await runner.create(input);json(response,202,run);
          void runner.run(run.run_id).catch(()=>{process.stderr.write('Run persistence/execution failed; inspect local state.\n');}).finally(()=>{pending=false;});return;
        } catch(error){pending=false;throw error;}
      }
      const cancel=path.match(/^\/api\/runs\/([a-zA-Z0-9_-]+)\/cancel$/);
      if(cancel){await body(request);return json(response,200,await runner.cancel(cancel[1]!));}
      return json(response,404,{error:'NOT_FOUND'});
    } catch(error) {
      json(response,error instanceof ControlError?409:400,{error:error instanceof ControlError?error.code:'INVALID_REQUEST_OR_STATE'});
    }
  });
}
