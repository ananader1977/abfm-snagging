'use strict';
const $ = id => document.getElementById(id);
const escape = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[c]);
const steps = ['Received','Inspection Assigned','Snags Confirmed','RFQ Issued','Quote Received','CS Approval','Client Submission','Client Approval','Authorized','In Progress','Reinspection','Closed'];
const suppliers = ['Rahati Bayti','Guardian'];
const money = n => new Intl.NumberFormat('en-AE',{style:'currency',currency:'AED'}).format(n);
const amount = (price, quantity) => Math.round(price * quantity * 100) / 100;
const duration = subtotal => subtotal < 25500 ? 6 : subtotal <= 42500 ? 10 : null;
const total = c => c.snags.reduce((sum,s) => sum+Math.round(amount(s.rate,s.qty)*100),0)/100;
const storeKey = 'abfm-snagging-demo-1';
const catalogKey='abfm-boq-rate-card-v1';
let cases=[],catalog=null,selected,revision=null;
let writePending=false,formEdited=false;
const log = (c, event) => c.history.unshift({event, time:new Date().toISOString()});
const move = (c, step) => { c.step=step; log(c,steps[step]); };

function deviceRecords(){
  return {cases:JSON.parse(localStorage.getItem(storeKey)||'[]'),catalog:JSON.parse(localStorage.getItem(catalogKey)||'null')};
}
async function stateRequest(path,method='GET',body){
  const response=await fetch(path,{method,cache:'no-store',...(body?{headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}:{})});
  const result=await response.json().catch(()=>null);
  if(!response.ok)throw Error(result?.error||'The server did not confirm the save. Try again.');
  if(!result?.state||!Number.isSafeInteger(result.revision))throw Error('The server returned an incomplete response.');
  return result;
}
function acceptState(result,redraw=true){
  const existing=new Map(cases.map(item=>[item.id,item]));
  cases=result.state.cases.map(item=>{
    const local=existing.get(item.id);
    if(!local)return item;
    for(const key of Object.keys(local))if(!Object.hasOwn(item,key))delete local[key];
    return Object.assign(local,item);
  });
  catalog=result.state.catalog;
  revision=result.revision;
  selected=cases.some(c=>c.id===selected)?selected:cases[0]?.id;
  if(redraw){formEdited=false;render();}
}
async function save(path='/api/state',data={cases,catalog},redraw=true){
  if(revision===null)throw Error('Load the online records before saving.');
  if(writePending)throw Error('Another save is in progress. Try again.');
  writePending=true;
  try{
    acceptState(await stateRequest(path,'PUT',{revision,state:data}),redraw);
    $('syncStatus').textContent='Saved to the server.';
  }finally{writePending=false;}
}
async function refreshState(){
  if(writePending)return;
  const result=await stateRequest('/api/state');
  if(!writePending&&(revision===null||result.revision>revision))acceptState(result);
  $('syncStatus').textContent='Connected to the server.';
}
async function startOnline(){
  const status=$('syncStatus'), migrate=$('migrateDevice'), refresh=$('refreshCases');
  $('new').disabled=true;
  $('boqFile').disabled=true;
  let local=null;
  try{local=deviceRecords();}
  catch{status.textContent='This browser has local data that could not be read. Keep it intact for recovery.';}
  migrate.hidden=false;
  migrate.onclick=async ()=>{
    migrate.disabled=true;
    try{
      if(!local)throw Error('This browser could not read its stored records. Keep the original browser profile and its site data intact.');
      if(!local.cases.length&&!local.catalog?.length){
        status.textContent='No older records were found in this browser. Open this page on the desktop browser that contains the original records.';
        return;
      }
      await refreshState();
      await save('/api/migration',local);
      status.textContent='Migration verified against the server response. The browser copy was preserved.';
    }catch(error){status.textContent=error.message;}
    finally{migrate.disabled=false;}
  };
  refresh.onclick=async ()=>{
    try{await refreshState();}
    catch(error){status.textContent=error.message;}
  };
  try{await refreshState();}
  catch(error){status.textContent=error.message;}
  document.addEventListener('input',event=>{if(event.target.closest('form'))formEdited=true;});
  setInterval(()=>{
    if(!document.hidden&&!formEdited&&!writePending&&!document.querySelector('dialog[open]'))refreshState().catch(error=>{status.textContent=error.message;});
  },12000);
}
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
    try { await handler(event==='submit'?Object.fromEntries(new FormData(element)):{}); await save(); }
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

const activeBoq=()=>catalog||[];
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
  return catalog;
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
function rahatiBudgetNotice(c,rates,budgets) {
  const ready=c.snags.length>0&&c.snags.every(line=>Number.isFinite(line.rate)&&Number.isFinite(line.qty)&&line.qty>0);
  const sellingCents=ready?cents(total(c)):null;
  if(!Number.isSafeInteger(sellingCents)||sellingCents<=0)return {text:'The overall target budget is unavailable for this quotation.',over:false};
  const target=Math.round(sellingCents*.79);
  const targetText='Overall target budget: '+money(target/100)+' before VAT.';
  if(rates.some(rate=>rate===null))return {text:targetText+' Enter all rates to check your quotation.',over:false};
  const quoted=c.snags.reduce((sum,line,i)=>sum+cents(amount(rates[i],line.qty)),0);
  const over=quoted>target;
  const changed=budgets.every(Number.isFinite)&&quoted!==c.snags.reduce((sum,line,i)=>sum+cents(amount(budgets[i],line.qty)),0);
  const result=over?'Your quotation exceeds the target budget. Please review the rates before submitting.':
    changed?'Your quotation differs from the original budget and is within the overall target.':'Your quotation is within the overall target.';
  return {text:targetText+' Your subtotal: '+money(quoted/100)+'. '+result,over};
}
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


