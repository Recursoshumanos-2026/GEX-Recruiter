// Operational monitoring only: never log IDs, names, résumé text, raw
// provider messages, headers, credentials, or candidate assessment scores.
export const integrationMonitoringEnabled=env=>env?.INTEGRATION_MONITOR_ENABLED==='true';

const stages=new Set(['application','profile','tag','questionnaire','resume_storage','resume_note','profile_fallback','technical_analysis','recrutei_connection','resume_database','ai_binding']);
const outcomes=new Set(['ok','failed','uncertain','not_required','unavailable']);

export function integrationEvent(env,stage,outcome) {
  if(!integrationMonitoringEnabled(env)||!stages.has(stage)||!outcomes.has(outcome))return;
  // Fixed strings only. Logging must not interfere with the application.
  try {
    const line=JSON.stringify({event:'gex_recruiter_integration',stage,outcome});
    if(outcome==='failed'||outcome==='uncertain'||outcome==='unavailable') console.warn(line);
    else console.info(line);
  } catch {}
}

export function monitorApplication(env,report) {
  if(!integrationMonitoringEnabled(env))return;
  for(const stage of ['application','profile','tag','questionnaire','resume_storage','resume_note','profile_fallback']) {
    const state=report[stage];
    integrationEvent(env,stage,state===true?'ok':state===false?'failed':'not_required');
  }
}

export async function checkIntegration(env,{checkRecrutei}={}) {
  if(!integrationMonitoringEnabled(env))return {status:'disabled'};
  // Probe a vacancy-list request, not a candidate or an application write.
  let recrutei=false;
  try {recrutei=(await checkRecrutei(env))===true;} catch {}
  const resumeExpected=env.RESUME_UPLOAD_ENABLED==='true';
  let d1=false;
  if(resumeExpected&&typeof env.RESUME_DB?.prepare==='function'){
    try {await env.RESUME_DB.prepare('SELECT 1 FROM candidate_resumes LIMIT 1').first();d1=true;}catch{}
  }
  // A binding is not evidence that a real AI inference succeeded.
  const ai=env.TECHNICAL_ANALYSIS_ENABLED==='false'&&!resumeExpected?'not_required':
    typeof env.AI?.run==='function'&&(!resumeExpected||typeof env.AI?.toMarkdown==='function')?'ok':'unavailable';
  const report={status:'checked',recrutei:recrutei?'ok':'failed',
    d1:!resumeExpected?'not_required':d1?'ok':'failed',ai_binding:ai};
  integrationEvent(env,'recrutei_connection',report.recrutei);
  integrationEvent(env,'resume_database',report.d1);
  integrationEvent(env,'ai_binding',report.ai_binding);
  return report;
}
