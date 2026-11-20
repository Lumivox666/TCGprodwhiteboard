'use strict';
const http=require('http'),fs=require('fs'),path=require('path'),crypto=require('crypto');
const PORT=Number(process.env.PORT||3000), PASSWORD=String(process.env.APP_PASSWORD||'566218');
// All mutable records and uploaded PDFs live under the mounted Railway volume.
// Railway automatically provides RAILWAY_VOLUME_MOUNT_PATH for attached volumes.
// DATA_DIR can select a subdirectory of that volume; locally it defaults to ./data.
const railwayVolume=process.env.RAILWAY_VOLUME_MOUNT_PATH;
const railwayRuntime=Boolean(process.env.RAILWAY_PROJECT_ID||process.env.RAILWAY_SERVICE_ID);
if(railwayRuntime && !railwayVolume && process.env.ALLOW_EPHEMERAL_DATA!=='true') {
  console.error('FATAL: No Railway volume attached. Attach a persistent volume before deploying to avoid losing goals, A3 PDFs and staff acknowledgements.');
  process.exit(1);
}
const DATA_DIR=path.resolve(process.env.DATA_DIR || railwayVolume || path.join(__dirname,'data'));
if(railwayRuntime && railwayVolume) {
  const mount=path.resolve(railwayVolume);
  if(DATA_DIR!==mount && !DATA_DIR.startsWith(mount+path.sep)) {
    console.error(`FATAL: DATA_DIR (${DATA_DIR}) is outside the Railway volume (${mount}). Set DATA_DIR to the mount path or remove it.`);
    process.exit(1);
  }
}
const DB=path.join(DATA_DIR,'whiteboard.json');
fs.mkdirSync(DATA_DIR,{recursive:true});
const departments=['Chassis','Conveyor','Scanner','Pre-testing','Testing','Shipping','Inventory','3D Printing','Refurbs'];
const defaults={Chassis:'',Conveyor:'',Scanner:'','Pre-testing':'',Testing:'',Shipping:'',Inventory:'','3D Printing':'',Refurbs:''};
const day=()=>new Date().toLocaleDateString('en-CA',{timeZone:process.env.TZ||'America/Edmonton'});
function monday(date){const d=new Date(date+'T12:00:00Z'),w=(d.getUTCDay()+6)%7;d.setUTCDate(d.getUTCDate()-w);return d.toISOString().slice(0,10)}
function month(date){return date.slice(0,7)}
function starterStaff(){return ['Craig','Emily','Jesse','Daniel','Dylan','Delcia','Kevin'].map(name=>({id:crypto.randomUUID(),name,status:'out',note:'',updatedAt:null}))}
function seed(){return {staff:starterStaff(),settings:{weeklyTarget:8,monthlyTarget:30,dailyMachineTarget:2,dailyRefurbTarget:0,weeklyRefurbTarget:1,monthlyRefurbTarget:4},goals:{},completions:[],shipments:[],issues:[],periods:[{id:crypto.randomUUID(),name:'Period 1',start:day(),end:null}],updatedAt:new Date().toISOString()}}
// Never silently overwrite an existing but unreadable database with an empty one.
let db;
if(fs.existsSync(DB)) {
  try { db=JSON.parse(fs.readFileSync(DB,'utf8')); }
  catch(error) { console.error('FATAL: Cannot parse existing database at '+DB, error); process.exit(1); }
  if(!db || typeof db!=='object' || Array.isArray(db)) {
    console.error('FATAL: Existing database has invalid structure at '+DB);
    process.exit(1);
  }
} else db=seed();
for(const k of ['settings','goals','completions','shipments','issues','periods'])if(!db[k])db[k]=seed()[k];
for(const [k,v] of Object.entries({dailyRefurbTarget:0,weeklyRefurbTarget:1,monthlyRefurbTarget:4}))if(db.settings[k]===undefined)db.settings[k]=v;
if(!Array.isArray(db.staff))db.staff=starterStaff();
if(!Array.isArray(db.a3Docs))db.a3Docs=[];if(!Array.isArray(db.announcements))db.announcements=[];if(!db.quickLinks)db.quickLinks={os:'',sop:'',guided:''};
const DOC_DIR=path.join(DATA_DIR,'a3-pdfs');fs.mkdirSync(DOC_DIR,{recursive:true});
function save(){db.updatedAt=new Date().toISOString();const tmp=DB+'.tmp';fs.writeFileSync(tmp,JSON.stringify(db,null,2));fs.renameSync(tmp,DB)}
// Default OS Lite shortcut for both fresh installs and pre-existing local data.
// A custom configured URL remains unchanged.
const osLiteUrl='https://tcgoslite.up.railway.app';
if(!db.quickLinks.os){db.quickLinks.os=osLiteUrl;save()}
else if(!fs.existsSync(DB))save();
const sessions=new Map();function clean(){for(const [k,v] of sessions)if(v<Date.now())sessions.delete(k)}
const json=(res,status,obj)=>{res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});res.end(JSON.stringify(obj))};
function cookie(req){return (req.headers.cookie||'').split(';').map(s=>s.trim()).find(s=>s.startsWith('tcg_session='))?.split('=')[1]||''}
function auth(req){clean();const token=cookie(req);return sessions.has(token)}
function requireAuth(req,res){if(!auth(req)){json(res,401,{error:'Login required'});return false}sessions.set(cookie(req),Date.now()+12*3600000);return true}
function body(req){return new Promise((resolve,reject)=>{let s='';req.on('data',c=>{s+=c;if(s.length>11000000)req.destroy()});req.on('end',()=>{try{resolve(JSON.parse(s||'{}'))}catch{reject(Error('Invalid JSON'))}});req.on('error',reject)})}
const int=(v,max=10000)=>Math.min(max,Math.max(0,Number.parseInt(v,10)||0));const str=(v,max=300)=>String(v??'').slice(0,max).trim();
function period(){return db.periods[db.periods.length-1]}
function activeIssues(p=period()){return db.issues.filter(x=>x.createdAt.slice(0,10)>=p.start&&(!p.end||x.createdAt.slice(0,10)<=p.end))}
function recurring(issues){const groups=new Map();for(const x of issues){if(x.department==='Inventory')continue;const norm=x.description.toLowerCase().replace(/[^a-z0-9 ]/g,' ').replace(/\s+/g,' ').trim();const key=[x.department,x.module||'',norm].join('|');if(!norm)continue;if(!groups.has(key))groups.set(key,{department:x.department,module:x.module||'',description:x.description,count:0});groups.get(key).count++}return [...groups.values()].filter(x=>x.count>=2).sort((a,b)=>b.count-a.count)}
function stats(p=period()){const items=activeIssues(p),counts={Production:0,Testing:0,Inventory:0,'3D Printing':0};for(const x of items)counts[x.department]=(counts[x.department]||0)+1;return {counts,total:items.length,recurring:recurring(items)}}
function snapshot(){return {...db,today:day(),activePeriod:period(),stats:stats()}}
function report(p=period()){const issues=activeIssues(p),st=stats(p),from=p.start,to=p.end||day();const full=db.completions.filter(x=>x.date>=from&&x.date<=to).reduce((a,x)=>a+x.quantity,0),shipped=db.shipments.filter(x=>x.date>=from&&x.date<=to).reduce((a,x)=>a+x.quantity,0);return {name:p.name,from,to,fullMachines:full,machinesShipped:shipped,...st,issues}}
function esc(s){return String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]))}
function htmlReport(p,comparison){const r=report(p),prev=comparison?report(db.periods[db.periods.length-2]):null;const rows=Object.entries(r.counts).map(([k,v])=>`<tr><td>${esc(k)}</td><td>${v}</td>${prev?`<td>${prev.counts[k]||0}</td><td>${v-(prev.counts[k]||0)}</td>`:''}</tr>`).join('');return `<!doctype html><html><head><meta charset="utf-8"><title>TCG KPI Report - ${esc(r.name)}</title><style>body{font:16px system-ui;max-width:900px;margin:45px auto;color:#15233b;padding:0 24px}h1{border-bottom:3px solid #e9791a;padding-bottom:15px}table{border-collapse:collapse;width:100%;margin:20px 0}td,th{padding:12px;border-bottom:1px solid #ddd;text-align:left}.metrics{display:flex;gap:16px;flex-wrap:wrap}.metric{border:1px solid #ddd;border-radius:12px;padding:18px;min-width:150px}.metric b{display:block;font-size:30px}@media print{button{display:none}}</style></head><body><button onclick="print()">Print / Save PDF</button><h1>TCG MACHINES — KPI REPORT</h1><p>${esc(r.name)} · ${esc(r.from)} to ${esc(r.to)}</p><div class="metrics"><div class="metric">KPI Points<b>${r.total}</b></div><div class="metric">Full machines completed<b>${r.fullMachines}</b></div><div class="metric">Machines shipped<b>${r.machinesShipped}</b></div></div><h2>${prev?'Current vs previous period':'Department points'}</h2><table><thead><tr><th>Department</th><th>Current</th>${prev?'<th>Previous</th><th>Change</th>':''}</tr></thead><tbody>${rows}</tbody></table><h2>Recurring issues</h2>${r.recurring.length?`<ul>${r.recurring.map(x=>`<li><strong>${esc(x.department)}${x.module?' / '+esc(x.module):''}</strong>: ${esc(x.description)} — ${x.count} occurrences</li>`).join('')}</ul>`:'<p>No identical recurring issue descriptions detected this period.</p>'}<h2>Recorded issues</h2><table><thead><tr><th>Date</th><th>Department</th><th>Module / Type</th><th>Description</th></tr></thead><tbody>${r.issues.map(x=>`<tr><td>${esc(x.createdAt.slice(0,10))}</td><td>${esc(x.department)}</td><td>${esc(x.module||x.issueType||'—')}</td><td>${esc(x.description)}</td></tr>`).join('')}</tbody></table><p style="color:#777;font-size:12px">Repeated issues are grouped by matching description, department and module. Different wording may not be grouped.</p></body></html>`}
const mime={'.html':'text/html; charset=utf-8','.png':'image/png','.ico':'image/x-icon'};
const server=http.createServer(async(req,res)=>{const url=new URL(req.url,'http://localhost');try{
if(req.method==='GET' && url.pathname==='/health') return json(res,200,{status:'ok'});
if(req.method==='GET'&&['/','/index.html','/logo.png'].includes(url.pathname)){const name=url.pathname==='/logo.png'?'logo.png':'index.html';res.writeHead(200,{'Content-Type':mime[path.extname(name)],'Cache-Control':'no-cache','X-Content-Type-Options':'nosniff'});return fs.createReadStream(path.join(__dirname,name)).pipe(res)}
if(req.method==='POST'&&url.pathname==='/api/login'){const b=await body(req);const a=Buffer.from(str(b.password,100)),c=Buffer.from(PASSWORD);if(a.length!==c.length||!crypto.timingSafeEqual(a,c))return json(res,403,{error:'Incorrect password'});const token=crypto.randomBytes(32).toString('hex');sessions.set(token,Date.now()+12*3600000);res.setHeader('Set-Cookie',`tcg_session=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=43200${(process.env.COOKIE_SECURE==='true'||railwayRuntime)?'; Secure':''}`);return json(res,200,{ok:true})}
if(url.pathname==='/api/logout'&&req.method==='POST'){sessions.delete(cookie(req));res.setHeader('Set-Cookie','tcg_session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0');return json(res,200,{ok:true})}
if(url.pathname.startsWith('/api/')&&!requireAuth(req,res))return;

// Multiple versioned PDF A3 documents. PDF bytes remain on the server, never in /api/state.
if(url.pathname==='/api/a3/upload'&&req.method==='POST'){
 const b=await body(req),title=str(b.title,140),raw=String(b.pdfBase64||''),audience=Array.isArray(b.staffIds)?b.staffIds.filter(id=>db.staff.some(x=>x.id===id)):[];
 if(!title||!audience.length)return json(res,400,{error:'Title and at least one assigned employee are required'});
 if(raw.length>10000000||!/^([A-Za-z0-9+/]{4})*([A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(raw))return json(res,400,{error:'Invalid or oversized PDF (maximum 7 MB)'});
 const bytes=Buffer.from(raw,'base64');if(bytes.length<8||bytes.length>7*1024*1024||bytes.subarray(0,5).toString()!=='%PDF-')return json(res,400,{error:'Upload a valid PDF smaller than 7 MB'});
 const id=crypto.randomUUID(),existing=db.a3Docs.find(x=>x.id===b.replaceId),version=existing?existing.version+1:1;
 const filename=id+'.pdf';fs.writeFileSync(path.join(DOC_DIR,filename),bytes,{flag:'wx'});
 if(existing){existing.archived=true;existing.replacedBy=id}
 db.a3Docs.push({id,title,version,filename,staffIds:audience,ack:[],archived:false,createdAt:new Date().toISOString(),replaces:existing?.id||null});save();return json(res,200,snapshot());
}
if(url.pathname==='/api/a3/ack'&&req.method==='POST'){
 const b=await body(req),doc=db.a3Docs.find(x=>x.id===b.docId),person=db.staff.find(x=>x.id===b.staffId);
 if(!doc||doc.archived||!person||!doc.staffIds.includes(person.id))return json(res,400,{error:'Document or assigned employee not found'});
 if(!doc.ack.some(x=>x.staffId===person.id))doc.ack.push({staffId:person.id,name:person.name,at:new Date().toISOString()});save();return json(res,200,snapshot());
}
if(url.pathname==='/api/a3/archive'&&req.method==='POST'){
 const b=await body(req),doc=db.a3Docs.find(x=>x.id===b.id);if(!doc)return json(res,404,{error:'Document not found'});doc.archived=true;save();return json(res,200,snapshot());
}
if(url.pathname.startsWith('/api/a3/pdf/')&&req.method==='GET'){
 const id=url.pathname.split('/').pop(),doc=db.a3Docs.find(x=>x.id===id);if(!doc)return json(res,404,{error:'PDF not found'});
 res.writeHead(200,{'Content-Type':'application/pdf','Content-Disposition':`inline; filename="A3-${doc.id}.pdf"`,'X-Content-Type-Options':'nosniff','Cache-Control':'no-store'});return fs.createReadStream(path.join(DOC_DIR,doc.filename)).pipe(res);
}
if(url.pathname==='/api/links'&&req.method==='POST'){
 const b=await body(req);for(const k of ['os','sop','guided'])if(k in b){const v=str(b[k],500);if(v&&!/^https:\/\//i.test(v))return json(res,400,{error:'Links must begin with https://'});db.quickLinks[k]=v}save();return json(res,200,snapshot());
}
if(url.pathname==='/api/announcement'&&req.method==='POST'){
 const b=await body(req),message=str(b.message,240),expires=str(b.expires,10);if(!message||!/^\d{4}-\d\d-\d\d$/.test(expires))return json(res,400,{error:'Message and expiry date required'});
 db.announcements.push({id:crypto.randomUUID(),message,expires,createdAt:new Date().toISOString()});save();return json(res,200,snapshot());
}
if(url.pathname==='/api/announcement/delete'&&req.method==='POST'){
 const b=await body(req);db.announcements=db.announcements.filter(x=>x.id!==b.id);save();return json(res,200,snapshot());
}

if(url.pathname==='/api/state'&&req.method==='GET')return json(res,200,snapshot());
if(url.pathname==='/api/staff'&&req.method==='POST'){const b=await body(req),name=str(b.name,70);if(!name)return json(res,400,{error:'Staff name required'});if(db.staff.some(x=>x.name.toLowerCase()===name.toLowerCase()))return json(res,409,{error:'Staff member already listed'});db.staff.push({id:crypto.randomUUID(),name,status:'out',note:'',updatedAt:null});save();return json(res,200,snapshot())}
if(url.pathname==='/api/staff/update'&&req.method==='POST'){const b=await body(req),staff=db.staff.find(x=>x.id===b.id);if(!staff)return json(res,404,{error:'Staff member not found'});if('name' in b){const name=str(b.name,70);if(!name)return json(res,400,{error:'Name required'});if(db.staff.some(x=>x.id!==staff.id&&x.name.toLowerCase()===name.toLowerCase()))return json(res,409,{error:'Name already in use'});staff.name=name}if('status' in b){if(!['in','out'].includes(b.status))return json(res,400,{error:'Invalid status'});staff.status=b.status}if('note' in b)staff.note=str(b.note,180);staff.updatedAt=new Date().toISOString();save();return json(res,200,snapshot())}
if(url.pathname==='/api/staff/delete'&&req.method==='POST'){const b=await body(req),before=db.staff.length;db.staff=db.staff.filter(x=>x.id!==b.id);if(db.staff.length===before)return json(res,404,{error:'Staff member not found'});save();return json(res,200,snapshot())}
if(url.pathname==='/api/settings'&&req.method==='POST'){const b=await body(req);for(const k of ['weeklyTarget','monthlyTarget','dailyMachineTarget','dailyRefurbTarget','weeklyRefurbTarget','monthlyRefurbTarget'])if(k in b)db.settings[k]=int(b[k]);save();return json(res,200,snapshot())}
if(url.pathname==='/api/goal'&&req.method==='POST'){const b=await body(req),d=str(b.date,10)||day(),dep=str(b.department,40);if(!/^\d{4}-\d\d-\d\d$/.test(d)||!departments.includes(dep))return json(res,400,{error:'Invalid goal'});db.goals[d]??={};db.goals[d][dep]={target:int(b.target),done:int(b.done),coverage:str(b.coverage,120),description:str(b.description,300),pulse:['Chassis','Conveyor','Scanner'].includes(dep)?str(b.pulse,40):'',status:['on-track','on-hold','blocked'].includes(b.status)?b.status:'on-track',reason:str(b.reason,220)};save();return json(res,200,snapshot())}
if(url.pathname==='/api/completion'&&req.method==='POST'){const b=await body(req),d=str(b.date,10)||day();if(!/^\d{4}-\d\d-\d\d$/.test(d))return json(res,400,{error:'Invalid date'});db.completions.push({id:crypto.randomUUID(),date:d,quantity:int(b.quantity,1000),type:b.type==='refurb'?'refurb':'new',note:str(b.note,150),createdAt:new Date().toISOString()});save();return json(res,200,snapshot())}
if(url.pathname==='/api/shipment'&&req.method==='POST'){const b=await body(req),d=str(b.date,10)||day();if(!/^\d{4}-\d\d-\d\d$/.test(d))return json(res,400,{error:'Invalid date'});db.shipments.push({id:crypto.randomUUID(),date:d,quantity:int(b.quantity,1000),note:str(b.note,150),createdAt:new Date().toISOString()});save();return json(res,200,snapshot())}
if(url.pathname==='/api/issue'&&req.method==='POST'){const b=await body(req),dep=str(b.department,40);if(!['Production','Testing','Inventory','3D Printing'].includes(dep)||!str(b.description))return json(res,400,{error:'Department and description required'});db.issues.push({id:crypto.randomUUID(),department:dep,module:str(b.module,60),issueType:str(b.issueType,60),description:str(b.description,500),createdAt:new Date().toISOString()});save();return json(res,200,snapshot())}
if(url.pathname==='/api/period/new'&&req.method==='POST'){const b=await body(req),p=period();p.end=day();db.periods.push({id:crypto.randomUUID(),name:str(b.name,100)||`Period ${db.periods.length+1}`,start:day(),end:null});save();return json(res,200,snapshot())}
if(url.pathname==='/api/report'&&req.method==='GET'){const compare=url.searchParams.get('compare')==='1';if(compare&&db.periods.length<2)return json(res,400,{error:'No previous period to compare'});res.writeHead(200,{'Content-Type':'text/html; charset=utf-8','Content-Disposition':`attachment; filename="TCG-KPI-${day()}${compare?'-comparison':''}.html"`});return res.end(htmlReport(period(),compare))}
if(url.pathname==='/api/backup'&&req.method==='GET'){res.writeHead(200,{'Content-Type':'application/json','Content-Disposition':`attachment; filename="TCG-whiteboard-backup-${day()}.json"`});return res.end(JSON.stringify(db,null,2))}
json(res,404,{error:'Not found'});
}catch(e){console.error(e);json(res,500,{error:e.message||'Server error'})}});
server.listen(PORT,'0.0.0.0',()=>console.log(`TCG Whiteboard listening on port ${PORT}; persistent data: ${DATA_DIR}`));
