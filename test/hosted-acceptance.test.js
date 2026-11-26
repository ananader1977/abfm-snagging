'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {spawn}=require('node:child_process');
const {once}=require('node:events');
const {randomBytes}=require('node:crypto');

test('isolated hosted PostgreSQL round-trip, account permissions, and restart',{skip:!process.env.TEST_DATABASE_URL,timeout:90000},async ()=>{
  const {Pool}=require('pg');
  const database=new Pool({connectionString:process.env.TEST_DATABASE_URL});
  const schema='snagging_test_'+randomBytes(8).toString('hex');
  const adminPassword=randomBytes(24).toString('hex');
  const vendorPassword=randomBytes(24).toString('hex');
  let processRef,base;
  async function start(){
    processRef=spawn(process.execPath,['server.js'],{env:{...process.env,PORT:'0',HOST:'127.0.0.1',
      DATABASE_URL:process.env.TEST_DATABASE_URL,SNAGGING_STAGE:'true',SNAGGING_TEST_SCHEMA:schema,
      SNAGGING_USERNAME:'test-admin',SNAGGING_PASSWORD:adminPassword},stdio:['ignore','pipe','pipe']});
    const watchdog=setTimeout(()=>processRef.kill(),25000);
    try{
      const port=await new Promise((resolve,reject)=>{
        let log='';
        processRef.stdout.on('data',data=>{
          log+=data;
          const result=log.match(/listening on port (\d+)/);
          if(result)resolve(result[1]);
        });
        processRef.once('exit',()=>reject(Error('Isolated HTTP test server did not start.')));
        processRef.once('error',reject);
      });
      base='http://127.0.0.1:'+port;
    }finally{clearTimeout(watchdog);}
  }
  async function stop(){
    if(processRef&&processRef.exitCode===null&&processRef.signalCode===null){const exited=once(processRef,'exit');processRef.kill();await exited;}
  }
  const request=(path,cookie,body)=>fetch(base+path,{redirect:'manual',headers:{
    ...(cookie?{Cookie:cookie}:{}),...(body?{'Content-Type':'application/json'}:{})
  },...(body?{method:'PUT',body:JSON.stringify(body)}:{})});
  async function login(username,password,status=303){
    const result=await fetch(base+'/login',{method:'POST',redirect:'manual',body:new URLSearchParams({username,password})});
    assert.equal(result.status,status);
    return result.headers.get('set-cookie')?.split(';')[0];
  }
  try{
    await start();
    const desktop=await login('test-admin',adminPassword);
    const mobile=await login('test-admin',adminPassword);
    assert.notEqual(desktop,mobile);
    const empty=await (await request('/api/state',desktop)).json();
    const record={id:'SG-TEST',client:'Synthetic test',site:'Synthetic site',step:3,
      rfq:{instructions:'Synthetic request'},snags:[{ref:'New BOQ - 1',rate:200,budget:100,qty:2}],bids:[],history:[]};
    const boq=[{ref:'New BOQ - 1',description:'Synthetic BOQ',unit:'No.',rate:200,budget:100}];
    const created=await request('/api/migration',desktop,{revision:empty.revision,state:{cases:[record],catalog:boq}});
    assert.equal(created.status,200);
    const fromMobile=await (await request('/api/state',mobile)).json();
    assert.equal(fromMobile.state.cases[0].quotationReference,'JAFZADPWDEOL-Q1126-1200');
    assert.deepEqual(fromMobile.state.catalog,boq);
    const duplicate=await request('/api/migration',mobile,{revision:fromMobile.revision,state:{cases:[record],catalog:boq}});
    assert.equal(duplicate.status,200);
    assert.equal((await duplicate.json()).revision,fromMobile.revision);
    assert.equal((await request('/api/rahati-account',desktop,{password:vendorPassword})).status,200);
    const rahati=await login('rahati-bayti',vendorPassword);
    assert.equal((await request('/api/state',rahati)).status,403);
    assert.equal((await request('/api/export',rahati)).status,403);
    const assigned=await (await request('/api/assigned',rahati)).json();
    assert.equal(assigned.records[0].items[0].vendorBudget,100);
    assert.equal(assigned.records[0].items[0].rate,undefined);
    assert.equal((await request('/api/supplier-action',rahati,{revision:assigned.revision,caseId:record.id,action:'quote',reference:'RB-TEST',rates:[85]})).status,200);
    const updated=await (await request('/api/state',desktop)).json();
    assert.equal(updated.state.cases[0].bids[0].total,170);
    assert.equal((await (await request('/api/assigned',rahati)).json()).records.length,0);
    assert.equal((await request('/api/state',mobile,{revision:fromMobile.revision,state:fromMobile.state})).status,409);
    await stop();
    await start();
    assert.equal((await request('/api/state',desktop)).status,401);
    const fresh=await login('test-admin',adminPassword);
    const afterRestart=await (await request('/api/state',fresh)).json();
    assert.equal(afterRestart.state.cases[0].bids[0].total,170);
    assert.deepEqual(afterRestart.state.catalog,boq);
    const {rows:[audit]}=await database.query('SELECT actor FROM '+schema+'.snagging_audit ORDER BY revision DESC LIMIT 1');
    assert.equal(audit.actor,'rahati-bayti');
  }finally{
    await stop();
    await database.query('DROP SCHEMA IF EXISTS '+schema+' CASCADE');
    await database.end();
  }
});
