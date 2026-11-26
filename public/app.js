'use strict';
const $ = id => document.getElementById(id);
const escape = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[c]);
const steps = ['Received','Inspection Assigned','Snags Confirmed','RFQ Issued','Quote Received','CS Approval','Client Submission','Client Approval','Authorized','In Progress','Reinspection','Closed'];
const suppliers = ['Rahati Bayti','Guardian'];
const demoBoq = [
  {ref:'DEMO-01', description:'Replace lock cylinder', unit:'Nos.', rate:125,budget:100},
  {ref:'DEMO-02', description:'Repaint internal wall', unit:'Sqm', rate:40,budget:30},
  {ref:'DEMO-03', description:'Deep clean office', unit:'Sqm', rate:18,budget:14}
];
const money = n => new Intl.NumberFormat('en-AE',{style:'currency',currency:'AED'}).format(n);
const amount = (price, quantity) => Math.round(price * quantity * 100) / 100;
const duration = subtotal => subtotal < 25500 ? 6 : subtotal <= 42500 ? 10 : null;
const total = c => c.snags.reduce((sum,s) => sum+Math.round(amount(s.rate,s.qty)*100),0)/100;
const storeKey = 'abfm-snagging-demo-1';
let cases = JSON.parse(localStorage.getItem(storeKey) || '[]');
let selected = cases[0]?.id;
const log = (c, event) => c.history.unshift({event, time:new Date().toISOString()});
const move = (c, step) => { c.step=step; log(c,steps[step]); };
const save = () => { localStorage.setItem(storeKey,JSON.stringify(cases)); render(); };
const field = (name,label,type='text',attrs='') => '<label>'+label+'<input name="'+name+'" type="'+type+'" required '+attrs+'></label>';
const options = items => items.map(v=>'<option>'+escape(v)+'</option>').join('');
const select = (name,label,items) => '<label>'+label+'<select name="'+name+'">'+options(items)+'</select></label>';
const form = (id, fields, action) => '<form id="'+id+'">'+fields+'<button>'+action+'</button></form>';
const button = (id,label) => '<button type="button" id="'+id+'">'+label+'</button>';
const e = escape;
function bind(id, handler) {
  const element=$(id);
  if (!element) return;
  const event=element.tagName==='FORM'?'submit':'click';
  element.addEventListener(event, async ev=>{
    ev.preventDefault();
    const snapshot = JSON.stringify(cases);
    const previousSelection=selected;
    try { await handler(event==='submit'?Object.fromEntries(new FormData(element)):{}); save(); }
    catch(error) { cases=JSON.parse(snapshot); selected=previousSelection; $('error').textContent=error.message; }
  });
}
const readPhoto = file => new Promise((resolve,reject) => {
  if (!file || !/^image\/(jpeg|png|webp)$/.test(file.type) || file.size > 500000) return reject(Error('Choose a JPEG, PNG or WebP up to 500 KB.'));
  const reader=new FileReader();
  reader.onload=()=>resolve(reader.result);
  reader.onerror=()=>reject(Error('Unable to read the photo.'));
  reader.readAsDataURL(file);
});
const photo = (src,label) => src ? '<figure><img src="'+e(src)+'" alt="'+label+'"><figcaption>'+label+'</figcaption></figure>' : '';
const upload = (name,label) => field(name,label,'file','accept="image/jpeg,image/png,image/webp"');
const rows = (head,data) => '<div class="wide"><table><thead><tr>'+head.map(x=>'<th>'+x+'</th>').join('')+'</tr></thead><tbody>'+data.map(r=>'<tr>'+r.map(x=>'<td>'+x+'</td>').join('')+'</tr>').join('')+'</tbody></table></div>';

