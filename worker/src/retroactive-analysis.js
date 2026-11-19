// Controlled reprocessing of existing portal résumés. No public route and
// no candidate updates other than one advisory technical observation.
const validId = value => /^[1-9]\d*$/.test(String(value ?? '')) && Number.isSafeInteger(Number(value));
const title = /GEX (?:Talents|Recruiter)\s*\|\s*An[aá]lise T[eé]cnica Automatizada/i;
const plain = value => String(value).replace(/<[^>]*>/g,' ').replace(/&nbsp;/gi,' ').replace(/&#124;|&vert;/gi,'|').replace(/\s+/g,' ').trim();

export async function runRetroactiveAnalysis(env,deps,{now=Date.now()}={}) {
  const report={status:'disabled',checked:0,eligible:0,alreadyAnalyzed:0,unavailable:0,submitted:0,uncertain:0};
  if(env?.RETROACTIVE_ANALYSIS_ENABLED!=='true') return report;
  const raw=String(env.RETROACTIVE_ANALYSIS_APPLICATION_IDS||'').split(',').map(s=>s.trim()).filter(Boolean);
  const ids=[...new Set(raw)];
  if(!ids.length || ids.length>5 || ids.some(id=>!validId(id)) ||
      typeof env.RESUME_DB?.prepare!=='function' || !deps.available(env)) {
    report.status='configuration_required';return report;
  }
  const write=env.RETROACTIVE_ANALYSIS_WRITE_ENABLED==='true';
  report.status=write?'controlled_write':'dry_run';
  const db=env.RESUME_DB;
  // Never touch recent applications that may still have their original AI task.
  const cutoff=new Date(now-24*60*60*1000).toISOString();
  if(write) {
    await db.prepare('CREATE TABLE IF NOT EXISTS gex_analysis_backfill_claims (application_id INTEGER PRIMARY KEY, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)').run();
    // Claims contain only IDs and disappear once their corresponding stored
    // résumé is removed by the existing retention task.
    await db.prepare('DELETE FROM gex_analysis_backfill_claims WHERE NOT EXISTS (SELECT 1 FROM candidate_resumes r WHERE r.application_id=gex_analysis_backfill_claims.application_id)').run();
  }
  for(const id of ids) {
    report.checked++;
    try {
      const stored=await db.prepare('SELECT vacancy_id, markdown FROM candidate_resumes WHERE application_id=? AND datetime(created_at)<datetime(?) ORDER BY created_at DESC LIMIT 2').bind(Number(id),cutoff).all();
      const rows=stored?.results;
      // Multiple stored versions require manual reconciliation.
      if(!Array.isArray(rows)||rows.length!==1||!validId(rows[0].vacancy_id)||
        typeof rows[0].markdown!=='string'||rows[0].markdown.trim().length<40) {
        report.unavailable++;continue;
      }
      const row=rows[0], lookup=await deps.lookup(env,id), app=lookup?.application;
      const talentId=app?.talent?.id, observations=app?.talent?.talent_observations;
      if(!lookup?.ok || String(app?.id)!==id || !validId(talentId) ||
        String(app.vacancy_id)!==String(row.vacancy_id) ||
        (app.talent_id!=null && String(app.talent_id)!==String(talentId)) ||
        Number(app.status)!==1 || app.deleted_at || app.reproved_reason_id || app.reproved_by ||
        app.application_withdrawal_id || app.hired ||
        !Array.isArray(observations) ||
        observations.some(note=>typeof note?.description!=='string')) {
        report.unavailable++;continue;
      }
      // Conservative: even a note linked to another vacancy on the same
      // talent prevents a write. Unknown linkage must never cause duplicates.
      if(observations.some(note=>title.test(plain(note.description)))) {
        report.alreadyAnalyzed++;continue;
      }
      const vacancy=await deps.vacancy(env,row.vacancy_id);
      if(!vacancy || String(vacancy.id)!==String(row.vacancy_id) ||
        typeof vacancy.description!=='string' || deps.criteria(vacancy.description).length<3) {
        report.unavailable++;continue;
      }
      report.eligible++;
      if(!write) continue;
      // A durable claim precedes the POST. Uncertain outcomes are not retried:
      // subsequent runs check ATS notes first and the claim prevents replay.
      const claim=await db.prepare('INSERT OR IGNORE INTO gex_analysis_backfill_claims (application_id) VALUES (?)').bind(Number(id)).run();
      if(claim?.meta?.changes!==1) {report.uncertain++;continue;}
      try {
        const result=await deps.submit(env,{vacancy_id:row.vacancy_id},
          {data:{talent:{id:talentId},application:{id:Number(id)}}},
          row.markdown,vacancy.description,vacancy.title);
        if(result?.ok!==true) {report.uncertain++;continue;}
        const check=await deps.lookup(env,id);
        if(check?.ok && String(check.application?.id)===id &&
          Array.isArray(check.application?.talent?.talent_observations) &&
          check.application.talent.talent_observations.some(note=>typeof note?.description==='string' && title.test(plain(note.description)))) {
          report.submitted++;
        } else report.uncertain++;
      } catch {report.uncertain++;}
    } catch {report.unavailable++;}
  }
  return report;
}
