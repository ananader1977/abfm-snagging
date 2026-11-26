'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {assignedRecords,supplierStage}=require('../central-accounts');
const {applySupplierAction,supplierNoticeTarget}=require('../supplier-workflow');
const rahati={role:'rahati',supplier:'Rahati Bayti'};
const client={role:'client'};
const example=()=>({id:'SG-1',step:3,rfq:{instructions:'Visit site'},bids:[],history:[],
  snags:[{ref:'ABFM-1',qty:2,budget:75,rate:121,profit:76}]});
test('only assigned supplier can submit once and receives no selling rates',()=>{
  const c=example();
  assert.equal(supplierNoticeTarget(c),200);
  const [view]=assignedRecords({cases:[c]},rahati);
  assert.equal(view.items[0].vendorBudget,75);
  assert.equal(view.items[0].rate,undefined);
  assert.equal(view.items[0].profit,undefined);
  assert.throws(()=>applySupplierAction(c,client,{action:'quote',rates:[70],reference:'RB-1'}),e=>e.status===403);
  applySupplierAction(c,rahati,{action:'quote',rates:[70],reference:'RB-1'});
  assert.equal(c.bids[0].total,140);
  assert.equal(c.snags[0].rate,121);
  assert.equal(supplierStage(rahati,c),null);
  assert.throws(()=>applySupplierAction(c,rahati,{action:'quote',rates:[70],reference:'RB-1'}),e=>e.status===403);
});
test('reinspection draft and signatures require award; after sign-off access ends',()=>{
  const c=example();
  c.award='Rahati Bayti';c.step=9;
  const data={reference:'WCR-1',signer:'Supplier inspector',remarks:'Done',
    lines:[{after:'data:image/png;base64,YWJj',work:'Repaired'}]};
  applySupplierAction(c,rahati,{action:'wcr-draft',...data});
  assert.equal(c.step,9);
  assert.equal(c.wcrDraft.lines[0].work,'Repaired');
  applySupplierAction(c,rahati,{action:'wcr-submit',...data,lines:[{work:'Repaired',after:null}]});
  assert.equal(c.step,10);
  assert.equal(c.supplierWcr.signature.name,'Supplier inspector');
  assert.equal(supplierStage(rahati,c),'engineer-review');
  c.step=11;
  assert.equal(supplierStage(rahati,c),null);
  assert.throws(()=>applySupplierAction(c,rahati,{action:'wcr-submit',...data}),e=>e.status===403);
});
