'use strict';

let supplierState={revision:null,records:[]};
let openCase,supplierFormEdited=false;
document.addEventListener('input',event=>{if(event.target.closest('form'))supplierFormEdited=true;});
const showError=message=>{
  const target=$('supplierError');
  if(target)target.textContent=message;
};

async function loadAssigned(message=''){
  const response=await fetch('/api/assigned',{cache:'no-store'});
  const result=await response.json();
  if(!response.ok)throw Error(result.error);
  supplierState=result;
  supplierFormEdited=false;
  if(!result.records.some(record=>record.id===openCase))openCase=result.records[0]?.id;
  renderAssigned(message);
}
async function supplierWrite(record,action,data){
  const response=await fetch('/api/supplier-action',{method:'PUT',headers:{'Content-Type':'application/json'},
    body:JSON.stringify({...data,caseId:record.id,revision:supplierState.revision,action})});
  const result=await response.json();
  if(!response.ok)throw Error(result.error||'The server did not confirm the save.');
}
function wireSubmit(form,handler){
  form.onsubmit=async event=>{
    event.preventDefault();
    const control=event.submitter||form.querySelector('button[type="submit"]');
    control.disabled=true;
    try{await handler(new FormData(form));}
    catch(error){showError(error.message);}
    finally{control.disabled=false;}
  };
}
function quotationForm(record,c){
  const inputs=record.items.map((line,i)=>field('rate'+i,e(line.ref)+' · '+e(line.description)+' · Target budget '+money(line.vendorBudget)+' · Qty '+line.qty,'number',
    'min="0" max="100000000" step=".01" value="'+(Number.isFinite(line.vendorBudget)?line.vendorBudget:'')+'"')).join('');
  return '<p>'+e(record.instructions||'')+'</p><form id="supplierQuote">'+field('reference','Quotation reference')+inputs+
    '<p id="supplierTarget" role="status"></p><label>Quotation format<select name="template"><option value="detailed">Detailed RFQ and rectification</option><option value="standard">Standard service quotation</option></select></label>'+
    '<button id="supplierPreview" type="button">Preview quotation</button><button type="submit">Submit quotation</button></form>';
}
function previewSupplierQuotation(c,reference,rates,template,onReference){
  const dialog=document.createElement('dialog');
  dialog.className='rahati-quotation-dialog';
  dialog.setAttribute('aria-labelledby','rahati-quote-title');
  const display=()=>rahatiQuotationDocument(c,reference,rates,template);
  const specs=rahatiFieldSpecs.filter(([key])=>template==='detailed'||!['requester','location','task','response','instructions'].includes(key));
  dialog.innerHTML=display()+quotationEditor(specs,rahatiQuotationFields(c,reference,template))+
    '<button class="edit-quotation secondary" type="button">Edit quotation details</button><span class="quote-save-status" role="status"></span> '+
    '<button class="print" type="button">Print / Save PDF</button> <button class="excel secondary" type="button">Download Excel</button> '+
    '<button class="vendor-summary secondary" type="button">Download Excel summary</button> <button class="dismiss secondary" type="button">Close</button>';
  document.body.append(dialog);
  dialog.querySelector('.print').onclick=()=>window.print();
  dialog.querySelector('.excel').onclick=()=>downloadQuotationExcel(dialog,reference+'-Rahati-'+template);
  dialog.querySelector('.vendor-summary').onclick=()=>downloadExcelFile(rahatiExcelSummary(c,reference,rates,template),reference+'-Rahati-Summary');
  wireQuotationEditor(dialog,display,updates=>{
    c.rahatiQuotationDetails={...c.rahatiQuotationDetails,[template]:updates};
    reference=updates.reference;
    onReference(reference);
    return 'Details applied to this quotation.';
  });
  dialog.querySelector('.dismiss').onclick=()=>dialog.close();
  dialog.addEventListener('close',()=>dialog.remove(),{once:true});
  dialog.showModal();
}
function viewSubmittedQuotation(c,quotation){
  const template=quotation.template==='standard'?'standard':'detailed';
  c.rahatiQuotationDetails=quotation.details||{};
  const dialog=document.createElement('dialog');
  dialog.className='quotation-dialog';
  dialog.innerHTML=rahatiQuotationDocument(c,quotation.reference,quotation.rates,template)+
    '<button class="print" type="button">Print / Save PDF</button> <button class="excel secondary" type="button">Download Excel</button> <button class="dismiss secondary" type="button">Close</button>';
  document.body.append(dialog);
  dialog.querySelector('.print').onclick=()=>window.print();
  dialog.querySelector('.excel').onclick=()=>downloadQuotationExcel(dialog,quotation.reference+'-Rahati-'+template);
  dialog.querySelector('.dismiss').onclick=()=>dialog.close();
  dialog.addEventListener('close',()=>dialog.remove(),{once:true});
  dialog.showModal();
}
function viewSubmittedWcr(c,record){
  const signed=record.supplierReport;
  if(!signed)return;
  const dialog=document.createElement('dialog');
  dialog.className='inspection-dialog';
  dialog.innerHTML='<div class="inspection-document"><h2>Rahati Bayti Work Completion Report</h2>'+
    '<p>WCR reference: '+e(signed.reference)+' · Case: '+e(record.id)+' · Site: '+e(record.site)+'</p>'+
    '<p class="inspection-comment"><strong>Report remarks:</strong> '+e(signed.remarks||'–')+'</p>'+
    rows(['BOQ Ref.','Work details','Before photo','After photo','Supplier remarks'],record.items.map((line,i)=>[
      e(line.ref),e(line.description),photo(line.before,'Before'),photo(line.after,'After'),e(signed.lines?.[i]?.work||'')
    ]))+reinspectionSignatures(c,signed,record.verification)+'</div>'+
    '<button class="print" type="button">Print / Save PDF</button> <button class="dismiss secondary" type="button">Close</button>';
  document.body.append(dialog);
  dialog.querySelector('.print').onclick=()=>window.print();
  dialog.querySelector('.dismiss').onclick=()=>dialog.close();
  dialog.addEventListener('close',()=>dialog.remove(),{once:true});
  dialog.showModal();
}
function latestSupplierDraft(record,c){
  const draft=record.reportDraft||record.supplierReport;
  return {reference:draft?.reference||record.wcrReference||'',remarks:draft?.remarks||'',
    lines:record.items.map((line,i)=>({work:draft?.lines?.[i]?.work||'',after:draft?.lines?.[i]?.after||line.after||''})),
    signature:{name:draft?.signature?.name||'',image:draft?.signature?.image||''}};
}
function reinspectionForm(record,c){
  const draft=latestSupplierDraft(record,c);
  return '<form id="supplierWcr">'+field('reference','Supplier WCR reference','text','value="'+e(draft.reference)+'"')+
    '<label>Report remarks<textarea name="remarks">'+e(draft.remarks)+'</textarea></label>'+
    '<label>Supplier signature (type full name)<input name="signer" value="'+e(draft.signature.name)+'"></label>'+
    '<label>Upload handwritten signature (optional)<input type="file" name="signatureImage" accept="image/jpeg,image/png,image/webp"></label>'+
    record.items.map((line,i)=>line.result==='Pass'?'':'<fieldset><legend>'+e(line.ref)+' · '+e(line.description)+'</legend>'+
      '<label>After photo<input type="file" name="after'+i+'" accept="image/jpeg,image/png,image/webp"></label>'+
      (draft.lines[i].after?'<p>After photo is saved.</p>':'')+
      '<label>Work completed / remarks<textarea name="work'+i+'">'+e(draft.lines[i].work)+'</textarea></label></fieldset>').join('')+
    '<button type="button" id="supplierWcrPreview">Save and preview reinspection report</button><button type="submit">Submit for reinspection</button></form>';
}
function renderAssigned(message){
  const list=$('supplierCases');
  const stageNames=['Received','Inspection Assigned','Snags Confirmed','RFQ Issued','Quote Received','CS Approval','Client Submission','Client Approval','Authorized','In Progress','Reinspection','Closed'];
  list.replaceChildren();
  for(const record of supplierState.records){
    const button=document.createElement('button');
    button.type='button';button.className='secondary';
    button.textContent=record.id+' · '+record.site+' · '+(stageNames[record.step]||'Case');
    button.onclick=()=>{openCase=record.id;renderAssigned('');};
    list.append(button);
  }
  const record=supplierState.records.find(row=>row.id===openCase);
  const detail=$('supplierDetail');
  const banner='<p role="status">'+e(message)+'</p><p id="supplierError" class="error" role="alert"></p>';
  if(!record){detail.innerHTML='<article><h1>No supplier cases available</h1>'+banner+'</article>';return;}
  const c={id:record.id,site:record.site,client:record.client,contact:record.contact,building:record.building,
    inspection:record.inspection,reinstatement:record.reinstatement,request:record.request,quotationReference:record.quotationReference,
    order:record.order,started:record.started,submitted:record.submitted,award:'Rahati Bayti',snags:record.items,rfq:{instructions:record.instructions}};
  const stageTitle=stageNames[record.step]||'Case';
  const quotationCards=(record.quotations||[]).map((quotation,index)=>
    '<section class="supplier-submitted-quote"><h2>Rahati quotation · '+e(quotation.reference)+(index===record.quotations.length-1&&record.quotations.length>1?' · Latest submission':'')+'</h2>'+
    '<p>Subtotal before VAT: '+money(quotation.total)+'</p><button type="button" class="view-supplier-quote" data-quote="'+index+'">View / print quotation PDF</button></section>').join('');
  const signedWcr=record.supplierReport?'<section><h2>Submitted signed WCR</h2><p>'+e(record.supplierReport.reference)+'</p>'+
    '<button type="button" id="viewSupplierSignedWcr">View / print signed WCR</button></section>':'';
  detail.innerHTML='<article><h1>'+e(record.site)+'</h1><p>'+e(record.id)+' · Current stage: <strong>'+e(stageTitle)+'</strong></p>'+banner+
    (record.quotations?.length?quotationCards:'')+signedWcr+
    rows(['BOQ Ref.','Scope','Unit','Qty','Before photo'],record.items.map(line=>[
      e(line.ref),e(line.description),e(line.unit),line.qty,photo(line.before,'Before')
    ]))+(record.stage==='quotation'?quotationForm(record,c):record.stage==='reinspection'?reinspectionForm(record,c):
      record.stage==='quotation-submitted'?'<p>Your quotation has been received by ABFM. It remains available above.</p>':
      record.stage==='award-status'?'<p>Your quotation and case status are available above while ABFM processes approval and authorization.</p>':
      record.stage==='completed'?'<p>Work is signed off. Your quotation and submitted signed WCR remain available above.</p>':
      '<p>Your report was submitted and is awaiting ABFM Engineer verification.</p>')+'</article>';
  detail.querySelectorAll('.view-supplier-quote').forEach(button=>button.onclick=()=>{
    const quote=record.quotations[Number(button.dataset.quote)];
    if(quote)viewSubmittedQuotation(c,quote);
  });
  const viewWcr=$('viewSupplierSignedWcr');
  if(viewWcr)viewWcr.onclick=()=>viewSubmittedWcr(c,record);
  const quote=$('supplierQuote');
  if(quote){
    const rates=()=>record.items.map((_,i)=>readRate(quote.elements['rate'+i].value));
    const update=()=>{
      const target=$('supplierTarget'), current=rates();
      if(!Number.isFinite(record.targetBudget)){target.textContent='Overall target budget is unavailable.';return;}
      const base='Overall target budget: '+money(record.targetBudget)+' before VAT.';
      if(current.some(rate=>rate===null)){target.textContent=base+' Enter all rates to check your quotation.';return;}
      const subtotal=rahatiQuoteTotals(c,current).subtotalCents/100;
      const over=subtotal>record.targetBudget;
      target.classList.toggle('error',over);
      target.textContent=base+' Your subtotal: '+money(subtotal)+'. '+(over?'Review your rates before submitting.':'Your quotation is within the target.');
    };
    quote.addEventListener('input',update);
    update();
    $('supplierPreview').onclick=()=>{
      if(!quote.reportValidity())return;
      const current=rates();
      if(current.some(rate=>rate===null))return showError('Enter all quoted rates first.');
      previewSupplierQuotation(c,quote.elements.reference.value.trim(),current,quote.elements.template.value,value=>{quote.elements.reference.value=value;});
    };
    wireSubmit(quote,async fields=>{
      await supplierWrite(record,'quote',{reference:fields.get('reference'),rates:rates(),template:fields.get('template'),details:c.rahatiQuotationDetails});
      await loadAssigned('Your quotation was submitted to ABFM.');
    });
  }
  const wcr=$('supplierWcr');
  if(wcr){
    const draft=latestSupplierDraft(record,c);
    const collect=async fields=>({
      reference:fields.get('reference'),remarks:fields.get('remarks'),signer:fields.get('signer'),
      signatureImage:fields.get('signatureImage')?.size?await readPhoto(fields.get('signatureImage')):null,
      lines:await Promise.all(record.items.map(async (_,i)=>{
        const file=fields.get('after'+i);
        return {work:fields.get('work'+i)??draft.lines[i].work,after:file?.size?await readPhoto(file):null};
      }))
    });
    $('supplierWcrPreview').onclick=async ()=>{
      if(!wcr.reportValidity())return;
      const control=$('supplierWcrPreview'),submit=wcr.querySelector('button[type="submit"]');
      control.disabled=submit.disabled=true;
      try{
        const data=await collect(new FormData(wcr));
        await supplierWrite(record,'wcr-draft',data);
        await loadAssigned('Draft saved to the server.');
        const refreshed=supplierState.records.find(item=>item.id===record.id);
        if(refreshed)previewSupplierWcr(c,latestSupplierDraft(refreshed,c));
      }catch(error){showError(error.message);}
      finally{control.disabled=submit.disabled=false;}
    };
    wireSubmit(wcr,async fields=>{
      await supplierWrite(record,'wcr-submit',await collect(fields));
      await loadAssigned('Report submitted for ABFM Engineer reinspection.');
    });
  }
}
$('supplierRefresh').onclick=()=>loadAssigned().catch(error=>showError(error.message));
loadAssigned().catch(error=>{
  $('supplierDetail').innerHTML='<article><p id="supplierError" class="error" role="alert"></p></article>';
  showError(error.message);
});
setInterval(()=>{if(!document.hidden&&!supplierFormEdited&&!document.querySelector('dialog[open]'))loadAssigned().catch(error=>showError(error.message));},15000);
