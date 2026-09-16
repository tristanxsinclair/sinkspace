import { scenarios } from './eval-scenarios.js';
const results=[];
for(const scenario of scenarios){const started=Date.now();try{await scenario.check();results.push({scenario:scenario.name,expected:scenario.expected,result:'PASS',latency_ms:Date.now()-started});}catch{results.push({scenario:scenario.name,expected:scenario.expected,result:'FAIL',latency_ms:Date.now()-started});}}
console.log(JSON.stringify({suite:'sink-governance-v1',adapter:'local-deterministic-v1',synthetic_fixtures:true,model:null,results,passed:results.filter(r=>r.result==='PASS').length,total:results.length},null,2));
if(results.some(r=>r.result==='FAIL'))process.exitCode=1;
