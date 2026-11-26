'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {randomBytes}=require('node:crypto');
const {CentralStorage}=require('../central-storage');

test('PostgreSQL migration avoids duplicates and survives a new connection pool',{skip:!process.env.TEST_DATABASE_URL},async ()=>{
  const {Pool}=require('pg');
  const config={connectionString:process.env.TEST_DATABASE_URL};
  const controller=new Pool(config);
  const schema='snagging_test_'+randomBytes(8).toString('hex');
  const makePool=()=>new Pool({...config,options:'-c search_path='+schema});
  let working;
  let schemaCreated=false;
  try{
    await controller.query('CREATE SCHEMA '+schema);
    schemaCreated=true;
    working=makePool();
    let storage=new CentralStorage(working);
    await storage.initialize();
    const first=await storage.get();
    assert.equal(first.revision,0);
    const attachment='data:image/png;base64,YWJj';
    const local={cases:[{id:'SG-1',step:0,snags:[{before:attachment}],bids:[],history:[]}],
      catalog:[{ref:'Existing BOQ - 7',description:'Replace lock',unit:'No.',budget:10,rate:20}]};
    const imported=await storage.write(0,local,'test-admin','migration');
    assert.equal(imported.state.cases[0].quotationReference,'JAFZADPWDEOL-Q1126-1200');
    assert.equal(imported.revision,1);
    const repeated=await storage.write(1,local,'test-admin','migration');
    assert.equal(repeated.revision,1);
    await assert.rejects(storage.write(0,local,'other-device','save'),error=>error.status===409);
    await assert.rejects(storage.write(1,{cases:[],catalog:null},'other-device','save'),error=>error.status===409);
    await working.end();
    working=makePool();
    storage=new CentralStorage(working);
    const fresh=await storage.get();
    assert.equal(fresh.state.cases[0].snags[0].before,attachment);
    assert.equal(fresh.state.catalog[0].rate,20);
    assert.equal((await working.query('SELECT actor FROM snagging_audit')).rows[0].actor,'test-admin');
  }finally{
    if(working)await working.end();
    if(schemaCreated)await controller.query('DROP SCHEMA '+schema+' CASCADE');
    await controller.end();
  }
});
