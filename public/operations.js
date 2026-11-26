'use strict';
const $=id=>document.getElementById(id);
const stages=['Received','Inspection Assigned','Snags Confirmed','RFQ Issued','Quote Received','CS Approval','Client Submission','Client Approval','Authorized','In Progress','Reinspection','Closed'];
let state=null,revision=null,selected=null;
const money=value=>new Intl.NumberFormat('en-AE',{style:'currency',currency:'AED'}).format(value);
const isRahati=value=>{const name=String(value||'').toLowerCase().replace(/[^a-z]/g,'');return name==='rahati'||(name.includes('rahati')&&(name.includes('bayti')||name.includes('baiti')));};
function rahatiQuotations(record){const result=(record.bids||[]).filter(bid=>isRahati(bid.supplier));const selected=record.award&&isRahati(record.award)?record.bids?.[record.awardedBid]:null;if(selected&&!result.includes(selected))result.push(selected);return result;}
const node=(tag,text,className='')=>{const item=document.createElement(tag);if(text!==undefined)item.textContent=text;if(className)item.className=className;return item;};
async function request(url){
  const response=await fetch(url,{cache:'no-store'});
  const body=await response.json().catch(()=>null);
  if(!response.ok)throw Error(body?.error||'The server did not confirm the request.');
  return body;
}
function render(){
  const list=$('cases');
  list.replaceChildren();
  if(!state)return;
  for(const record of state.cases){
    const quoteReady=rahatiQuotations(record).length>0;
    const button=node('button',(record.site||'Property')+' · '+record.id+' · '+(stages[record.step]||'Unknown stage')+(quoteReady?' · Rahati quote received':''),'secondary');
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
    detail.append(node('article','Select a case to view its Rahati quotation.'));
    return;
  }
  const article=node('article');
  article.append(node('h1',record.site||'Snagging case'));
  article.append(node('p',record.id+' · '+(record.client||'')+' · '+(stages[record.step]||'Unknown stage'),'meta'));
  article.append(node('p','Read-only quotation view.'));
  const quotations=rahatiQuotations(record);
  if(!quotations.length){
    article.append(node('p','The Rahati quotation will appear here after it is received.'));
    detail.append(article);
    return;
  }
  for(const bid of quotations){
    const section=node('section');
    section.append(node('h2','Rahati Bayti · '+(bid.reference||'Quotation')));
    section.append(node('p','Submitted total: '+money(bid.total||0)+' (AED)','meta'));
    const table=node('table');
    const head=node('thead'),headRow=node('tr');
    ['BOQ Ref.','Work scope','Qty','Quoted rate (AED)','Line total (AED)'].forEach(label=>headRow.append(node('th',label)));
    head.append(headRow);table.append(head);
    const body=node('tbody');
    (record.snags||[]).forEach((line,index)=>{
      const rate=bid.rates?.[index]??0;
      const row=node('tr');
      row.append(node('td',line.ref||''));
      row.append(node('td',line.description||''));
      row.append(node('td',String(line.qty??'')+' '+(line.unit||'')));
      const rateCell=node('td',money(rate));
      const latestRevision=quotations.length>1&&bid===quotations[quotations.length-1];
      if(latestRevision){rateCell.style.color='#13733f';rateCell.style.fontWeight='700';rateCell.title='Latest Rahati submission';}
      row.append(rateCell);
      row.append(node('td',money(Math.round(Number(line.qty||0)*Number(rate)*100)/100)));
      body.append(row);
    });
    table.append(body);section.append(table);article.append(section);
  }
  if(record.step===5&&quotations.length){
    const reject=node('button','Reject quotation · request Rahati resubmission','secondary');
    reject.type='button';
    reject.addEventListener('click',async()=>{
      const reason=window.prompt('Enter the reason for requesting a revised Rahati quotation:');
      if(!reason||!reason.trim())return;
      reject.disabled=true;
      try{
        const response=await fetch('/api/operations-action',{method:'PUT',headers:{'Content-Type':'application/json'},
          body:JSON.stringify({action:'reject-quotation',caseId:record.id,reason:reason.trim(),revision})});
        const body=await response.json().catch(()=>null);
        if(!response.ok)throw Error(body?.error||'The server did not confirm the request.');
        await load();
        $('syncStatus').textContent='Quotation returned to Rahati for resubmission.';
      }catch(error){
        $('syncStatus').textContent=error.message;
        reject.disabled=false;
      }
    });
    article.append(reject);
  }
  detail.append(article);
}
async function load(){
  const status=$('syncStatus');
  $('refresh').disabled=true;
  try{
    const result=await request('/api/state');
    state=result.state;revision=result.revision;
    if(!selected||!state.cases.some(item=>item.id===selected))selected=state.cases[0]?.id||null;
    status.textContent='Connected to the live database. Read-only Rahati quotations refresh automatically.';
    render();
  }catch(error){status.textContent=error.message;}
  finally{$('refresh').disabled=false;}
}
$('refresh').addEventListener('click',load);
if(globalThis.brand?.abfm)$('abfm').src=globalThis.brand.abfm;
load();
setInterval(()=>{if(!document.hidden)load();},15000);
