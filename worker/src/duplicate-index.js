// Private, bounded duplicate index for new, confirmed portal applications.
// No raw e-mail, CPF, or client address is stored or returned.
import { cutoffUtc } from './retention.js';

export const duplicateIndexReady = env => typeof env?.DUPLICATE_LOOKUP_SECRET === 'string' &&
  env.DUPLICATE_LOOKUP_SECRET.length >= 32 && typeof env?.RESUME_DB?.prepare === 'function';

const encoder = new TextEncoder();
const emailOf = value => String(value || '').trim().toLowerCase();
const cpfOf = value => String(value || '').replace(/\D/g, '');
export function validDuplicatePair(email, cpf) {
  if (typeof email !== 'string' || email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) return false;
  if (typeof cpf !== 'string' || !/^(?:\d{11}|\d{3}\.\d{3}\.\d{3}-\d{2})$/.test(cpf)) return false;
  const digits = cpfOf(cpf);
  if (/^(\d)\1{10}$/.test(digits)) return false;
  const digit = n => (11 - [...digits.slice(0,n)].reduce((s,d,i) => s + Number(d)*(n+1-i),0)%11)%11%10;
  return digit(9) === Number(digits[9]) && digit(10) === Number(digits[10]);
}
async function digest(env, values) {
  const key = await crypto.subtle.importKey('raw',encoder.encode(env.DUPLICATE_LOOKUP_SECRET),{name:'HMAC',hash:'SHA-256'},false,['sign']);
  return Array.from(new Uint8Array(await crypto.subtle.sign('HMAC',key,encoder.encode(JSON.stringify(values))))).map(b=>b.toString(16).padStart(2,'0')).join('');
}
const cutoff = now => cutoffUtc(now,12);
async function table(env) {
  await env.RESUME_DB.prepare('CREATE TABLE IF NOT EXISTS gex_duplicate_index (vacancy_id TEXT NOT NULL, application_id TEXT NOT NULL, pair_hash TEXT NOT NULL, cpf_hash TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, PRIMARY KEY (vacancy_id, application_id))').run();
  await env.RESUME_DB.prepare('CREATE INDEX IF NOT EXISTS gex_duplicate_pair_idx ON gex_duplicate_index (vacancy_id, pair_hash, created_at)').run();
  await env.RESUME_DB.prepare('CREATE INDEX IF NOT EXISTS gex_duplicate_cpf_idx ON gex_duplicate_index (vacancy_id, cpf_hash, created_at)').run();
}
async function rateTable(env) {
  await env.RESUME_DB.prepare('CREATE TABLE IF NOT EXISTS gex_duplicate_rate (bucket TEXT PRIMARY KEY, expires_at INTEGER NOT NULL, attempts INTEGER NOT NULL)').run();
}
export async function rememberDuplicatePair(env, payload, applicationId) {
  if (!duplicateIndexReady(env) || !/^[1-9][0-9]*$/.test(String(applicationId||'')) || !validDuplicatePair(payload.email,payload.ssn)) return;
  const vacancy = String(payload.vacancy_id);
  const [pair,cpf] = await Promise.all([
    digest(env,['pair',vacancy,emailOf(payload.email),cpfOf(payload.ssn)]),
    digest(env,['cpf',vacancy,cpfOf(payload.ssn)])
  ]);
  await table(env);
  await env.RESUME_DB.prepare('INSERT OR IGNORE INTO gex_duplicate_index (vacancy_id,application_id,pair_hash,cpf_hash) VALUES (?,?,?,?)').bind(vacancy,String(applicationId),pair,cpf).run();
}
export async function duplicateCpfKnown(env, payload, now=Date.now()) {
  if (!duplicateIndexReady(env)) return false;
  await table(env);
  const vacancy=String(payload.vacancy_id);
  const hash=await digest(env,['cpf',vacancy,cpfOf(payload.ssn)]);
  return Boolean(await env.RESUME_DB.prepare('SELECT 1 AS found FROM gex_duplicate_index WHERE vacancy_id=? AND cpf_hash=? AND created_at>=? LIMIT 1').bind(vacancy,hash,cutoff(now)).first());
}
export async function checkDuplicatePair(env, payload, client, now=Date.now()) {
  if (!duplicateIndexReady(env) || !client || !validDuplicatePair(payload.email,payload.ssn)) return {status:'unavailable'};
  // Shared, atomic D1 cap. The raw network address never enters the database.
  const end=(Math.floor(now/600000)+1)*600000;
  await rateTable(env);
  const bucket=await digest(env,['rate',client,end]);
  const count=await env.RESUME_DB.prepare('INSERT INTO gex_duplicate_rate (bucket,expires_at,attempts) VALUES (?,?,1) ON CONFLICT(bucket) DO UPDATE SET attempts=attempts+1 RETURNING attempts').bind(bucket,end).first();
  if (!Number.isSafeInteger(Number(count?.attempts)) || Number(count.attempts)>10) return {status:'unavailable'};
  const vacancy=String(payload.vacancy_id);
  const hash=await digest(env,['pair',vacancy,emailOf(payload.email),cpfOf(payload.ssn)]);
  await table(env);
  const found=await env.RESUME_DB.prepare('SELECT 1 AS found FROM gex_duplicate_index WHERE vacancy_id=? AND pair_hash=? AND created_at>=? LIMIT 1').bind(vacancy,hash,cutoff(now)).first();
  // A negative lookup is NOT confirmation that the candidate is new.
  return {status:found?'duplicate':'unconfirmed'};
}
export async function cleanupDuplicateIndex(env,now=Date.now()) {
  if (typeof env?.RESUME_DB?.prepare !== 'function' || env.RESUME_RETENTION_ENABLED!=='true' || env.RESUME_RETENTION_DRY_RUN!=='false') return;
  if (!duplicateIndexReady(env)) return;
  await table(env); await rateTable(env);
  await env.RESUME_DB.prepare('DELETE FROM gex_duplicate_index WHERE rowid IN (SELECT rowid FROM gex_duplicate_index WHERE created_at < ? LIMIT 500)').bind(cutoff(now)).run();
  await env.RESUME_DB.prepare('DELETE FROM gex_duplicate_rate WHERE expires_at < ?').bind(now).run();
}
