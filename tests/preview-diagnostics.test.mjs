import test from 'node:test';
import assert from 'node:assert/strict';
import worker from '../worker/src/index.js';

function diagnosticEnv(options={}) {
  const events=[];
  const toMarkdown=()=>({
    async supported() {
      events.push('ai-supported');
      if(options.aiFailure)throw new Error('AI currently unavailable');
      return [{extension:'.pdf',mimeType:'application/pdf'},
        {extension:'.docx',mimeType:'application/vnd.openxmlformats-officedocument.wordprocessingml.document'}];
    }
  });
  const env={
    RESUME_DIAGNOSTIC_ENABLED:'true',
    RESUME_UPLOAD_ENABLED:'false',
    AI:{toMarkdown},
    RESUME_DB:{
      prepare(statement){
        events.push(statement);
        return {async first(){
          if(options.dbFailure)throw new Error('No such table');
          return options.withCandidate?{id:'private-person-id'}:null;
        }};
      }
    }
  };
  return {env,events};
}
const request=new Request('https://preview.invalid/health?check=resume');

test('diagnosis verifies D1 schema and PDF/DOCX support without revealing candidate data',async()=>{
  const {env,events}=diagnosticEnv({withCandidate:true});
  const response=await worker.fetch(request,env);
  assert.equal(response.status,200);
  assert.equal(response.headers.get('cache-control'),'no-store');
  const body=await response.json();
  assert.equal(body.d1_table_ready,true);
  assert.equal(body.pdf_supported,true);
  assert.equal(body.docx_supported,true);
  assert.equal(body.resume_upload_enabled,false);
  assert.equal(body.recrutei_credentials_configured,false);
  assert.ok(!JSON.stringify(body).includes('private-person-id'));
  assert.equal(events.filter(e=>e.startsWith('SELECT id')).length,1);
});

test('diagnosis reports D1 or AI unavailability without exposing errors',async()=>{
  const {env}=diagnosticEnv({dbFailure:true,aiFailure:true});
  const response=await worker.fetch(request,env);
  assert.equal(response.status,200);
  const body=await response.json();
  assert.equal(body.d1_table_ready,false);
  assert.equal(body.pdf_supported,false);
  assert.equal(body.docx_supported,false);
  assert.ok(!JSON.stringify(body).includes('No such table'));
});

test('production has no diagnostic query and does not invoke either binding',async()=>{
  const {env,events}=diagnosticEnv({withCandidate:true});
  delete env.RESUME_DIAGNOSTIC_ENABLED;
  const response=await worker.fetch(request,env);
  assert.equal(response.status,200);
  const body=await response.json();
  assert.equal(body.d1_table_ready,undefined);
  assert.equal(events.length,0);
});
