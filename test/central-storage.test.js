'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {validateState,reconcileReferences,storeAttachments,restoreAttachments}=require('../central-storage');

const makeCase=(id,extra={})=>({id,step:0,snags:[],bids:[],history:[],...extra});
test('creates distinct server references and keeps existing assigned references',()=>{
  const current={cases:[makeCase('SG-1',{quotationReference:'JAFZADPWDEOL-Q1126-1200'})],sequence:1200};
  const desired={cases:[makeCase('SG-1'),makeCase('SG-2'),makeCase('SG-3')],catalog:null};
  const result=reconcileReferences(desired,current);
  assert.deepEqual(result.cases.map(c=>c.quotationReference),[1200,1201,1202].map(n=>'JAFZADPWDEOL-Q1126-'+n));
});
test('conflicting CAFM records and manually assigned quotations are rejected',()=>{
  const current={cases:[],sequence:1199};
  const cases=[makeCase('SG-1',{inspection:'CAFM-1'}),makeCase('SG-2',{reinstatement:'cafm-1'})];
  assert.throws(()=>reconcileReferences({cases},current),/already linked/);
  for(const item of cases){
    delete item.inspection;delete item.reinstatement;
    item.quotationDetails={client:{reference:'DUPLICATE'}};
  }
  assert.throws(()=>reconcileReferences({cases},current),/Conflicting quotation reference/);
});
test('deduplicates identical binary material and rehydrates reports',()=>{
  const data='data:image/png;base64,YWJj';
  const files=new Map(), packed=storeAttachments({before:data,after:data},files);
  assert.equal(files.size,1);
  assert.equal(packed.before.$snaggingAttachment,packed.after.$snaggingAttachment);
  const hydrated=restoreAttachments(packed,new Map([...files].map(([key,entry])=>[key,'data:'+entry.mime+';base64,'+entry.bytes.toString('base64')])));
  assert.deepEqual(hydrated,{before:data,after:data});
  assert.throws(()=>storeAttachments({$snaggingAttachment:'untrusted'},files),/Invalid attachment reference/);
});
test('does not accept duplicate BOQ references or malformed records',()=>{
  const item={ref:'New BOQ - 1',description:'Repair lock',rate:70,budget:45,unit:'No.'};
  assert.doesNotThrow(()=>validateState({cases:[makeCase('SG-1')],catalog:[item]}));
  assert.throws(()=>validateState({cases:[],catalog:[item,item]}),/repeated BOQ/);
});
