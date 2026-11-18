import 'dotenv/config';
import express from 'express';
import session from 'express-session';
import connectPgSimple from 'connect-pg-simple';
import pg from 'pg';
import bcrypt from 'bcryptjs';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import multer from 'multer';
import crypto from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pdf from 'pdf-parse';
import mammoth from 'mammoth';

const { Pool } = pg;
const { DATABASE_URL, SESSION_SECRET, OWNER_EMAIL, OWNER_PASSWORD, OWNER_NAME='Principal Researcher', OPENAI_API_KEY, OPENAI_MODEL='gpt-4.1-mini', PGSSL='false' } = process.env;
for(const key of ['DATABASE_URL','SESSION_SECRET','OWNER_EMAIL','OWNER_PASSWORD']) {
  if (!process.env[key]) { console.error(`Missing required environment variable: ${key}`); process.exit(1); }
}
if (SESSION_SECRET.length<32) {console.error('SESSION_SECRET must be at least 32 characters.');process.exit(1);}
if (OWNER_PASSWORD.length<12) {console.error('OWNER_PASSWORD must be at least 12 characters.');process.exit(1);}
const pool = new Pool({ connectionString:DATABASE_URL, ssl:PGSSL==='true'?{rejectUnauthorized:true}:undefined, max:10 });
const app=express();
app.set('trust proxy',1);
app.disable('x-powered-by');
app.use(helmet({contentSecurityPolicy:{directives:{defaultSrc:["'self'"],scriptSrc:["'self'"],styleSrc:["'self'","'unsafe-inline'"],imgSrc:["'self'","data:"],connectSrc:["'self'"],fontSrc:["'self'"],objectSrc:["'none'"],frameAncestors:["'none'"]}}}));
app.use(express.json({limit:'80kb'}));
const PgStore=connectPgSimple(session);
app.use(session({
 store:new PgStore({pool,tableName:'user_sessions',createTableIfMissing:true}),
 secret:SESSION_SECRET,resave:false,saveUninitialized:false,name:'rf.sid',
 cookie:{httpOnly:true,secure:process.env.NODE_ENV==='production',sameSite:'lax',maxAge:14*24*60*60*1000}
}));
const authLimit=rateLimit({windowMs:15*60*1000,limit:15,standardHeaders:'draft-7',legacyHeaders:false,message:{error:'Too many attempts. Try again later.'}});
const aiLimit=rateLimit({windowMs:60*1000,limit:15,standardHeaders:'draft-7',legacyHeaders:false,message:{error:'Too many commands. Try again shortly.'}});
const q=(s,params=[])=>pool.query(s,params);
const sha=s=>crypto.createHash('sha256').update(s).digest('hex');
const clean=s=>String(s||'').trim();
const statuses=['To do','In progress','Blocked','Done'];
const priorities=['Low','Medium','High'];
const phases=['Analytical','Numerical','Validation','Writing','Other'];
const token=()=>crypto.randomBytes(28).toString('hex');
const err=(res,msg,status=400)=>res.status(status).json({error:msg});
function required(req,res,next){if(!req.session.userId)return err(res,'Sign in required',401);next();}
function csrf(req,res,next){if(req.method==='GET'||req.path==='/api/auth/login'||req.path==='/api/auth/accept')return next();if(!req.session.userId)return err(res,'Sign in required',401);if(!req.session.csrf||req.get('X-CSRF-Token')!==req.session.csrf)return err(res,'Security token missing or expired',403);next();}
app.use('/api',csrf);
const userSafe=u=>({id:u.id,email:u.email,name:u.name,role:u.role});
async function getUser(id){const r=await q('SELECT id,email,name,role FROM users WHERE id=$1',[id]);return r.rows[0];}
async function activity(client,actor,description){await client.query('INSERT INTO activities(actor_id,description) VALUES($1,$2)',[actor,description.slice(0,450)]);}
async function transaction(fn){const client=await pool.connect();try{await client.query('BEGIN');const result=await fn(client);await client.query('COMMIT');return result;}catch(e){await client.query('ROLLBACK');throw e;}finally{client.release();}}
async function initialize(){
 await q(`CREATE TABLE IF NOT EXISTS users(id SERIAL PRIMARY KEY,email TEXT NOT NULL UNIQUE,name TEXT NOT NULL,password_hash TEXT NOT NULL,role TEXT NOT NULL CHECK(role IN('owner','collaborator')),created_at TIMESTAMPTZ NOT NULL DEFAULT NOW())`);
 await q(`CREATE TABLE IF NOT EXISTS invitations(id SERIAL PRIMARY KEY,email TEXT NOT NULL,token_hash TEXT NOT NULL UNIQUE,created_by INTEGER REFERENCES users(id),expires_at TIMESTAMPTZ NOT NULL,used_at TIMESTAMPTZ)`);
 await q(`CREATE TABLE IF NOT EXISTS tasks(id SERIAL PRIMARY KEY,title TEXT NOT NULL,description TEXT NOT NULL DEFAULT '',phase TEXT NOT NULL DEFAULT 'Other',status TEXT NOT NULL DEFAULT 'To do',priority TEXT NOT NULL DEFAULT 'Medium',assignee_id INTEGER REFERENCES users(id) ON DELETE SET NULL,due_date DATE,created_by INTEGER REFERENCES users(id),updated_at TIMESTAMPTZ DEFAULT NOW(),created_at TIMESTAMPTZ DEFAULT NOW())`);
 await q(`CREATE TABLE IF NOT EXISTS notes(id SERIAL PRIMARY KEY,body TEXT NOT NULL,author_id INTEGER REFERENCES users(id),created_at TIMESTAMPTZ DEFAULT NOW())`);
 await q(`CREATE TABLE IF NOT EXISTS research_files(id SERIAL PRIMARY KEY,original_name TEXT NOT NULL,mime_type TEXT NOT NULL,bytes INTEGER NOT NULL,content BYTEA NOT NULL,uploaded_by INTEGER REFERENCES users(id),created_at TIMESTAMPTZ DEFAULT NOW())`);
 await q(`CREATE TABLE IF NOT EXISTS activities(id SERIAL PRIMARY KEY,actor_id INTEGER REFERENCES users(id),description TEXT NOT NULL,created_at TIMESTAMPTZ DEFAULT NOW())`);
 const email=OWNER_EMAIL.trim().toLowerCase();const existing=await q('SELECT id FROM users WHERE role=$1',['owner']);
 if(!existing.rowCount){const hash=await bcrypt.hash(OWNER_PASSWORD,12);await q('INSERT INTO users(email,name,password_hash,role) VALUES($1,$2,$3,$4)',[email,OWNER_NAME,hash,'owner']);console.log('Research workspace owner account initialized.');}
}