const catalogKey = 'abfm-boq-rate-card-v1';
const activeBoq = () => JSON.parse(localStorage.getItem(catalogKey) || 'null') || demoBoq;
const cents = value => Math.round(value * 100);
const readRate = value => {
  const normalized = String(value ?? '').trim().replace(/^AED\s*/i,'').replace(/,/g,'');
  if (!/^\d+(?:\.\d+)?$/.test(normalized)) return null;
  const rate = Number(normalized);
  return Number.isFinite(rate) && rate <= 100000000 ? cents(rate)/100 : null;
};
async function xlsxParts(file) {
  if (!file?.size || file.size > 5000000) throw Error('Choose an Excel workbook under 5 MB.');
  const bytes = new Uint8Array(await file.arrayBuffer());
  const view = new DataView(bytes.buffer);
  const u16 = offset => view.getUint16(offset,true);
  const u32 = offset => view.getUint32(offset,true);
  let end = bytes.length - 22;
  while (end >= Math.max(0,bytes.length-65557) && u32(end)!==0x06054b50) end--;
  if (end<Math.max(0,bytes.length-65557)) throw Error('Choose the consolidated .xlsx workbook.');
  const count=u16(end+10);
  let offset=u32(end+16);
  const parts=new Map();
  for (let i=0;i<count;i++) {
    if(u32(offset)!==0x02014b50) throw Error('The workbook ZIP directory is invalid.');
    const method=u16(offset+10), size=u32(offset+20), outputSize=u32(offset+24);
    const nameLength=u16(offset+28), local=u32(offset+42);
    const name=new TextDecoder().decode(bytes.subarray(offset+46,offset+46+nameLength));
    offset+=46+nameLength+u16(offset+30)+u16(offset+32);
    if (!/^xl\/(?:worksheets\/sheet1|sharedStrings)\.xml$/.test(name)) continue;
    if (outputSize>5000000 || u32(local)!==0x04034b50 || ![0,8].includes(method)) throw Error('Unsupported workbook format.');
    const start=local+30+u16(local+26)+u16(local+28);
    const compressed=bytes.slice(start,start+size);
    const stream=new Blob([compressed]).stream();
    const buffer=method===0?compressed:await new Response(stream.pipeThrough(new DecompressionStream('deflate-raw'))).arrayBuffer();
    parts.set(name,new DOMParser().parseFromString(new TextDecoder().decode(buffer),'application/xml'));
  }
  return parts;
}
async function importBoq(file) {
  const parts=await xlsxParts(file);
  const sheet=parts.get('xl/worksheets/sheet1.xml');
  const nodes=(root,tag)=>Array.from(root?.getElementsByTagNameNS('*',tag)||[]);
  const strings=nodes(parts.get('xl/sharedStrings.xml'),'si').map(item=>nodes(item,'t').map(t=>t.textContent).join(''));
  const sheetRows=nodes(sheet,'row').map(row=>Object.fromEntries(nodes(row,'c').map(cell=>{
    const raw=nodes(cell,'v')[0]?.textContent??'';
    const type=cell.getAttribute('t');
    return [cell.getAttribute('r').replace(/\d+$/,''),type==='s'?strings[Number(raw)]:type==='inlineStr'?nodes(cell,'t').map(t=>t.textContent).join(''):raw];
  })));
  const header=Object.fromEntries(Object.entries(sheetRows.shift()||{}).map(([key,value])=>[value.trim(),key]));
  for(const name of ['ABFM Ref.','ABFM BOQ Description','Vendor Budget','ABFM BOQ Price','BOQ Source']) {
    if(!header[name])throw Error('The consolidated workbook is missing '+name+'.');
  }
  const catalog=[], seen=new Set();
  for(const row of sheetRows){
    const value=name=>String(row[header[name]]??'').trim();
    const ref=value('ABFM Ref.'), description=value('ABFM BOQ Description'), source=value('BOQ Source');
    if(!ref && !description)continue;
    if (!ref || !description || !['Existing BOQ','New BOQ'].includes(source))throw Error('A BOQ row is missing its reference, description, or source.');
    const qualified=ref.startsWith(source+' - ')?ref:source+' - '+ref;
    if(seen.has(qualified))throw Error('Duplicate BOQ reference: '+qualified);
    seen.add(qualified);
    catalog.push({ref:qualified,description,unit:value('Unit'),budget:readRate(value('Vendor Budget')),rate:readRate(value('ABFM BOQ Price'))});
  }
  if(!catalog.length || !catalog.some(line=>line.rate!==null&&line.budget!==null))throw Error('The workbook contains no usable rate pairs.');
  localStorage.setItem(catalogKey,JSON.stringify(catalog));
  return catalog.length;
}
const validSellRate = (snag, vendorRate) => Number.isFinite(snag.rate) && Number.isFinite(vendorRate) && cents(snag.rate)>cents(vendorRate);
const changedRate = (snag, vendorRate) => Number.isFinite(snag.budget) && cents(snag.budget)!==cents(vendorRate);
const lineKey = (s,i) => i+':'+s.ref;
function recordBid(c, supplier, reference, rates) {
  if (!suppliers.includes(supplier) || typeof reference!=='string' || !reference.trim() || rates.length!==c.snags.length || rates.some(rate=>rate===null)) {
    throw Error('A quotation reference and a valid rate for every line are required.');
  }
  const bidTotal=c.snags.reduce((sum,s,i)=>sum+Math.round(amount(rates[i],s.qty)*100),0)/100;
  c.bids.push({supplier,reference:reference.trim(),rates,total:bidTotal});
  log(c,'Quotation '+reference.trim()+' from '+supplier);
  move(c,4);
}
function downloadFile(name, content, type) {
  const url=URL.createObjectURL(new Blob([content],{type}));
  const anchor=document.createElement('a');
  anchor.href=url;
  anchor.download=name;
  anchor.click();
  setTimeout(()=>URL.revokeObjectURL(url),1000);
}
function downloadRateCard(c) {
  const data={caseId:c.id,lines:c.snags.map((s,i)=>({key:lineKey(s,i),ref:s.ref,description:s.description,unit:s.unit,qty:s.qty,budget:s.budget??null}))};
  const payload=JSON.stringify(data).replace(/</g,'\\u003c');
  const html='<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Rahati Bayti quotation</title>'+
    '<style>body{font:16px system-ui;margin:24px}table{border-collapse:collapse;width:100%}td,th{padding:8px;text-align:left;border:1px solid #ccc}input{font:inherit;width:110px}button{font:inherit;margin:16px 0}caption{text-align:left}</style>'+
    '<h1>Rahati Bayti rate card</h1><form id="bid"><label>Quotation reference <input name="reference" required></label>'+
    rows(['ABFM Ref.','ABFM BOQ Description','Unit','Qty','Vendor Budget (AED)','Your rate (AED)'],data.lines.map((s,i)=>[e(s.ref),e(s.description),e(s.unit),e(s.qty),s.budget===null?'Review':money(s.budget),'<input aria-label="Rate for line '+(i+1)+'" name="rate'+i+'" type="number" min="0" max="100000000" step=".01" required value="'+(s.budget??'')+'">']))+
    '<button>Download quotation for ABFM</button></form><script>const data='+payload+';document.getElementById("bid").onsubmit=function(event){event.preventDefault();const fields=new FormData(this);const quote={caseId:data.caseId,reference:fields.get("reference"),lines:data.lines.map((line,i)=>({key:line.key,rate:fields.get("rate"+i)}))};const url=URL.createObjectURL(new Blob([JSON.stringify(quote)],{type:"application/json"}));const a=document.createElement("a");a.href=url;a.download=data.caseId+"-Rahati-quotation.json";a.click();setTimeout(()=>URL.revokeObjectURL(url),1000)};</script></html>';
  downloadFile(c.id+'-Rahati-rate-card.html',html,'text/html');
}
async function importRahatiBid(c,file) {
  if (!file?.size || file.size>500000) throw Error('Select the quotation file returned by Rahati Bayti.');
  const quote=JSON.parse(await file.text());
  if(quote.caseId!==c.id||!Array.isArray(quote.lines)||quote.lines.length!==c.snags.length)throw Error('This quotation does not match the case.');
  const rates=quote.lines.map((line,i)=>{
    if(line?.key!==lineKey(c.snags[i],i))throw Error('The quotation lines do not match the issued rate card.');
    return readRate(line.rate);
  });
  recordBid(c,'Rahati Bayti',quote.reference,rates);
}

