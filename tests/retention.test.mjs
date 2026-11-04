import test from 'node:test';
import assert from 'node:assert/strict';
import worker from '../worker/src/index.js';
import { cleanupExpiredResumes, cutoffUtc, RETENTION_CRON } from '../worker/src/retention.js';

const makeDatabase = (results = []) => {
  const calls = [];
  const db = {
    prepare(sql) {
      const call = {sql};
      calls.push(call);
      return {
        bind(...args) {
          call.args=args;
          return {
            async first() { return results.shift() ?? { total: 0 }; },
            async run() { return results.shift() ?? {success:true,meta:{changes:0}}; }
          };
        }
      };
    }
  };
  return {db,calls};
};

test('calendar-month cutoff handles leap years and shorter months', () => {
  assert.equal(cutoffUtc('2026-11-04T06:00:00Z',12),'2025-11-04 06:00:00');
  assert.equal(cutoffUtc('2026-03-31T06:00:00Z',1),'2026-02-28 06:00:00');
  assert.equal(cutoffUtc('2025-03-31T06:00:00Z',13),'2024-02-29 06:00:00');
  assert.throws(()=>cutoffUtc('2026-11-04',0),/Prazo/);
  assert.throws(()=>cutoffUtc('invalid date',12),/Data/);
});

test('default configuration does not query or delete any curriculum', async () => {
  const {db,calls}=makeDatabase();
  const result=await cleanupExpiredResumes({RESUME_DB:db},{now:Date.parse('2026-11-04T06:00:00Z')});
  assert.deepEqual(result,{status:'disabled',deleted:0});
  assert.equal(calls.length,0);
});

test('12-month dry run counts expired rows without deleting anything', async () => {
  const {db,calls}=makeDatabase([{total:8}]);
  const result=await cleanupExpiredResumes({
    RESUME_DB:db,RESUME_RETENTION_ENABLED:'true',RESUME_RETENTION_MONTHS:'12'
  },{now:Date.parse('2026-11-04T06:00:00Z')});
  assert.deepEqual(result,{status:'dry_run',eligible:8,deleted:0});
  assert.match(calls[0].sql,/SELECT COUNT\(\*\)/);
  assert.ok(!calls.some(c=>c.sql.includes('DELETE')));
  assert.deepEqual(calls[0].args,['2025-11-04 06:00:00']);
});

test('explicitly approved deletion is bounded, date-filtered and parameterized', async () => {
  const {db,calls}=makeDatabase([
    {success:true,meta:{changes:100}},
    {success:true,meta:{changes:3}}
  ]);
  const result=await cleanupExpiredResumes({
    RESUME_DB:db,RESUME_RETENTION_ENABLED:'true',
    RESUME_RETENTION_DRY_RUN:'false',RESUME_RETENTION_MONTHS:'12'
  },{now:Date.parse('2026-11-04T06:00:00Z')});
  assert.deepEqual(result,{status:'completed',deleted:103});
  assert.equal(calls.length,2);
  assert.ok(calls.every(c=>c.sql.includes('DELETE FROM candidate_resumes')));
  assert.ok(calls.every(c=>c.sql.includes('created_at < ?')));
  assert.ok(calls.every(c=>c.sql.includes('LIMIT ?')));
  assert.deepEqual(calls[0].args,['2025-11-04 06:00:00',100]);
});

test('batch loop stops at 500 deletions per scheduled invocation', async()=>{
  const {db,calls}=makeDatabase(Array.from({length:8},()=>({success:true,meta:{changes:100}})));
  const result=await cleanupExpiredResumes({
    RESUME_DB:db,RESUME_RETENTION_ENABLED:'true',
    RESUME_RETENTION_DRY_RUN:'false'
  },{now:Date.parse('2026-11-04T06:00:00Z')});
  assert.deepEqual(result,{status:'completed',deleted:500});
  assert.equal(calls.length,5);
});

test('cron does not delete unless the known schedule and flags match',async()=>{
  const {db,calls}=makeDatabase([{total:2}]);
  const env={RESUME_DB:db,RESUME_RETENTION_ENABLED:'true'};
  const original=console.info;
  console.info=()=>{};
  try {
    await worker.scheduled({cron:'0 0 1 * *',scheduledTime:Date.parse('2026-11-04T06:00:00Z')},env);
    assert.equal(calls.length,0);
    await worker.scheduled({cron:RETENTION_CRON,scheduledTime:Date.parse('2026-11-04T06:00:00Z')},env);
    assert.equal(calls.length,1);
    assert.ok(!calls[0].sql.includes('DELETE'));
  } finally {console.info=original}
});

test('Cloudflare cleanup never calls Recrutei or another external service',async()=>{
  const {db,calls}=makeDatabase([{success:true,meta:{changes:1}}]);
  const originalFetch=globalThis.fetch;
  let externalCalls=0;
  globalThis.fetch=async()=>{externalCalls++;throw Error('External system must never be contacted');};
  try{
    const r=await cleanupExpiredResumes({
      RESUME_DB:db,
      RESUME_RETENTION_ENABLED:'true',
      RESUME_RETENTION_DRY_RUN:'false',
      RESUME_RETENTION_MONTHS:'12'
    },{now:Date.parse('2026-11-04T06:00:00Z')});
    assert.equal(r.deleted,1);
    assert.equal(externalCalls,0);
    assert.equal(calls.length,1);
    assert.ok(calls[0].sql.includes('candidate_resumes'));
  }finally{globalThis.fetch=originalFetch;}
});
