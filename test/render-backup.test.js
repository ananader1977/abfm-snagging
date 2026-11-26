'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {readRegionDate,cutoffDate,postgresEnvironment}=require('../ops/render-backup');
test('uses Dubai dates and retains at least 35 days',()=>{
  const date=readRegionDate(new Date('2026-11-26T22:00:00Z'));
  assert.equal(date,'2026-11-27');
  assert.equal(cutoffDate(date),'2026-10-23');
});
test('keeps credentials in the subprocess environment and decodes escaped values',()=>{
  const env=postgresEnvironment('postgresql://account:some%2Fkey@internal-host:5432/abfm?sslmode=require');
  assert.equal(env.PGPASSWORD,'some/key');
  assert.equal(env.PGHOST,'internal-host');
  assert.equal(env.PGDATABASE,'abfm');
  assert.equal(env.PGSSLMODE,'require');
});
