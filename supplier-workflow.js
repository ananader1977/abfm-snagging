'use strict';
const {StorageError}=require('./central-storage');
const {supplierStage}=require('./central-accounts');

const inputText=(value,length=1000)=>typeof value==='string'?value.trim().slice(0,length):'';
const cents=value=>Math.round(value*100);
function supplierNoticeTarget(caseRecord) {
  const lines=caseRecord.snags.filter(line=>line.source!=='Non-BOQ'&&!String(line.ref||'').startsWith('NBOQ-'));
  const centsTotal=lines.reduce((sum,line)=>sum+cents(line.rate*line.qty),0);
  if(!lines.length||!lines.every(line=>Number.isFinite(line.rate)&&Number.isFinite(line.qty))||
    !Number.isSafeInteger(centsTotal)||centsTotal<=0)return null;
  return Math.round(centsTotal*0.79)/100;
}
function applySupplierAction(c,user,body,now=new Date()) {
  const stage=supplierStage(user,c);
  const append=event=>c.history.unshift({event,time:now.toISOString()});
  if(body.action==='quote'&&stage==='quotation'){
    const reference=inputText(body.reference,120), rates=body.rates;
    if(!reference||!Array.isArray(rates)||rates.length!==c.snags.length||!rates.length||rates.some(rate=>!Number.isFinite(rate)||rate<0||rate>1e8||cents(rate)/100!==rate)){
      throw new StorageError(400,'Enter a quotation reference and a valid rate for every quotation line.');
    }
    const total=c.snags.reduce((sum,line,index)=>sum+cents(rates[index]*line.qty),0)/100;
    const keys=['date','recipient','address','phone','subject','requester','location','task','response','instructions','notes','payment','remarks'];
    const details=Object.fromEntries(['detailed','standard'].filter(format=>body.details?.[format]).map(format=>[
      format,Object.fromEntries(keys.filter(key=>typeof body.details[format][key]==='string').map(key=>[key,inputText(body.details[format][key],2000)]))
    ]));
    const template=body.template==='standard'?'standard':'detailed';
    c.bids.push({supplier:user.supplier,reference,rates,total,details,template});
    c.step=4;
    const resubmission=Boolean(c.quoteResubmissionRequested);
    delete c.quoteResubmissionRequested;
    append((resubmission?'Resubmitted quotation ':'Quotation ')+reference+' from '+user.supplier);
    return;
  }
  if((body.action==='wcr-draft'||body.action==='wcr-submit')&&stage==='reinspection'){
    const previous=c.wcrDraft||c.supplierWcr;
    if(!Array.isArray(body.lines)||body.lines.length!==c.snags.length)throw new StorageError(400,'The report does not match the work lines.');
    const reference=inputText(body.reference,120);
    if(body.signatureImage!=null&&!(typeof body.signatureImage==='string'&&/^data:image\/(?:jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/.test(body.signatureImage))){
      throw new StorageError(400,'Choose a supported signature image.');
    }
    const signature={name:inputText(body.signer,160),image:body.signatureImage||previous?.signature?.image||''};
    const submitting=body.action==='wcr-submit';
    if(!reference||(submitting&&!signature.name))throw new StorageError(400,'Enter the WCR reference and sign before submitting.');
    const lines=c.snags.map((item,i)=>{
      const saved=previous?.lines?.[i];
      if(item.result==='Pass')return {work:saved?.work||'',after:item.after||''};
      const proposed=body.lines[i]?.after;
      if(proposed!=null&&!(typeof proposed==='string'&&/^data:image\/(?:jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/.test(proposed))){
        throw new StorageError(400,'Choose a supported after photo.');
      }
      const after=proposed||saved?.after||item.after||'';
      if(submitting&&!after)throw new StorageError(400,'Add an after photo for '+item.ref+'.');
      return {after,work:inputText(body.lines[i]?.work,2000)};
    });
    const remarks=inputText(body.remarks,2000);
    if(!submitting){
      c.wcrDraft={reference,remarks,signature,lines:lines.map((line,i)=>({...line,after:line.after===c.snags[i].after?'':line.after}))};
      append('Supplier saved reinspection draft '+reference);
      return;
    }
    for(const [i,line] of c.snags.entries())if(line.result!=='Pass')line.after=lines[i].after;
    c.supplierWcr={reference,remarks,signature,lines:lines.map(line=>({work:line.work}))};
    delete c.wcrDraft;
    delete c.reinspectionVerification;
    c.wcr=reference;
    c.submitted=new Intl.DateTimeFormat('en-GB',{timeZone:'Asia/Dubai'}).format(now);
    c.step=10;
    append('Supplier WCR '+reference+' submitted for reinspection');
    return;
  }
  throw new StorageError(403,'This case is no longer open for this supplier action.');
}
module.exports={applySupplierAction,supplierNoticeTarget};
