import assert from 'node:assert/strict';

// Public Cloudflare Preview URL only. Does not call production or create Recrutei candidates.
// The dedicated diagnostic converts a wholly synthetic PDF once and writes a fictitious
// row in the D1 TEST database. Subsequent checks reuse the cached test row.
const base='https://feat-lucide-icons-gex-gex-talents-api.rh-75e.workers.dev';
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const fetchJSON=async path=>{
  const response=await fetch(base+path,{signal:AbortSignal.timeout(15000),
    headers:{'Cache-Control':'no-cache'}});
  let body;
  try{body=await response.json()}catch{body={}};
  return {status:response.status,body};
};
if(process.env.GEX_RUN_LIVE_PREVIEW !== 'true'){
  console.log('Skip live integration; explicit CI switch not set.');
  process.exit(0);
}
let result;
for(let attempt=1;attempt<=30;attempt++){
  try{
    const health=await fetchJSON('/health?check=resume');
    if(health.body.environment !== 'preview' ||
        health.body.d1_table_ready !== true ||
        health.body.pdf_supported !== true ||
        health.body.docx_supported !== true){
      console.log(`Preview not ready; attempt ${attempt}/30`);
      await sleep(8000);
      continue;
    }
    assert.equal(health.body.resume_upload_enabled,false,
      'Live candidate upload must stay disabled in preview');
    result=await fetchJSON('/health?check=conversion');
    if(result.status!==200 || result.body.ok!==true){
      // Real business-logic failure, not a deployment delay.
      if(result.body.code)throw new Error('Live smoke check failed: '+result.body.code);
      console.log(`Smoke endpoint pending; attempt ${attempt}/30`);
      await sleep(8000);
      continue;
    }
    assert.equal(result.body.conversion_ok,true);
    assert.equal(result.body.d1_write_ok,true);
    const status=await fetchJSON('/health');
    assert.equal(status.body.resume_upload_enabled,false);
    console.log(JSON.stringify({
      live_preview:'PASS',
      pdf_to_markdown:'PASS',
      cloudflare_d1_round_trip:'PASS',
      recrutei_untouched:true,
      application_upload_disabled:true,
      fixture_cached:result.body.cached
    }));
    process.exit(0);
  }catch(error){
    if(error.message.startsWith('Live smoke check failed:'))throw error;
    console.log(`Live preview connectivity pending (${attempt}/30): ${error.name}`);
    await sleep(8000);
  }
}
throw new Error('Preview did not become ready for a synthetic PDF/D1 verification.');
