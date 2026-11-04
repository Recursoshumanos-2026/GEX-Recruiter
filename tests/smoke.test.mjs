import test from 'node:test';
import assert from 'node:assert/strict';
import worker from '../worker/src/index.js';
import { syntheticPdf, smokeResume } from '../worker/src/smoke.js';

const marker='CURRICULO FICTICIO TESTE GEX';
function fakeEnvironment(opts={}) {
  let record=null,converted=0,created=0,reads=0;
  const env={
    RESUME_DIAGNOSTIC_ENABLED:'true',
    RESUME_UPLOAD_ENABLED:'false',
    AI: {
      async toMarkdown(doc) {
        converted++;
        assert.equal(doc.name,'curriculo.pdf');
        const pdf=new Uint8Array(await doc.blob.arrayBuffer());
        assert.equal(new TextDecoder().decode(pdf.slice(0,8)),'%PDF-1.4');
        if(opts.conversionFails) return {format:'error',error:'not parsed'};
        return {format:'markdown',data:'# '+marker+'\n\nExperiencia ficticia em atendimento, operacoes e dados.'};
      }
    },
    RESUME_DB:{
      prepare(sql) {
        if(opts.dbFails) throw new Error('Table not ready');
        return {
          bind(...params) {
            return {
              async first() {
                reads++;
                if(sql.startsWith('SELECT markdown'))return record?{markdown:record}:null;
                return null;
              },
              async run() {
                if(opts.dbWriteFails) return {success:false};
                created++;
                record=params[3];
                return {success:true};
              }
            };
          }
        };
      }
    }
  };
  return {env,stats:()=>({record,converted,created,reads})};
}

test('embedded synthetic PDF is valid and contains no real personal information',async()=>{
  const fake=syntheticPdf();
  assert.equal(fake.type,'application/pdf');
  assert.ok(fake.size>100);
  assert.ok(fake.size<2000);
  const data=await fake.text();
  assert.ok(data.startsWith('%PDF-1.4'));
  assert.ok(data.includes(marker));
  assert.ok(!data.includes('@'));
});

test('preview-only smoke test converts PDF and stores Markdown with no Recrutei calls',async()=>{
  const {env,stats}=fakeEnvironment();
  const prev=globalThis.fetch;
  globalThis.fetch=()=>{throw Error('No external request allowed')};
  try{
    const response=await worker.fetch(new Request('https://preview.invalid/health?check=conversion'),env);
    assert.equal(response.status,200);
    assert.equal(response.headers.get('cache-control'),'no-store');
    assert.deepEqual(await response.json(),{
      ok:true,conversion_ok:true,d1_write_ok:true,cached:false
    });
    assert.equal(stats().converted,1);
    assert.equal(stats().created,1);
    assert.ok(stats().record.includes(marker));
    const again=await worker.fetch(new Request('https://preview.invalid/health?check=conversion'),env);
    assert.equal(again.status,200);
    assert.equal((await again.json()).cached,true);
    assert.equal(stats().converted,1);
    assert.equal(stats().created,1);
  } finally {globalThis.fetch=prev}
});

test('preview endpoint cannot be called when diagnostic toggle is absent',async()=>{
  const {env,stats}=fakeEnvironment();
  delete env.RESUME_DIAGNOSTIC_ENABLED;
  const result=await worker.fetch(new Request('https://preview.invalid/health?check=conversion'),env);
  assert.equal(result.status,200);
  assert.equal((await result.json()).ok,true);
  assert.equal(stats().converted,0);
  assert.equal(stats().created,0);
});

test('PDF conversion failures never write to D1',async()=>{
  const {env,stats}=fakeEnvironment({conversionFails:true});
  const response=await worker.fetch(new Request('https://preview.invalid/health?check=conversion'),env);
  assert.equal(response.status,503);
  assert.equal((await response.json()).code,'PDF_CONVERSION_FAILED');
  assert.equal(stats().created,0);
});

test('failed D1 write is reported and never as a successful result',async()=>{
  const {env,stats}=fakeEnvironment({dbWriteFails:true});
  const response=await worker.fetch(new Request('https://preview.invalid/health?check=conversion'),env);
  assert.equal(response.status,503);
  assert.equal((await response.json()).code,'D1_WRITE_FAILED');
  assert.equal(stats().converted,1);
  assert.equal(stats().created,0);
});

test('missing table stops AI conversion',async()=>{
  const {env,stats}=fakeEnvironment({dbFails:true});
  const response=await worker.fetch(new Request('https://preview.invalid/health?check=conversion'),env);
  assert.equal(response.status,503);
  assert.equal((await response.json()).code,'D1_TABLE_UNAVAILABLE');
  assert.equal(stats().converted,0);
});

test('disabled upload is required for the synthetic diagnostic',async()=>{
  const {env,stats}=fakeEnvironment();
  env.RESUME_UPLOAD_ENABLED='true';
  assert.deepEqual(await smokeResume(env),{ok:false,code:'TEST_DISABLED'});
  assert.equal(stats().converted,0);
});
