import test from 'node:test';
import assert from 'node:assert/strict';
import { questionnaireFor, validateQuestionnaireAnswers, setPublishedQuestionnaires } from '../questionnaires.js';
import { authorizedRhUser, normalizeQuestionnaire, loadVacancyQuestionnaire,
  publicQuestionnaires, handleRhRequest } from '../worker/src/rh-questionnaires.js';
import worker from '../worker/src/index.js';

const origin='https://gex-talents-api.rh-75e.workers.dev';
const fakeAccess={access:{aud:'aud-rh',getIdentity:async()=>({email:'Yas@exemplo.com'})}};
function envWithDb() {
  const questions=new Map(),templates=new Map();
  const db={prepare(sql){let args=[];
    const statement={bind(...values){args=values;return statement;},
      async first(){
        if(sql.includes('FROM gex_questionnaires')) return questions.get(args[0])||null;
        if(sql.includes('FROM gex_questionnaire_templates')) return templates.get(args[0])||null;
        throw Error('SQL inesperado: '+sql);
      },
      async all(){
        if(sql.includes('FROM gex_questionnaires')) return {results:[...questions.values()]};
        if(sql.includes('FROM gex_questionnaire_templates'))return {results:[...templates.values()]};
        throw Error('SQL inesperado: '+sql);
      },
      async run(){
        if(sql.startsWith('CREATE TABLE'))return {success:true};
        if(sql.startsWith('INSERT INTO gex_questionnaires')){
          const [vacancy_id,document,disabled,updated_at,updated_by]=args;
          questions.set(vacancy_id,{vacancy_id,document,disabled,version:1,updated_at,updated_by});
          return {success:true,meta:{changes:1}};
        }
        if(sql.startsWith('UPDATE gex_questionnaires')){
          const [document,disabled,updated_at,updated_by,vacancy_id,version]=args;
          const current=questions.get(vacancy_id);
          if(!current||current.version!==version)return {meta:{changes:0}};
          questions.set(vacancy_id,{vacancy_id,document,disabled,updated_at,updated_by,version:version+1});
          return {meta:{changes:1}};
        }
        if(sql.startsWith('INSERT INTO gex_questionnaire_templates')){
          const [id,name,document,updated_at,updated_by]=args;
          templates.set(id,{id,name,document,updated_at,updated_by});return {success:true};
        }
        throw Error('SQL inesperado: '+sql);
      }};
    return statement;}};
  return {RESUME_DB:db,QUESTIONNAIRE_ADMIN_ENABLED:'true',
    QUESTIONNAIRE_ACCESS_AUD:'aud-rh', QUESTIONNAIRE_RH_EMAILS:'yas@exemplo.com,rh@exemplo.com'};
}
const vacancies=async()=>[{id:158928,title:'Atendimento'},{id:999999,title:'Nova vaga'}];
function req(path,method='GET',body,headers={}){
  return new Request(origin+path,{method,headers:{...headers,
    ...(body?{'Content-Type':'application/json',Origin:origin}:{})},
    ...(body?{body:JSON.stringify(body)}:{})});
}
const custom={title:'Perguntas de triagem técnica',questions:[
  {id:'q_tech',label:'Qual sua experiência com APIs?',type:'long',required:true},
  {id:'q_crm',label:'Quais sistemas você utiliza?',type:'multiple',required:false,
    options:['CRM','ClickUp','ERP']}
]};

test('editor privado não aceita email falsificado, token inventado ou audiência errada',async()=>{
  const env=envWithDb();
  let r=await handleRhRequest(req('/rh/perguntas','GET',null,{'Cf-Access-Authenticated-User-Email':'yas@exemplo.com'}),env,{},vacancies);
  assert.equal(r.status,403);
  r=await handleRhRequest(req('/rh/perguntas'),env,{access:{aud:'outro',getIdentity:async()=>({email:'yas@exemplo.com'})}},vacancies);
  assert.equal(r.status,403);
  r=await handleRhRequest(req('/rh/perguntas'),{...env,QUESTIONNAIRE_ADMIN_ENABLED:'false'},fakeAccess,vacancies);
  assert.equal(r.status,403);
  assert.equal(await authorizedRhUser(env,fakeAccess),'yas@exemplo.com');
});