function dpwQuotationWorkbookData(c){
  const fields=quotationFields(c,false),rows=[],styleCells={},merged=['C1:D1','C2:D2','C3:D3','C5:H5','A8:C10','A13:C14'];
  const put=(row,col,value,style)=>{rows[row-1]??=Array(8).fill('');rows[row-1][col-1]=value;if(style)styleCells[String.fromCharCode(64+col)+row]=style;};
  const label=(cell,text)=>{const m=cell.match(/^([A-H])(\d+)$/);put(Number(m[2]),m[1].charCodeAt(0)-64,text,3);};
  const value=(cell,text)=>{const m=cell.match(/^([A-H])(\d+)$/);put(Number(m[2]),m[1].charCodeAt(0)-64,text||'',4);};
  const left=(row,name,val)=>{label('A'+row,name);value('C'+row,val);};
  const right=(row,name,val)=>{label('G'+row,name);value('H'+row,val);};
  left(1,'Client Name:',fields.client);right(1,'Ref. No.',fields.reference);
  left(2,'Property Name:',fields.property);right(2,'Date',fields.date.split('-').reverse().join('/'));
  left(3,'Contact Person:',fields.contact);right(3,'Task ID.',fields.task);
  left(4,'Works Location:',fields.location);
  label('A5','Subject:');value('C5',fields.subject);
  label('A7','Works Requirement:');right(7,'Quotation Validity:',fields.validity);
  value('A8',fields.requirement);
  label('A12','Additional Information:');right(8,'Materials Delivery Period:',fields.delivery);
  right(9,'Works Completion Period:',fields.completion);
  right(10,'Warranty (as applicable):',fields.warranty);
  right(11,'Urgency of Works:',fields.urgency);right(12,'Payment Terms:',fields.payment);
  value('A13',fields.additional);
  const headerRow=15,headers=['SN','BOQ Ref Number','Description','Unit','Qty','Unit Price','SubTotal','Total'];
  rows[headerRow-1]=headers;for(let col=1;col<=8;col++)styleCells[String.fromCharCode(64+col)+headerRow]=1;
  c.snags.forEach((snag,index)=>{
    const row=headerRow+index+1,subtotal=Math.round(amount(snag.rate,snag.qty)*100)/100;
    rows[row-1]=[index+1,snag.ref,snag.description,snag.unit,snag.qty,snag.rate,subtotal,subtotal];
    for(let col=1;col<=8;col++)styleCells[String.fromCharCode(64+col)+row]=col===1||col===5||col>=6?2:4;
  });
  const subtotal=total(c),vat=amount(subtotal,.05);
  const totals=[['Total Value',subtotal],['Discount (if applicable)',0],['Total after Discount',subtotal],['5% Value Added Tax (VAT)',vat],['Grand Total, inclusive of VAT',subtotal+vat]];
  totals.forEach(([name,number],offset)=>{
    const row=firstTotal+offset;rows[row-1]=[name,'','','','','','',number];
    styleCells['A'+row]=offset===4?5:3;styleCells['H'+row]=offset===4?6:2;
  });
  const firstTotal=headerRow+c.snags.length+1;
  totals.forEach((_,offset)=>merged.push('A'+(firstTotal+offset)+':G'+(firstTotal+offset)));
  const remarks=firstTotal+totals.length+1;
  label('A'+remarks,'Remarks:');value('A'+(remarks+1),fields.remarks);
  for(const row of [1,2,3,4,5,7,8,9,10,11,12,13,14,remarks,remarks+1]){
    rows[row-1]??=Array(8).fill('');
    for(let col=1;col<=8;col++){
      const ref=String.fromCharCode(64+col)+row;
      if(!styleCells[ref])styleCells[ref]=4;
    }
  }
  for(let col=1;col<=8;col++)styleCells[String.fromCharCode(64+col)+remarks]=3;
  merged.push('A'+(remarks+1)+':H'+(remarks+1));
  return {template:'dpw',lines:rows.map(row=>row||Array(8).fill('')),width:[3.71,8.14,40.57,5.57,4.29,21.57,9.71,29.14],merged,styleCells,pictures:[],classNames:new Set(),remarksRow:remarks};
}
function quoteWorkbookData(sheet) {
  const heading=sheet.querySelector('h2').textContent.trim();
  const lines=[[heading]];
  const pictures=[];
  const classNames=new Set();
  const append=(values,format)=>{lines.push(values);if(format)classNames.add(lines.length);};
  for(const node of sheet.querySelectorAll('.quote-meta dt,.quote-subject dt,.quote-terms dt')){
    append([node.textContent.trim(),node.nextElementSibling.textContent.trim()]);
  }
  for(const node of sheet.querySelectorAll('.rahati-identifiers strong')){
    append([node.textContent.trim()]);
  }
  for(const node of sheet.querySelectorAll('.rahati-meta > div')){
    append(Array.from(node.children,child=>child.textContent.trim()));
  }
  const numericColumns=/^(?:#|sn|qty|unit\s*rate|unit\s*price|subtotal|total|amount)$/i;
  for(const table of sheet.querySelectorAll('table')){
    append([]);
    const totals=table.matches('.quote-totals,.rahati-totals');
    const headers=Array.from(table.tHead?.rows[0]?.cells||[],cell=>cell.textContent.trim());
    for(const row of table.rows){
      const header=row.parentElement.tagName==='THEAD';
      const values=Array.from(row.cells,(cell,index)=>{
        const image=cell.querySelector('img');
        if(image){
          const source=image.getAttribute('src');
          if(/^data:image\/(?:jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/.test(source||'')){
            pictures.push({row:lines.length,column:index,source});
          }
          return '';
        }
        const value=cell.innerText.trim();
        const numeric=!header&&(totals?index===1:numericColumns.test(headers[index]||''));
        const clean=value.replace(/^AED\s*/i,'').replace(/,/g,'');
        return numeric&&/^\d+(?:\.\d+)?$/.test(clean)?Number(clean):value;
      });
      append(values,header || /^(?:Grand Total|Total Including VAT)/.test(String(values[0])));
    }
  }
  for(const node of sheet.querySelectorAll('.quote-remarks,.rahati-terms > div,.rahati-remarks')){
    append([node.innerText.trim()]);
  }
  return {lines,classNames,pictures};
}

function quotationZip(parts) {
  const encoder=new TextEncoder();
  const chunks=[], directory=[];
  const table=Array.from({length:256},(_,i)=>{
    for(let j=0;j<8;j++)i=(i>>>1)^((i&1)?0xedb88320:0);
    return i;
  });
  let position=0, directoryLength=0;
  for(const [path,content] of Object.entries(parts)){
    const name=encoder.encode(path);
    const bytes=typeof content==='string'?encoder.encode(content):content;
    let crc=0xffffffff;
    for(const byte of bytes)crc=(crc>>>8)^table[(crc^byte)&255];
    crc=(crc^0xffffffff)>>>0;
    const local=new Uint8Array(30+name.length);
    const entry=new Uint8Array(46+name.length);
    const l=new DataView(local.buffer), d=new DataView(entry.buffer);
    l.setUint32(0,0x04034b50,true);
    l.setUint16(4,20,true);
    l.setUint16(12,33,true);
    l.setUint32(14,crc,true);
    l.setUint32(18,bytes.length,true);
    l.setUint32(22,bytes.length,true);
    l.setUint16(26,name.length,true);
    local.set(name,30);
    d.setUint32(0,0x02014b50,true);
    d.setUint16(4,20,true);
    d.setUint16(6,20,true);
    d.setUint16(14,33,true);
    d.setUint32(16,crc,true);
    d.setUint32(20,bytes.length,true);
    d.setUint32(24,bytes.length,true);
    d.setUint16(28,name.length,true);
    d.setUint32(42,position,true);
    entry.set(name,46);
    chunks.push(local,bytes);
    directory.push(entry);
    position+=local.length+bytes.length;
    directoryLength+=entry.length;
  }
  const end=new Uint8Array(22), fields=new DataView(end.buffer);
  fields.setUint32(0,0x06054b50,true);
  fields.setUint16(8,directory.length,true);
  fields.setUint16(10,directory.length,true);
  fields.setUint32(12,directoryLength,true);
  fields.setUint32(16,position,true);
  return new Blob([...chunks,...directory,end],{type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'});
}

function buildQuotationWorkbook(data) {
  const xml=value=>e(String(value).replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g,''));
  const ns='http://schemas.openxmlformats.org/spreadsheetml/2006/main';
  const relationships=entries=>'<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'+entries.map(([id,type,target])=>'<Relationship Id="rId'+id+'" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/'+type+'" Target="'+target+'"/>').join('')+'</Relationships>';
  const parts={
    '_rels/.rels':relationships([[1,'officeDocument','xl/workbook.xml']]),
    'xl/_rels/workbook.xml.rels':relationships([[1,'worksheet','worksheets/sheet1.xml'],[2,'styles','styles.xml']]),
    'xl/workbook.xml':'<workbook xmlns="'+ns+'" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Quotation" sheetId="1" r:id="rId1"/></sheets></workbook>',
    'xl/styles.xml':data.template==='dpw'
      ?'<styleSheet xmlns="'+ns+'"><fonts count="2"><font><sz val="9"/><name val="Tahoma"/></font><font><b/><sz val="9"/><name val="Tahoma"/></font></fonts><fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills><borders count="2"><border/><border><left style="thin"><color rgb="FF000000"/></left><right style="thin"><color rgb="FF000000"/></right><top style="thin"><color rgb="FF000000"/></top><bottom style="thin"><color rgb="FF000000"/></bottom><diagonal/></border></borders><cellStyleXfs count="1"><xf fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="7"><xf fontId="0" fillId="0" borderId="0" xfId="0" applyAlignment="1"><alignment wrapText="1" vertical="top"/></xf><xf fontId="1" fillId="0" borderId="1" xfId="0" applyFont="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center" wrapText="1"/></xf><xf numFmtId="4" fontId="0" fillId="0" borderId="1" xfId="0" applyNumberFormat="1" applyBorder="1" applyAlignment="1"><alignment horizontal="right" vertical="center"/></xf><xf fontId="1" fillId="0" borderId="1" xfId="0" applyFont="1" applyBorder="1" applyAlignment="1"><alignment vertical="center" wrapText="1"/></xf><xf fontId="0" fillId="0" borderId="1" xfId="0" applyBorder="1" applyAlignment="1"><alignment vertical="center" wrapText="1"/></xf><xf fontId="1" fillId="0" borderId="1" xfId="0" applyFont="1" applyBorder="1" applyAlignment="1"><alignment horizontal="left" vertical="center"/></xf><xf numFmtId="4" fontId="1" fillId="0" borderId="1" xfId="0" applyFont="1" applyNumberFormat="1" applyBorder="1" applyAlignment="1"><alignment horizontal="right" vertical="center"/></xf></cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>'
      :'<styleSheet xmlns="'+ns+'"><fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><color rgb="FFFFFFFF"/><sz val="11"/><name val="Calibri"/></font></fonts><fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FF173A63"/></patternFill></fill></fills><borders count="1"><border/></borders><cellStyleXfs count="1"><xf fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="4"><xf fontId="0" fillId="0" borderId="0" xfId="0" applyAlignment="1"><alignment wrapText="1" vertical="top"/></xf><xf fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1" applyAlignment="1"><alignment wrapText="1"/></xf><xf numFmtId="4" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/><xf numFmtId="4" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1" applyNumberFormat="1"/></cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>'
  };
  const drawings=[];
  const pictureRows=new Set(data.pictures.map(item=>item.row));
  for(const {row,column,source} of data.pictures){
    const [uri,encoded]=source.split(',');
    const extension=uri.includes('jpeg')?'jpeg':uri.includes('png')?'png':'webp';
    if(extension==='webp')continue;
    const id=drawings.length+1, filename='photo'+id+'.'+extension;
    parts['xl/media/'+filename]=Uint8Array.from(atob(encoded),char=>char.charCodeAt(0));
    drawings.push({id,row,column,filename});
  }
  if(drawings.length){
    parts['xl/worksheets/_rels/sheet1.xml.rels']=relationships([[1,'drawing','../drawings/drawing1.xml']]);
    parts['xl/drawings/_rels/drawing1.xml.rels']=relationships(drawings.map(d=>[d.id,'image','../media/'+d.filename]));
    parts['xl/drawings/drawing1.xml']='<xdr:wsDr xmlns:xdr="http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">'+drawings.map(({id,row,column})=>
      '<xdr:oneCellAnchor><xdr:from><xdr:col>'+column+'</xdr:col><xdr:colOff>28575</xdr:colOff><xdr:row>'+row+'</xdr:row><xdr:rowOff>28575</xdr:rowOff></xdr:from><xdr:ext cx="990600" cy="666750"/><xdr:pic><xdr:nvPicPr><xdr:cNvPr id="'+id+'" name="Before photo '+id+'"/><xdr:cNvPicPr/></xdr:nvPicPr><xdr:blipFill><a:blip r:embed="rId'+id+'"/><a:stretch><a:fillRect/></a:stretch></xdr:blipFill><xdr:spPr><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></xdr:spPr></xdr:pic><xdr:clientData/></xdr:oneCellAnchor>').join('')+'</xdr:wsDr>';
  }
  parts['[Content_Types].xml']='<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Default Extension="jpeg" ContentType="image/jpeg"/><Default Extension="png" ContentType="image/png"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>'+
    (drawings.length?'<Override PartName="/xl/drawings/drawing1.xml" ContentType="application/vnd.openxmlformats-officedocument.drawing+xml"/>':'')+'</Types>';
  const width=data.width||[42,58,25,17,17,17,22,25,25];
  const sheetRows=data.lines.map((line,i)=>{
    const row=i+1, bright=i===0||data.classNames.has(row);
    const height=pictureRows.has(i)?58:Math.min(180,Math.max(18,...line.map((v,j)=>15*Math.ceil(String(v).length/(width[j]||17)))));
    return '<row r="'+row+'" ht="'+height+'" customHeight="1">'+line.map((value,j)=>{
      const ref=String.fromCharCode(65+j)+row;
      const style=data.template==='dpw'?(data.styleCells?.[ref]??(typeof value==='number'?2:0)):(bright?(typeof value==='number'?3:1):(typeof value==='number'?2:0));
      if(typeof value==='number')return '<c r="'+ref+'" s="'+style+'"><v>'+value+'</v></c>';
      return '<c r="'+ref+'" s="'+style+'" t="inlineStr"><is><t xml:space="preserve">'+xml(value)+'</t></is></c>';
    }).join('')+'</row>';
  }).join('');
  parts['xl/worksheets/sheet1.xml']='<worksheet xmlns="'+ns+'" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><dimension ref="A1:'+String.fromCharCode(64+width.length)+data.lines.length+'"/><cols>'+
    width.map((n,i)=>'<col min="'+(i+1)+'" max="'+(i+1)+'" width="'+n+'" customWidth="1"/>').join('')+
    '</cols><sheetData>'+sheetRows+'</sheetData>'+
    (data.merged?.length?'<mergeCells count="'+data.merged.length+'">'+data.merged.map(ref=>'<mergeCell ref="'+ref+'"/>').join('')+'</mergeCells>':'')+
    '<pageMargins left="0.3" right="0.3" top="0.4" bottom="0.4" header="0.2" footer="0.2"/>'+
    (data.template==='dpw'?'<pageSetup paperSize="9" orientation="portrait" fitToWidth="1" fitToHeight="0"/>':'')+
    (drawings.length?'<drawing r:id="rId1"/>':'')+'</worksheet>';
  return quotationZip(parts);
}

function downloadExcelFile(data,filename) {
  const url=URL.createObjectURL(buildQuotationWorkbook(data));
  const link=document.createElement('a');
  link.href=url;
  link.download=filename.replace(/[<>:"/\\|?*\u0000-\u001f]/g,'-')+'.xlsx';
  link.click();
  setTimeout(()=>URL.revokeObjectURL(url),1000);
}


const rahatiFieldSpecs=[
  ['reference','Quotation reference',true],['date','Date',true,'date'],['recipient','To',true],
  ['address','Address'],['phone','Telephone'],['subject','Quotation For',true],
  ['requester','Requester Name'],['location','Location'],['task','Task ID'],
  ['response','Service Provider Response',false,'textarea'],['instructions','Site instructions',false,'textarea'],
  ['notes','General Notes & Special Conditions',false,'textarea'],['payment','Terms of Payment'],
  ['remarks','Remarks',false,'textarea']
];
function rahatiQuotationFields(c,reference,template) {
  return {
    date:quotationFields(c,false).date,recipient:'Al Bonian FM',address:c.site||'',phone:'',
    subject:'Reinstatement works · '+c.site,requester:c.contact||'',location:c.site||'',
    task:c.inspection||c.id,response:'Quoted BOQ items are listed below',instructions:c.rfq?.instructions||'',
    notes:'As agreed for this quotation.',payment:'As agreed.',remarks:'',
    ...c.rahatiQuotationDetails?.[template],reference
  };
}
function downloadQuotationExcel(dialog,filename,c,tenant) {
  const data=c&&!tenant?dpwQuotationWorkbookData(c):quoteWorkbookData(dialog.querySelector('.rahati-sheet,.quote-sheet'));
  downloadExcelFile(data,filename);
}
function quotationSummaryData(c) {
  const awarded=c.bids[c.awardedBid];
  const bid=awarded||c.bids.at(-1);
  if(!bid||!Number.isFinite(bid.total)||!c.snags.every(line=>Number.isFinite(line.rate)))return null;
  return {lines:[
    ['Quotation summary'],
    ['Quotation reference','Case ID','Client','Property / location','Supplier','Supplier quotation reference','Supplier selection','Total supplier cost (AED, excl. VAT)','Total ABFM selling price (AED, excl. VAT)'],
    [quotationFields(c,false).reference,c.id,c.client,c.site,bid.supplier,bid.reference,awarded?'Awarded':'Latest quotation received',bid.total,total(c)]
  ],classNames:new Set([2]),pictures:[]};
}

function rahatiQuoteTotals(c,rates) {
  const subtotalCents=c.snags.reduce((sum,line,i)=>sum+cents(amount(rates[i],line.qty)),0);
  const vatCents=Math.round(subtotalCents*.05);
  return {subtotalCents,vatCents,totalCents:subtotalCents+vatCents};
}
function rahatiExcelSummary(c,reference,rates,template) {
  const fields=rahatiQuotationFields(c,reference,template);
  const {subtotalCents,vatCents,totalCents}=rahatiQuoteTotals(c,rates);
  return {lines:[
    ['Rahati Bayti quotation summary'],
    ['Rahati quotation reference','ABFM case ID','To','Site / address','Date','Subtotal excluding VAT (AED)','VAT (AED)','Total including VAT (AED)'],
    [fields.reference,c.id,fields.recipient,fields.address,fields.date,subtotalCents/100,vatCents/100,totalCents/100]
  ],classNames:new Set([2]),pictures:[]};
}
function rahatiQuotationDocument(c,reference,rates,template) {
  const detailed=template==='detailed';
  const details=rahatiQuotationFields(c,reference,template);
  const date=details.date.split('-').reverse().join('/');
  const logo=globalThis.brand?.rahati || 'rahati.png';
  const {subtotalCents,vatCents,totalCents}=rahatiQuoteTotals(c,rates);
  const meta=(label,value,arabic)=>'<div><strong>'+label+'</strong><span>'+e(value||'–')+'</span><b lang="ar" dir="rtl">'+arabic+'</b></div>';
  const headings=detailed?['SN','Item description','Photos','Qty','Unit','Unit rate','Amount']:['#','Description','Unit','Qty','Unit rate','Total'];
  const items=c.snags.map((line,i)=>{
    const description='<strong>'+e(line.ref)+'</strong><br>'+e(line.description);
    const rate=money(rates[i]), total=money(amount(rates[i],line.qty));
    return detailed?[i+1,description,photo(line.before,'Before'),e(line.qty),e(line.unit),rate,total]
      :[i+1,description,e(line.unit),e(line.qty),rate,total];
  });
  const technical=detailed?'<h3>General Information</h3>'+
    rows(['Requester Name','Location','Task ID'],[[e(details.requester||'–'),e(details.location||'–'),e(details.task||'–')]])+
    '<h3>Technical Qualification Sheet</h3>'+
    rows(['SN','Description','Service Provider Response'],[[1,'Scope of work as per RFQ',e(details.response||'–')],[2,'Site instructions',e(details.instructions||'–')]]):'';
  return '<section class="rahati-sheet '+(detailed?'rahati-detailed':'rahati-standard')+'">'+
    '<div class="rahati-heading"><img src="'+e(logo)+'" alt="Rahati Bayti Technical Services"><div><h2 id="rahati-quote-title">QUOTATION</h2><div lang="ar" dir="rtl">عرض أسعار</div></div></div>'+
    '<div class="rahati-identifiers"><strong>No. '+e(details.reference)+'</strong><strong>Date: '+e(date)+'</strong></div>'+
    '<div class="rahati-meta">'+meta('To:',details.recipient,'حضرة')+meta('Address:',details.address,'العنوان')+meta('Tel.:',details.phone,'هاتف')+
    meta('Quotation For:',details.subject,'عرض لزوم')+'</div>'+
    (detailed?'<p class="rahati-rfq">Request For Quotation (RFQ)<br>Procurement and Logistics Department</p>':'')+
    technical+'<div class="rahati-items">'+rows(headings,items)+'</div>'+
    '<table class="rahati-totals"><tbody>'+
    [['Total Excluding VAT',subtotalCents],['5% VAT',vatCents],['Total Including VAT',totalCents]].map(([label,value])=>'<tr><th scope="row">'+label+'</th><td>'+money(value/100)+'</td></tr>').join('')+
    '</tbody></table><div class="rahati-terms"><div><strong>General Notes &amp; Special Conditions</strong><p>'+e(details.notes)+'</p></div>'+
    '<div><strong>Terms of Payment</strong><p>'+e(details.payment)+'</p></div><div><strong>Authorized Stamp</strong></div></div>'+
    '<div class="rahati-remarks"><strong>Remarks:</strong><div>'+e(details.remarks)+'</div></div></section>';
}
function showRahatiQuotation(c,bidForm) {
  const formData=new FormData(bidForm);
  if (formData.get('supplier')!=='Rahati Bayti' || !bidForm.reportValidity())return;
  let reference=String(formData.get('reference')||'').trim();
  const template=formData.get('rahatiTemplate')==='standard'?'standard':'detailed';
  const rates=c.snags.map((_,i)=>readRate(formData.get('rate'+i)));
  if(!reference || rates.some(rate=>rate===null)){
    $('error').textContent='Enter a quotation reference and a valid rate for each item.';
    return;
  }
  const dialog=document.createElement('dialog');
  dialog.className='rahati-quotation-dialog';
  dialog.setAttribute('aria-labelledby','rahati-quote-title');
  const renderSheet=()=>rahatiQuotationDocument(c,reference,rates,template);
  const specs=rahatiFieldSpecs.filter(([key])=>template==='detailed'||!['requester','location','task','response','instructions'].includes(key));
  dialog.innerHTML=renderSheet()+quotationEditor(specs,rahatiQuotationFields(c,reference,template))+
    '<button class="edit-quotation secondary" type="button">Edit quotation details</button> <span class="quote-save-status" role="status"></span> '+
    '<button class="print" type="button">Print / Save PDF</button> <button class="excel secondary" type="button">Download Excel</button> <button class="vendor-summary secondary" type="button">Download Excel summary</button> <button class="dismiss secondary" type="button">Close</button>';
  document.body.append(dialog);
  dialog.querySelector('.print').onclick=()=>window.print();
  dialog.querySelector('.excel').onclick=()=>downloadQuotationExcel(dialog,reference+'-Rahati-'+template);
  dialog.querySelector('.vendor-summary').onclick=()=>downloadExcelFile(rahatiExcelSummary(c,reference,rates,template),reference+'-Rahati-Summary');
  wireQuotationEditor(dialog,renderSheet,async updates=>{
    const previous=c.rahatiQuotationDetails;
    c.rahatiQuotationDetails={...previous,[template]:updates};
    try{await save('/api/state',{cases,catalog},false);}
    catch(error){c.rahatiQuotationDetails=previous;throw Error('Unable to save quotation details: '+error.message);}
    reference=updates.reference;
    bidForm.elements.reference.value=reference;
    return 'Quotation details saved.';
  });
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


const inspectionHeaderFields=[
  ['building','Building Name',true],['location','Location',true],['date','Survey Date',true,'date'],
  ['engineer','Inspector Name',true],['lessee','Lessee Name'],['ackDate','Acknowledgement Date',false,'date'],
  ['remarks','Inspection Remarks',false,'textarea']
];
const inspectionItems=c=>c.snags.length?c.snags:[{location:c.site,notes:'No reinstatement work is required.'}];
function inspectionFields(c) {
  const fields={building:c.building||c.site,location:c.site,date:c.date||'',engineer:c.engineer||'',lessee:'',ackDate:'',remarks:''};
  inspectionItems(c).forEach((snag,i)=>{
    fields['location'+i]=snag.location||'';
    fields['notes'+i]=snag.notes||'';
    fields['priority'+i]=snag.priority||'';
  });
  return {...fields,...c.inspectionDetails};
}
function inspectionEditor(c) {
  const items=inspectionItems(c).flatMap((_,i)=>[
    ['location'+i,'Item '+(i+1)+' location',true],
    ['notes'+i,'Item '+(i+1)+' comment / concern',false,'textarea'],
    ['priority'+i,'Item '+(i+1)+' priority']
  ]);
  return quotationEditor([...inspectionHeaderFields,...items],inspectionFields(c),'Edit inspection report');
}
function attachInspectionEditor(dialog,c) {
  wireQuotationEditor(dialog,()=>'<div class="inspection-document">'+inspectionReport(c)+'</div>',async updates=>{
    const old=inspectionFields(c);
    if(!Object.keys(updates).some(key=>updates[key]!==String(old[key]??'')))return '';
    const previous=c.inspectionDetails;
    const history=c.history.slice();
    c.inspectionDetails=updates;
    log(c,'Inspection report details updated');
    try{await save();}
    catch(error){c.inspectionDetails=previous;c.history=history;throw Error('Unable to save inspection details: '+error.message);}
    return 'Inspection report saved.';
  },'.inspection-document');
}
function inspectionReport(c) {
  const details=inspectionFields(c);
  const date=details.date.split('-').reverse().join('/');
  const ackDate=details.ackDate.split('-').reverse().join('/');
  const logo = globalThis.brand?.abfm || 'abfm.jpg';
  const observations=inspectionItems(c).map((snag,i)=>({...snag,location:details['location'+i],notes:details['notes'+i],priority:details['priority'+i]}));
  const pages = [];
  for (let offset = 0; offset < observations.length; offset += 2) {
    pages.push(observations.slice(offset, offset + 2));
  }
  const acknowledgement = '<section class="inspection-signatures"><h3>1. LESSEE ACKNOWLEDGEMENT &amp; SIGNATURES</h3>'+
    (details.remarks?'<p class="inspection-comment"><strong>Remarks:</strong> '+e(details.remarks)+'</p>':'')+
    '<p>I, '+e(details.lessee||'________________________')+', acknowledge the receipt and inspection of the facility as per the conditions outlined in this document.</p>'+
    '<p>Lessee Name &amp; Signature: '+e(details.lessee)+' ________________________________________</p>'+
    '<p>Date: '+e(ackDate||'____________________')+'</p>'+
    '<p>Inspector Name &amp; Signature: '+e(details.engineer)+' ________________________________________</p></section>';
  return pages.map((page,index)=>{
    const observationRows = page.map((s,i)=>'<tr><td>'+(index*2+i+1)+'</td><td>'+
      (s.before ? '<img class="inspection-photo" src="'+e(s.before)+'" alt="Inspection photograph for '+e(s.location)+'">' : '')+
      '</td><td><strong>'+e(s.location)+'</strong><div class="inspection-comment">'+[s.ref,s.description,s.notes].filter(Boolean).map(e).join('<br>')+'</div></td><td>'+e(s.priority || '')+'</td></tr>').join('');
    return '<section class="inspection-sheet"><div class="inspection-heading"><img src="'+e(logo)+'" alt="Al Bonian FM">'+
      '<h2 id="inspection-title-'+index+'">End of Lease Inspection Report</h2></div>'+
      '<div class="inspection-meta"><div><strong>Building Name:</strong> '+e(details.building)+'</div><div><strong>Location:</strong> '+e(details.location)+'</div>'+
      '<div><strong>Survey Date:</strong> '+e(date)+'</div><div><strong>Inspector:</strong> '+e(details.engineer)+'</div>'+
      '<div class="inspection-count">Composed of '+pages.length+(pages.length===1?' Page':' Pages')+'</div></div>'+
      '<table class="inspection-table"><colgroup><col><col><col><col></colgroup>'+
      '<thead><tr><th scope="col">No</th><th scope="col">Area / Photograph</th><th scope="col">Location / Comment / Concern</th><th scope="col">Priority</th></tr></thead>'+
      '<tbody>'+observationRows+'</tbody></table>'+(index===pages.length-1?acknowledgement:'')+'</section>';
  }).join('');
}


const quotationFieldSpecs=[
  ['client','Client Name',true],['property','Property Name',true],['contact','Contact Person'],
  ['location','Works Location',true],['reference','Ref. No.',true],['date','Date',true,'date'],['task','Task ID'],
  ['subject','Subject',true],['requirement','Works Requirement'],['additional','Additional Information'],
  ['validity','Quotation Validity'],['delivery','Materials Delivery Period'],['completion','Works Completion Period'],
  ['warranty','Warranty (as applicable)'],['urgency','Urgency of Works'],['payment','Payment Terms'],['remarks','Remarks',false,'textarea']
];
const quotationKey=tenant=>tenant?'tenant':'client';
function quotationFields(c,tenant) {
  const dateParts=new Intl.DateTimeFormat('en-GB',{timeZone:'Asia/Dubai',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date());
  const part=type=>dateParts.find(item=>item.type===type).value;
  const days=c.days||duration(total(c));
  return {
    client:c.client||'',property:c.building||c.site||'',contact:c.contact||'',location:c.site||'',
    reference:(c.quotationReference||c.id)+(tenant?'-Tenant':''),date:part('year')+'-'+part('month')+'-'+part('day'),
    task:c.inspection||c.reinstatement||c.id,subject:'EOL Reinstatement Works – '+c.site,
    requirement:'End of lease reinstatement',additional:'',validity:'30 Days',delivery:'',
    completion:days?days+' days from order confirmation':'To be agreed',
    warranty:'',urgency:c.priority||'',payment:'As per agreement',remarks:'',
    ...c.quotationDetails?.[quotationKey(tenant)]
  };
}
function quotationEditor(specs,fields,title='Edit quotation details') {
  return '<form class="quotation-editor" hidden><h3>'+e(title)+'</h3><p class="error" role="alert"></p>'+
    specs.map(([key,label,required,type])=>{
      const field=type==='textarea'?'<textarea name="'+key+'" maxlength="2000" rows="3">'+e(fields[key])+'</textarea>'
        : '<input name="'+key+'" type="'+(type||'text')+'"'+(required?' required':'')+' maxlength="500" value="'+e(fields[key])+'">';
      return '<label>'+label+field+'</label>';
    }).join('')+
    '<button type="submit">Save details</button><button type="button" class="cancel-edit secondary">Cancel</button></form>';
}
function wireQuotationEditor(dialog,renderSheet,saveDetails,sheetSelector='.quote-sheet,.rahati-sheet') {
  const editor=dialog.querySelector('.quotation-editor');
  const edit=dialog.querySelector('.edit-quotation');
  const notice=dialog.querySelector('.quote-save-status');
  const print=dialog.querySelector('.print'),excel=dialog.querySelector('.excel');
  const toggle=open=>{
    editor.hidden=!open;
    edit.hidden=open;
    print.disabled=open;
    if(excel)excel.disabled=open;
    const summary=dialog.querySelector('.vendor-summary');
    if(summary)summary.disabled=open;
    if(open){
      notice.textContent='';
      editor.querySelector('input,textarea')?.focus();
    }
  };
  edit.onclick=()=>toggle(true);
  editor.querySelector('.cancel-edit').onclick=()=>{editor.reset();editor.querySelector('.error').textContent='';toggle(false);};
  editor.onsubmit=async event=>{
    event.preventDefault();
    const updates=Object.fromEntries(Array.from(new FormData(editor),([key,value])=>[key,value.trim()]));
    try{
      const result=await saveDetails(updates);
      if(result){
        dialog.querySelector(sheetSelector).outerHTML=renderSheet();
        for(const [key,value] of Object.entries(updates))editor.elements[key].defaultValue=value;
      }
      toggle(false);
      notice.textContent=result||'';
    }catch(error){editor.querySelector('.error').textContent=error.message;}
  };
}
function attachQuotationEditor(dialog,c,tenant) {
  wireQuotationEditor(dialog,()=>quotationDocument(c,tenant),async updates=>{
    if(c.step>=7)throw Error('These quotation details are locked after client submission.');
    const previousFields=quotationFields(c,tenant);
    const changed=Object.keys(updates).filter(key=>updates[key]!==String(previousFields[key]??''));
    if(!changed.length)return '';
    const material=['requirement','additional','validity','delivery','completion','warranty','urgency','payment','remarks'];
    const reapproval=c.step===6&&changed.some(key=>material.includes(key));
    const previous={quotationDetails:c.quotationDetails,step:c.step,history:c.history.slice()};
    c.quotationDetails={...c.quotationDetails,[quotationKey(tenant)]:updates};
    if(reapproval)move(c,5);
    log(c,(tenant?'Tenant':'DP World')+' quotation details updated');
    try{await save();}
    catch(error){
      Object.assign(c,previous);
      throw Error('Unable to save quotation details: '+error.message);
    }
    return reapproval?'Details saved. Updated terms require CS approval before submission.':'Quotation details saved.';
  });
}
function quotationDocument(c,tenant) {
  const details=quotationFields(c,tenant);
  const date=details.date.split('-').reverse().join('/');
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
    '<div class="quote-heading"><img src="'+e(logo)+'" alt="Al Bonian FM"></div>'+
    '<div class="quote-meta"><dl>'+row('Client Name:',details.client)+row('Property Name:',details.property)+
    (tenant?'':row('Contact Person:',details.contact))+row('Works Location:',details.location)+'</dl>'+
    '<dl>'+row('Ref. No.',details.reference)+row('Date',date)+row('Task ID.',details.task)+'</dl></div>'+
    '<dl class="quote-subject">'+row('Subject:',details.subject)+'</dl>'+
    '<div class="quote-terms"><dl>'+row('Works Requirement:',details.requirement)+row('Additional Information:',details.additional)+'</dl>'+
    '<dl>'+row('Quotation Validity:',details.validity)+row('Materials Delivery Period:',details.delivery)+
    row('Works Completion Period:',details.completion)+row('Warranty (as applicable):',details.warranty)+
    row('Urgency of Works:',details.urgency)+row('Payment Terms:',details.payment)+'</dl></div>'+
    '<table class="quote-lines"><colgroup>'+headers.map(()=>'<col>').join('')+'</colgroup>'+
    '<thead><tr>'+headers.map(header=>'<th scope="col">'+header+'</th>').join('')+'</tr></thead><tbody>'+lineRows+'</tbody></table>'+
    '<table class="quote-totals"><tbody>'+totals.map(([label,number])=>'<tr><th scope="row">'+label+'</th><td>'+displayAmount(number)+'</td></tr>').join('')+'</tbody></table>'+
    '<div class="quote-remarks"><strong>Remarks:</strong><div>'+e(details.remarks)+'</div></div>'+
    '<div class="quote-footer"><span>Document Code: ABFM-ADM-QUO-001-2022-00<br>Rev. 0</span><span>Classification: Quotation</span><span>Issue No.: 1 Date: 29 Aug. 2022</span></div></section>';
}

function supplierWcrForm(c) {
  const draft=c.wcrDraft||c.supplierWcr;
  const photoFields=c.snags.map((line,i)=>line.result==='Pass'?'':
    '<fieldset><legend>'+e(line.ref)+' · '+e(line.description)+'</legend>'+
    '<label>After photo <input type="file" name="after'+i+'" accept="image/jpeg,image/png,image/webp"></label>'+
    (draft?.lines[i]?.after||line.after?'<p class="meta">An after photo is saved. Choose a file to replace it.</p>':'')+
    '<label>Work completed / remarks<textarea name="work'+i+'">'+e(draft?.lines[i]?.work||'')+'</textarea></label></fieldset>').join('');
  return form('wcr',field('wcr','Supplier WCR reference','text','value="'+e(draft?.reference||c.wcr||'')+'"')+
    '<label>Report remarks<textarea name="wcrRemarks">'+e(draft?.remarks||'')+'</textarea></label>'+
    field('supplierSign','Supplier signature (type full name)','text','value="'+e(draft?.signature?.name||'')+'"')+
    '<label>Upload handwritten signature (optional)<input name="supplierSignImage" type="file" accept="image/jpeg,image/png,image/webp"></label>'+
    (draft?.signature?.image?'<p class="meta">A signature image is saved.</p>':'')+
    photoFields+button('previewWcr','Save and preview reinspection report'),'Submit supplier WCR for reinspection');
}
async function collectSupplierWcr(c,values,submitting) {
  const previous=c.wcrDraft||c.supplierWcr;
  const reference=String(values.wcr||'').trim();
  if(!reference)throw Error('Enter the supplier WCR reference.');
  const lines=[];
  for(const [i,line] of c.snags.entries()){
    const file=values['after'+i];
    const after=file?.size?await readPhoto(file):previous?.lines[i]?.after||line.after||'';
    if(submitting&&!after&&line.result!=='Pass')throw Error('Add an after photo for '+line.ref+' before submitting.');
    const work=line.result==='Pass'?(previous?.lines[i]?.work||''):String(values['work'+i]||'').trim();
    lines.push({after,work});
  }
  const signer=String(values.supplierSign||'').trim();
  if(submitting&&!signer)throw Error('Enter the supplier signature before submitting.');
  const file=values.supplierSignImage;
  const image=file?.size?await readPhoto(file):previous?.signature?.image||'';
  return {reference,remarks:String(values.wcrRemarks||'').trim(),lines,signature:{name:signer,image}};
}
function reinspectionSignatures(c,submission,verification) {
  const supplier=submission?.signature;
  const engineer=verification?.signature;
  const date=verification?.date?.split('-').reverse().join('/')||'Pending Engineer inspection';
  const signature=(value,label)=>{
    const image=value?.image?'<img class="wcr-signature-image" src="'+e(value.image)+'" alt="'+label+' handwritten signature">':'';
    return '<span>'+e(value?.name||'________________________')+'</span>'+image;
  };
  return '<section class="wcr-signatures"><h3>Reinspection sign-off</h3>'+
    '<p><strong>Date of inspection:</strong> '+e(date)+'</p>'+
    '<p><strong>'+e(c.award||'Rahati Bayti')+' signature:</strong> '+signature(supplier,'Supplier')+'</p>'+
    '<p><strong>ABFM Engineer signature:</strong> '+signature(engineer,'ABFM Engineer')+'</p>'+
    (verification?.engineer?'<p><strong>ABFM Engineer:</strong> '+e(verification.engineer)+'</p>':'')+'</section>';
}
function previewSupplierWcr(c,draft) {
  const dialog=document.createElement('dialog');
  dialog.className='inspection-dialog';
  dialog.setAttribute('aria-labelledby','supplier-wcr-title');
  dialog.innerHTML='<h2 id="supplier-wcr-title">Reinspection report preview</h2>'+
    '<p>Supplier: '+e(c.award)+' · WCR: '+e(draft.reference)+' · Site: '+e(c.site)+'</p>'+
    '<p class="inspection-comment"><strong>Report remarks:</strong> '+e(draft.remarks||'–')+'</p>'+
    rows(['BOQ Ref.','Work details','Before photo','After photo','Supplier remarks'],
      c.snags.map((line,i)=>[e(line.ref),e(line.description),photo(line.before,'Before'),
        photo(draft.lines[i].after,'After')||'Photo pending',e(draft.lines[i].work)]))+
    reinspectionSignatures(c,draft,null)+
    '<p>Draft saved. Return to editing to make changes, then submit it for Engineer reinspection.</p>'+
    '<button type="button">Return to editing</button>';
  document.body.append(dialog);
  dialog.querySelector('button').onclick=()=>dialog.close();
  dialog.addEventListener('close',()=>dialog.remove(),{once:true});
  dialog.showModal();
}
function workCompletionReport(c){
  const final=c.step===11,details=quotationFields(c,false),verification=c.reinspectionVerification||{},supplier=c.supplierWcr?.signature||{};
  const reportDate=verification.date?.split('-').reverse().join('/')||c.submitted||'';
  const sign=(value,label)=>'<div class="client-wcr-sign"><strong>'+label+'</strong><div class="client-wcr-sign-line">'+(value?.image?'<img src="'+e(value.image)+'" alt="'+label+' signature">':'')+'</div><div>Name: '+e(value?.name||'')+'</div><div>Date: '+e(label.includes('Engineer')?reportDate:(c.submitted||''))+'</div></div>';
  const work=c.snags.map((line,i)=>'<section class="client-wcr-item"><strong>'+e(line.ref||String(i+1))+'. '+e(line.description)+'</strong>'+
    '<div class="client-wcr-photos">'+photo(line.before,'Before Photo')+photo(line.after,'After Photo')+'</div>'+
    (c.supplierWcr?.lines?.[i]?.work?'<p>'+e(c.supplierWcr.lines[i].work)+'</p>':'')+'</section>').join('');
  const logo=globalThis.brand?.abfm||'abfm.jpg';
  return '<section class="client-wcr-sheet"><header class="client-wcr-heading"><img src="'+e(logo)+'" alt="Al Bonian FM"><h2>WORK COMPLETION REPORT</h2></header>'+
    '<div class="client-wcr-meta">'+
    '<div><strong>Quotation / Contract Ref #:</strong><span>'+e(details.reference)+'</span><strong>Client:</strong><span>'+e(c.client||'')+'</span><strong>Date:</strong><span>'+e(reportDate)+'</span>'+
    '<strong>Monthly Fixed Cost / Variable:</strong><span>Variable</span><strong>Status:</strong><span>'+(final?'100% Completion':'Partial / In Progress')+'</span></div>'+
    '<div><strong>Location:</strong><span>'+e((c.building?c.building+' ':'')+(c.site||''))+'</span><strong>Work Order No:</strong><span>'+e(c.order||'')+'</span>'+
    (final?'<strong>Amount per Client PO / Fixed Monthly Cost:</strong><span>'+money(total(c))+'</span>':'')+
    '<strong>Work Start Date:</strong><span>'+e(c.started||'')+'</span><strong>Work Complete Date:</strong><span>'+e(reportDate)+'</span></div></div>'+
    '<p class="client-wcr-description"><strong>Work description:</strong> '+e(c.request||details.subject)+'</p>'+
    '<h3>Work details</h3>'+work+
    '<section class="client-wcr-approvals"><h3>Approvals</h3><div>'+sign(supplier,'Service Provider - Engineer / Manager')+
    sign(null,'End User – JAFZA / DPW')+sign(verification.signature,'Client Representative / ABFM Engineer')+'</div></section>'+
    '<section class="client-wcr-remarks"><strong>Remarks</strong><p>'+e(c.supplierWcr?.remarks||verification.remarks||'')+'</p></section></section>';
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
  const heads=['No.','Work details','Before photo','After photo','Supplier remarks','Verified status'];
  const lines=wcr?c.snags.map((s,i)=>[i+1,e(s.description),photo(s.before,'Before'),photo(s.after,'After'),e(c.supplierWcr?.lines[i]?.work||''),e(s.result||'Pending Engineer verification')]):[];
  const dialog=document.createElement('dialog');
  if (inspection) {
    dialog.classList.add('inspection-dialog');
    dialog.setAttribute('aria-labelledby','inspection-title-0');
  }
  if (quote) {
    dialog.classList.add('quotation-dialog');
    dialog.setAttribute('aria-labelledby','quote-title');
  }
  dialog.innerHTML=(inspection ? '<div class="inspection-document">'+inspectionReport(c)+'</div>' : quote ? quotationDocument(c,tenant) : wcr ? workCompletionReport(c) : '<h2>'+type+'</h2><p>Client '+e(c.client)+' · Location '+e(c.site)+' · Task ID '+e(c.inspection||c.id)+'</p>'+
    rows(heads,lines))+
    (inspection?inspectionEditor(c)+'<button class="edit-quotation secondary" type="button">Edit inspection report</button> <span class="quote-save-status" role="status"></span> ':'')+
    (quote&&c.step<7?quotationEditor(quotationFieldSpecs.filter(([key])=>!tenant||key!=='contact'),quotationFields(c,tenant))+'<button class="edit-quotation secondary" type="button">Edit quotation details</button> <span class="quote-save-status" role="status"></span> ':'')+
    '<button class="print">Print / Save PDF</button> '+(quote?'<button class="excel secondary" type="button">Download Excel</button> ':'')+
    '<button class="dismiss secondary">Close</button>';
  document.body.append(dialog);
  dialog.querySelector('.print').onclick=()=>window.print();
  if(inspection)attachInspectionEditor(dialog,c);
  if(quote){
    dialog.querySelector('.excel').onclick=()=>downloadQuotationExcel(dialog,quotationFields(c,tenant).reference+'-'+(tenant?'Tenant':'DP-World')+'-Quotation',c,tenant);
    if(c.step<7)attachQuotationEditor(dialog,c,tenant);
  }
  dialog.querySelector('.dismiss').onclick=()=>dialog.close();
  dialog.addEventListener('close',()=>dialog.remove(),{once:true});
  dialog.showModal();
}
function bidComparison(c) {
  const uplift=budgetUplift(c);
  const summary=uplift?'<p>Vendor Budget subtotal '+money(uplift.budget/100)+' · ABFM selling subtotal '+money(uplift.selling/100)+' · '+((uplift.selling/uplift.budget-1)*100).toFixed(2)+'% uplift'+(uplift.meets?' · Meets the 21% overall rule':'')+'</p>':'';
  const rahati=c.bids.filter(bid=>bid.supplier==='Rahati Bayti'),latest=rahati.at(-1);
  return summary+rows(['Supplier / quotation','ABFM Ref.','Vendor Budget','Quoted rate','ABFM BOQ Price','Pricing check'],c.bids.flatMap(b=>c.snags.map((s,i)=>{
        const rate=b.rates[i], changed=b.supplier==='Rahati Bayti'&&changedRate(s,rate),isLatest=rahati.length>1&&b===latest;
        const quoteRate=isLatest?'<strong class="latest-rahati-rate">'+money(rate)+'</strong>'+(changed?' <span class="error">Changed from Vendor Budget</span>':'')+' <span class="latest-rahati-label">Latest Rahati submission</span>':
          changed?'<strong class="error">'+money(rate)+' · Changed</strong>':money(rate);
        return [e(b.supplier+' / '+b.reference),e(s.ref),Number.isFinite(s.budget)?money(s.budget):'Review',
          quoteRate,Number.isFinite(s.rate)?money(s.rate):'Review',
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
  $('new').disabled=false;
  $('boqFile').disabled=false;
  $('boqStatus').textContent=catalog.length?catalog.length+' BOQ lines loaded':'Upload the approved consolidated BOQ.';
  $('boqFile').onchange=async event=>{
    try{
      const imported=await importBoq(event.target.files[0]);
      await save('/api/state',{cases,catalog:imported});
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
  if(c.step===1)panel=form('snag',field('location','Snag location')+select('priority','Priority',['','Low','Medium','High','Urgent'])+select('scopeType','Line item type',['BOQ item','Non-BOQ item'])+
    '<div id="boqScopeFields">'+field('scopeSearch','Search BOQ scope by description','search','placeholder="e.g. replace floor tiles" autocomplete="off"')+
    '<input type="hidden" name="scopeMatch"><p id="scopeStatus" class="meta" role="status"></p><div id="scopeResults" class="scope-results" aria-label="Matching BOQ scopes"></div>'+
    field('ref','ABFM BOQ reference','text','readonly')+'<div id="ratePreview" class="meta"></div>'+field('unit','Unit of measure')+'</div>'+
    '<div id="nonBoqFields" hidden>'+field('customDescription','Non-BOQ work description')+field('customUnit','Unit of measure')+
    field('customRate','ABFM BOQ Price (AED)','number','min="0.01" max="100000000" step=".01"')+
    '<p class="meta">Rahati target budget is calculated as 21% below the ABFM BOQ Price.</p></div>'+
    field('qty','Measured quantity','number','min=".01" step=".01"')+upload('before','Before photo')+field('notes','Observation / recommended work'),'Add confirmed snag')+(c.snags.length?button('confirm','Publish inspection and confirm snags'):button('no-work','Publish inspection · no reinstatement required'));
  if(c.step===2)panel=form('rfq',field('deadline','Quote deadline','date')+field('instructions','Site instructions'),'Record RFQ to Rahati Bayti and Guardian');
  if(c.step===3||c.step===4){
    panel='<div class="supplier"><img id="rahati" src="'+(globalThis.brand?.rahati||'rahati.png')+'" alt="Rahati Bayti">Guardian</div>'+
      form('bid',select('supplier','Supplier',suppliers)+field('reference','Quotation reference')+
      '<p id="bidBudgetStatus" class="meta" role="status"></p>'+
      c.snags.map((s,i)=>field('rate'+i,'Supplier rate · '+e(s.ref),'number','min="0" max="100000000" step=".01"')).join('')+
      '<p id="rahatiTargetNotice" class="meta" role="status" aria-live="polite"></p>'+
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
  if(c.step===9)panel=supplierWcrForm(c);
  if(c.step===10)panel=form('verify',field('inspector','Reinspecting ABFM Engineer','text','value="'+e(c.engineer||'')+'"')+
    field('inspectionDate','Date of inspection','date')+field('engineerSign','ABFM Engineer signature (type full name)')+
    '<label>Upload handwritten signature (optional)<input name="engineerSignImage" type="file" accept="image/jpeg,image/png,image/webp"></label>'+c.snags.map((s,i)=>s.result==='Pass'?'':select('result'+i,'Decision · '+e(s.ref),['Pass','Failed','Partial'])).join('')+'<label>Engineer remarks<textarea name="remarks"></textarea></label>','Record verification');
  $('detail').innerHTML='<article><h1>'+e(c.site)+'</h1><p class="meta">'+e(c.id)+' · '+e(c.client)+' · '+e(c.contact)+'</p>'+(c.quotationReference?'<p class="meta">Quotation reference '+e(c.quotationReference)+'</p>':'')+'<p>'+e(c.request)+'</p><p class="meta">CAFM '+e(c.inspection||'—')+' / '+e(c.reinstatement||'—')+'</p>'+
    '<ol class="steps">'+steps.map((s,i)=>'<li '+(i===c.step?'aria-current="step"':'')+'>'+s+'</li>').join('')+'</ol><h2>'+steps[c.step]+'</h2>'+
    (c.noWork?'<p>No reinstatement required.</p>':'')+'<p class="error" id="error" role="alert"></p>'+panel+
    (c.bids.length?'<h3>Supplier rate comparison</h3>'+bidComparison(c):'')+
    (c.snags.length?rows(['BOQ reference','Scope','Qty','Evidence','Verification'],c.snags.map(s=>[e(s.ref),e(s.description)+'<br>'+e(s.notes)+(!Number.isFinite(s.rate)||!Number.isFinite(s.budget)?'<br><strong class="error">BOQ pricing needs review before RFQ</strong>':''),s.qty+' '+e(s.unit),photo(s.before,'Before')+photo(s.after,'After'),e(s.result||'Pending')])):'')+
    (c.published||(c.step===1&&c.snags.length)?button('inspectionReport','Inspection report')+' ':'')+(c.award?button('clientQuote','DP World quotation · Print PDF')+' '+button('tenantQuote','Tenant quotation · Print PDF')+' ':'')+
    (c.bids.length?button('quoteSummary','Download quotation summary · Excel')+' ':'')+
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
      const demoHint=!catalog.length?' Import the approved BOQ to search scopes.':'';
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
    const boqGroup=$('boqScopeFields'),customGroup=$('nonBoqFields');
    const setScopeType=()=>{
      const custom=fields.scopeType.value==='Non-BOQ item';
      boqGroup.hidden=custom;customGroup.hidden=!custom;
      for(const control of boqGroup.querySelectorAll('input,select,textarea'))control.disabled=custom;
      for(const control of customGroup.querySelectorAll('input,select,textarea'))control.disabled=!custom;
      if(custom){applyScope(null);resultList.replaceChildren();status.textContent='Enter the non-BOQ scope and ABFM selling rate.';}
      else showMatches();
    };
    fields.scopeType.addEventListener('change',setScopeType);
    setScopeType();
  }
  if ($('bid')) {
    const fields=$('bid').elements;
    const inputs=c.snags.map((_,i)=>fields['rate'+i]);
    const budgets=c.snags.map(s=>vendorBudget(s,catalog));
    const drafts=new Map();
    let supplier=fields.supplier.value;
    const latestBid=name=>c.bids.findLast(bid=>bid.supplier===name);
    const updateTargetNotice=()=>{
      const notice=$('rahatiTargetNotice');
      notice.hidden=supplier!=='Rahati Bayti';
      if(notice.hidden){notice.textContent='';return;}
      const result=rahatiBudgetNotice(c,inputs.map(input=>readRate(input.value)),budgets);
      notice.classList.toggle('error',result.over);
      notice.textContent=result.text;
    };
    const loadRates=()=>{
      const rahati=supplier==='Rahati Bayti';
      $('rahatiPrintOptions').hidden=!rahati;
      const saved=latestBid(supplier);
      const draft=drafts.get(supplier);
      fields.reference.value=draft?.reference??saved?.reference??'';
      inputs.forEach((input,i)=>{
        input.value=draft?.rates[i]??saved?.rates[i]??(rahati?budgets[i]??'':'');
      });
      const missing=budgets.filter(rate=>rate===null).length;
      $('bidBudgetStatus').textContent=saved
        ? 'Saved quotation '+saved.reference+' · '+money(saved.total)+' before VAT. Edit the rates to record a new revision.'
        : rahati
          ? 'Rates start from Vendor Budget and can be edited.'+(missing?' '+missing+' line(s) have no single usable Vendor Budget. Check the workbook.':'')
          : 'Enter the rates quoted by '+supplier+'.';
      updateTargetNotice();
    };
    inputs.forEach(input=>input.addEventListener('input',updateTargetNotice));
    fields.supplier.onchange=()=>{
      drafts.set(supplier,{reference:fields.reference.value,rates:inputs.map(input=>input.value)});
      supplier=fields.supplier.value;
      loadRates();
    };
    loadRates();
  }
  if ($('previewRahati')) $('previewRahati').onclick=()=>showRahatiQuotation(c,$('bid'));
  bind('vendorReturn',v=>importRahatiBid(c,v.quotation));
  bind('assign',v=>{Object.assign(c,v);move(c,1);});
  bind('snag',async v=>{
    if(!Number.isFinite(Number(v.qty))||Number(v.qty)<=0)throw Error('Enter a measured quantity greater than zero.');
    let item;
    if(v.scopeType==='Non-BOQ item'){
      const description=String(v.customDescription||'').trim(),unit=String(v.customUnit||'').trim(),rate=readRate(v.customRate);
      if(!description)throw Error('Enter the non-BOQ work description.');
      if(!unit)throw Error('Enter the unit of measure for this non-BOQ item.');
      if(!Number.isFinite(rate)||rate<=0)throw Error('Enter a valid ABFM selling rate for this non-BOQ item.');
      const number=c.snags.filter(s=>s.source==='Non-BOQ').length+1;
      item={ref:'NBOQ-'+String(number).padStart(3,'0'),source:'Non-BOQ',description,unit,
        rate,budget:Math.round(rate*.79*100)/100};
    }else{
      const line=catalog.find(x=>x.ref===v.scopeMatch);
      if(!line)throw Error('Select a matching BOQ scope from the search results.');
      const unit=line.unit||v.unit.trim();
      if(!unit)throw Error('Enter the unit of measure for this BOQ scope.');
      item={...line,source:line.source||'BOQ',unit};
    }
    Object.assign(item,{location:v.location,notes:v.notes,priority:v.priority,qty:Number(v.qty),before:await readPhoto(v.before)});
    c.snags.push(item);
    log(c,'Engineer confirmed '+item.ref+(item.source==='Non-BOQ'?' · Non-BOQ item':''));
  });
  bind('confirm',()=>{c.published=true;move(c,2);});
  bind('no-work',()=>{c.published=true;c.noWork=true;log(c,'No reinstatement required');move(c,11);});
  bind('rfq',v=>{
    for(const snag of c.snags){
      if(snag.source==='Non-BOQ'){
        if(!Number.isFinite(snag.budget)||!Number.isFinite(snag.rate))throw Error(snag.ref+' needs a valid ABFM selling price before RFQ.');
        continue;
      }
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
  bind('send',v=>{
    c.quotationDetails={client:quotationFields(c,false),tenant:quotationFields(c,true)};
    log(c,'Client submission '+v.submission);
    move(c,7);
  });
  bind('authorize',v=>{Object.assign(c,v);c.days=duration(total(c))??Number(v.days);log(c,'Client approval '+v.approval);move(c,8);});
  bind('start',v=>{if(v.started<c.ordered)throw Error('Start date precedes order confirmation.');c.started=v.started;move(c,9);});
  if($('quoteSummary'))$('quoteSummary').onclick=()=>{
    const summary=quotationSummaryData(c);
    if(!summary){$('error').textContent='A supplier quotation and valid ABFM selling prices are required.';return;}
    downloadExcelFile(summary,quotationFields(c,false).reference+'-Quotation-Summary');
  };
  if($('previewWcr'))$('previewWcr').onclick=async ()=>{
    const formElement=$('wcr');
    if(!formElement.reportValidity())return;
    const button=$('previewWcr');
    const submit=formElement.querySelector('button:not([type])');
    button.disabled=submit.disabled=true;
    const previous=c.wcrDraft;
    try{
      const draft=await collectSupplierWcr(c,Object.fromEntries(new FormData(formElement)),false);
      c.wcrDraft={...draft,lines:draft.lines.map((line,i)=>({work:line.work,after:line.after===c.snags[i].after?'':line.after}))};
      await save();
      previewSupplierWcr(c,draft);
    }catch(error){
      c.wcrDraft=previous;
      $('error').textContent=error.message;
    }finally{button.disabled=submit.disabled=false;}
  };
  bind('wcr',async v=>{
    const report=await collectSupplierWcr(c,v,true);
    for(const [i,line] of c.snags.entries())if(line.result!=='Pass')line.after=report.lines[i].after;
    c.supplierWcr={reference:report.reference,remarks:report.remarks,signature:report.signature,lines:report.lines.map(line=>({work:line.work}))};
    delete c.reinspectionVerification;
    delete c.wcrDraft;
    c.wcr=report.reference;
    c.submitted=new Date().toLocaleDateString('en-GB',{timeZone:'Asia/Dubai'});
    log(c,'Supplier WCR '+report.reference);
    move(c,10);
  });
  bind('verify',async v=>{
    const engineer=String(v.inspector||'').trim(), name=String(v.engineerSign||'').trim();
    if(!engineer||!name||!v.inspectionDate)throw Error('Enter the Engineer name, signature and date of inspection.');
    const signature={name,image:v.engineerSignImage?.size?await readPhoto(v.engineerSignImage):''};
    if(Object.entries(v).some(([key,value])=>key.startsWith('result')&&value!=='Pass')&&!v.remarks.trim())throw Error('Enter rectification instructions for failed or partial work.');
    for(const [i,s] of c.snags.entries())if(s.result!=='Pass')s.result=v['result'+i];
    c.reinspectionVerification={engineer,date:v.inspectionDate,signature};
    log(c,'Reinspection on '+v.inspectionDate+' by '+engineer+' · '+v.remarks+' · '+c.snags.map(s=>s.ref+' '+s.result).join(', '));
    move(c,c.snags.every(s=>s.result==='Pass')?11:9);
  });
  for(const [id,type] of [['inspectionReport','Inspection report'],['clientQuote','DP World quotation'],['tenantQuote','Tenant quotation'],['completion',c.step===11?'Final WCR':'Partial / draft WCR']]){
    if($(id))$(id).onclick=()=>report(c,type);
  }
}
if(globalThis.brand?.abfm)$('abfm').src=globalThis.brand.abfm;
render();


const vendorAccountForm=$('vendorAccountForm');
if(vendorAccountForm)vendorAccountForm.onsubmit=async event=>{
  event.preventDefault();
  const status=$('vendorAccountStatus');
  const button=vendorAccountForm.querySelector('button');
  button.disabled=true;
  try{
    const result=await fetch('/api/rahati-account',{method:'PUT',headers:{'Content-Type':'application/json'},
      body:JSON.stringify({password:vendorAccountForm.elements.newPassword.value})});
    const body=await result.json();
    if(!result.ok)throw Error(body.error);
    vendorAccountForm.reset();
    status.textContent='Account ready. Username: '+body.username+'. Share the password securely with Rahati Bayti.';
  }catch(error){status.textContent=error.message;}
  finally{button.disabled=false;}
};
const operationsAccountForm=$('operationsAccountForm');
if(operationsAccountForm)operationsAccountForm.onsubmit=async event=>{
  event.preventDefault();
  const status=$('operationsAccountStatus');
  const button=operationsAccountForm.querySelector('button');
  button.disabled=true;
  try{
    const result=await fetch('/api/operations-account',{method:'PUT',headers:{'Content-Type':'application/json'},
      body:JSON.stringify({password:operationsAccountForm.elements.newPassword.value})});
    const body=await result.json();
    if(!result.ok)throw Error(body.error);
    operationsAccountForm.reset();
    status.textContent='Account ready. Username: '+body.username+'. Share the password securely with Operations.';
  }catch(error){status.textContent=error.message;}
  finally{button.disabled=false;}
};
const installApp=$('installApp');
if(installApp){
  let installPrompt;
  const hideInstall=()=>{installApp.hidden=true;installPrompt=null;};
  if(window.matchMedia('(display-mode: standalone)').matches||navigator.standalone)hideInstall();
  window.addEventListener('beforeinstallprompt',event=>{
    event.preventDefault();
    installPrompt=event;
  });
  window.addEventListener('appinstalled',hideInstall);
  installApp.onclick=async ()=>{
    if(installPrompt){
      const prompt=installPrompt;
      installPrompt=null;
      await prompt.prompt();
      if((await prompt.userChoice).outcome==='accepted')hideInstall();
      return;
    }
    const help=document.createElement('dialog');
    help.className='install-help';
    help.setAttribute('aria-labelledby','install-title');
    help.innerHTML='<h2 id="install-title">Install ABFM Snagging</h2>'+
      '<p><strong>iPhone or iPad:</strong> Open the site in Safari. Tap Share, then Add to Home Screen.</p>'+
      '<p><strong>Android, Windows or Mac:</strong> Open the site in Chrome or Edge and choose Install app or Add to Home Screen from the browser menu.</p>'+
      '<button type="button">Close</button>';
    document.body.append(help);
    help.querySelector('button').onclick=()=>help.close();
    help.addEventListener('close',()=>help.remove(),{once:true});
    help.showModal();
  };
}

// Load the shared server state before enabling BOQ or other save actions.
startOnline();
