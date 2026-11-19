import test from 'node:test';
import assert from 'node:assert/strict';
import { duplicateIndexReady, validDuplicatePair, rememberDuplicatePair, duplicateCpfKnown, checkDuplicatePair, cleanupDuplicateIndex } from '../worker/src/duplicate-index.js';
import worker from '../worker/src/index.js';

const now=Date.parse('2026-11-19T12:00:00Z');
const pair={vacancy_id:'164607',email:'teste@example.invalid',ssn:'529.982.247-25'};
function build(){
  const rows=[], rates=new Map(), calls=[];
  const env={APPLICATIONS_ENABLED:'true',DUPLICATE_PILOT_VACANCY_ID:'164607',DUPLICATE_LOOKUP_SECRET:'fictitious-unit-test-key-not-used-in-production',RESUME_RETENTION_ENABLED:'true',RESUME_RETENTION_DRY_RUN:'false',
    RESUME_DB:{prepare(sql){let args=[];return {bind(...a){args=a;calls.push({sql,args});return this;},
      async run(){if(sql.startsWith('INSERT OR IGNORE'))rows.push({vacancy:args[0],id:args[1],pair:args[2],cpf:args[3],created:'2026-11-19 00:00:00'});
        if(sql.startsWith('DELETE FROM gex_duplicate_index'))for(let i=rows.length-1;i>=0;i--)if(rows[i].created<args[0])rows.splice(i,1);
        if(sql.startsWith('DELETE FROM gex_duplicate_rate'))for(const [key,r] of rates)if(r.end<args[0])rates.delete(key);
        return {success:true};},
      async first(){if(sql.startsWith('INSERT INTO gex_duplicate_rate')){const previous=rates.get(args[0]);const attempts=(previous?.attempts||0)+1;rates.set(args[0],{attempts,end:args[1]});return {attempts};}
        if(sql.includes('pair_hash=?')||sql.includes('cpf_hash=?'))return rows.some(r=>r.vacancy===args[0]&&r[sql.includes('pair_hash=?')?'pair':'cpf']===args[1]&&r.created>=args[2])?{found:1}:null;
        throw Error('unexpected query');}
    };}}};return {env,rows,rates,calls};
}
test('guarda apenas identificadores HMAC, normaliza CPF/e-mail e isola vagas',async()=>{
 const {env,calls,rows}=build();assert.ok(duplicateIndexReady(env));
 assert.equal(validDuplicatePair(pair.email,pair.ssn),true);
 assert.equal(validDuplicatePair(pair.email,'00000000000'),false);
 assert.equal((await checkDuplicatePair(env,pair,'test-client',now)).status,'unconfirmed');
 await rememberDuplicatePair(env,pair,'123');
 assert.equal(rows.length,1);assert.match(rows[0].pair,/^[a-f0-9]{64}$/);assert.match(rows[0].cpf,/^[a-f0-9]{64}$/);
 assert.notEqual(rows[0].pair,rows[0].cpf);
 assert.equal((await checkDuplicatePair(env,{...pair,email:'TESTE@EXAMPLE.INVALID',ssn:'52998224725'},'test-client',now)).status,'duplicate');
 assert.equal((await checkDuplicatePair(env,{...pair,email:'other@example.invalid'},'test-client',now)).status,'unconfirmed');
 assert.equal((await checkDuplicatePair(env,{...pair,vacancy_id:'999'},'test-client',now)).status,'unconfirmed');
 assert.equal(await duplicateCpfKnown(env,{...pair,email:'other@example.invalid'},now),true);
 assert.equal(await duplicateCpfKnown(env,{...pair,vacancy_id:'999'},now),false);
 assert.doesNotMatch(JSON.stringify(calls),/teste@example|52998224725|529\.982|test-client/);
});
test('limita tentativas e expira registros; sem chave não consulta',async()=>{
 const {env,rows,rates}=build();await rememberDuplicatePair(env,pair,'123');
 for(let i=0;i<10;i++)assert.equal((await checkDuplicatePair(env,pair,'client',now)).status,'duplicate');
 assert.equal((await checkDuplicatePair(env,pair,'client',now)).status,'unavailable');
 assert.equal((await checkDuplicatePair(env,pair,null,now)).status,'unavailable');
 assert.equal((await checkDuplicatePair({...env,DUPLICATE_LOOKUP_SECRET:undefined},pair,'client',now)).status,'unavailable');
 await cleanupDuplicateIndex(env,Date.parse('2028-01-01T00:00:00Z'));assert.equal(rows.length,0);assert.equal(rates.size,0);
});
test('rota pública exige origem e escopo, não chama a ATS e não devolve dados pessoais',async()=>{
 const {env}=build();await rememberDuplicatePair(env,pair,'123');
 const origin='https://carreiras.gexcorp.com.br';
 const req=(input,site=origin)=>new Request('https://worker.invalid/api/verificar-inscricao',{method:'POST',headers:{Origin:site,'Content-Type':'application/json','CF-Connecting-IP':'192.0.2.1'},body:JSON.stringify(input)});
 const valid=await worker.fetch(req(pair),env);assert.equal(valid.status,200);assert.equal(valid.headers.get('Cache-Control'),'no-store');assert.deepEqual(await valid.json(),{status:'duplicate'});
 const other=await worker.fetch(req({...pair,vacancy_id:'999'}),env);assert.deepEqual(await other.json(),{status:'unavailable'});
 const bad=await worker.fetch(req(pair,'https://example.invalid'),env);assert.equal(bad.status,403);assert.deepEqual(await bad.json(),{status:'unavailable'});
 const oversized=await worker.fetch(req({...pair,x:'x'.repeat(3000)}),env);assert.equal(oversized.status,413);
});
