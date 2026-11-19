import test from 'node:test';
import assert from 'node:assert/strict';
import {integrationEvent,monitorApplication,checkIntegration} from '../worker/src/integration-monitoring.js';

test('registra resultados permitidos sem dados pessoais nem mensagens externas',()=>{
  const logs=[],oldInfo=console.info,oldWarn=console.warn;
  console.info=console.warn=line=>logs.push(JSON.parse(line));
  try{
    const env={INTEGRATION_MONITOR_ENABLED:'true'};
    monitorApplication(env,{application:true,profile:false,tag:true,email:'ficticio@example.invalid'});
    integrationEvent(env,'ficticio@example.invalid','ok');
    integrationEvent(env,'profile','mensagem privada');
    assert.equal(logs.length,7);
    assert.equal(logs.find(x=>x.stage==='profile').outcome,'failed');
    assert.equal(logs.find(x=>x.stage==='questionnaire').outcome,'not_required');
    assert.ok(!JSON.stringify(logs).includes('ficticio'));
    integrationEvent({},'application','ok');
    assert.equal(logs.length,7);
  }finally{console.info=oldInfo;console.warn=oldWarn;}
});
test('verifica conexão e banco sem consultar currículos',async()=>{
  const queries=[];
  const env={INTEGRATION_MONITOR_ENABLED:'true',RESUME_UPLOAD_ENABLED:'true',AI:{run(){},toMarkdown(){}},
    RESUME_DB:{prepare(sql){queries.push(sql);return {async first(){return null;}}}}};
  assert.deepEqual(await checkIntegration(env,{checkRecrutei:async()=>true}),
    {status:'checked',recrutei:'ok',d1:'ok',ai_binding:'ok'});
  assert.deepEqual(queries,['SELECT 1 FROM candidate_resumes LIMIT 1']);
  const failed=await checkIntegration({...env,AI:{},RESUME_DB:{prepare(){throw Error('private error')}}},
    {checkRecrutei:async()=>{throw Error('secret credential')}});
  assert.deepEqual(failed,{status:'checked',recrutei:'failed',d1:'failed',ai_binding:'unavailable'});
});
test('monitoramento desativado não chama a API',async()=>{
  let called=false;
  assert.deepEqual(await checkIntegration({}, {checkRecrutei:async()=>{called=true}}),{status:'disabled'});
  assert.equal(called,false);
});
