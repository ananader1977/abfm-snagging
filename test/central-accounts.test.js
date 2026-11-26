'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {assignedRecords,passwordDigest,verifyPassword,supplierStage}=require('../central-accounts');
const record={id:'SG-1',client:'DP World',site:'J18',step:7,award:'Rahati Bayti',secret:'ABFM confidential',
  snags:[{ref:'A',qty:2,rate:200,budget:90,profitMargin:0.5}],bids:[{supplier:'Rahati Bayti',reference:'RB-1',rates:[90],total:180},{supplier:'Guardian',total:160}],
  quotationDetails:{client:{reference:'DPW-1'}}};
test('Rahati sees only its quotation and no ABFM selling information',()=>{
  const [item]=assignedRecords({cases:[{...record,step:9}]},{role:'rahati',supplier:'Rahati Bayti'});
  assert.equal(item.quotations[0].total,180);
  assert.equal(Object.hasOwn(item.items[0],'rate'),false);
  assert.doesNotMatch(JSON.stringify(item),/200|Guardian|margin|confidential/i);
  assert.deepEqual(assignedRecords({cases:[{...record,step:9,award:'Guardian'}]},{role:'rahati',supplier:'Rahati Bayti'}),[]);
  assert.equal(supplierStage({role:'rahati',supplier:'Rahati Bayti'},record),null);
});
test('client sees issued selling quotation only at assigned properties',()=>{
 const user={role:'client',properties:[{client:'DP World',site:'J18'}]};
 const [item]=assignedRecords({cases:[record,{...record,id:'SG-2',site:'J19'}]},user);
 assert.equal(item.quotation.lines[0].sellingRate,200);
 assert.equal(JSON.stringify(item).includes('180'),false);
 assert.equal(assignedRecords({cases:[{...record,step:6}]},user)[0].quotation,undefined);
 assert.equal(assignedRecords({cases:[record]},user).length,1);
});
test('validates salted account passwords',async ()=>{
 const digest=await passwordDigest('unique test password');
 assert.equal(await verifyPassword('unique test password',digest),true);
 assert.equal(await verifyPassword('incorrect',digest),false);
});
