'use strict';
const {randomBytes,scrypt,timingSafeEqual}=require('node:crypto');
const {promisify}=require('node:util');
const derive=promisify(scrypt);
const propertiesOf=user=>Array.isArray(user.properties)?user.properties:[];
const allowedClientCase=(user,c)=>propertiesOf(user).some(scope=>scope.client===c.client&&scope.site===c.site);
function supplierStage(user,c){
  if(user.role!=='rahati'||user.supplier!=='Rahati Bayti'||c.noWork)return null;
  if((c.step===3||c.step===4)&&!c.award&&c.rfq&&!c.bids.some(bid=>bid.supplier===user.supplier))return 'quotation';
  if(c.award===user.supplier&&c.step===9)return 'reinspection';
  if(c.award===user.supplier&&c.step===10)return 'engineer-review';
  return null;
}
const activeSupplierCase=(user,c)=>Boolean(supplierStage(user,c));

async function passwordDigest(password,salt=randomBytes(16).toString('hex')){
  const hash=await derive(password,salt,64);
  return salt+':'+hash.toString('hex');
}
async function verifyPassword(password,stored){
  const [salt,digest]=String(stored||'').split(':');
  if(!/^[a-f0-9]{32}$/.test(salt||'')||!/^[a-f0-9]{128}$/.test(digest||''))return false;
  const candidate=Buffer.from((await passwordDigest(password,salt)).split(':')[1],'hex');
  return timingSafeEqual(Buffer.from(digest,'hex'),candidate);
}
function supplierCase(c,user){
  const submitting=c.award===user.supplier;
  return {
    id:c.id,site:c.site,step:c.step,stage:supplierStage(user,c),deadline:c.rfq?.deadline,instructions:c.rfq?.instructions,
    items:c.snags.map(item=>({
      ref:item.ref,description:item.description,location:item.location,unit:item.unit,qty:item.qty,
      vendorBudget:item.budget,before:item.before,
      ...(submitting?{after:item.after,result:item.result}:{})
    })),
    quotations:c.bids.filter(bid=>bid.supplier===user.supplier).map(bid=>({reference:bid.reference,rates:bid.rates,total:bid.total})),
    ...(submitting?{workOrder:c.order,wcrReference:c.wcr,reportDraft:c.wcrDraft?{reference:c.wcrDraft.reference,remarks:c.wcrDraft.remarks,signature:{name:c.wcrDraft.signature?.name,image:c.wcrDraft.signature?.image},lines:c.wcrDraft.lines?.map(line=>({work:line.work,after:line.after}))}:null,supplierReport:c.supplierWcr?{reference:c.supplierWcr.reference,remarks:c.supplierWcr.remarks,lines:c.supplierWcr.lines?.map(line=>({work:line.work}))}:null}:{}),
  };
}
function clientCase(c){
  const quotation=c.step>=7?c.quotationDetails?.client:null;
  return {
    id:c.id,client:c.client,site:c.site,step:c.step,
    ...(quotation?{quotation:{
      reference:quotation.reference,subject:quotation.subject,validity:quotation.validity,
      completion:quotation.completion,warranty:quotation.warranty,payment:quotation.payment,
      lines:c.snags.map(item=>({ref:item.ref,description:item.description,unit:item.unit,qty:item.qty,sellingRate:item.rate}))
    }}:{})
  };
}
function assignedRecords(state,user){
  if(user.role==='rahati')return state.cases.filter(c=>activeSupplierCase(user,c)).map(c=>supplierCase(c,user));
  if(user.role==='client')return state.cases.filter(c=>allowedClientCase(user,c)).map(clientCase);
  return [];
}
module.exports={assignedRecords,passwordDigest,verifyPassword,supplierStage};