function inspectionReport(c) {
  const date = c.date ? c.date.split('-').reverse().join('/') : '';
  const logo = globalThis.brand?.abfm || 'abfm.jpg';
  const observations = c.snags.length ? c.snags : [{location:c.site, notes:'No reinstatement work is required.'}];
  const pages = [];
  for (let offset = 0; offset < observations.length; offset += 2) {
    pages.push(observations.slice(offset, offset + 2));
  }
  const acknowledgement = '<section class="inspection-signatures"><h3>1. LESSEE ACKNOWLEDGEMENT &amp; SIGNATURES</h3>'+
    '<p>I, ________________________, acknowledge the receipt and inspection of the facility as per the conditions outlined in this document.</p>'+
    '<p>Lessee Name &amp; Signature: ________________________________________</p>'+
    '<p>Date: ____________________</p>'+
    '<p>Inspector Name &amp; Signature: '+e(c.engineer)+' ________________________________________</p></section>';
  return pages.map((page,index)=>{
    const observationRows = page.map((s,i)=>'<tr><td>'+(index*2+i+1)+'</td><td>'+
      (s.before ? '<img class="inspection-photo" src="'+e(s.before)+'" alt="Inspection photograph for '+e(s.location)+'">' : '')+
      '</td><td><strong>'+e(s.location)+'</strong><div class="inspection-comment">'+[s.ref,s.description,s.notes].filter(Boolean).map(e).join('<br>')+'</div></td><td>'+e(s.priority || '')+'</td></tr>').join('');
    return '<section class="inspection-sheet"><div class="inspection-heading"><img src="'+e(logo)+'" alt="Al Bonian FM">'+
      '<h2 id="inspection-title-'+index+'">End of Lease Inspection Report</h2></div>'+
      '<div class="inspection-meta"><div><strong>Building Name:</strong> '+e(c.building || c.site)+'</div><div><strong>Location:</strong> '+e(c.site)+'</div>'+
      '<div><strong>Survey Date:</strong> '+e(date)+'</div><div><strong>Inspector:</strong> '+e(c.engineer)+'</div>'+
      '<div class="inspection-count">Composed of '+pages.length+(pages.length===1?' Page':' Pages')+'</div></div>'+
      '<table class="inspection-table"><colgroup><col><col><col><col></colgroup>'+
      '<thead><tr><th scope="col">No</th><th scope="col">Area / Photograph</th><th scope="col">Location / Comment / Concern</th><th scope="col">Priority</th></tr></thead>'+
      '<tbody>'+observationRows+'</tbody></table>'+(index===pages.length-1?acknowledgement:'')+'</section>';
  }).join('');
}
function report(c,type) {
  const inspection = type === 'Inspection report';
  const tenant=type==='Tenant quotation';
  const quote=tenant||type==='DP World quotation';
  const wcr=type.includes('WCR');
  if (quote && !c.snags.every((s,i)=>validSellRate(s,c.bids[c.awardedBid]?.rates[i]))) {
    $('error').textContent='Client quotation blocked: every ABFM selling rate must exceed the selected vendor rate.';
    return;
  }
  const heads=wcr?['No.','Work details','Before photo','After photo','Verified status']:tenant?['SN','Before photo','BOQ ref.','Description','Total']:quote?['SN','Before photo','BOQ ref.','Description','Unit','Qty','Unit price','Subtotal']:['No.','Plot / location','Observation','Before photo'];
  const lines=c.snags.map((s,i)=>{
    const n=i+1, d=e(s.description), before=photo(s.before,'Before');
    if(wcr)return [n,d,before,photo(s.after,'After'),e(s.result||'Pending Engineer verification')];
    if(tenant)return [n,before,e(s.ref),d,money(amount(s.rate,s.qty))];
    if(quote)return [n,before,e(s.ref),d,e(s.unit),s.qty,money(s.rate),money(amount(s.rate,s.qty))];
    return [n,e(s.location),d,before];
  });
  const dialog=document.createElement('dialog');
  if (inspection) {
    dialog.classList.add('inspection-dialog');
    dialog.setAttribute('aria-labelledby','inspection-title-0');
  }
  dialog.innerHTML=(inspection ? inspectionReport(c) : '<h2>'+type+'</h2><p>Client '+e(c.client)+' · Location '+e(c.site)+' · Task ID '+e(c.inspection||c.id)+'</p>'+
    (wcr?'<p>Quotation ref. '+e(c.id)+' · Work order '+e(c.order)+' · Approved amount '+money(total(c))+'<br>Work start '+e(c.started)+' · Submitted '+e(c.submitted)+' · Service provider '+e(c.award)+'</p>':'')+
    rows(heads,lines)+(quote?'<p>Total value '+money(total(c))+'<br>5% VAT '+money(amount(total(c),.05))+'<br>Grand total '+money(total(c)+amount(total(c),.05))+'</p>':'')+
    (wcr?'<p>Approvals · Service Provider Engineer / Manager · End User (JAFZA/DPW)</p>':''))+
    '<button class="print">Print / Save PDF</button> <button class="dismiss secondary">Close</button>';
  document.body.append(dialog);
  dialog.querySelector('.print').onclick=()=>window.print();
  dialog.querySelector('.dismiss').onclick=()=>dialog.close();
  dialog.addEventListener('close',()=>dialog.remove(),{once:true});
  dialog.showModal();
}
function bidComparison(c) {
  return rows(['Supplier / quotation','ABFM Ref.','Vendor Budget','Quoted rate','ABFM BOQ Price','Pricing check'],c.bids.flatMap(b=>c.snags.map((s,i)=>{
        const rate=b.rates[i], changed=b.supplier==='Rahati Bayti'&&changedRate(s,rate);
        return [e(b.supplier+' / '+b.reference),e(s.ref),Number.isFinite(s.budget)?money(s.budget):'Review',
          changed?'<strong class="error">'+money(rate)+' · Changed</strong>':money(rate),Number.isFinite(s.rate)?money(s.rate):'Review',
          validSellRate(s,rate)?'Pass':'<strong class="error">Selling price must exceed quoted rate</strong>'];
      })));
}
function render() {
  $('cases').innerHTML=cases.map((c,i)=>'<button class="secondary" id="case'+i+'">'+e(c.id)+' · '+e(c.site)+'</button>').join('');
  for (const [i,c] of cases.entries()) $('case'+i).onclick=()=>{selected=c.id;render();};
  $('new').onclick=()=>{selected=undefined;render();};
  const catalog=activeBoq();
  $('boqStatus').textContent=catalog===demoBoq?'Demo rates':catalog.length+' BOQ lines loaded';
  $('boqFile').onchange=async event=>{
    try{
      await importBoq(event.target.files[0]);
      render();
    }catch(error){$('boqStatus').textContent=error.message;}
    finally{event.target.value='';}
  };
  const c=cases.find(item=>item.id===selected);
  if(!c){
    $('detail').innerHTML='<article><h1>New snagging request</h1><p class="error" id="error" role="alert"></p>'+
      form('intake',field('client','Client')+field('site','Property / unit')+'<label>Building name<input name="building"></label>'+field('contact','Requester / contact')+field('request','Request details')+
      '<label>Inspection CAFM task ID<input name="inspection"></label><label>Reinstatement CAFM task ID<input name="reinstatement"></label>','Register request')+'</article>';
    bind('intake',values=>{
      const ids=[values.inspection,values.reinstatement].map(x=>x.trim()).filter(Boolean);
      if (cases.some(item=>[item.inspection,item.reinstatement].some(x=>ids.includes(x)))) throw Error('This CAFM task is already linked.');
      const id='SG-'+crypto.randomUUID().slice(0,8).toUpperCase();
      const item={...values,id,step:0,snags:[],bids:[],history:[]};
      log(item,'Client request registered'); cases.push(item); selected=id;
    }); return;
  }
  let panel='';
  if(c.step===0)panel=form('assign',field('engineer','ABFM Engineer')+field('date','Inspection date','date'),'Assign inspection');
  if(c.step===1)panel=form('snag',field('location','Snag location')+select('priority','Priority',['','Low','Medium','High','Urgent'])+select('ref','ABFM BOQ reference',catalog.map(x=>x.ref))+'<div id="ratePreview" class="meta"></div>'+field('unit','Unit of measure')+field('qty','Measured quantity','number','min=".01" step=".01"')+upload('before','Before photo')+field('notes','Observation / recommended work'),'Add confirmed snag')+(c.snags.length?button('confirm','Publish inspection and confirm snags'):button('no-work','Publish inspection · no reinstatement required'));
  if(c.step===2)panel=form('rfq',field('deadline','Quote deadline','date')+field('instructions','Site instructions'),'Record RFQ to Rahati Bayti and Guardian');
  if(c.step===3||c.step===4){
    panel='<div class="supplier"><img id="rahati" src="'+(globalThis.brand?.rahati||'rahati.png')+'" alt="Rahati Bayti">Guardian</div>'+
      form('bid',select('supplier','Supplier',suppliers)+field('reference','Quotation reference')+c.snags.map((s,i)=>field('rate'+i,'Supplier rate · '+e(s.ref),'number','min="0" max="100000000" step=".01"'+(Number.isFinite(s.budget)?' value="'+s.budget+'"':''))).join(''),'Record quotation revision');
    panel+=button('vendorCard','Download Rahati rate card')+
      form('vendorReturn',field('quotation','Import quotation returned by Rahati','file','accept=".json,application/json"'),'Import Rahati quotation');
    if(c.bids.length)panel+=rows(['Supplier','Reference','Bid total'],c.bids.map(b=>[e(b.supplier),e(b.reference),money(b.total)]))+
      form('award','<label>Award recommendation<select name="bid">'+c.bids.map((b,i)=>'<option value="'+i+'">'+e(b.supplier+' · '+b.reference)+'</option>').join('')+'</select></label>'+field('reason','Award justification'),'Send to CS approval');
  }
  if(c.step===5)panel=form('cs',field('approver','CS approver'),'Record CS approval');
  if(c.step===6)panel=form('send',field('submission','Client submission reference'),'Record submission to client');
  if(c.step===7)panel=form('authorize',field('approval','Client approval reference')+field('order','PO / work order')+field('ordered','Order confirmation date','date')+
    (duration(total(c))===null?field('days','Agreed calendar days','number','min="1" step="1"'):'<p>Maximum '+duration(total(c))+' days from order confirmation</p>'),'Record approval and authorize work');
  if(c.step===8)panel=form('start',field('started','Actual start date','date'),'Start execution');
  if(c.step===9)panel=form('wcr',field('wcr','Supplier WCR reference')+c.snags.map((s,i)=>s.result==='Pass'?'':upload('after'+i,'After photo · '+e(s.ref))).join(''),'Submit supplier WCR for reinspection');
  if(c.step===10)panel=form('verify',field('inspector','Reinspecting ABFM Engineer')+c.snags.map((s,i)=>s.result==='Pass'?'':select('result'+i,'Decision · '+e(s.ref),['Pass','Failed','Partial'])).join('')+'<label>Engineer remarks<textarea name="remarks"></textarea></label>','Record verification');
  $('detail').innerHTML='<article><h1>'+e(c.site)+'</h1><p class="meta">'+e(c.id)+' · '+e(c.client)+' · '+e(c.contact)+'</p><p>'+e(c.request)+'</p><p class="meta">CAFM '+e(c.inspection||'—')+' / '+e(c.reinstatement||'—')+'</p>'+
    '<ol class="steps">'+steps.map((s,i)=>'<li '+(i===c.step?'aria-current="step"':'')+'>'+s+'</li>').join('')+'</ol><h2>'+steps[c.step]+'</h2>'+
    (c.noWork?'<p>No reinstatement required.</p>':'')+'<p class="error" id="error" role="alert"></p>'+panel+
    (c.bids.length?'<h3>Supplier rate comparison</h3>'+bidComparison(c):'')+
    (c.snags.length?rows(['BOQ reference','Scope','Qty','Evidence','Verification'],c.snags.map(s=>[e(s.ref),e(s.description)+'<br>'+e(s.notes),s.qty+' '+e(s.unit),photo(s.before,'Before')+photo(s.after,'After'),e(s.result||'Pending')])):'')+
    (c.published?button('inspectionReport','Inspection report')+' ':'')+(c.award?button('clientQuote','DP World quotation')+' '+button('tenantQuote','Tenant quotation')+' ':'')+
    (c.wcr?button('completion',c.step===11?'Final WCR':'Partial / draft WCR'):'')+
    '<details><summary>Activity history</summary><ul>'+c.history.map(h=>'<li>'+e(new Date(h.time).toLocaleString('en-AE',{timeZone:'Asia/Dubai'}))+' · '+e(h.event)+'</li>').join('')+'</ul></details></article>';
  if ($('snag')) {
    const picker=$('snag').elements.ref;
    const preview=()=>{
      const line=catalog.find(x=>x.ref===picker.value);
      if (!line) return;
      $('snag').elements.unit.value=line.unit || '';
      $('ratePreview').textContent=line.description+' · Vendor Budget '+(Number.isFinite(line.budget)?money(line.budget):'requires review')+' · ABFM BOQ Price '+(Number.isFinite(line.rate)?money(line.rate):'requires review');
    };
    picker.onchange=preview;
    preview();
  }
  if ($('vendorCard')) $('vendorCard').onclick=()=>downloadRateCard(c);
  bind('vendorReturn',v=>importRahatiBid(c,v.quotation));
  bind('assign',v=>{Object.assign(c,v);move(c,1);});
  bind('snag',async v=>{
    const line=catalog.find(x=>x.ref===v.ref);
    if(!line||!Number.isFinite(line.budget)||!Number.isFinite(line.rate))throw Error('This BOQ item needs a single numeric Vendor Budget and ABFM BOQ Price. Correct the source workbook and reimport it.');
    c.snags.push({...line,unit:line.unit||v.unit.trim(),location:v.location,notes:v.notes,priority:v.priority,qty:Number(v.qty),before:await readPhoto(v.before)});
    log(c,'Engineer confirmed '+line.ref);
  });
  bind('confirm',()=>{c.published=true;move(c,2);});
  bind('no-work',()=>{c.published=true;c.noWork=true;log(c,'No reinstatement required');move(c,11);});
  bind('rfq',v=>{c.rfq=v;move(c,3);});
  bind('bid',v=>recordBid(c,v.supplier,v.reference,c.snags.map((s,i)=>readRate(v['rate'+i]))));
  bind('award',v=>{
    const index=Number(v.bid), bid=c.bids[index];
    if(!bid||!c.snags.every((s,i)=>validSellRate(s,bid.rates[i])))throw Error('Resolve the quoted rates before approval. Every ABFM selling rate must exceed the vendor rate.');
    c.award=bid.supplier;
    c.awardedBid=index;
    log(c,'Award recommendation · '+v.reason);
    move(c,5);
  });
  bind('cs',v=>{log(c,'CS approved by '+v.approver);move(c,6);});
  bind('send',v=>{log(c,'Client submission '+v.submission);move(c,7);});
  bind('authorize',v=>{Object.assign(c,v);c.days=duration(total(c))??Number(v.days);log(c,'Client approval '+v.approval);move(c,8);});
  bind('start',v=>{if(v.started<c.ordered)throw Error('Start date precedes order confirmation.');c.started=v.started;move(c,9);});
  bind('wcr',async v=>{
    for(const [i,s] of c.snags.entries())if(s.result!=='Pass')s.after=await readPhoto(v['after'+i]);
    c.wcr=v.wcr;c.submitted=new Date().toLocaleDateString('en-GB',{timeZone:'Asia/Dubai'});log(c,'Supplier WCR '+v.wcr);move(c,10);
  });
  bind('verify',v=>{
    if(Object.entries(v).some(([key,value])=>key.startsWith('result')&&value!=='Pass')&&!v.remarks.trim())throw Error('Enter rectification instructions for failed or partial work.');
    for(const [i,s] of c.snags.entries())if(s.result!=='Pass')s.result=v['result'+i];
    log(c,'Reinspection by '+v.inspector+' · '+v.remarks+' · '+c.snags.map(s=>s.ref+' '+s.result).join(', '));
    move(c,c.snags.every(s=>s.result==='Pass')?11:9);
  });
  for(const [id,type] of [['inspectionReport','Inspection report'],['clientQuote','DP World quotation'],['tenantQuote','Tenant quotation'],['completion',c.step===11?'Final WCR':'Partial / draft WCR']]){
    if($(id))$(id).onclick=()=>report(c,type);
  }
}
if(globalThis.brand?.abfm)$('abfm').src=globalThis.brand.abfm;
render();
