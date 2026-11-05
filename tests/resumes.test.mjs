import test from 'node:test';
import assert from 'node:assert/strict';
import worker from '../worker/src/index.js';
import { validateResume, convertResume, resumeField, storeResume } from '../worker/src/resumes.js';
import { questionnaireFor } from '../questionnaires.js';

const ORIGIN = 'https://recursoshumanos-2026.github.io';
const rawPdf = () => new File([new TextEncoder().encode('%PDF-1.7\nCurriculo ficticio da pessoa teste.\n%%EOF')], 'curriculo.pdf', { type:'application/pdf' });
const rawDocx = () => new File([new Uint8Array([0x50,0x4b,0x03,0x04,...new Array(36).fill(0)])], 'curriculo.docx', {
  type:'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
});
const answers = () => Object.fromEntries(questionnaireFor('158928').questions.map(q => [q.id,
  q.type === 'text' ? 'Resposta demonstrativa' : q.type === 'single'
    ? q.options[0] : q.options.slice(0,2)
]));

const formFor = file => {
  const form = new FormData();
  for (const [key,value] of Object.entries({
    name:'Pessoa fictícia',email:'candidate@example.invalid',telephone:'11999999999',
    vacancy_id:'158928',form_version:'2',birthday:'2000-01-01',
    intended_remuneration:'5000'
  })) form.set(key,value);
  form.set('questionnaire_answers', JSON.stringify(answers()));
  if (file) form.set('resume',file,file.name);
  return form;
};

function fakeEnv(options={}) {
  const dbRows=[];
  const env={
    APPLICATIONS_ENABLED:'true',PROSPECT_CHANNEL_ID:'8',
    ALLOWED_ORIGIN:ORIGIN,RESUME_UPLOAD_ENABLED:'true',
    AI:{ async toMarkdown(input) {
      assert.ok(input.name.endsWith('.pdf') || input.name.endsWith('.docx'));
      assert.equal(input.name.includes('Pessoa'),false);
      return {data:options.markdown ?? '# Pessoa fictícia\n\n## Experiência profissional\n\nTrabalhou com atendimento e operações.',format:'markdown'};
    }},
    RESUME_DB:{prepare(sql) {
      return {
        async first() {
          if(options.tableMissing) throw Error('Missing D1 table');
          return null;
        },
        bind(...values) {
          return { async run() {
            if(options.d1Fail) throw Error('D1 simulated failure');
            dbRows.push({sql,values});
            return {success:true};
          }};
        }
      };
    }}
  };
  return {env,dbRows};
}

async function application(file,options={}) {
  const { env,dbRows }=fakeEnv(options);
  const calls=[];
  const prior=globalThis.fetch;
  globalThis.fetch=async(url,init={})=>{
    const path=new URL(String(url)).pathname;
    calls.push({path,url:String(url),init});
    if(path.endsWith('login-api')) return Response.json({token:'fake-token'});
    if(path.endsWith('/vacancies/filter')) return Response.json({
      data:[{id:158928,title:'Analista de Atendimento',vacancy_status_id:1,pipe_stages:[{id:10,order:1}]}]
    });
    if(String(url).startsWith('https://jobs.recrutei.com.br/gex-corporation/vacancy/'))
      return new Response('<script id="__NEXT_DATA__">'+JSON.stringify({props:{pageProps:{
        retorno:{error:false,closed:false,past:false,finished:false,vacancy:{id:158928}}
      }}})+'</script>',{status:200});
    if(path.endsWith('/prospects')) return new Response(JSON.stringify({
      data:{talent:{id:22,prospect:{id:44}},application:{id:33,prospect:{id:44}}}
    }),{status:201});
    if(path.endsWith('/curriculum/filled/22')) return new Response(
      JSON.stringify(options.profileFail?{message:'Não encontrado'}:{data:{ok:true}}),
      {status:options.profileFail?(options.profileStatus??404):200});
    if(path.endsWith('/tags/talent')||path.endsWith('/talents-observations'))return new Response(
      JSON.stringify({ok:true}),{status:201});
    throw Error('Unexpected external request:'+path);
  };
  try {
    const result=await worker.fetch(new Request('https://worker.invalid/api/candidatar',{
      method:'POST',headers:{Origin:ORIGIN},body:formFor(file)
    }),env);
    return {status:result.status,body:await result.json(),calls,dbRows,env};
  }finally{globalThis.fetch=prior}
}

