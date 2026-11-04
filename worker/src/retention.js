// GEX Talents — privacy-first, bounded D1 resume retention cleanup.
// Only the private D1 Markdown table is in scope. Recrutei copies require
// a separate approved retention process and cannot be assumed deleted here.
export const RETENTION_CRON = '0 6 * * *';
const DELETE_BATCH_SIZE = 100;
const MAX_BATCHES = 5;

export function cutoffUtc(asOf, months) {
  const count = Number(months);
  if (!Number.isInteger(count) || count < 1 || count > 60) {
    throw new Error('Prazo de retenção inválido.');
  }
  const date = new Date(asOf);
  if (!Number.isFinite(date.getTime())) {
    throw new Error('Data da execução inválida.');
  }
  // Calendar months, clipping the day in shorter months (e.g. March 31).
  const targetMonth = date.getUTCMonth() - count;
  const first = new Date(Date.UTC(date.getUTCFullYear(), targetMonth, 1));
  const lastDay = new Date(Date.UTC(first.getUTCFullYear(),
    first.getUTCMonth() + 1, 0)).getUTCDate();
  const result = new Date(Date.UTC(first.getUTCFullYear(),first.getUTCMonth(),
    Math.min(date.getUTCDate(),lastDay),date.getUTCHours(),date.getUTCMinutes(),
    date.getUTCSeconds()));
  return result.toISOString().slice(0,19).replace('T',' ');
}

export async function cleanupExpiredResumes(env, options = {}) {
  // Production-safe default. Never erase data just because a Cron was deployed.
  if (env?.RESUME_RETENTION_ENABLED !== 'true') {
    return { status:'disabled', deleted:0 };
  }
  if (typeof env?.RESUME_DB?.prepare !== 'function') {
    // No production database binding yet: skip safely and report in logs.
    // Nothing is ever deleted in Recrutei or another external system.
    return { status:'no_database_binding',deleted:0 };
  }
  // For a first dry-run, calculate only how many expired rows exist.
  const dryRun = env.RESUME_RETENTION_DRY_RUN !== 'false';
  const months = env.RESUME_RETENTION_MONTHS ?? '12';
  const cutoff = cutoffUtc(options.now ?? Date.now(), months);
  if (dryRun) {
    const record = await env.RESUME_DB.prepare(
      'SELECT COUNT(*) AS total FROM candidate_resumes WHERE created_at < ?'
    ).bind(cutoff).first();
    return { status:'dry_run', eligible:Number(record?.total || 0), deleted:0 };
  }

  let deleted = 0;
  // Delete up to 500 rows per daily run, preventing unbounded D1 writes/CPU.
  for (let index=0;index<MAX_BATCHES;index++) {
    const result = await env.RESUME_DB.prepare(
      'DELETE FROM candidate_resumes WHERE id IN (' +
      'SELECT id FROM candidate_resumes WHERE created_at < ? ' +
      'ORDER BY created_at ASC, id ASC LIMIT ?)'
    ).bind(cutoff, DELETE_BATCH_SIZE).run();
    if (result?.success === false) {
      throw new Error('A exclusão no D1 não foi confirmada.');
    }
    const changed = Number(result?.meta?.changes);
    if (!Number.isSafeInteger(changed) || changed < 0 || changed > DELETE_BATCH_SIZE) {
      throw new Error('O D1 não retornou a contagem esperada da limpeza.');
    }
    deleted+=changed;
    if (changed < DELETE_BATCH_SIZE) break;
  }
  // Avoid IDs, Markdown, names or candidate information in cron logs.
  return { status:'completed', deleted };
}