app.post('/api/auth/login',authLimit,async(req,res,next)=>{try{
 const email=clean(req.body.email).toLowerCase(),password=String(req.body.password||'');
 const r=await q('SELECT * FROM users WHERE email=$1',[email]);
 if(!r.rowCount||!(await bcrypt.compare(password,r.rows[0].password_hash)))return err(res,'Invalid email or password',401);
 req.session.regenerate(e=>{if(e)return next(e);req.session.userId=r.rows[0].id;req.session.csrf=token();res.json({user:userSafe(r.rows[0]),csrf:req.session.csrf});});
}catch(e){next(e);}});
app.post('/api/auth/accept',authLimit,async(req,res,next)=>{try{
 const invite=String(req.body.token||''),name=clean(req.body.name),password=String(req.body.password||'');
 if(!/^[a-f0-9]{56}$/.test(invite)||name.length<2||name.length>90||password.length<12)return err(res,'Valid invitation, name and a password of at least 12 characters are required');
 const digest=sha(invite),hash=await bcrypt.hash(password,12);
 const user=await transaction(async c=>{
  const inv=await c.query('SELECT * FROM invitations WHERE token_hash=$1 AND used_at IS NULL AND expires_at>NOW() FOR UPDATE',[digest]);
  if(!inv.rowCount)throw new Error('Invitation is invalid, used, or expired');
  await c.query("SELECT id FROM users WHERE role='owner' FOR UPDATE");
  const memberCount=await c.query('SELECT count(*)::int AS total FROM users');
  if(memberCount.rows[0].total>=2)throw new Error('This two-person workspace is full');
  const created=await c.query('INSERT INTO users(email,name,password_hash,role) VALUES($1,$2,$3,$4) RETURNING *',[inv.rows[0].email,name,hash,'collaborator']);
  await c.query('UPDATE invitations SET used_at=NOW() WHERE id=$1',[inv.rows[0].id]);
  await activity(c,created.rows[0].id,'Joined the research workspace');return created.rows[0];
 });
 req.session.regenerate(e=>{if(e)return next(e);req.session.userId=user.id;req.session.csrf=token();res.json({user:userSafe(user),csrf:req.session.csrf});});
}catch(e){if(e.code==='23505')return err(res,'That email address already has an account');if(/Invitation|workspace is full/i.test(e.message))return err(res,e.message);next(e);}});
app.get('/api/bootstrap',async(req,res,next)=>{try{
 if(!req.session.userId)return res.json({authenticated:false});
 const user=await getUser(req.session.userId);if(!user){req.session.destroy(()=>{});return res.json({authenticated:false});}
 req.session.csrf ||= token();res.json({authenticated:true,user,csrf:req.session.csrf,aiEnabled:!!OPENAI_API_KEY});
}catch(e){next(e);}});
app.post('/api/auth/logout',required,(req,res,next)=>req.session.destroy(e=>e?next(e):res.json({ok:true})));
app.post('/api/auth/invite',required,authLimit,async(req,res,next)=>{try{
 const user=await getUser(req.session.userId);if(user?.role!=='owner')return err(res,'Only the owner can invite a colleague',403);
 const email=clean(req.body.email).toLowerCase();if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)||email.length>254)return err(res,'Provide a valid email address');
 const members=await q('SELECT count(*)::int AS total FROM users');if(members.rows[0].total>=2)return err(res,'Both workspace seats are occupied');
 const secret=token();await q('INSERT INTO invitations(email,token_hash,created_by,expires_at) VALUES($1,$2,$3,NOW()+INTERVAL \'7 days\')',[email,sha(secret),user.id]);
 // Return a relative path only. The browser constructs an origin-local URL.
 res.json({invitePath:'/invite?token='+secret,expiresIn:'7 days',email});
}catch(e){next(e);}});
app.get('/api/dashboard',required,async(req,res,next)=>{try{
 const [tasks,notes,files,activities,members]=await Promise.all([
 q(`SELECT t.*,to_char(t.due_date,'YYYY-MM-DD') AS due_date,u.name AS assignee_name FROM tasks t LEFT JOIN users u ON t.assignee_id=u.id ORDER BY CASE t.status WHEN 'In progress' THEN 0 WHEN 'Blocked' THEN 1 WHEN 'To do' THEN 2 ELSE 3 END, t.updated_at DESC LIMIT 500`),
 q(`SELECT n.id,n.body,n.created_at,u.name AS author_name FROM notes n LEFT JOIN users u ON u.id=n.author_id ORDER BY n.created_at DESC LIMIT 100`),
 q(`SELECT f.id,f.original_name,f.mime_type,f.bytes,f.created_at,u.name AS uploader_name FROM research_files f LEFT JOIN users u ON u.id=f.uploaded_by ORDER BY f.created_at DESC LIMIT 200`),
 q(`SELECT a.id,a.description,a.created_at,u.name AS actor_name FROM activities a LEFT JOIN users u ON u.id=a.actor_id ORDER BY a.created_at DESC LIMIT 100`),
 q('SELECT id,name,email,role FROM users ORDER BY id')
 ]);res.json({tasks:tasks.rows,notes:notes.rows,files:files.rows,activities:activities.rows,members:members.rows});
}catch(e){next(e);}});
const taskFields={title:'title',description:'description',phase:'phase',status:'status',priority:'priority',assigneeId:'assignee_id',dueDate:'due_date'};
function normalTask(payload,partial=false){
 const out={};for(const [from,to] of Object.entries(taskFields))if(Object.hasOwn(payload,from))out[to]=payload[from];
 if(!partial&&(!clean(out.title)||clean(out.title).length>180))throw new Error('Task title is required (maximum 180 characters)');
 if(Object.hasOwn(out,'title')){out.title=clean(out.title);if(!out.title||out.title.length>180)throw new Error('Invalid task title');}
 if(Object.hasOwn(out,'description')){out.description=clean(out.description);if(out.description.length>5000)throw new Error('Description is too long');}
 if(Object.hasOwn(out,'status')&&!statuses.includes(out.status))throw new Error('Invalid status');
 if(Object.hasOwn(out,'priority')&&!priorities.includes(out.priority))throw new Error('Invalid priority');
 if(Object.hasOwn(out,'phase')&&!phases.includes(out.phase))throw new Error('Invalid phase');
 if(Object.hasOwn(out,'due_date')&&out.due_date!==null&&!/^\d{4}-\d{2}-\d{2}$/.test(out.due_date))throw new Error('Invalid due date');
 if(Object.hasOwn(out,'assignee_id')&&out.assignee_id!==null&&!Number.isInteger(Number(out.assignee_id)))throw new Error('Invalid assignee');
 return out;
}
app.post('/api/tasks',required,async(req,res,next)=>{try{
 const t=normalTask(req.body);const r=await transaction(async c=>{
  if(t.assignee_id!=null){const m=await c.query('SELECT id FROM users WHERE id=$1',[t.assignee_id]);if(!m.rowCount)throw new Error('Invalid assignee');}
  const result=await c.query(`INSERT INTO tasks(title,description,phase,status,priority,assignee_id,due_date,created_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,[t.title,t.description||'',t.phase||'Other',t.status||'To do',t.priority||'Medium',t.assignee_id||null,t.due_date||null,req.session.userId]);
  await activity(c,req.session.userId,`Created task: ${t.title}`);return result.rows[0];
 });res.status(201).json(r);
}catch(e){if(/Invalid|title|long/i.test(e.message))return err(res,e.message);next(e);}});
app.patch('/api/tasks/:id',required,async(req,res,next)=>{try{
 const t=normalTask(req.body,true);if(!Object.keys(t).length)return err(res,'No changes supplied');
 const saved=await transaction(async c=>{
  if(t.assignee_id!=null){const m=await c.query('SELECT id FROM users WHERE id=$1',[t.assignee_id]);if(!m.rowCount)throw new Error('Invalid assignee');}
  const fields=Object.keys(t),values=fields.map(k=>t[k]);
  const r=await c.query(`UPDATE tasks SET ${fields.map((f,i)=>`${f}=$${i+1}`).join(',')},updated_at=NOW() WHERE id=$${fields.length+1} RETURNING *`,[...values,req.params.id]);
  if(!r.rowCount)throw new Error('Task not found');await activity(c,req.session.userId,`Updated task: ${r.rows[0].title}${t.status?' → '+t.status:''}`);return r.rows[0];
 });res.json(saved);
}catch(e){if(/Invalid|not found|long|title/i.test(e.message))return err(res,e.message);next(e);}});
app.delete('/api/tasks/:id',required,async(req,res,next)=>{try{
 await transaction(async c=>{const r=await c.query('DELETE FROM tasks WHERE id=$1 RETURNING title',[req.params.id]);if(!r.rowCount)throw new Error('Task not found');await activity(c,req.session.userId,'Deleted task: '+r.rows[0].title);});res.json({ok:true});
}catch(e){if(e.message==='Task not found')return err(res,e.message,404);next(e);}});
app.post('/api/notes',required,async(req,res,next)=>{try{
 const body=clean(req.body.body);if(!body||body.length>10000)return err(res,'Note must be 1–10000 characters');
 const created=await transaction(async c=>{const r=await c.query('INSERT INTO notes(body,author_id) VALUES($1,$2) RETURNING *',[body,req.session.userId]);await activity(c,req.session.userId,'Added research note: '+body.slice(0,90));return r.rows[0];});res.status(201).json(created);
}catch(e){next(e);}});
app.delete('/api/notes/:id',required,async(req,res,next)=>{try{await transaction(async c=>{const r=await c.query('DELETE FROM notes WHERE id=$1 RETURNING id',[req.params.id]);if(!r.rowCount)throw new Error('Note not found');await activity(c,req.session.userId,'Deleted a research note');});res.json({ok:true});}catch(e){if(e.message==='Note not found')return err(res,e.message,404);next(e);}});
const uploads=multer({storage:multer.memoryStorage(),limits:{fileSize:15*1024*1024,files:1}});
app.post('/api/files',required,uploads.single('file'),async(req,res,next)=>{try{
 if(!req.file)return err(res,'Choose a file');
 const original=path.basename(req.file.originalname).slice(0,240),allowed=/\.(pdf|docx|xlsx|csv|txt|md|json|inp|dat|log|sta|msg|odb|py|png|jpg|jpeg|zip)$/i;
 if(!allowed.test(original))return err(res,'This file type is not supported');
 const stored=await transaction(async c=>{const r=await c.query('INSERT INTO research_files(original_name,mime_type,bytes,content,uploaded_by) VALUES($1,$2,$3,$4,$5) RETURNING id,original_name,bytes,created_at',[original,req.file.mimetype||'application/octet-stream',req.file.size,req.file.buffer,req.session.userId]);await activity(c,req.session.userId,'Uploaded file: '+original);return r.rows[0];});res.status(201).json(stored);
}catch(e){next(e);}});
app.get('/api/files/:id/download',required,async(req,res,next)=>{try{
 const r=await q('SELECT original_name,mime_type,bytes,content FROM research_files WHERE id=$1',[req.params.id]);if(!r.rowCount)return err(res,'File not found',404);
 const f=r.rows[0];res.setHeader('Content-Type','application/octet-stream');res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Content-Disposition',`attachment; filename*=UTF-8''${encodeURIComponent(f.original_name)}`);res.setHeader('Content-Length',String(f.bytes));res.send(f.content);
}catch(e){next(e);}});
app.delete('/api/files/:id',required,async(req,res,next)=>{try{await transaction(async c=>{const r=await c.query('DELETE FROM research_files WHERE id=$1 RETURNING original_name',[req.params.id]);if(!r.rowCount)throw new Error('File not found');await activity(c,req.session.userId,'Deleted file: '+r.rows[0].original_name);});res.json({ok:true});}catch(e){if(e.message==='File not found')return err(res,e.message,404);next(e);}});
const commonWords=new Set(['i','we','the','and','for','all','with','have','was','our','this','that','now','are','from','into','today','done','completed','finished','started','update','task','mark','progress']);
function matchTask(message,tasks){const m=message.toLowerCase();return tasks.map(t=>({t,score:t.title.toLowerCase().split(/[^a-z0-9]+/).filter(w=>w.length>=3&&!commonWords.has(w)&&m.includes(w)).length})).sort((a,b)=>b.score-a.score)[0];}
function fallbackAgent(message,tasks){
 const trimmed=message.trim(),low=trimmed.toLowerCase();let actions=[],reply='';
 const add=trimmed.match(/^(?:add|create|new)\s+task\s*[:\-]\s*(.+)/i);
 const note=trimmed.match(/^(?:note|log|research note)\s*[:\-]\s*(.+)/is);
 if(add){actions=[{type:'add_task',title:add[1].slice(0,180),phase:'Other',priority:'Medium'}];reply='I can create this task. Review and confirm.';}
 else if(note){actions=[{type:'add_note',body:note[1].slice(0,10000)}];reply='I can save this research note. Review and confirm.';}
 else if(/\b(completed|finished|done|started|beginning|blocked)\b/.test(low)){
  let match=matchTask(low,tasks);if(match?.score>=1){let status=/completed|finished|done/.test(low)?'Done':/blocked/.test(low)?'Blocked':'In progress';actions=[{type:'update_task',taskId:match.t.id,status}];reply=`Matched “${match.t.title}”. Review the proposed status change.`;}
  else reply='No existing task confidently matches that update. Try “Add task: [name]” or create the task in the Tasks view.';
 }else if(/progress|summary|report|overview/i.test(low)){
   const done=tasks.filter(t=>t.status==='Done').length, active=tasks.filter(t=>t.status==='In progress').length, blocked=tasks.filter(t=>t.status==='Blocked').length;
   reply=`Current project: ${tasks.length} tasks; ${done} complete, ${active} in progress, ${blocked} blocked. ${tasks.length?Math.round(done/tasks.length*100):0}% completed. Outstanding tasks: ${tasks.filter(t=>t.status!=='Done').slice(0,8).map(t=>t.title).join('; ')||'none'}.`;
 }else reply='Quick command mode understands “Add task: ...”, “Note: ...”, “Completed [task]”, “Started [task]”, “Blocked [task]”, and “Show progress”. Add OPENAI_API_KEY in deployment Secrets to enable natural-language AI interpretation.';
 return {reply,actions,mode:'quick-command'};
}
function validateActions(actions,tasks){return actions.slice(0,8).flatMap(a=>{
 if(!a||typeof a!=='object')return [];
 if(a.type==='add_task'&&clean(a.title).length>0&&clean(a.title).length<=180)return [{type:'add_task',title:clean(a.title),description:clean(a.description||'').slice(0,1500),phase:phases.includes(a.phase)?a.phase:'Other',priority:priorities.includes(a.priority)?a.priority:'Medium'}];
 if(a.type==='add_note'&&clean(a.body).length>0)return [{type:'add_note',body:clean(a.body).slice(0,10000)}];
 if(a.type==='update_task'&&Number.isInteger(Number(a.taskId))&&tasks.some(t=>t.id===Number(a.taskId))&&statuses.includes(a.status))return [{type:'update_task',taskId:Number(a.taskId),status:a.status}];
 return [];
 });}
async function openaiInterpret(message,tasks,notes,files){
 const sys=`You are a research-collaboration task assistant for a two-person geotechnical research workspace. Interpret the user's command based ONLY on supplied existing tasks, notes, and file names. Respond as a JSON object with keys "reply" (brief human-readable text) and "actions" (array, maximum 8). Actions are {"type":"add_task","title":"...","description":"...","phase":"Analytical|Numerical|Validation|Writing|Other","priority":"Low|Medium|High"} or {"type":"update_task","taskId":INTEGER,"status":"To do|In progress|Blocked|Done"} or {"type":"add_note","body":"..."}. Do NOT mutate anything unless specifically requested. Do NOT fabricate experiment results, file contents, completion statuses, numerical parameters, or task IDs. Never claim to have analyzed the actual contents of attached files: only filenames are provided. If the user asks for a summary, produce a read-only reply and actions=[]. If the request is ambiguous, explain and use actions=[]. A sentence saying someone did a completed piece of work may justify marking a clearly matching existing task Done; if unclear ask. Keep reply concise.`;
 const r=await fetch('https://api.openai.com/v1/chat/completions',{method:'POST',headers:{Authorization:`Bearer ${OPENAI_API_KEY}`,'Content-Type':'application/json'},body:JSON.stringify({model:OPENAI_MODEL,temperature:0,response_format:{type:'json_object'},messages:[{role:'system',content:sys},{role:'user',content:JSON.stringify({message,existingTasks:tasks.map(t=>({id:t.id,title:t.title,status:t.status,phase:t.phase})),recentNotes:notes.map(n=>n.body.slice(0,250)),uploadedFileNames:files.map(f=>f.original_name)})}]}) ,signal:AbortSignal.timeout(25000)});
 if(!r.ok){const body=await r.text();throw new Error('AI service returned '+r.status+': '+body.slice(0,140));}
 const raw=await r.json(),parsed=JSON.parse(raw.choices?.[0]?.message?.content||'{}');return {reply:String(parsed.reply||'Please review the suggested changes.').slice(0,3000),actions:validateActions(Array.isArray(parsed.actions)?parsed.actions:[],tasks),mode:'ai'};
}
app.post('/api/agent/interpret',required,aiLimit,async(req,res,next)=>{try{
 const message=clean(req.body.message);if(!message||message.length>3000)return err(res,'Enter a command of up to 3000 characters');
 const [tr,nr,fr]=await Promise.all([q('SELECT id,title,status,phase FROM tasks ORDER BY updated_at DESC LIMIT 200'),q('SELECT body FROM notes ORDER BY created_at DESC LIMIT 20'),q('SELECT original_name FROM research_files ORDER BY created_at DESC LIMIT 30')]);
 let result;if(OPENAI_API_KEY){try{result=await openaiInterpret(message,tr.rows,nr.rows,fr.rows);}catch(e){console.error('AI interpretation error:',e.message);result=fallbackAgent(message,tr.rows);result.reply+=' (AI temporarily unavailable; using quick-command interpretation.)';}}
 else result=fallbackAgent(message,tr.rows);
 res.json(result);
}catch(e){next(e);}});
app.post('/api/agent/apply',required,async(req,res,next)=>{try{
 const actions=req.body.actions;if(!Array.isArray(actions)||actions.length===0||actions.length>8)return err(res,'Provide 1–8 proposed actions');
 const tr=await q('SELECT id FROM tasks');const safe=validateActions(actions,tr.rows);if(safe.length!==actions.length)return err(res,'One or more actions are invalid. Please request a new interpretation.');
 await transaction(async c=>{for(const a of safe){
  if(a.type==='add_task'){await c.query('INSERT INTO tasks(title,description,phase,priority,created_by) VALUES($1,$2,$3,$4,$5)',[a.title,a.description,a.phase,a.priority,req.session.userId]);await activity(c,req.session.userId,'AI-assisted: created task '+a.title);}
  if(a.type==='update_task'){const r=await c.query('UPDATE tasks SET status=$1,updated_at=NOW() WHERE id=$2 RETURNING title',[a.status,a.taskId]);if(!r.rowCount)throw new Error('Task disappeared; request a new interpretation');await activity(c,req.session.userId,`AI-assisted: ${r.rows[0].title} → ${a.status}`);}
  if(a.type==='add_note'){await c.query('INSERT INTO notes(body,author_id) VALUES($1,$2)',[a.body,req.session.userId]);await activity(c,req.session.userId,'AI-assisted: added research note');}
 }});res.json({ok:true,count:safe.length});
}catch(e){if(/Task disappeared|invalid/i.test(e.message))return err(res,e.message);next(e);}});
app.post('/api/agent/summarize-file/:id',required,aiLimit,async(req,res,next)=>{try{
 if(!OPENAI_API_KEY)return err(res,'Set OPENAI_API_KEY to enable document summaries',503);
 const r=await q('SELECT original_name,content,bytes FROM research_files WHERE id=$1',[req.params.id]);if(!r.rowCount)return err(res,'File not found',404);
 const f=r.rows[0],extension=path.extname(f.original_name).toLowerCase();let text='';
 if(['.txt','.csv','.md','.json','.inp','.dat','.log','.sta','.msg','.py'].includes(extension))text=f.content.toString('utf8');
 else if(extension==='.pdf')text=(await pdf(f.content)).text;
 else if(extension==='.docx')text=(await mammoth.extractRawText({buffer:f.content})).value;
 else return err(res,'Text extraction supports PDF, DOCX and plain-text/code files only');
 if(!clean(text))return err(res,'Could not extract text from this document');
 const excerpt=text.slice(0,18000);
 const response=await fetch('https://api.openai.com/v1/chat/completions',{method:'POST',headers:{Authorization:`Bearer ${OPENAI_API_KEY}`,'Content-Type':'application/json'},body:JSON.stringify({model:OPENAI_MODEL,temperature:0,messages:[{role:'system',content:'You are a careful engineering research assistant. Summarize only the provided extracted file text. Clearly label limitations due to truncation. Include key work completed, open questions, and plausible next tasks, separating claims in the document from your suggestions. Do not fabricate results.'},{role:'user',content:`Filename: ${f.original_name}\n${text.length>18000?'WARNING: text truncated to first 18,000 characters.\n':''}\n${excerpt}`} ]}),signal:AbortSignal.timeout(30000)});
 if(!response.ok)throw new Error('AI summary service failed with status '+response.status);
 const json=await response.json();res.json({summary:String(json.choices?.[0]?.message?.content||'No summary returned'),truncated:text.length>18000});
}catch(e){next(e);}});

const publicDir=path.join(path.dirname(fileURLToPath(import.meta.url)),'public');
app.use(express.static(publicDir,{index:false,maxAge:'15m'}));
app.get(['/', '/invite'],(req,res)=>res.sendFile(path.join(publicDir,'index.html')));
app.use('/api',(req,res)=>err(res,'Endpoint not found',404));
app.use((e,req,res,next)=>{console.error('Request error:',e);if(e instanceof multer.MulterError)return err(res,e.code==='LIMIT_FILE_SIZE'?'File exceeds 15 MB limit':e.message,413);if(e instanceof SyntaxError&&e.status===400)return err(res,'Invalid JSON');return err(res,'Unexpected server error',500);});
initialize().then(()=>app.listen(Number(process.env.PORT||3000),'0.0.0.0',()=>console.log('ResearchFlow listening on port '+(process.env.PORT||3000)))).catch(e=>{console.error('Could not initialize database:',e);process.exit(1);});
