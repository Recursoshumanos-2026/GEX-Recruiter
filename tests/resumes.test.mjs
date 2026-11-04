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
  const r2Objects=[];
  const env={
    APPLICATIONS_ENABLED:'true',PROSPECT_CHANNEL_ID:'8',
    ALLOWED_ORIGIN:ORIGIN,RESUME_UPLOAD_ENABLED:'true',
    AI:{ async toMarkdown(input) {
      assert.ok(input.name.endsWith('.pdf') || input.name.endsWith('.docx'));
      assert.equal(input.name.includes('Pessoa'),false);
      return {data:'# Pessoa fictícia\n\n## Experiência profissional\n\nTrabalhou com atendimento e operações.',format:'markdown'};
    }},
    RESUME_BUCKET:{async put(key,markdown,metadata) {
      if (options.r2Fail) throw Error('R2 simulated failure');
      r2Objects.push({key,markdown,metadata});
    }}
  };
  return {env,r2Objects};
}

async function application(file,options={}) {
  const { env,r2Objects }=fakeEnv(options);
  const calls=[];
  const prior=globalThis.fetch;
  globalThis.fetch=async(url,init={})=>{
    const path=new URL(String(url)).pathname;
    calls.push({path,init});
    if(path.endsWith('login-api')) return Response.json({token:'fake-token'});
    if(path.endsWith('/vacancies/filter')) return Response.json({
      data:[{id:158928,vacancy_status_id:1,pipe_stages:[{id:10,order:1}]}]
    });
    if(path.endsWith('/prospects')) return new Response(JSON.stringify({
      data:{talent:{id:22},application:{id:33}}
    }),{status:201});
    if(path.endsWith('/curriculum/filled')) return new Response(
      JSON.stringify(options.profileFail?{message:'Não encontrado'}:{data:{ok:true}}),
      {status:options.profileFail?404:200});
    if(path.endsWith('/tags/talent')||path.endsWith('/talents-observations'))return new Response(
      JSON.stringify({ok:true}),{status:201});
    throw Error('Unexpected external request:'+path);
  };
  try {
    const result=await worker.fetch(new Request('https://worker.invalid/api/candidatar',{
      method:'POST',headers:{Origin:ORIGIN},body:formFor(file)
    }),env);
    return {status:result.status,body:await result.json(),calls,r2Objects,env};
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

test('private Markdown storage returns opaque key and no public URL',async()=>{
  const {env,r2Objects}=fakeEnv();
  const saved=await storeResume(env,'# Currículo demonstrativo',33,158928);
  assert.match(saved.key,/^curriculos\/158928\/33\/[a-f0-9-]+\.md$/);
  assert.equal(saved.url,undefined);
  assert.equal(r2Objects[0].markdown,'# Currículo demonstrativo');
  assert.equal(r2Objects[0].metadata.httpMetadata.contentType,'text/markdown; charset=utf-8');
  assert.ok(!saved.key.includes('candidate'));
});

test('Markdown resume enters Recrutei custom informations field and R2 storage',async()=>{
  const r=await application(rawPdf());
  assert.equal(r.status,201);
  assert.equal(r.body.application_created,true);
  assert.equal(r.body.resume_completed,true);
  assert.equal(r.body.resume_custom_field_completed,true);
  assert.equal(r.body.resume_observation_completed,false);
  assert.equal(r.r2Objects.length,1);
  const update=r.calls.find(c=>c.path==='/api/v2/curriculum/filled');
  const payload=JSON.parse(update.init.body);
  assert.equal(payload.informations.length,1);
  assert.deepEqual(payload.informations[0],resumeField(r.r2Objects[0].markdown));
  assert.equal(r.calls.filter(c=>c.path==='/api/v2/prospects').length,1);
  assert.equal(r.calls.filter(c=>c.path==='/api/v2/talents-observations').length,1);
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
  assert.ok(notes[1].init.body.get('description').includes('Currículo convertido em Markdown'));
  assert.equal(r.calls.filter(c=>c.path==='/api/v2/prospects').length,1);
});

test('R2 storage failure never retries or misreports successful resume attachment',async()=>{
  const r=await application(rawPdf(),{r2Fail:true});
  assert.equal(r.status,201);
  assert.equal(r.body.application_created,true);
  assert.equal(r.body.resume_stored,false);
  assert.equal(r.body.resume_completed,false);
  assert.equal(r.body.resume_custom_field_completed,false);
  assert.equal(r.calls.filter(c=>c.path==='/api/v2/prospects').length,1);
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
  assert.equal((await r.json()).resume_upload_enabled,true);
  delete env.RESUME_BUCKET;
  r=await worker.fetch(new Request('https://worker.invalid/health'),env);
  assert.equal((await r.json()).resume_upload_enabled,false);
});

test('invalid PDF does not create a candidate in Recrutei',async()=>{
  const invalid=new File(['not a real PDF document'],'curriculo.pdf',{type:'application/pdf'});
  const r=await application(invalid);
  assert.equal(r.status,400);
  assert.equal(r.body.application_created,undefined);
  assert.equal(r.calls.filter(c=>c.path==='/api/v2/prospects').length,0);
  assert.equal(r.r2Objects.length,0);
});

test('Markdown conversion failure returns validation status before candidate creation',async()=>{
  const {env}=fakeEnv();
  env.AI.toMarkdown=async()=>({format:'error',error:'OCR failed'});
  const real=globalThis.fetch;const calls=[];
  globalThis.fetch=async(url)=>{
    const path=new URL(String(url)).pathname;calls.push(path);
    if(path.endsWith('login-api'))return Response.json({token:'mock'});
    if(path.endsWith('/vacancies/filter'))return Response.json({
      data:[{id:158928,vacancy_status_id:1,pipe_stages:[{id:10,order:1}]}]
    });
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
