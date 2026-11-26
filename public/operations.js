'use strict';
const $=id=>document.getElementById(id);
const stages=['Received','Inspection Assigned','Snags Confirmed','RFQ Issued','Quote Received','CS Approval','Client Submission','Client Approval','Authorized','In Progress','Reinspection','Closed'];
let state=null,revision=null,selected=null;
const money=value=>new Intl.NumberFormat('en-AE',{style:'currency',currency:'AED'}).format(value);
const node=(tag,text,className='')=>{const item=document.createElement(tag);if(text!==undefined)item.textContent=text;if(className)item.className=className;return item;};
async function request(url,options={}){
  const response=await fetch(url,{cache:'no-store',...options});
  const body=await response.json().catch(()=>null);
  if(!response.ok)throw Error(body?.error||'The server did not confirm the request.');
  return body;
}
function render(){
  const list=$('cases');
  list.replaceChildren();
  if(!state)return;
  for(const record of state.cases){
    const button=node('button',record.site+' · '+record.id,'secondary');
    button.type='button';
    button.style.width='100%';
    button.style.margin='8px 0';
    button.setAttribute('aria-pressed',String(record.id===selected));
    button.addEventListener('click',()=>{selected=record.id;render();});
    list.append(button);
  }
  const record=state.cases.find(item=>item.id===selected);
  const detail=$('detail');
  detail.replaceChildren();
  if(!record){
    detail.append(node('article','Select a case to review its quotation.'));
    return;
  }
  const article=node('article');
  article.append(node('h1',record.site||'Snagging case'));
  article.append(node('p',record.id+' · '+(record.client||'')+' · '+(stages[record.step]||'Unknown stage'),'meta'));
  article.append(node('p','Operations can edit the selected Rahati quotation only while the case is at CS Approval. Before then, quotations are read-only.'));
  if(!record.bids?.length){
    article.append(node('p','No supplier quotation has been recorded.'));
    detail.append(article);
    return;
  }
  const awarded=record.bids[record.awardedBid];
  record.bids.forEach((bid,index)=>{
    const section=node('section');
    section.append(node('h2',bid.supplier+' · '+bid.reference+(record.awardedBid===index?' · Selected for approval':'')));
    section.append(node('p','Submitted total: '+money(bid.total||0),'meta'));
    const editable=record.step===5&&record.award==='Rahati Bayti'&&bid.supplier==='Rahati Bayti'&&record.awardedBid===index;
    const table=node('table');
    const head=node('thead'),headRow=node('tr');
    ['BOQ Ref.','Work scope','Qty','Rahati rate (AED)'].forEach(label=>headRow.append(node('th',label)));
    head.append(headRow);table.append(head);
    const body=node('tbody'),inputs=[];
    (record.snags||[]).forEach((line,lineIndex)=>{
      const row=node('tr');
      row.append(node('td',line.ref||''));
      row.append(node('td',line.description||''));
      row.append(node('td',String(line.qty??'' )+' '+(line.unit||'')));
      const rateCell=node('td');
      if(editable){
        const input=node('input');
        input.type='number';input.min='0';input.step='.01';input.max='100000000';input.required=true;
        input.value=Number.isFinite(bid.rates?.[lineIndex])?String(bid.rates[lineIndex]):'';
        input.setAttribute('aria-label','Rahati rate for '+(line.ref||('line '+(lineIndex+1))));
        inputs.push(input);rateCell.append(input);
      }else rateCell.textContent=money(bid.rates?.[lineIndex]||0);
      row.append(rateCell);body.append(row);
    });
    table.append(body);section.append(table);
    if(editable){
      const total=node('p','Updated quotation total will be recalculated on save.','meta');
      const save=node('button','Save approved quotation edit');
      save.type='button';
      const status=node('p','','meta');status.setAttribute('role','status');
      save.addEventListener('click',async()=>{
        if(inputs.some(input=>!input.reportValidity()))return;
        const rates=inputs.map(input=>Number(input.value));
        if(rates.some(rate=>!Number.isFinite(rate)||Math.round(rate*100)/100!==rate)){
          status.textContent='Enter valid rates to two decimal places.';return;
        }
        save.disabled=true;status.textContent='Saving to the live database…';
        try{
          const result=await request('/api/operations-action',{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({revision,caseId:record.id,bidIndex:index,rates})});
          state=result.state;revision=result.revision;
          $('syncStatus').textContent='Connected. Changes are saved to the live database.';
          render();
        }catch(error){status.textContent=error.message;}
        finally{save.disabled=false;}
      });
      section.append(total,save,status);
    }else if(record.step<5&&bid.supplier==='Rahati Bayti'&&record.awardedBid===index){
      section.append(node('p','Read-only: ABFM must send this selected quote to CS approval before Operations can edit it.','meta'));
    }
    article.append(section);
  });
  if(record.step===5&&awarded?.supplier!=='Rahati Bayti')article.append(node('p','This approval is not for a Rahati Bayti quotation, so no Rahati quote can be edited.'));
  detail.append(article);
}
async function load(){
  const status=$('syncStatus');
  $('refresh').disabled=true;
  try{
    const result=await request('/api/state');
    state=result.state;revision=result.revision;
    if(!selected||!state.cases.some(item=>item.id===selected))selected=state.cases[0]?.id||null;
    status.textContent='Connected to the live database.';
    render();
  }catch(error){status.textContent=error.message;}
  finally{$('refresh').disabled=false;}
}
$('refresh').addEventListener('click',load);
if(globalThis.brand?.abfm)$('abfm').src=globalThis.brand.abfm;
load();