test('editor autenticado tem CSP restritiva e nenhum token no HTML',async()=>{
  const r=await handleRhRequest(req('/rh/perguntas'),envWithDb(),fakeAccess,vacancies);
  assert.equal(r.status,200);
  const html=await r.text();
  assert.match(html,/Administração de questionários/);
  assert.match(r.headers.get('Content-Security-Policy'),/frame-ancestors 'none'/);
  assert.match(r.headers.get('Content-Security-Policy'),/script-src 'nonce-/);
  assert.doesNotMatch(html,/RECRUTEI_API_SECRET|QUESTIONNAIRE_ACCESS_AUD/);
});

test('validação impede conteúdo inconsistente e mantém todas as alternativas',()=>{
  assert.deepEqual(normalizeQuestionnaire(custom),custom);
  assert.throws(()=>normalizeQuestionnaire({...custom,questions:[{...custom.questions[0],label:'x'}]}),/pergunta 1/i);
  assert.throws(()=>normalizeQuestionnaire({...custom,questions:[{...custom.questions[0],type:'html'}]}),/pergunta 1/i);
  assert.throws(()=>normalizeQuestionnaire({...custom,questions:[custom.questions[0],custom.questions[0]]}),/pergunta 2/i);
  const invalid={...custom,questions:[{...custom.questions[1],options:['Sim','sim']}]};
  assert.throws(()=>normalizeQuestionnaire(invalid),/alternativas distintas/i);
});

test('RH cria, atualiza, consulta, reutiliza modelo e desativa sem perder questionário legado',async()=>{
  const env=envWithDb();
  assert.equal(questionnaireFor('158928').questions.length,7);
  const first=await handleRhRequest(req('/rh/api/questionarios/999999'),env,fakeAccess,vacancies);
  assert.equal((await first.json()).version,0);
  const saved=await handleRhRequest(req('/rh/api/questionarios/999999','PUT',
    {questionnaire:custom,expected_version:0}),env,fakeAccess,vacancies);
  assert.equal(saved.status,200);
  assert.equal((await saved.json()).version,1);
  assert.deepEqual(await loadVacancyQuestionnaire(env,'999999'),custom);
  assert.equal(validateQuestionnaireAnswers(custom,{q_tech:'  Faço integrações REST  ',q_crm:['ERP','CRM']}).q_tech,'Faço integrações REST');
  const listing=await publicQuestionnaires(env,[{id:999999},{id:158928}]);
  assert.deepEqual(listing['999999'],custom);
  setPublishedQuestionnaires(listing);
  assert.equal(questionnaireFor('999999').questions.length,2);
  setPublishedQuestionnaires({});

  const stale=await handleRhRequest(req('/rh/api/questionarios/999999','PUT',
    {questionnaire:custom,expected_version:0}),env,fakeAccess,vacancies);
  assert.equal(stale.status,409);

  const template=await handleRhRequest(req('/rh/api/modelos','POST',
    {name:'Modelo de dados',questionnaire:custom}),env,fakeAccess,vacancies);
  assert.equal(template.status,201);
  const id=(await template.json()).id;
  const read=await handleRhRequest(req('/rh/api/modelos/'+id),env,fakeAccess,vacancies);
  assert.deepEqual((await read.json()).questionnaire,custom);

  const removed=await handleRhRequest(req('/rh/api/questionarios/999999','DELETE',
    {expected_version:1}),env,fakeAccess,vacancies);
  assert.equal(removed.status,200);
  assert.equal(await loadVacancyQuestionnaire(env,'999999'),null);
  const overrides=await publicQuestionnaires(env,[{id:999999}]);
  assert.equal(overrides['999999'],null);
  setPublishedQuestionnaires(overrides);
  assert.equal(questionnaireFor('999999'),null);
  setPublishedQuestionnaires({});
});

test('RH não edita vaga fora da lista nem aceita gravação cross-site',async()=>{
  const env=envWithDb();
  const foreign=await handleRhRequest(req('/rh/api/questionarios/1234','PUT',
    {questionnaire:custom,expected_version:0}),env,fakeAccess,vacancies);
  assert.equal(foreign.status,404);
  const hostile=new Request(origin+'/rh/api/questionarios/999999',{method:'PUT',
    headers:{Origin:'https://outro-site.example','Content-Type':'application/json'},
    body:JSON.stringify({questionnaire:custom,expected_version:0})});
  const blocked=await handleRhRequest(hostile,env,fakeAccess,vacancies);
  assert.equal(blocked.status,403);
});

test('site público recebe perguntas da vaga nova e Recrutei recebe respostas da configuração RH',async()=>{
  const env={...envWithDb(),APPLICATIONS_ENABLED:'true',PROSPECT_CHANNEL_ID:'8',
    ALLOWED_ORIGIN:'https://recursoshumanos-2026.github.io'};
  const saved=await handleRhRequest(req('/rh/api/questionarios/999999','PUT',
    {questionnaire:custom,expected_version:0}),env,fakeAccess,vacancies);
  assert.equal(saved.status,200);
  const calls=[];
  const previous=globalThis.fetch;
  globalThis.fetch=async(url,options={})=>{
    const target=String(url),path=new URL(target).pathname;
    calls.push({path,options});
    if(path.endsWith('/login-api'))return Response.json({token:'ficticio'});
    if(path.endsWith('/vacancies/filter'))return Response.json({data:[{
      id:999999,title:'Nova vaga',vacancy_status_id:1,pipe_stages:[{id:7,order:1}]
    }]});
    if(target.startsWith('https://jobs.recrutei.com.br/'))return new Response(
      '<script id="__NEXT_DATA__">'+JSON.stringify({props:{pageProps:{retorno:{
        error:false,past:false,closed:false,finished:false,
        vacancy:{id:999999,description:'<p>Vaga de teste</p>'}
      }}}})+'</script>');
    if(path.endsWith('/prospects'))return Response.json({data:{talent:{id:22,prospect:{id:44}},
      application:{id:33,prospect:{id:44}}}},{status:201});
    if(path.endsWith('/curriculum/filled/22'))return Response.json({ok:true});
    if(path.endsWith('/tags/talent')||path.endsWith('/talents-observations'))return Response.json({ok:true},{status:201});
    throw Error('Requisição inesperada: '+path);
  };
  try{
    const list=await worker.fetch(new Request(origin+'/api/vagas'),env);
    assert.equal(list.status,200);
    const data=await list.json();
    assert.deepEqual(data.questionnaires['999999'],custom);
    const input={name:'Pessoa fictícia',email:'teste@example.invalid',telephone:'11911111111',
      vacancy_id:'999999',questionnaire_answers:{q_tech:'Experiência em REST',q_crm:['CRM']}};
    const blocked=await worker.fetch(new Request(origin+'/api/candidatar',{
      method:'POST',headers:{'Content-Type':'application/json'},
      body:JSON.stringify({...input,questionnaire_answers:{q_crm:['CRM']}})
    }),env);
    assert.equal(blocked.status,400);
    assert.equal(calls.some(call=>call.path.endsWith('/prospects')),false);
    const response=await worker.fetch(new Request(origin+'/api/candidatar',{
      method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(input)
    }),env);
    assert.equal(response.status,201);
    assert.equal((await response.json()).observation_completed,true);
    const observation=calls.find(call=>call.path.endsWith('/talents-observations'));
    assert.ok(observation);
    assert.match(observation.options.body.get('description'),/Quais sistemas você utiliza/);
    assert.match(observation.options.body.get('description'),/Experiência em REST/);
    assert.match(observation.options.body.get('description'),/CRM/);
  }finally{globalThis.fetch=previous;}
});
