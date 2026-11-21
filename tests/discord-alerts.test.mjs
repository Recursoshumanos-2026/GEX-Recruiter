import test from 'node:test';
import assert from 'node:assert/strict';
import {sendDiscordAlert,discordAlertsReady} from '../worker/src/discord-alerts.js';
import {integrationEvent,monitorApplication} from '../worker/src/integration-monitoring.js';

const sample='https://discord.com/api/webhooks/123456789012345678/fictional-test-token-not-a-real-webhook';
function db(){
 const entries=new Map();
 return {entries,prepare(sql){
  let args=[];return {bind(...x){args=x;return this;},
   async run(){
    if(sql.startsWith('DELETE FROM gex_monitor_alert_cooldown')){
      if(entries.get(args[0])===args[1])entries.delete(args[0]);
    }
    return {success:true};
   },
   async first(){
    if(!sql.startsWith('INSERT INTO gex_monitor_alert_cooldown'))throw Error('Unexpected SQL');
    if(entries.has(args[0])&&entries.get(args[0])>args[2])return null;
    entries.set(args[0],args[1]);
    return {event_key:args[0]};
   }
  };
 }};
}
function envWith(dbValue=db()){return {INTEGRATION_MONITOR_ENABLED:'true',DISCORD_ALERTS_ENABLED:'true',DISCORD_ALERT_WEBHOOK:sample,RESUME_DB:dbValue};}

test('não envia sem opção explícita e webhook privado válido',async()=>{
 const attempts=[];
 const fake=async(url,init)=>{attempts.push([url,init]);return {ok:true};};
 assert.equal(discordAlertsReady({}),false);
 assert.equal(await sendDiscordAlert({},'application','failed',{fetchFn:fake}),'disabled');
 assert.equal(await sendDiscordAlert({...envWith(),DISCORD_ALERTS_ENABLED:'false'},'application','failed',{fetchFn:fake}),'disabled');
 assert.equal(await sendDiscordAlert({...envWith(),DISCORD_ALERT_WEBHOOK:'https://example.invalid/api/webhooks/123/key'},'application','failed',{fetchFn:fake}),'disabled');
 assert.equal(await sendDiscordAlert(envWith(),'unknown','failed',{fetchFn:fake}),'disabled');
 assert.equal(await sendDiscordAlert(envWith(),'application','ok',{fetchFn:fake}),'disabled');
 assert.equal(attempts.length,0);
});

test('envia somente códigos fixos, sem dados pessoais, repetição nem menções',async()=>{
 const database=db(),env=envWith(database),calls=[];
 const fetchFn=async (url,init)=>{calls.push({url,init});return {ok:true};};
 const now=Date.parse('2026-11-21T10:00:00Z');
 assert.equal(discordAlertsReady(env),true);
 assert.equal(await sendDiscordAlert(env,'profile','failed',{now,fetchFn}),'sent');
 assert.equal(await sendDiscordAlert(env,'profile','failed',{now:now+60000,fetchFn}),'cooldown');
 assert.equal(calls.length,1);
 const content=JSON.parse(calls[0].init.body);
 assert.deepEqual(content.allowed_mentions,{parse:[]});
 assert.match(content.content,/GEX Recruiter/);
 assert.match(content.content,/Atualização do perfil/);
 assert.doesNotMatch(content.content,/123456789012345678|token|ficticio@example\.invalid/);
 assert.equal(await sendDiscordAlert(env,'profile','failed',{now:now+21600000,fetchFn}),'sent');
 assert.equal(calls.length,2);
 assert.equal(database.entries.get('profile:failed'),now+43200000);
});

test('falha de envio libera cooldown; não interrompe monitoramento',async()=>{
 const database=db(),env=envWith(database);
 const now=Date.parse('2026-11-21T10:00:00Z');
 assert.equal(await sendDiscordAlert(env,'application','uncertain',{now,fetchFn:async()=>({ok:false})}),'failed');
 assert.equal(database.entries.size,0);
 assert.equal(await sendDiscordAlert(env,'application','uncertain',{now,fetchFn:async()=>{throw Error('webhook token');}}),'failed');
 assert.equal(await sendDiscordAlert(env,'application','uncertain',{now,fetchFn:async()=>({ok:true})}),'sent');
});

test('falha no banco não causa alerta por candidatura; cron diário pode avisar',async()=>{
 const env=envWith({prepare(){throw Error('DB unavailable');}});
 let count=0;const fetchFn=async()=>{count++;return {ok:true};};
 assert.equal(await sendDiscordAlert(env,'resume_database','failed',{fetchFn}),'unavailable');
 assert.equal(count,0);
 assert.equal(await sendDiscordAlert(env,'resume_database','failed',{allowWithoutDb:true,fetchFn}),'sent');
 assert.equal(count,1);
});

test('eventos do monitor acionam notificações somente para falhas e sem interromper fluxo',async()=>{
 const oldWarn=console.warn,oldInfo=console.info,logs=[];
 console.warn=console.info=(line)=>logs.push(line);
 const previous=globalThis.fetch,calls=[];
 globalThis.fetch=async(url,init)=>{calls.push({url,init});return {ok:true};};
 try{
  const tasks=[],ctx={waitUntil(task){tasks.push(task);}};
  const env=envWith();
  monitorApplication(env,{application:true,profile:false,tag:true,questionnaire:null,email:'ficticio@example.invalid'},ctx);
  integrationEvent(env,'technical_analysis','unavailable',ctx);
  integrationEvent(env,'technical_analysis','ok',ctx);
  integrationEvent(env,'ficticio@example.invalid','failed',ctx);
  await Promise.all(tasks);
  assert.equal(calls.length,2);
  assert.equal(calls.every(c=>!c.init.body.includes('ficticio@example.invalid')),true);
  assert.equal(logs.every(l=>!l.includes('ficticio@example.invalid')),true);
 }finally{globalThis.fetch=previous;console.warn=oldWarn;console.info=oldInfo;}
});
