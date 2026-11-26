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
  let saving = false;
  element.addEventListener(event, async ev=>{
    ev.preventDefault();
    if(saving)return;
    saving=true;
    const originalCases=cases.slice();
    const snapshot=JSON.parse(JSON.stringify(cases));
    const previousSelection=selected;
    const control=event==='submit'?element.querySelector('button[type="submit"],button:not([type])'):element;
    if(control)control.disabled=true;
    try { await handler(event==='submit'?Object.fromEntries(new FormData(element)):{}); save(); }
    catch(error) {
      cases=originalCases.map((original,i)=>{
        for(const key of Object.keys(original))delete original[key];
        return Object.assign(original,snapshot[i]);
      });
      selected=previousSelection;
      const alert=$('error');
      alert.textContent=error.name==='QuotaExceededError'?'Browser storage is full. Free space or use fewer photos before saving.':error.message;
      alert.scrollIntoView?.({block:'nearest'});
    }
    finally { saving=false; if(control)control.disabled=false; }
  });
}
const readDataUrl = file => new Promise((resolve,reject) => {
  const reader=new FileReader();
  reader.onload=()=>resolve(reader.result);
  reader.onerror=()=>reject(Error('Unable to read the photo.'));
  reader.readAsDataURL(file);
});
async function readPhoto(file) {
  if(!file?.size)throw Error('Attach a before or after photo as requested.');
  const supported=/^image\/(jpeg|png|webp)$/i.test(file.type) || (!file.type && /\.(jpe?g|png|webp)$/i.test(file.name));
  if(!supported)throw Error('Choose a JPEG, PNG or WebP photo.');
  if(file.size<=500000)return readDataUrl(file);
  if(file.size>25000000)throw Error('Choose a photo smaller than 25 MB.');
  const data=await readDataUrl(file);
  const image=new Image();
  image.src=data;
  try { await image.decode(); }
  catch { throw Error('This photo could not be opened. Choose another JPEG, PNG or WebP.'); }
  const canvas=document.createElement('canvas');
  const scale=Math.min(1,1440/Math.max(image.naturalWidth,image.naturalHeight));
  canvas.width=Math.max(1,Math.round(image.naturalWidth*scale));
  canvas.height=Math.max(1,Math.round(image.naturalHeight*scale));
  const context=canvas.getContext('2d');
  context.fillStyle='#fff';
  context.fillRect(0,0,canvas.width,canvas.height);
  context.drawImage(image,0,0,canvas.width,canvas.height);
  for(const quality of [.78,.6,.4]){
    const encoded=canvas.toDataURL('image/jpeg',quality);
    if(encoded.length<=667000)return encoded;
  }
  throw Error('This photo could not be compressed. Choose a smaller image.');
}
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
function budgetUplift(c) {
  if (!c.snags.length || !c.snags.every(s=>Number.isFinite(s.budget) && Number.isFinite(s.rate))) return null;
  const budget=c.snags.reduce((sum,s)=>sum+cents(amount(s.budget,s.qty)),0);
  const selling=cents(total(c));
  if (!Number.isSafeInteger(budget) || !Number.isSafeInteger(selling) || budget<=0) return null;
  return {budget,selling,meets:BigInt(selling)*100n>=BigInt(budget)*121n};
}
function quotationAllowed(c,bid) {
  return Boolean(bid && c.snags.length && c.snags.every(s=>Number.isFinite(s.rate)) &&
    (budgetUplift(c)?.meets || c.snags.every((s,i)=>validSellRate(s,bid.rates[i]))));
}
const priceGateMessage = 'Resolve the pricing before approval. The selling subtotal must be at least 21% above Vendor Budget or each selling rate must exceed the selected vendor rate.';
const changedRate = (snag, vendorRate) => Number.isFinite(snag.budget) && cents(snag.budget)!==cents(vendorRate);
function vendorBudget(snag,catalog) {
  if(Number.isFinite(snag.budget))return snag.budget;
  const budget=catalog.find(line=>line.ref===snag.ref)?.budget;
  return Number.isFinite(budget)?budget:null;
}
const lineKey = (s,i) => i+':'+s.ref;
function recordBid(c, supplier, reference, rates) {
  if (!suppliers.includes(supplier) || typeof reference!=='string' || !reference.trim() || rates.length!==c.snags.length || rates.some(rate=>rate===null)) {
    throw Error('A quotation reference and a valid rate for every line are required.');
  }
  if(supplier==='Rahati Bayti'){
    const catalog=activeBoq();
    for(const snag of c.snags)snag.budget=vendorBudget(snag,catalog);
  }
  const bidTotal=c.snags.reduce((sum,s,i)=>sum+Math.round(amount(rates[i],s.qty)*100),0)/100;
  c.bids.push({supplier,reference:reference.trim(),rates,total:bidTotal});
  log(c,'Quotation '+reference.trim()+' from '+supplier);
  move(c,4);
}

