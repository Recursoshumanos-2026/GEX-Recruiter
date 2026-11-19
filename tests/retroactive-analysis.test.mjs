import test from 'node:test';
import assert from 'node:assert/strict';
import {runRetroactiveAnalysis} from '../worker/src/retroactive-analysis.js';
function fixture({rows=[{vacancy_id:44,markdown:'Currículo fictício: experiência profissional em atendimento ao cliente.'}],notes=[],status=1,closed=false,fail=false,write=false,enabled=true}={}){
  let submitted=0,claims=new Set(),sql=[],currentNotes=[...notes];
  const env={RETROACTIVE_ANALYSIS_ENABLED:String(enabled),RETROACTIVE_ANALYSIS_WRITE_ENABLED:String(write),RETROACTIVE_ANALYSIS_APPLICATION_IDS:'123',
    RESUME_DB:{prepare(query){sql.push(query);return {async run(){return {success:true}},bind(id){return {async all(){return {results:rows}},async run(){if(claims.has(id))return {meta:{changes:0}};claims.add(id);return {meta:{changes:1}}}}}}}}};
  const deps={available:()=>true,criteria:()=>[1,2,3],lookup:async()=>({ok:true,application:{id:123,vacancy_id:44,talent_id:22,status,talent:{id:22,talent_observations:currentNotes}}}),vacancy:async()=>closed?null:{id:44,title:'Vaga de teste',description:'Requisitos fictícios'},
    submit:async(_env,payload,body,markdown)=>{submitted++;assert.equal(payload.vacancy_id,44);assert.equal(body.data.application.id,123);assert.equal(markdown,rows[0].markdown);if(fail)throw Error('incerto');currentNotes.push({description:'<strong>GEX Talents | Análise Técnica Automatizada</strong>'});return {ok:true}}};
  return {env,deps,sql,count:()=>submitted};
}
test('desativado por padrão não consulta dados',async()=>{const f=fixture({enabled:false});const r=await runRetroactiveAnalysis(f.env,f.deps);assert.equal(r.status,'disabled');assert.equal(f.sql.length,0)});
test('simulação identifica elegível sem escrever nem executar IA',async()=>{const f=fixture();const r=await runRetroactiveAnalysis(f.env,f.deps);assert.equal(r.eligible,1);assert.equal(f.count(),0);assert.ok(f.sql.every(q=>q.startsWith('SELECT')))});
test('grava apenas uma observação e não repete em nova execução',async()=>{const f=fixture({write:true});assert.equal((await runRetroactiveAnalysis(f.env,f.deps)).submitted,1);assert.equal((await runRetroactiveAnalysis(f.env,f.deps)).alreadyAnalyzed,1);assert.equal(f.count(),1)});
test('resultado incerto não repete POST',async()=>{const f=fixture({write:true,fail:true});assert.equal((await runRetroactiveAnalysis(f.env,f.deps)).uncertain,1);assert.equal((await runRetroactiveAnalysis(f.env,f.deps)).uncertain,1);assert.equal(f.count(),1)});
for(const options of [{rows:[]},{notes:[{}]},{status:2},{closed:true},{rows:[{vacancy_id:44,markdown:'Curto'}]}]){
 test('não escreve com dados indisponíveis ou candidatura inelegível '+JSON.stringify(options),async()=>{const f=fixture({...options,write:true});assert.equal((await runRetroactiveAnalysis(f.env,f.deps)).unavailable,1);assert.equal(f.count(),0)});
}
test('análise existente permanece intacta',async()=>{const f=fixture({write:true,notes:[{description:'<p>GEX Recruiter | Análise Técnica Automatizada</p>'}]});assert.equal((await runRetroactiveAnalysis(f.env,f.deps)).alreadyAnalyzed,1);assert.equal(f.count(),0)});
