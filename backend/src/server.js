import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import crypto from 'node:crypto';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import cron from 'node-cron';
import multer from 'multer';
import { createClient } from '@supabase/supabase-js';

const app=express();
const allowedOrigins = new Set([
  process.env.CORS_ORIGIN || 'http://localhost:5173',
  'http://localhost:5173',
  'http://127.0.0.1:5173',
]);
app.use(cors({
  origin(origin, callback) {
    if (!origin || allowedOrigins.has(origin)) return callback(null, true);
    return callback(new Error(`Origin ${origin} is not allowed by CORS`));
  },
}));
app.use(express.json({ verify: (req, _res, buffer) => { req.rawBody = Buffer.from(buffer); } }));
const db=createClient(process.env.SUPABASE_URL,process.env.SUPABASE_SERVICE_ROLE_KEY);
const RATE=Number(process.env.RATE_PER_HOUR||20), GRACE=15;
const upload=multer({storage:multer.memoryStorage(),limits:{fileSize:8*1024*1024},fileFilter(req,file,cb){cb(null,/^image\/(png|jpeg|webp)$/.test(file.mimetype));}});
const thaiDateTime=(date,time)=>new Date(`${date}T${String(time).slice(0,5)}:00+07:00`);
const sign=u=>jwt.sign({id:u.id,role:u.role},process.env.JWT_SECRET,{expiresIn:'12h'});
function auth(req,res,next){try{const h=req.headers.authorization||'';req.user=jwt.verify(h.replace(/^Bearer /,''),process.env.JWT_SECRET);next();}catch{return res.status(401).json({error:'unauthorized'});}}
function admin(req,res,next){if(req.user?.role!=='admin')return res.status(403).json({error:'สำหรับผู้ดูแลระบบเท่านั้น'});next();}
function id(){return crypto.randomUUID();}
async function userById(uid){const {data}=await db.from('users').select('*').eq('id',uid).maybeSingle();return data;}
async function pushLine(to,text){if(!to||!process.env.LINE_CHANNEL_ACCESS_TOKEN)return false;const r=await fetch('https://api.line.me/v2/bot/message/push',{method:'POST',headers:{'Content-Type':'application/json','Authorization':`Bearer ${process.env.LINE_CHANNEL_ACCESS_TOKEN}`},body:JSON.stringify({to,messages:[{type:'text',text}]})});if(!r.ok)console.error('LINE push failed',r.status,await r.text());return r.ok;}
async function credit(uid,type,amount,reason){const u=await userById(uid);const next=Number(u.credit||0)+(type==='add'?amount:-amount);await db.from('users').update({credit:next}).eq('id',uid);await db.from('credit_history').insert({id:id(),user_id:uid,type,amount,reason,source:'system'});}
async function finishBooking(input,reason='manual'){
  const {data:b,error:loadError}=await db.from('bookings').select('*').eq('id',input.id).maybeSingle();
  if(loadError)throw loadError;
  if(!b)return {ok:false,error:'booking not found'};
  if(['completed','cancelled','no_show'].includes(b.status))return {ok:true,alreadyFinalized:true,reason};
  const now=new Date(),start=thaiDateTime(b.date,b.time);
  const actual=Math.max(0,Math.round((now-start)/60000));
  const overtime=Math.max(0,actual-Number(b.duration)*60);
  const overtimeAmount=Math.ceil(overtime/60)*RATE;
  const {data:claimed,error:claimError}=await db.from('bookings').update({status:'completed',exit_time:now.toISOString(),actual_minutes:actual,overtime_minutes:overtime,overtime_amount:overtimeAmount,amount:Number(b.amount)+overtimeAmount}).eq('id',b.id).in('status',['pending','active']).select('id').maybeSingle();
  if(claimError)throw claimError;
  if(!claimed)return {ok:true,alreadyFinalized:true,reason};
  if(overtimeAmount)await credit(b.user_id,'reduce',overtimeAmount,`ค่าจอดเกินเวลา ${b.slot_id}`);
  await db.from('slots').update({status:'available',updated_at:now.toISOString()}).eq('id',b.slot_id);
  const u=await userById(b.user_id);
  if(u?.line_user_id)await pushLine(u.line_user_id,`✅ จบการจอดช่อง ${b.slot_id}\nเวลาจริง ${actual} นาที\nค่าจอดเกินเวลา ฿${overtimeAmount}\nยอดรวม ฿${Number(b.amount)+overtimeAmount}`);
  return {ok:true,actual,overtimeAmount,reason};
}