test('accept only small PDF/DOCX files with valid format',async()=>{
  assert.equal(validateResume(rawPdf()),'pdf');
  assert.equal(validateResume(rawDocx()),'docx');
  assert.throws(()=>validateResume(new File(['abc'], 'arquivo.txt',{type:'text/plain'})),/PDF ou DOCX/);
  assert.throws(()=>validateResume(new File([new Uint8Array(5*1024*1024+1)],'arquivo.pdf',{type:'application/pdf'})),/5 MB/);
  const {env}=fakeEnv();
  await assert.rejects(()=>convertResume(env,new File(['not really a pdf file'],'curriculo.pdf',{type:'application/pdf'})),/não é um PDF/);
  await assert.rejects(()=>convertResume(env,new File(['not really an archive'],'curriculo.docx',{type:'application/vnd.openxmlformats-officedocument.wordprocessingml.document'})),/não é um PDF/);
});

test('private D1 Markdown storage uses parameterized SQL and no public URL',async()=>{
  const {env,dbRows}=fakeEnv();
  const saved=await storeResume(env,'# Currículo demonstrativo',33,158928);
  assert.match(saved.id,/^[a-f0-9-]{36}$/);
  assert.equal(saved.url,undefined);
  assert.equal(dbRows[0].sql,'INSERT INTO candidate_resumes (id, vacancy_id, application_id, markdown) VALUES (?, ?, ?, ?)');
  assert.deepEqual(dbRows[0].values,[saved.id,158928,33,'# Currículo demonstrativo']);
  assert.equal(dbRows[0].values.some(value=>String(value).includes('candidate@example.invalid')),false);
});

test('Markdown resume enters Recrutei custom informations field and D1 storage',async()=>{
  const r=await application(rawPdf());
  assert.equal(r.status,201);
  assert.equal(r.body.application_created,true);
  assert.equal(r.body.resume_completed,true);
  assert.equal(r.body.resume_custom_field_completed,true);
  assert.equal(r.body.resume_observation_completed,true);
  assert.equal(r.dbRows.length,1);
  const update=r.calls.find(c=>c.path==='/api/v2/curriculum/filled/22');
  const payload=JSON.parse(update.init.body);
  assert.equal(new URL(update.url).pathname.split('/').pop(),'22');
  assert.equal(Object.hasOwn(payload,'talent_id'),false);
  assert.equal(payload.application_id,33);
  assert.equal(payload.informations.length,1);
  assert.deepEqual(payload.informations[0],resumeField(r.dbRows[0].values[3]));
  assert.equal(r.calls.filter(c=>c.path==='/api/v2/prospects').length,1);
  assert.equal(r.calls.filter(c=>c.path==='/api/v2/talents-observations').length,2);
  const resumeNote=r.calls.filter(c=>c.path==='/api/v2/talents-observations')[1].init.body.get('description');
  assert.ok(resumeNote.includes('<strong>Experiência profissional</strong>'));
  assert.ok(resumeNote.includes('<p>Trabalhou com atendimento e operações.</p>'));
  assert.ok(!resumeNote.includes('<pre>'));
});

test('organiza currículo em seções, parágrafos e listas sem interpretar HTML do candidato',async()=>{
  const markdown = '# Profissional fictício\n\n## Resumo\n\nAtendimento ao cliente.\nResultados mensais.\n\n## Competências\n\n- **SQL**\n- <script>alert("x")</script>\n';
  const r=await application(rawPdf(),{markdown});
  const note=r.calls.filter(c=>c.path==='/api/v2/talents-observations')[1].init.body.get('description');
  assert.ok(note.includes('<p><strong>Resumo</strong></p>'));
  assert.ok(note.includes('<p>Atendimento ao cliente.<br>Resultados mensais.</p>'));
  assert.ok(note.includes('<ul><li><strong>SQL</strong></li><li>&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt;</li></ul>'));
  assert.ok(!note.includes('<script>'));
  assert.ok(!note.includes('<pre>'));
  assert.equal(r.dbRows[0].values[3], markdown.trim());
});

