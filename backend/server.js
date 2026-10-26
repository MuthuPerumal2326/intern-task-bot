require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const Database = require('better-sqlite3');
const nodemailer = require('nodemailer');
const XLSX = require('xlsx');
const OpenAI = require('openai');

const app = express();
const PORT = process.env.PORT || 4000;
const root = path.join(__dirname, 'data');
const uploads = path.join(root, 'uploads');
fs.mkdirSync(uploads, {recursive:true});
app.use(cors());
app.use(express.json({limit:'2mb'}));

const db = new Database(path.join(root, 'internflow.sqlite'));
db.pragma('journal_mode = WAL');
db.exec(`
CREATE TABLE IF NOT EXISTS interns (
 id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, email TEXT NOT NULL UNIQUE,
 task TEXT DEFAULT '', status TEXT DEFAULT 'Not Started', review_round INTEGER DEFAULT 1,
 review1_date TEXT DEFAULT '', review1_time TEXT DEFAULT '', review1_link TEXT DEFAULT '',
 review2_date TEXT DEFAULT '', review2_time TEXT DEFAULT '', review2_link TEXT DEFAULT '',
 review3_date TEXT DEFAULT '', review3_time TEXT DEFAULT '', review3_link TEXT DEFAULT '',
 score INTEGER DEFAULT 0, feedback TEXT DEFAULT '', created_at TEXT DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS submissions (
 id INTEGER PRIMARY KEY AUTOINCREMENT, intern_id INTEGER NOT NULL, filename TEXT NOT NULL,
 original_name TEXT NOT NULL, notes TEXT DEFAULT '', submitted_at TEXT DEFAULT CURRENT_TIMESTAMP,
 score INTEGER DEFAULT 0, feedback TEXT DEFAULT '', review_status TEXT DEFAULT 'Pending',
 FOREIGN KEY(intern_id) REFERENCES interns(id)
);
CREATE TABLE IF NOT EXISTS notifications (
 id INTEGER PRIMARY KEY AUTOINCREMENT, intern_id INTEGER, email TEXT NOT NULL,
 subject TEXT NOT NULL, body TEXT NOT NULL, delivery TEXT DEFAULT 'demo',
 created_at TEXT DEFAULT CURRENT_TIMESTAMP
);
`);
const defaultTasks = [
 'Build a responsive portfolio website','Create a task management REST API','Build a student attendance dashboard',
 'Create an expense tracker with charts','Develop a library management system','Build a weather dashboard using an API',
 'Create an employee leave management app','Develop a product catalogue with search','Build a quiz application with scoring',
 'Create a feedback collection portal','Build an event registration system','Develop a simple inventory tracker',
 'Create a job application tracker','Build a notes app with CRUD','Create a food donation coordination app',
 'Build a customer support ticket system','Develop a URL shortener','Create a basic e-commerce cart',
 'Build a course progress tracker','Develop a contact management app'
];
const count = db.prepare('SELECT COUNT(*) c FROM interns').get().c;
if (!count) {
  const insert = db.prepare('INSERT INTO interns(name,email,task,status) VALUES(?,?,?,?)');
  const tx = db.transaction(() => {
    for(let i=1;i<=100;i++) insert.run(`Demo Intern ${String(i).padStart(3,'0')}`,`intern${i}@example.com`,defaultTasks[(i-1)%defaultTasks.length], 'Not Started');
  });
  tx();
}
let transporter = null;
if (process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS) {
  transporter = nodemailer.createTransport({
    host:process.env.SMTP_HOST, port:Number(process.env.SMTP_PORT||587),
    secure:String(process.env.SMTP_SECURE).toLowerCase()==='true',
    auth:{user:process.env.SMTP_USER,pass:process.env.SMTP_PASS}
  });
}
const openai = process.env.OPENAI_API_KEY ? new OpenAI({apiKey:process.env.OPENAI_API_KEY}) : null;
const getIntern = db.prepare('SELECT * FROM interns WHERE id=?');
function notify(intern, subject, body) {
  const delivery = transporter ? 'queued' : 'demo';
  const result = db.prepare('INSERT INTO notifications(intern_id,email,subject,body,delivery) VALUES(?,?,?,?,?)')
    .run(intern.id, intern.email, subject, body, delivery);
  if (transporter) {
    transporter.sendMail({from:process.env.MAIL_FROM||process.env.SMTP_USER,to:intern.email,subject,text:body})
      .then(()=>db.prepare("UPDATE notifications SET delivery='sent' WHERE id=?").run(result.lastInsertRowid))
      .catch(err=>db.prepare("UPDATE notifications SET delivery=? WHERE id=?").run('failed: '+String(err.message).slice(0,120),result.lastInsertRowid));
  } else console.log(`\n[DEMO EMAIL to ${intern.email}]\n${subject}\n${body}\n`);
}
app.get('/api/dashboard',(req,res)=>{
 const totals=db.prepare("SELECT COUNT(*) total, SUM(CASE WHEN status='Advanced' THEN 1 ELSE 0 END) advanced, SUM(CASE WHEN status LIKE 'Review %' THEN 1 ELSE 0 END) inReview, SUM(CASE WHEN status='Submitted' THEN 1 ELSE 0 END) submitted FROM interns").get();
 const submissions=db.prepare('SELECT COUNT(*) c FROM submissions').get().c;
 res.json({...totals, submissions, tasks:db.prepare('SELECT COUNT(DISTINCT task) c FROM interns').get().c});
});
app.get('/api/interns',(req,res)=>{
 const q=(req.query.q||'').trim();
 const rows=q ? db.prepare('SELECT * FROM interns WHERE name LIKE ? OR email LIKE ? OR task LIKE ? ORDER BY id').all(`%${q}%`,`%${q}%`,`%${q}%`)
 : db.prepare('SELECT * FROM interns ORDER BY id').all();
 res.json(rows);
});
app.post('/api/interns',(req,res)=>{
 const {name,email,task=''}=req.body||{};
 if(!name||!email||!String(email).includes('@')) return res.status(400).json({error:'Enter a valid name and email.'});
 try {
  const info=db.prepare('INSERT INTO interns(name,email,task,status) VALUES(?,?,?,?)').run(String(name).trim(),String(email).trim(),String(task).trim(),'Not Started');
  res.status(201).json(getIntern.get(info.lastInsertRowid));
 } catch(e){res.status(400).json({error:'Email already exists or input is invalid.'});}
});
app.post('/api/interns/import',(req,res)=>{
 const {rows}=req.body||{};
 if(!Array.isArray(rows)) return res.status(400).json({error:'Expected rows array.'});
 let added=0, skipped=0;
 const stmt=db.prepare('INSERT OR IGNORE INTO interns(name,email,task,status) VALUES(?,?,?,?)');
 const tx=db.transaction(()=>rows.forEach(r=>{
   if(!r.name||!r.email||!String(r.email).includes('@')) {skipped++;return;}
   const info=stmt.run(String(r.name).trim(),String(r.email).trim(),String(r.task||'').trim(),'Not Started');
   if(info.changes) added++; else skipped++;
 }));
 tx(); res.json({added,skipped});
});
app.post('/api/interns/auto-assign',(req,res)=>{
 const interns=db.prepare("SELECT * FROM interns WHERE task='' OR task IS NULL ORDER BY id").all();
 const tx=db.transaction(()=>interns.forEach((it,i)=>db.prepare('UPDATE interns SET task=?, status=? WHERE id=?').run(defaultTasks[(i+it.id-1)%defaultTasks.length],it.status==='Not Started'?'Task Assigned':it.status,it.id)));
 tx(); res.json({assigned:interns.length});
});
app.get('/api/interns/export',(req,res)=>{
 const rows=db.prepare('SELECT id,name,email,task,status,review_round,review1_date,review1_time,review1_link,review2_date,review2_time,review2_link,review3_date,review3_time,review3_link,score,feedback FROM interns ORDER BY id').all();
 const sheet=XLSX.utils.json_to_sheet(rows);
 const csv=XLSX.utils.sheet_to_csv(sheet);
 res.setHeader('Content-Type','text/csv; charset=utf-8');
 res.setHeader('Content-Disposition','attachment; filename="intern-roster-progress.csv"');
 res.send('\ufeff'+csv);
});
app.post('/api/reviews/send',(req,res)=>{
 const {round=1,date,time,link}=req.body||{};
 const r=Number(round);
 if(![1,2,3].includes(r)||!date||!time||!link) return res.status(400).json({error:'Choose a review round, date, time, and meeting link.'});
 const eligible=db.prepare(r===1?'SELECT * FROM interns':'SELECT * FROM interns WHERE status != ?').all(...(r===1?[]:['Advanced']));
 const dateCol=`review${r}_date`, timeCol=`review${r}_time`, linkCol=`review${r}_link`;
 const update=db.prepare(`UPDATE interns SET ${dateCol}=?,${timeCol}=?,${linkCol}=?,review_round=?,status=? WHERE id=?`);
 const tx=db.transaction(()=>eligible.forEach(it=>{
   update.run(date,time,link,r,`Review ${r} Scheduled`,it.id);
   const current=getIntern.get(it.id);
   notify(current,`InternFlow: Review ${r} scheduled`,`Hello ${it.name},\n\nYour Review ${r} is scheduled.\nDate: ${date}\nTime: ${time}\nMeeting link: ${link}\nAssigned task: ${it.task}\n\nPlease prepare your latest work and be ready to explain your decisions.\n\nRegards,\nInternFlow Team`);
 }));
 tx(); res.json({scheduled:eligible.length,round:r});
});
const storage=multer.diskStorage({
 destination:(req,file,cb)=>cb(null,uploads),
 filename:(req,file,cb)=>cb(null,`${Date.now()}-${Math.random().toString(36).slice(2,9)}${path.extname(file.originalname).slice(0,12)}`)
});
const upload=multer({storage,limits:{fileSize:20*1024*1024},fileFilter:(req,file,cb)=>{
 const ok=/\.(zip|pdf|docx?|pptx?|txt|js|jsx|ts|tsx|html|css|py|java|json|png|jpg|jpeg)$/i.test(file.originalname);
 cb(ok?null:new Error('Unsupported file type.'),ok);
}});
app.post('/api/submissions',upload.single('file'),(req,res)=>{
 const internId=Number(req.body.internId);
 const intern=getIntern.get(internId);
 if(!intern){if(req.file)fs.unlinkSync(req.file.path);return res.status(404).json({error:'Intern not found.'});}
 if(!req.file)return res.status(400).json({error:'Upload a project file.'});
 const info=db.prepare('INSERT INTO submissions(intern_id,filename,original_name,notes) VALUES(?,?,?,?)')
 .run(internId,path.basename(req.file.path),req.file.originalname,String(req.body.notes||'').slice(0,2000));
 db.prepare("UPDATE interns SET status='Submitted' WHERE id=?").run(internId);
 res.status(201).json({id:info.lastInsertRowid,intern:intern.name,file:req.file.originalname,status:'Pending review'});
});
async function reviewSubmission(sub) {
 const intern=getIntern.get(sub.intern_id);
 const fullPath=path.join(uploads,sub.filename);
 let textContent='';
 try {
  if(/\.(txt|js|jsx|ts|tsx|html|css|py|java|json)$/i.test(sub.original_name)) textContent=fs.readFileSync(fullPath,'utf8').slice(0,16000);
 } catch{}
 let score=0, feedback='';
 if(openai) {
  try {
   const completion=await openai.chat.completions.create({
    model:process.env.OPENAI_MODEL||'gpt-4o-mini',
    messages:[
     {role:'system',content:'You are a constructive internship project reviewer. Give a score from 0 to 100 and practical, specific feedback. Be fair, avoid claiming to have run code. Return concise plain text with Score: N/100, Strengths, Issues, Priority updates, and Recommendation (advance / revise). A human reviewer makes final decisions.'},
     {role:'user',content:`Intern task: ${intern.task}\nSubmission filename: ${sub.original_name}\nIntern notes: ${sub.notes}\n${textContent?`File text (may be partial):\n${textContent}`:'No readable source text was extracted from this file. Review only what can be inferred and clearly state limitations.'}`}
    ],temperature:0.2
   });
   feedback=completion.choices[0]?.message?.content||'AI returned no feedback.';
   const match=feedback.match(/(?:score\s*[:\-]?\s*)(\d{1,3})/i);
   score=match?Math.min(100,Number(match[1])):0;
  } catch(e){feedback='AI review failed, so a checklist review was used. '+e.message;}
 }
 if(!openai||!feedback||feedback.startsWith('AI review failed')) {
   const ext=path.extname(sub.original_name).toLowerCase();
   const readable=['.txt','.js','.jsx','.ts','.tsx','.html','.css','.py','.java','.json'].includes(ext);
   const checks=[
    [Boolean(sub.notes&&sub.notes.trim().length>20),'Add clear project notes explaining features, setup, and design decisions.'],
    [readable,'Submit source code or include a README so the implementation can be inspected.'],
    [Boolean(textContent&&textContent.length>80),'Ensure the main source files contain complete, readable implementation rather than placeholders.'],
    [Boolean(intern.task&&intern.task.trim()),'Confirm the submission addresses the assigned task and its acceptance criteria.']
   ];
   const passed=checks.filter(x=>x[0]).length;
   score=Math.round((passed/4)*100);
   feedback=`Demo checklist review — ${score}/100\n\nWhat looks good:\n- Submission was received and linked to ${intern.name}.\n- Assigned task: ${intern.task||'No task assigned'}.\n\nWhat to improve:\n${checks.filter(x=>!x[0]).map(x=>'- '+x[1]).join('\n')||'- Add a README with installation and usage instructions.\n- Test core flows and document the test results.\n- Include screenshots or a short demo where useful.'}\n\nImportant: this is a basic automated checklist, not a full code execution or semantic review. A human reviewer should verify functionality before deciding.`;
 }
 return {score,feedback};
}
app.get('/api/submissions',(req,res)=>{
 const rows=db.prepare(`SELECT s.*,i.name intern_name,i.email intern_email,i.task FROM submissions s JOIN interns i ON i.id=s.intern_id ORDER BY s.id DESC`).all();
 res.json(rows);
});
app.post('/api/submissions/:id/review',async(req,res)=>{
 const sub=db.prepare('SELECT * FROM submissions WHERE id=?').get(Number(req.params.id));
 if(!sub)return res.status(404).json({error:'Submission not found.'});
 const result=await reviewSubmission(sub);
 db.prepare("UPDATE submissions SET score=?,feedback=?,review_status='Reviewed' WHERE id=?").run(result.score,result.feedback,sub.id);
 db.prepare('UPDATE interns SET score=?,feedback=? WHERE id=?').run(result.score,result.feedback,sub.intern_id);
 const intern=getIntern.get(sub.intern_id);
 notify(intern,'InternFlow: Project review feedback',`Hello ${intern.name},\n\nYour submission "${sub.original_name}" has been reviewed.\n\n${result.feedback}\n\nPlease check the review notes in the portal. This automated feedback is advisory; your reviewer will confirm the next step.`);
 res.json({...result,intern:intern.name});
});
app.post('/api/interns/:id/advance',(req,res)=>{
 const intern=getIntern.get(Number(req.params.id));
 if(!intern)return res.status(404).json({error:'Intern not found.'});
 db.prepare("UPDATE interns SET status='Advanced' WHERE id=?").run(intern.id);
 const updated=getIntern.get(intern.id);
 notify(updated,'InternFlow: Next process',`Hello ${updated.name},\n\nCongratulations! Your project has been marked as ready for the next selection process. The recruiting team will share further instructions.\n\nRegards,\nInternFlow Team`);
 res.json(updated);
});
app.post('/api/interns/:id/schedule-review',(req,res)=>{
 const intern=getIntern.get(Number(req.params.id));
 if(!intern)return res.status(404).json({error:'Intern not found.'});
 const {round,date,time,link}=req.body||{}, r=Number(round);
 if(![2,3].includes(r)||!date||!time||!link)return res.status(400).json({error:'Review 2 or 3 requires date, time and link.'});
 db.prepare(`UPDATE interns SET review${r}_date=?,review${r}_time=?,review${r}_link=?,review_round=?,status=? WHERE id=?`)
 .run(date,time,link,r,`Review ${r} Scheduled`,intern.id);
 notify(getIntern.get(intern.id),`InternFlow: Review ${r} scheduled`,`Hello ${intern.name},\n\nYour Review ${r} is scheduled.\nDate: ${date}\nTime: ${time}\nMeeting link: ${link}\nTask: ${intern.task}\n\nPlease update your project using the previous feedback and attend the review.\n\nRegards,\nInternFlow Team`);
 res.json(getIntern.get(intern.id));
});
app.get('/api/notifications',(req,res)=>res.json(db.prepare('SELECT n.*,i.name intern_name FROM notifications n LEFT JOIN interns i ON i.id=n.intern_id ORDER BY n.id DESC LIMIT 250').all()));
app.get('/api/submissions/:id/file',(req,res)=>{
 const sub=db.prepare('SELECT * FROM submissions WHERE id=?').get(Number(req.params.id));
 if(!sub)return res.status(404).send('Submission not found');
 const file=path.join(uploads,path.basename(sub.filename));
 if(!fs.existsSync(file))return res.status(404).send('File missing');
 res.download(file,sub.original_name);
});
app.use((err,req,res,next)=>{
 console.error(err.message);
 res.status(400).json({error:err.message||'Request failed'});
});
app.use(express.static(path.join(__dirname,'public')));
app.get('*',(req,res)=>res.sendFile(path.join(__dirname,'public','index.html')));
app.listen(PORT,()=>console.log(`InternFlow running at http://localhost:${PORT}`));