function rahatiQuotationDocument(c,reference,rates,template) {
  const detailed=template==='detailed';
  const today=new Intl.DateTimeFormat('en-GB',{timeZone:'Asia/Dubai'}).format(new Date());
  const logo=globalThis.brand?.rahati || 'rahati.png';
  const subtotalCents=c.snags.reduce((sum,line,i)=>sum+cents(amount(rates[i],line.qty)),0);
  const vatCents=Math.round(subtotalCents*.05);
  const meta=(label,value,arabic)=>'<div><strong>'+label+'</strong><span>'+e(value||'–')+'</span><b lang="ar" dir="rtl">'+arabic+'</b></div>';
  const headings=detailed?['SN','Item description','Photos','Qty','Unit','Unit rate','Amount']:['#','Description','Unit','Qty','Unit rate','Total'];
  const items=c.snags.map((line,i)=>{
    const description='<strong>'+e(line.ref)+'</strong><br>'+e(line.description);
    const rate=money(rates[i]), total=money(amount(rates[i],line.qty));
    return detailed?[i+1,description,photo(line.before,'Before'),e(line.qty),e(line.unit),rate,total]
      :[i+1,description,e(line.unit),e(line.qty),rate,total];
  });
  const technical=detailed?'<h3>General Information</h3>'+
    rows(['Requester Name','Location','Task ID'],[[e(c.contact||'–'),e(c.site),e(c.inspection||c.id)]])+
    '<h3>Technical Qualification Sheet</h3>'+
    rows(['SN','Description','Service Provider Response'],[[1,'Scope of work as per RFQ','Quoted BOQ items are listed below'],[2,'Site instructions',e(c.rfq?.instructions||'–')]]):'';
  return '<section class="rahati-sheet '+(detailed?'rahati-detailed':'rahati-standard')+'">'+
    '<div class="rahati-heading"><img src="'+e(logo)+'" alt="Rahati Bayti Technical Services"><div><h2 id="rahati-quote-title">QUOTATION</h2><div lang="ar" dir="rtl">عرض أسعار</div></div></div>'+
    '<div class="rahati-identifiers"><strong>No. '+e(reference)+'</strong><strong>Date: '+e(today)+'</strong></div>'+
    '<div class="rahati-meta">'+meta('To:','Al Bonian FM','حضرة')+meta('Address:',c.site,'العنوان')+
    meta('Quotation For:','Reinstatement works · '+c.site,'عرض لزوم')+'</div>'+
    (detailed?'<p class="rahati-rfq">Request For Quotation (RFQ)<br>Procurement and Logistics Department</p>':'')+
    technical+'<div class="rahati-items">'+rows(headings,items)+'</div>'+
    '<table class="rahati-totals"><tbody>'+
    [['Total Excluding VAT',subtotalCents],['5% VAT',vatCents],['Total Including VAT',subtotalCents+vatCents]].map(([label,value])=>'<tr><th scope="row">'+label+'</th><td>'+money(value/100)+'</td></tr>').join('')+
    '</tbody></table><div class="rahati-terms"><div><strong>General Notes &amp; Special Conditions</strong><p>As agreed for this quotation.</p></div>'+
    '<div><strong>Terms of Payment</strong><p>As agreed.</p></div><div><strong>Authorized Stamp</strong></div></div></section>';
}
function showRahatiQuotation(c,bidForm) {
  const formData=new FormData(bidForm);
  if (formData.get('supplier')!=='Rahati Bayti' || !bidForm.reportValidity())return;
  const reference=String(formData.get('reference')||'').trim();
  const rates=c.snags.map((_,i)=>readRate(formData.get('rate'+i)));
  if(!reference || rates.some(rate=>rate===null)){
    $('error').textContent='Enter a quotation reference and a valid rate for each item.';
    return;
  }
  const dialog=document.createElement('dialog');
  dialog.className='rahati-quotation-dialog';
  dialog.setAttribute('aria-labelledby','rahati-quote-title');
  dialog.innerHTML=rahatiQuotationDocument(c,reference,rates,formData.get('rahatiTemplate'))+
    '<button class="print" type="button">Print / Save PDF</button> <button class="dismiss secondary" type="button">Close</button>';
  document.body.append(dialog);
  dialog.querySelector('.print').onclick=()=>window.print();
  dialog.querySelector('.dismiss').onclick=()=>dialog.close();
  dialog.addEventListener('close',()=>dialog.remove(),{once:true});
  dialog.showModal();
}
async function importRahatiBid(c,file) {
  if (!file?.size || file.size>5000000) throw Error('Select the quotation PDF returned by Rahati Bayti.');
  const document=await file.text();
  let quote;
  try {
    if(document.startsWith('%PDF-')){
      const payload=document.match(/^%ABFM-RAHATI-QUOTE ([^\r\n]+)$/m)?.[1];
      if(!payload || payload.length>500000)throw Error();
      quote=JSON.parse(decodeURIComponent(payload));
    } else {
      quote=JSON.parse(document);
    }
  } catch {
    throw Error('Import an original quotation from the previous Rahati rate card. For new quotations, preview and record the rates directly in this case.');
  }
  if(quote?.caseId!==c.id||!Array.isArray(quote.lines)||quote.lines.length!==c.snags.length)throw Error('This quotation does not match the case.');
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

function quotationDocument(c,tenant) {
  const today=new Intl.DateTimeFormat('en-GB',{timeZone:'Asia/Dubai'}).format(new Date());
  const title=tenant?'DPW -TENANT -PROPOSAL':'DPW-EOL-PROPOSAL';
  const logo=globalThis.brand?.abfm || 'abfm.jpg';
  const displayAmount=value=>new Intl.NumberFormat('en-AE',{minimumFractionDigits:2,maximumFractionDigits:2}).format(value);
  const value=total(c);
  const vat=amount(value,.05);
  const row=(label,data)=>'<dt>'+label+'</dt><dd>'+e(data || '–')+'</dd>';
  const headers=tenant?['SN','BOQ Ref Number','Description','Total']:['SN','BOQ Ref Number','Description','Unit','Qty','Unit Price','SubTotal','Total'];
  const lineRows=c.snags.map((s,i)=>{
    const lineTotal=displayAmount(amount(s.rate,s.qty));
    const cells=[i+1,s.ref,s.description];
    if (!tenant) cells.push(s.unit,s.qty,displayAmount(s.rate),lineTotal);
    cells.push(lineTotal);
    return '<tr>'+cells.map(cell=>'<td>'+e(cell)+'</td>').join('')+'</tr>';
  }).join('');
  const totals=[['Total Value',value],['Discount (if applicable)',0],['Total after Discount',value],['5% Value Added Tax (VAT)',vat],['Grand Total, inclusive of VAT',value+vat]];
  return '<section class="quote-sheet '+(tenant?'quote-tenant':'quote-client')+'">'+
    '<div class="quote-heading"><img src="'+e(logo)+'" alt="Al Bonian FM"><h2 id="quote-title">'+title+'</h2></div>'+
    '<div class="quote-meta"><dl>'+row('Client Name:',c.client)+row('Property Name:',c.building||c.site)+
    (tenant?'':row('Contact Person:',c.contact))+row('Works Location:',c.site)+'</dl>'+
    '<dl>'+row('Ref. No.',tenant?c.id+'-Tenant':c.id)+row('Date',today)+row('Task ID.',c.inspection||c.reinstatement||c.id)+'</dl></div>'+
    '<dl class="quote-subject">'+row('Subject:','EOL Reinstatement Works – '+c.site)+'</dl>'+
    '<div class="quote-terms"><dl>'+row('Works Requirement:','End of lease reinstatement')+row('Additional Information:','')+'</dl>'+
    '<dl>'+row('Quotation Validity:','30 Days')+row('Materials Delivery Period:','')+
    row('Works Completion Period:',(c.days||duration(value))?(c.days||duration(value))+' days from order confirmation':'To be agreed')+
    row('Warranty (as applicable):','')+row('Urgency of Works:',c.priority)+row('Payment Terms:','As per agreement')+'</dl></div>'+
    '<table class="quote-lines"><colgroup>'+headers.map(()=>'<col>').join('')+'</colgroup>'+
    '<thead><tr>'+headers.map(header=>'<th scope="col">'+header+'</th>').join('')+'</tr></thead><tbody>'+lineRows+'</tbody></table>'+
    '<table class="quote-totals"><tbody>'+totals.map(([label,number])=>'<tr><th scope="row">'+label+'</th><td>'+displayAmount(number)+'</td></tr>').join('')+'</tbody></table>'+
    '<div class="quote-remarks"><strong>Remarks:</strong></div>'+
    '<div class="quote-footer"><span>Document Code: ABFM-ADM-QUO-001-2022-00<br>Rev. 0</span><span>Classification: Quotation</span><span>Issue No.: 1 Date: 29 Aug. 2022</span></div></section>';
}
function report(c,type) {
  const inspection = type === 'Inspection report';
  const tenant=type==='Tenant quotation';
  const quote=tenant||type==='DP World quotation';
  const wcr=type.includes('WCR');
  if (quote && !quotationAllowed(c,c.bids[c.awardedBid])) {
    $('error').textContent=priceGateMessage;
    return;
  }
  const heads=['No.','Work details','Before photo','After photo','Verified status'];
  const lines=wcr?c.snags.map((s,i)=>[i+1,e(s.description),photo(s.before,'Before'),photo(s.after,'After'),e(s.result||'Pending Engineer verification')]):[];
  const dialog=document.createElement('dialog');
  if (inspection) {
    dialog.classList.add('inspection-dialog');
    dialog.setAttribute('aria-labelledby','inspection-title-0');
  }
  if (quote) {
    dialog.classList.add('quotation-dialog');
    dialog.setAttribute('aria-labelledby','quote-title');
  }
  dialog.innerHTML=(inspection ? inspectionReport(c) : quote ? quotationDocument(c,tenant) : '<h2>'+type+'</h2><p>Client '+e(c.client)+' · Location '+e(c.site)+' · Task ID '+e(c.inspection||c.id)+'</p>'+
    (wcr?'<p>Quotation ref. '+e(c.id)+' · Work order '+e(c.order)+' · Approved amount '+money(total(c))+'<br>Work start '+e(c.started)+' · Submitted '+e(c.submitted)+' · Service provider '+e(c.award)+'</p>':'')+
    rows(heads,lines)+
    (wcr?'<p>Approvals · Service Provider Engineer / Manager · End User (JAFZA/DPW)</p>':''))+
    '<button class="print">Print / Save PDF</button> <button class="dismiss secondary">Close</button>';
  document.body.append(dialog);
  dialog.querySelector('.print').onclick=()=>window.print();
  dialog.querySelector('.dismiss').onclick=()=>dialog.close();
  dialog.addEventListener('close',()=>dialog.remove(),{once:true});
  dialog.showModal();
}
function bidComparison(c) {
  const uplift=budgetUplift(c);
  const summary=uplift?'<p>Vendor Budget subtotal '+money(uplift.budget/100)+' · ABFM selling subtotal '+money(uplift.selling/100)+' · '+((uplift.selling/uplift.budget-1)*100).toFixed(2)+'% uplift'+(uplift.meets?' · Meets the 21% overall rule':'')+'</p>':'';
  return summary+rows(['Supplier / quotation','ABFM Ref.','Vendor Budget','Quoted rate','ABFM BOQ Price','Pricing check'],c.bids.flatMap(b=>c.snags.map((s,i)=>{
        const rate=b.rates[i], changed=b.supplier==='Rahati Bayti'&&changedRate(s,rate);
        return [e(b.supplier+' / '+b.reference),e(s.ref),Number.isFinite(s.budget)?money(s.budget):'Review',
          changed?'<strong class="error">'+money(rate)+' · Changed</strong>':money(rate),Number.isFinite(s.rate)?money(s.rate):'Review',
          validSellRate(s,rate)?'Pass':'<strong class="error">Selling rate at or below quoted rate</strong>'];
      })));
}
function findScopes(catalog,query) {
  const normalize=text=>String(text).normalize('NFKD').toLowerCase().replace(/\p{M}/gu,'');
  const ignored=new Set(['a','an','and','for','in','of','the','to']);
  const words=normalize(query).match(/[\p{L}\p{N}]+/gu)||[];
  const terms=[...new Set(words.filter(word=>!ignored.has(word)).map(word=>word.length>3?word.replace(/s$/,''):word))];
  if(!terms.length)return {matches:[],partial:false};
  const ranked=catalog.map(line=>{
    const description=normalize(line.description);
    return {line,score:terms.filter(term=>description.includes(term)).length};
  }).filter(match=>match.score>0);
  const exact=ranked.filter(match=>match.score===terms.length);
  if(exact.length)return {matches:exact.map(match=>match.line),partial:false};
  const highest=Math.max(0,...ranked.map(match=>match.score));
  return {matches:ranked.filter(match=>match.score===highest).map(match=>match.line),partial:true};
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
  if(c.step===1)panel=form('snag',field('location','Snag location')+select('priority','Priority',['','Low','Medium','High','Urgent'])+field('scopeSearch','Search BOQ scope by description','search','placeholder="e.g. replace floor tiles" autocomplete="off"')+
    '<input type="hidden" name="scopeMatch"><p id="scopeStatus" class="meta" role="status"></p><div id="scopeResults" class="scope-results" aria-label="Matching BOQ scopes"></div>'+
    field('ref','ABFM BOQ reference','text','readonly')+'<div id="ratePreview" class="meta"></div>'+field('unit','Unit of measure')+field('qty','Measured quantity','number','min=".01" step=".01"')+upload('before','Before photo')+field('notes','Observation / recommended work'),'Add confirmed snag')+(c.snags.length?button('confirm','Publish inspection and confirm snags'):button('no-work','Publish inspection · no reinstatement required'));
  if(c.step===2)panel=form('rfq',field('deadline','Quote deadline','date')+field('instructions','Site instructions'),'Record RFQ to Rahati Bayti and Guardian');
  if(c.step===3||c.step===4){
    panel='<div class="supplier"><img id="rahati" src="'+(globalThis.brand?.rahati||'rahati.png')+'" alt="Rahati Bayti">Guardian</div>'+
      form('bid',select('supplier','Supplier',suppliers)+field('reference','Quotation reference')+
      '<p id="bidBudgetStatus" class="meta" role="status"></p>'+
      c.snags.map((s,i)=>field('rate'+i,'Supplier rate · '+e(s.ref),'number','min="0" max="100000000" step=".01"')).join('')+
      '<div id="rahatiPrintOptions"><label>Rahati quotation format<select name="rahatiTemplate"><option value="detailed">Detailed RFQ and rectification</option><option value="standard">Standard service quotation</option></select></label>'+
      button('previewRahati','Preview Rahati quotation')+'</div>','Record quotation revision');
    panel+=form('vendorReturn',field('quotation','Import a previously issued Rahati quotation','file','accept=".pdf,.json,application/pdf,application/json"'),'Import Rahati quotation');
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
    (c.snags.length?rows(['BOQ reference','Scope','Qty','Evidence','Verification'],c.snags.map(s=>[e(s.ref),e(s.description)+'<br>'+e(s.notes)+(!Number.isFinite(s.rate)||!Number.isFinite(s.budget)?'<br><strong class="error">BOQ pricing needs review before RFQ</strong>':''),s.qty+' '+e(s.unit),photo(s.before,'Before')+photo(s.after,'After'),e(s.result||'Pending')])):'')+
    (c.published?button('inspectionReport','Inspection report')+' ':'')+(c.award?button('clientQuote','DP World quotation · Print PDF')+' '+button('tenantQuote','Tenant quotation · Print PDF')+' ':'')+
    (c.wcr?button('completion',c.step===11?'Final WCR':'Partial / draft WCR'):'')+
    '<details><summary>Activity history</summary><ul>'+c.history.map(h=>'<li>'+e(new Date(h.time).toLocaleString('en-AE',{timeZone:'Asia/Dubai'}))+' · '+e(h.event)+'</li>').join('')+'</ul></details></article>';
  if ($('snag')) {
    const fields=$('snag').elements;
    const resultList=$('scopeResults');
    const status=$('scopeStatus');
    const applyScope=line=>{
      fields.scopeMatch.value=line?.ref||'';
      fields.ref.value=line?.ref||'';
      fields.unit.value=line?.unit||'';
      fields.unit.readOnly=Boolean(line?.unit);
      $('ratePreview').textContent=line
        ? line.description+' · Vendor Budget '+(Number.isFinite(line.budget)?money(line.budget):'requires review')+' · ABFM BOQ Price '+(Number.isFinite(line.rate)?money(line.rate):'requires review')
        : '';
      for(const button of resultList.children)button.setAttribute('aria-pressed',String(button.dataset.ref===line?.ref));
    };
    const showMatches=()=>{
      applyScope(null);
      resultList.replaceChildren();
      const query=fields.scopeSearch.value.trim();
      const {matches,partial}=findScopes(catalog,query);
      const demoHint=catalog===demoBoq?' Only demo items are loaded. Import ABFM_Consolidated_BOQ.xlsx to search your BOQ.':'';
      status.textContent=matches.length
        ? matches.length+(partial?' related scope(s). Select the correct line.':' matching scope(s).')+demoHint
        : (query?'No matching scope. Try a shorter phrase.':'Type a few words from the scope.')+demoHint;
      for(const line of matches.slice(0,30)){
        const result=document.createElement('button');
        result.type='button';
        result.className='secondary';
        result.dataset.ref=line.ref;
        result.setAttribute('aria-pressed','false');
        result.textContent=line.description+' · '+line.ref+(line.unit?' · '+line.unit:'');
        result.onclick=()=>applyScope(line);
        resultList.append(result);
      }
      if(matches.length>30)status.textContent+=' Showing the first 30. Refine the search to narrow the list.';
      if(matches.length===1&&!partial)applyScope(matches[0]);
    };
    fields.scopeSearch.addEventListener('input',showMatches);
    fields.scopeSearch.addEventListener('keydown',event=>{
      if(event.key==='Enter'){
        event.preventDefault();
        resultList.firstElementChild?.focus();
      }
    });
    showMatches();
  }
  if ($('bid')) {
    const fields=$('bid').elements;
    const inputs=c.snags.map((_,i)=>fields['rate'+i]);
    const budgets=c.snags.map(s=>vendorBudget(s,catalog));
    const drafts=new Map();
    let supplier=fields.supplier.value;
    const loadRates=()=>{
      const rahati=supplier==='Rahati Bayti';
      $('rahatiPrintOptions').hidden=!rahati;
      const saved=drafts.get(supplier);
      inputs.forEach((input,i)=>{input.value=saved?.[i]??(rahati?budgets[i]??'':'');});
      const missing=budgets.filter(rate=>rate===null).length;
      $('bidBudgetStatus').textContent=rahati
        ? 'Rates start from Vendor Budget and can be edited.'+(missing?' '+missing+' line(s) have no single usable Vendor Budget. Check the workbook.':'')
        : 'Enter the rates quoted by '+supplier+'.';
    };
    fields.supplier.onchange=()=>{
      drafts.set(supplier,inputs.map(input=>input.value));
      supplier=fields.supplier.value;
      loadRates();
    };
    loadRates();
  }
  if ($('previewRahati')) $('previewRahati').onclick=()=>showRahatiQuotation(c,$('bid'));
  bind('vendorReturn',v=>importRahatiBid(c,v.quotation));
  bind('assign',v=>{Object.assign(c,v);move(c,1);});
  bind('snag',async v=>{
    const line=catalog.find(x=>x.ref===v.scopeMatch);
    if(!line)throw Error('Select a matching scope from the search results.');
    const unit=line.unit||v.unit.trim();
    if(!unit)throw Error('Enter the unit of measure for this BOQ scope.');
    if(!Number.isFinite(Number(v.qty))||Number(v.qty)<=0)throw Error('Enter a measured quantity greater than zero.');
    c.snags.push({...line,unit,location:v.location,notes:v.notes,priority:v.priority,qty:Number(v.qty),before:await readPhoto(v.before)});
    log(c,'Engineer confirmed '+line.ref);
  });
  bind('confirm',()=>{c.published=true;move(c,2);});
  bind('no-work',()=>{c.published=true;c.noWork=true;log(c,'No reinstatement required');move(c,11);});
  bind('rfq',v=>{
    for(const snag of c.snags){
      if(Number.isFinite(snag.budget)&&Number.isFinite(snag.rate))continue;
      const line=catalog.find(item=>item.ref===snag.ref);
      if(!Number.isFinite(snag.budget))snag.budget=line?.budget??null;
      if(!Number.isFinite(snag.rate))snag.rate=line?.rate??null;
      if(!Number.isFinite(snag.budget)||!Number.isFinite(snag.rate))throw Error(snag.ref+' needs a numeric Vendor Budget and ABFM BOQ Price before RFQ. Correct the workbook and reimport it.');
    }
    c.rfq=v;
    move(c,3);
  });
  bind('bid',v=>recordBid(c,v.supplier,v.reference,c.snags.map((_,i)=>readRate(v['rate'+i]))));
  bind('award',v=>{
    const index=Number(v.bid), bid=c.bids[index];
    if(!quotationAllowed(c,bid))throw Error(priceGateMessage);
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