test('corrige currículo de PDF com cabeçalhos e tópicos colados no texto',async()=>{
  const markdown = '# curriculo-teste.pdf\nContents\nPage 1\n' +
    'PESSOA EXEMPLOJundiaí - SP | contato@example.invalid\n' +
    'LinkedIn: linkedin.com/in/exemploRESUMO PROFISSIONAL' +
    'Experiência em RH com foco em resultados.COMPETÊNCIAS TÉCNICAS' +
    '• Recrutamento e Seleção• Administração de benefícios' +
    'EXPERIÊNCIA PROFISSIONALAnalista de RH | Empresa Exemplo | 2024 - Atual' +
    '• Gestão de processos.• Organização de documentos.' +
    'Jovem Aprendiz | Empresa Teste | 2022 - 2023' +
    'Page 2\nAuxiliar Administrativo | Empresa Teste | 2021 - 2022' +
    'FORMAÇÃO ACADÊMICABacharelado em Psicologia | Universidade Exemplo';
  const r=await application(rawPdf(),{markdown});
  const note=r.calls.filter(c=>c.path==='/api/v2/talents-observations')[1].init.body.get('description');
  assert.ok(note.includes('<p><strong>RESUMO PROFISSIONAL</strong></p>'));
  assert.ok(note.includes('<p><strong>COMPETÊNCIAS TÉCNICAS</strong></p>'));
  assert.ok(note.includes('<p><strong>EXPERIÊNCIA PROFISSIONAL</strong></p>'));
  assert.ok(note.includes('<p><strong>FORMAÇÃO ACADÊMICA</strong></p>'));
  assert.ok(note.includes('<p><strong>COMPETÊNCIAS TÉCNICAS</strong></p><br><ul>'));
  assert.ok(note.includes('</ul><br><p><strong>EXPERIÊNCIA PROFISSIONAL</strong></p>'));
  assert.ok(note.includes('<li>Recrutamento e Seleção</li><li>Administração de benefícios</li>'));
  assert.ok(note.includes('<li>Recrutamento e Seleção</li>'));
  assert.ok(note.includes('<li>Administração de benefícios</li>'));
  assert.ok(note.includes('<li>Organização de documentos.</li>'));
  assert.ok(!note.includes('resultados.COMPETÊNCIAS'));
  assert.ok(!note.includes('TÉCNICAS•'));
  assert.ok(!note.includes('PROFISSIONALAnalista'));
  assert.ok(!note.includes('EXEMPLOJundiaí'));
  assert.ok(!note.includes('Contents'));
  assert.ok(!note.includes('Page 1'));
  assert.equal(r.dbRows[0].values[3],markdown);
});

test('when Recrutei custom field returns HTTP 404, fallback observation stores escaped Markdown',async()=>{
  const r=await application(rawPdf(),{profileFail:true});
  assert.equal(r.status,201);
  assert.equal(r.body.profile_completed,false);
  assert.equal(r.body.resume_custom_field_completed,false);
  assert.equal(r.body.resume_stored,true);
  assert.equal(r.body.resume_observation_completed,true);
  assert.equal(r.body.resume_completed,true);
  const notes=r.calls.filter(c=>c.path==='/api/v2/talents-observations');
  assert.equal(notes.length,2);
  assert.ok(notes[1].init.body.get('description').includes('Currículo do candidato'));
  assert.equal(r.calls.filter(c=>c.path==='/api/v2/prospects').length,1);
});

test('HTTP 406 preserva currículo convertido e registra nascimento/salário sem alterar perfil próprio',async()=>{
  const r=await application(rawPdf(),{profileFail:true,profileStatus:406});
  assert.equal(r.status,201);
  assert.equal(r.body.application_created,true);
  assert.equal(r.body.profile_completed,false);
  assert.deepEqual(r.body.profile_error,{http_status:406,fields:[]});
  assert.equal(r.body.resume_stored,true);
  assert.equal(r.body.resume_observation_completed,true);
  assert.equal(r.body.resume_completed,true);
  assert.equal(r.body.profile_fallback_observation_completed,true);
  const notes=r.calls.filter(c=>c.path==='/api/v2/talents-observations');
  assert.equal(notes.length,3);
  assert.ok(notes.some(note=>note.init.body.get('description').includes('Currículo do candidato')));
  assert.ok(notes.some(note=>note.init.body.get('description').includes('Data de nascimento:')));
});