let lifecycleRunning=false;
async function lifecycle(){
  if(lifecycleRunning)return;
  lifecycleRunning=true;
  try{
    const now=new Date();
    const {data:bs,error}=await db.from('bookings').select('*').in('status',['pending','active']);
    if(error)throw error;
    for(const b of bs||[]){
      const start=thaiDateTime(b.date,b.time),end=new Date(start.getTime()+Number(b.duration)*3600000);
      const {data:sensor}=await db.from('devices').select('*').eq('type','sensor').eq('linked_slot',b.slot_id).limit(1).maybeSingle();
      const {data:barrier}=await db.from('devices').select('*').eq('type','barrier').eq('linked_slot',b.slot_id).limit(1).maybeSingle();
      const sensorFresh=sensor?.updated_at&&now-new Date(sensor.updated_at)<120000;
      const entry=b.entry_verified||(sensorFresh&&sensor?.status==='online'&&sensor?.presence==='occupied');
      const u=await userById(b.user_id);

      if(b.status==='pending'&&now>=new Date(start.getTime()+GRACE*60000)&&sensorFresh&&sensor?.status==='online'&&!entry){
        await db.from('bookings').update({status:'no_show',no_show_checked:true}).eq('id',b.id).eq('status','pending');
        await db.from('slots').update({status:'available',updated_at:now.toISOString()}).eq('id',b.slot_id);
        if(u?.line_user_id)await pushLine(u.line_user_id,`❌ ยกเลิกการจอง ${b.slot_id} เพราะไม่เข้าจอดภายใน 15 นาที`);
        continue;
      }
      if(b.status==='pending'&&now>=start&&entry){
        await db.from('bookings').update({status:'active',entry_verified:true,entry_time:b.entry_time||now.toISOString()}).eq('id',b.id).eq('status','pending');
      }
      const left=(end-now)/60000;
      if(left>0&&left<=Number(b.notify_before_min||15)&&!b.notified){
        if(u?.line_user_id)await pushLine(u.line_user_id,`⏰ เวลาจอดช่อง ${b.slot_id} จะหมดใน ${Math.ceil(left)} นาที`);
        await db.from('bookings').update({notified:true}).eq('id',b.id);
      }
      const exitDetected=b.status==='active'&&sensorFresh&&sensor?.presence==='empty'&&barrier?.state==='closed';
      if(exitDetected){await finishBooking(b,'sensor-exit');continue;}
      if(now>=end&&b.status==='active'){await finishBooking(b,'scheduled-end');continue;}
    }
  }catch(error){console.error('[lifecycle]',error);}
  finally{lifecycleRunning=false;}
}
app.get('/api/health',(req,res)=>res.json({ok:true,time:new Date().toISOString()}));
app.post('/api/auth/register',async(req,res)=>{try{const {username,email,password,name}=req.body;if(!username||!password||!name)return res.status(400).json({error:'ข้อมูลไม่ครบ'});const u={id:id(),username,email:email?.toLowerCase(),password_hash:await bcrypt.hash(password,10),name,role:'user',credit:0,status:'active',line_link_code:crypto.randomBytes(4).toString('hex').slice(0,6).toUpperCase()};const {data,error}=await db.from('users').insert(u).select('*').single();if(error)throw error;delete data.password_hash;res.json({user:data,token:sign(data)});}catch(e){res.status(400).json({error:e.message});}});
app.post('/api/auth/login',async(req,res)=>{try{const username=String(req.body.username||'').trim(),password=String(req.body.password||'');if(!username||!password)return res.status(400).json({error:'กรุณากรอกชื่อผู้ใช้และรหัสผ่าน'});const {data,error}=await db.from('users').select('*').or(`username.eq.${username},email.eq.${username}`).maybeSingle();if(error)throw error;if(!data||data.status!=='active'||!(data.password_hash?await bcrypt.compare(password,data.password_hash):data.password===password))return res.status(401).json({error:'ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง'});delete data.password_hash;delete data.password;res.json({user:data,token:sign(data)});}catch(error){console.error('[login]',error);res.status(500).json({error:'เข้าสู่ระบบไม่สำเร็จ กรุณาตรวจสอบ Backend และ Supabase'});}});
app.get('/api/bootstrap',auth,async(req,res)=>{try{const out={};const required=['slots','bookings','credit_history','devices'];const optional=['credit_requests','maintenance_logs','parking_maps'];const userFields='id,username,email,name,role,tier,credit,status,line_user_id,line_link_code,created_at';let usersQuery=db.from('users').select(userFields);if(req.user.role!=='admin')usersQuery=usersQuery.eq('id',req.user.id);const {data:users,error:userError}=await usersQuery;if(userError)throw userError;out.users=users||[];for(const table of required){let query=db.from(table).select('*');if(req.user.role!=='admin'&&['bookings','credit_history'].includes(table))query=query.eq('user_id',req.user.id);const {data,error}=await query;if(error)throw error;out[table]=data||[];}for(const table of optional){let query=db.from(table).select('*');if(req.user.role!=='admin'&&table==='credit_requests')query=query.eq('user_id',req.user.id);const {data,error}=await query;if(error){console.warn(`[bootstrap] optional table ${table}:`,error.message);out[table]=[];}else out[table]=data||[];}res.json(out);}catch(error){console.error('[bootstrap]',error);res.status(500).json({error:`โหลดข้อมูลไม่สำเร็จ: ${error.message}`});}});
app.post('/api/bookings',auth,async(req,res)=>{const {slotId,date,time,duration}=req.body;const u=await userById(req.user.id);const amount=Number(duration)*RATE;if(!slotId||!date||!time||!duration||u.credit<amount)return res.status(400).json({error:'ข้อมูลไม่ถูกต้องหรือเครดิตไม่พอ'});const {data:slot,error:slotError}=await db.from('slots').select('status').eq('id',slotId).maybeSingle();if(slotError)return res.status(500).json({error:slotError.message});if(!slot||slot.status!=='available')return res.status(400).json({error:'ช่องจอดนี้ไม่ว่างหรือกำลังซ่อม'});const start=thaiDateTime(date,time);if(start<=new Date())return res.status(400).json({error:'เวลาเริ่มจองต้องเป็นเวลาในอนาคต'});const status='pending';const b={id:id(),slot_id:slotId,user_id:u.id,date,time,duration,amount,status};const {data,error}=await db.from('bookings').insert(b).select('*').single();if(error)return res.status(400).json({error:error.message});await db.from('slots').update({status:'booked'}).eq('id',slotId);await credit(u.id,'reduce',amount,`ชำระค่าจอง ${slotId}`);res.json(data);});
app.post('/api/bookings/:id/cancel',auth,async(req,res)=>{const {data:b}=await db.from('bookings').select('*').eq('id',req.params.id).eq('user_id',req.user.id).maybeSingle();if(!b||b.status!=='pending'||new Date()>=thaiDateTime(b.date,b.time))return res.status(400).json({error:'ยกเลิกได้จนถึงก่อนเวลาเริ่มจองเท่านั้น'});await db.from('bookings').update({status:'cancelled'}).eq('id',b.id);await db.from('slots').update({status:'available'}).eq('id',b.slot_id);await credit(req.user.id,'add',b.amount,`คืนเครดิตจากการยกเลิก ${b.slot_id}`);res.json({ok:true});});
app.post('/api/bookings/:id/finish',auth,async(req,res)=>{const {data:b}=await db.from('bookings').select('*').eq('id',req.params.id).eq('user_id',req.user.id).maybeSingle();if(!b||b.status!=='active')return res.status(400).json({error:'Booking ไม่ได้อยู่ในสถานะ active'});res.json(await finishBooking(b));});
app.post('/api/devices/:id/toggle',auth,async(req,res)=>{const {data:d}=await db.from('devices').select('*').eq('id',req.params.id).maybeSingle();if(!d||d.type!=='barrier')return res.status(404).json({error:'ไม่พบอุปกรณ์ควบคุมช่องจอด'});if(req.user.role!=='admin'){const {data:b}=await db.from('bookings').select('slot_id,date,time,status').eq('user_id',req.user.id).in('status',['pending','active']);const now=new Date();const allowed=(b||[]).some(x=>x.slot_id===d.linked_slot&&(x.status==='active'||(x.status==='pending'&&(thaiDateTime(x.date,x.time)-now)/60000<=15&&(thaiDateTime(x.date,x.time)-now)/60000>-60)));if(!allowed)return res.status(403).json({error:'ควบคุมได้เฉพาะช่องที่คุณจองไว้และอยู่ในช่วงเวลาใช้งาน'});}const state=d.state==='open'?'closed':'open';const {data,error}=await db.from('devices').update({state,updated_at:new Date().toISOString()}).eq('id',d.id).select('*').single();if(error)return res.status(400).json({error:error.message});res.json(data);});
app.patch('/api/admin/users/:id',auth,admin,async(req,res)=>{try{const patch={};if(['admin','user'].includes(req.body.role))patch.role=req.body.role;if(['active','inactive'].includes(req.body.status))patch.status=req.body.status;if(typeof req.body.name==='string'&&req.body.name.trim())patch.name=req.body.name.trim();if(!Object.keys(patch).length)return res.status(400).json({error:'ไม่มีข้อมูลที่ต้องแก้ไข'});const {data,error}=await db.from('users').update(patch).eq('id',req.params.id).select('*').single();if(error)throw error;res.json(data);}catch(e){res.status(400).json({error:e.message});}});
app.patch('/api/admin/devices/:id',auth,admin,async(req,res)=>{try{const patch={};if(typeof req.body.name==='string'&&req.body.name.trim())patch.name=req.body.name.trim();if(typeof req.body.linked_slot==='string'||req.body.linked_slot===null)patch.linked_slot=req.body.linked_slot;if(['online','offline','error'].includes(req.body.status))patch.status=req.body.status;patch.updated_at=new Date().toISOString();const {data,error}=await db.from('devices').update(patch).eq('id',req.params.id).select('*').single();if(error)throw error;res.json(data);}catch(e){res.status(400).json({error:e.message});}});
app.patch('/api/admin/slots/:id',auth,admin,async(req,res)=>{try{const patch={};if(typeof req.body.code==='string'&&req.body.code.trim())patch.code=req.body.code.trim();if(['available','booked','unavailable'].includes(req.body.status))patch.status=req.body.status;if(typeof req.body.type==='string'&&req.body.type.trim())patch.type=req.body.type.trim();patch.updated_at=new Date().toISOString();const {data,error}=await db.from('slots').update(patch).eq('id',req.params.id).select('*').single();if(error)throw error;res.json(data);}catch(e){res.status(400).json({error:e.message});}});
app.post('/api/admin/slots/swap',auth,admin,async(req,res)=>{try{const {firstId,secondId}=req.body;const {data:slots,error}=await db.from('slots').select('id,floor,slot_order').in('id',[firstId,secondId]);if(error)throw error;if(!slots||slots.length!==2)return res.status(404).json({error:'ไม่พบช่องจอด'});const a=slots.find(x=>x.id===firstId),b=slots.find(x=>x.id===secondId);await db.from('slots').update({floor:b.floor,slot_order:b.slot_order,updated_at:new Date().toISOString()}).eq('id',a.id);await db.from('slots').update({floor:a.floor,slot_order:a.slot_order,updated_at:new Date().toISOString()}).eq('id',b.id);res.json({ok:true});}catch(e){res.status(400).json({error:e.message});}});
app.post('/api/admin/maintenance',auth,admin,async(req,res)=>{try{const {slotId,problemDetail}=req.body;if(!slotId||!String(problemDetail||'').trim())return res.status(400).json({error:'กรุณาระบุช่องจอดและรายละเอียด'});const {data,error}=await db.from('maintenance_logs').insert({id:id(),slot_id:slotId,problem_detail:String(problemDetail).trim(),status:'open'}).select('*').single();if(error)throw error;await db.from('slots').update({status:'unavailable',updated_at:new Date().toISOString()}).eq('id',slotId);res.json(data);}catch(e){res.status(400).json({error:e.message});}});
app.post('/api/admin/maintenance/:id/resolve',auth,admin,async(req,res)=>{try{const {data:m,error}=await db.from('maintenance_logs').select('*').eq('id',req.params.id).maybeSingle();if(error)throw error;if(!m)return res.status(404).json({error:'ไม่พบรายการซ่อม'});await db.from('maintenance_logs').update({status:'resolved',resolved_at:new Date().toISOString()}).eq('id',m.id);await db.from('slots').update({status:'available',updated_at:new Date().toISOString()}).eq('id',m.slot_id);res.json({ok:true});}catch(e){res.status(400).json({error:e.message});}});
app.post('/api/admin/maps',auth,admin,upload.single('image'),async(req,res)=>{try{if(!req.file)return res.status(400).json({error:'กรุณาเลือกไฟล์ PNG, JPG หรือ WebP'});const floor=Number(req.body.floor||1);const ext=req.file.mimetype==='image/png'?'png':req.file.mimetype==='image/webp'?'webp':'jpg';const path=`floor-${floor}/${Date.now()}-${crypto.randomUUID()}.${ext}`;const {error:uploadError}=await db.storage.from('parking-maps').upload(path,req.file.buffer,{contentType:req.file.mimetype,upsert:false});if(uploadError)throw uploadError;const {data:urlData}=db.storage.from('parking-maps').getPublicUrl(path);const {data,error}=await db.from('parking_maps').insert({id:id(),name:String(req.body.name||`ผังชั้น ${floor}`),floor,image_url:urlData.publicUrl,created_by:req.user.id}).select('*').single();if(error)throw error;res.json(data);}catch(e){res.status(400).json({error:e.message});}});
app.post('/api/iot/telemetry',async(req,res)=>{try{const deviceId=String(req.body.device_id||'').trim(),slots=req.body.slots;if(!deviceId||!Array.isArray(slots))return res.status(400).json({error:'device_id และ slots array จำเป็นต้องระบุ'});const {data,error}=await db.rpc('handle_sensor_telemetry',{device_id:deviceId,slots});if(error)throw error;res.json(data);}catch(e){console.error('[iot telemetry]',e);res.status(400).json({error:e.message});}});
app.post('/api/iot/sensors/presence',async(req,res)=>{const {deviceId,presence,carPresent}=req.body;const {data,error}=await db.from('devices').update({presence,car_present:carPresent,status:'online',updated_at:new Date().toISOString()}).eq('id',deviceId).eq('type','sensor').select('*').single();if(error)return res.status(400).json({error:error.message});res.json(data);});
app.post('/api/iot/barriers/status',async(req,res)=>{const {deviceId,state}=req.body;const {data,error}=await db.from('devices').update({state,status:'online',updated_at:new Date().toISOString()}).eq('id',deviceId).eq('type','barrier').select('*').single();if(error)return res.status(400).json({error:error.message});res.json(data);});
app.post('/api/credit-requests',auth,async(req,res)=>{try{const amount=Number(req.body.amount);const reason=String(req.body.reason||'').trim();if(!Number.isFinite(amount)||amount<=0||!reason)return res.status(400).json({error:'กรุณาระบุจำนวนเงินและเหตุผล'});const {data,error}=await db.from('credit_requests').insert({id:id(),user_id:req.user.id,type:'add',amount,reason,status:'pending'}).select('*').single();if(error)throw error;res.json(data);}catch(e){res.status(400).json({error:e.message});}});
app.post('/api/admin/users/:id/credit',auth,admin,async(req,res)=>{try{const type=req.body.type==='reduce'?'reduce':'add';const amount=Number(req.body.amount);const reason=String(req.body.reason||'ปรับเครดิตโดยผู้ดูแล').trim();if(!Number.isFinite(amount)||amount<=0)return res.status(400).json({error:'จำนวนเงินไม่ถูกต้อง'});const u=await userById(req.params.id);if(!u)return res.status(404).json({error:'ไม่พบผู้ใช้'});if(type==='reduce'&&Number(u.credit)<amount)return res.status(400).json({error:'เครดิตผู้ใช้ไม่เพียงพอ'});await credit(u.id,type,amount,reason);const updated=await userById(u.id);if(updated?.line_user_id)await pushLine(updated.line_user_id,`${type==='add'?'✅ เพิ่ม':'➖ หัก'}เครดิต ฿${amount.toLocaleString('th-TH')}\nเหตุผล: ${reason}\nเครดิตคงเหลือ ฿${Number(updated.credit).toLocaleString('th-TH')}`);res.json({ok:true,user:updated});}catch(e){res.status(400).json({error:e.message});}});
app.post('/api/admin/credit-requests/:id/:action',auth,admin,async(req,res)=>{try{const action=req.params.action;if(!['approve','reject'].includes(action))return res.status(400).json({error:'action ไม่ถูกต้อง'});const {data:r,error}=await db.from('credit_requests').select('*').eq('id',req.params.id).maybeSingle();if(error)throw error;if(!r||r.status!=='pending')return res.status(400).json({error:'คำขอนี้ถูกดำเนินการแล้ว'});if(action==='approve'){await credit(r.user_id,r.type,Number(r.amount),`อนุมัติคำขอ: ${r.reason}`);}await db.from('credit_requests').update({status:action==='approve'?'approved':'rejected',reviewed_by:req.user.id,reviewed_at:new Date().toISOString()}).eq('id',r.id);const u=await userById(r.user_id);if(u?.line_user_id)await pushLine(u.line_user_id,action==='approve'?`✅ คำขอเติมเครดิต ฿${Number(r.amount).toLocaleString('th-TH')} ได้รับการอนุมัติ\nเครดิตคงเหลือ ฿${Number(u.credit).toLocaleString('th-TH')}`:`❌ คำขอเติมเครดิต ฿${Number(r.amount).toLocaleString('th-TH')} ถูกปฏิเสธ`);res.json({ok:true});}catch(e){res.status(400).json({error:e.message});}});
app.post('/api/line/webhook',async(req,res)=>{res.sendStatus(200);const sig=req.headers['x-line-signature']||'';const raw=req.rawBody||Buffer.from(JSON.stringify(req.body));if(process.env.LINE_CHANNEL_SECRET){const h=crypto.createHmac('sha256',process.env.LINE_CHANNEL_SECRET).update(raw).digest('base64');if(h!==sig)return;}for(const e of req.body.events||[]){if(e.type==='message'&&e.message?.type==='text'){const code=e.message.text.trim().toUpperCase();const {data:u}=await db.from('users').select('id,name').eq('line_link_code',code).maybeSingle();if(u){await db.from('users').update({line_user_id:e.source.userId}).eq('id',u.id);await pushLine(e.source.userId,`เชื่อมต่อบัญชี ${u.name} สำเร็จ ✅`);}}}});
app.use((error,_req,res,_next)=>{console.error('[express]',error);res.status(500).json({error:'เกิดข้อผิดพลาดภายใน Backend'});});
cron.schedule('* * * * *',()=>lifecycle());
app.listen(Number(process.env.PORT||3000),()=>console.log(`Backend listening on ${process.env.PORT||3000}`));