test('D1 storage failure still preserves resume Markdown at Recrutei without false success',async()=>{
  const r=await application(rawPdf(),{d1Fail:true});
  assert.equal(r.status,201);
  assert.equal(r.body.application_created,true);
  assert.equal(r.body.resume_stored,false);
  assert.equal(r.body.resume_completed,false);
  assert.equal(r.body.resume_custom_field_completed,true);
  assert.equal(r.body.resume_observation_completed,true);
  const updated=r.calls.find(c=>c.path==='/api/v2/curriculum/filled/22');
  assert.equal(JSON.parse(updated.init.body).informations.length,1);
  assert.equal(r.calls.filter(c=>c.path==='/api/v2/prospects').length,1);
});

test('missing D1 table is rejected before creating Recrutei candidate',async()=>{
  const r=await application(rawPdf(),{tableMissing:true});
  assert.equal(r.status,503);
  assert.equal(r.body.application_created,undefined);
  assert.equal(r.calls.filter(c=>c.path==='/api/v2/prospects').length,0);
  assert.equal(r.dbRows.length,0);
});

test('disabled feature rejects multipart requests before candidate creation',async()=>{
  const {env}=fakeEnv();
  env.RESUME_UPLOAD_ENABLED='false';
  const original=globalThis.fetch;
  globalThis.fetch=()=>{throw Error('No API calls expected')};
  try{
    const r=await worker.fetch(new Request('https://worker.invalid/api/candidatar',{
      method:'POST',headers:{Origin:ORIGIN},body:formFor(rawPdf())
    }),env);
    assert.equal(r.status,503);
    assert.equal((await r.json()).application_created,undefined);
  }finally{globalThis.fetch=original}
});

test('health advertises resume upload only when both private storage and conversion exist',async()=>{
  const {env}=fakeEnv();
  let r=await worker.fetch(new Request('https://worker.invalid/health'),env);
  const enabled = await r.json();
  assert.equal(enabled.resume_upload_enabled,true);
  assert.equal(enabled.resume_observation_format,'sectioned_html_v3');
  assert.deepEqual(enabled.resume_connections,{workers_ai:true,d1_database:true});
  delete env.RESUME_DB;
  r=await worker.fetch(new Request('https://worker.invalid/health'),env);
  const missingDb = await r.json();
  assert.equal(missingDb.resume_upload_enabled,false);
  assert.deepEqual(missingDb.resume_connections,{workers_ai:true,d1_database:false});
});

test('invalid PDF does not create a candidate in Recrutei',async()=>{
  const invalid=new File(['not a real PDF document'],'curriculo.pdf',{type:'application/pdf'});
  const r=await application(invalid);
  assert.equal(r.status,400);
  assert.equal(r.body.application_created,undefined);
  assert.equal(r.calls.filter(c=>c.path==='/api/v2/prospects').length,0);
  assert.equal(r.dbRows.length,0);
});

test('Markdown conversion failure returns validation status before candidate creation',async()=>{
  const {env}=fakeEnv();
  env.AI.toMarkdown=async()=>({format:'error',error:'OCR failed'});
  const real=globalThis.fetch;const calls=[];
  globalThis.fetch=async(url)=>{
    const path=new URL(String(url)).pathname;calls.push(path);
    if(path.endsWith('login-api'))return Response.json({token:'mock'});
    if(path.endsWith('/vacancies/filter'))return Response.json({
      data:[{id:158928,title:'Analista de Atendimento',vacancy_status_id:1,pipe_stages:[{id:10,order:1}]}]
    });
    if(String(url).startsWith('https://jobs.recrutei.com.br/gex-corporation/vacancy/'))
      return new Response('<script id="__NEXT_DATA__">'+JSON.stringify({props:{pageProps:{
        retorno:{error:false,closed:false,past:false,finished:false,vacancy:{id:158928}}
      }}})+'</script>',{status:200});
    throw Error('No candidate should be created');
  };
  try{
    const response=await worker.fetch(new Request('https://worker.invalid/api/candidatar',{
      method:'POST',headers:{Origin:ORIGIN},body:formFor(rawPdf())
    }),env);
    assert.equal(response.status,422);
    assert.equal(calls.includes('/api/v2/prospects'),false);
  }finally{globalThis.fetch=real}
});
