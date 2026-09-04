const express = require("express");
const path = require("path");
const crypto = require("crypto");
const admin = require("firebase-admin");

const app = express();
app.use(express.json({limit:"200kb"}));

const BOT_TOKEN = process.env.BOT_TOKEN;
const WEBAPP_URL = process.env.WEBAPP_URL || "https://example.com";
const CHANNELS = ["@usdt_g_ram", "@usdt_hub_payment_proof"];
const PAYMENT_CHANNEL = "@usdt_hub_payment_proof";
const ADMINS = new Set(["5479488791","5980396006"]);
const POINTS_PER_AD = 200;
const POINTS_PER_REF = 300;
const WITHDRAW_POINTS = 20000;
const WITHDRAW_BIRR = 25;
const DAILY_AD_LIMIT = 50;

if (!admin.apps.length) {
  if (process.env.FIREBASE_SERVICE_ACCOUNT_JSON) {
    try{
      const serviceAccount=JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_JSON);
      admin.initializeApp({credential:admin.credential.cert(serviceAccount)});
    }catch(e){
      console.error("Invalid FIREBASE_SERVICE_ACCOUNT_JSON:",e.message);
      throw new Error("Firebase service-account configuration is invalid.");
    }
  }else{
    admin.initializeApp({credential:admin.credential.applicationDefault()});
  }
}
const db = admin.firestore();

function telegramAuth(initData) {
  if (!initData || !BOT_TOKEN) throw new Error("Telegram authentication is unavailable.");
  const p = new URLSearchParams(initData);
  const hash = p.get("hash");
  const authDate = Number(p.get("auth_date"));
  if (!hash || !authDate || Date.now()/1000-authDate > 86400) throw new Error("Telegram session expired.");
  p.delete("hash");
  const dataCheck = [...p.entries()].sort(([a],[b])=>a.localeCompare(b)).map(([k,v])=>`${k}=${v}`).join("\n");
  const secret = crypto.createHmac("sha256","WebAppData").update(BOT_TOKEN).digest();
  const check = crypto.createHmac("sha256",secret).update(dataCheck).digest("hex");
  if (!crypto.timingSafeEqual(Buffer.from(check),Buffer.from(hash))) throw new Error("Invalid Telegram authentication.");
  return JSON.parse(p.get("user") || "{}");
}
function getUser(req){ return telegramAuth(req.body?.initData); }
function todayKey(){ return new Intl.DateTimeFormat("en-CA",{timeZone:"Africa/Addis_Ababa"}).format(new Date()); }
function cleanPhone(x){return String(x||"").replace(/\s+/g,"");}
async function bot(method, params){
  const r=await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/${method}`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(params)});
  const d=await r.json();
  if(!d.ok) throw new Error(d.description||"Telegram API error");
  return d.result;
}
async function verifyMembership(uid){
  for(const chat of CHANNELS){
    try{
      const m=await bot("getChatMember",{chat_id:chat,user_id:Number(uid)});
      if(!["creator","administrator","member"].includes(m.status) && !(m.status==="restricted" && m.is_member)) return false;
    }catch(e){
      console.error(`Membership check failed for ${chat}:`,e.message);
      throw new Error(`የ${chat} አባልነት ማረጋገጥ አልተቻለም። Bot በዚህ ቻናል administrator መሆኑን ያረጋግጡ።`);
    }
  }
  return true;
}
async function ensureUser(tgUser, referralId){
  const ref=String(referralId||"");
  const refDoc=ref && /^\d+$/.test(ref) ? db.collection("users").doc(ref) : null;
  const refSnap=refDoc ? await refDoc.get() : null;
  const referrerOk=refSnap?.exists && ref!==String(tgUser.id);
  const referrerId=referrerOk?ref:null;
  const referrerEligible=referrerId ? await verifyMembership(tgUser.id).catch(()=>false) : false;
  const referrerUserRef=db.collection("users").doc(String(tgUser.id));
  const referrerMarker=referrerId?db.collection("referralClaims").doc(String(tgUser.id)):null;
  const referrerMarkerSnap=referrerMarker?await referrerMarker.get():null;

  await db.runTransaction(async tx=>{
    const snap=await tx.get(referrerUserRef);
    if(!snap.exists){
      tx.set(referrerUserRef,{userId:String(tgUser.id),firstName:String(tgUser.first_name||""),username:String(tgUser.username||""),points:0,referrals:0,createdAt:admin.firestore.FieldValue.serverTimestamp(),updatedAt:admin.firestore.FieldValue.serverTimestamp(),lastAdDate:null,adsToday:0,referralProcessed:false});
    } else {
      tx.update(referrerUserRef,{firstName:String(tgUser.first_name||snap.data().firstName||""),username:String(tgUser.username||snap.data().username||""),updatedAt:admin.firestore.FieldValue.serverTimestamp()});
    }
  });

  if(referrerId && referrerEligible && !referrerMarkerSnap?.exists && String(tgUser.id)!==referrerId){
    await db.runTransaction(async tx=>{
      const marker=await tx.get(referrerMarker);
      const target=await tx.get(referrerUserRef);
      const referrer=await tx.get(refDoc);
      if(marker.exists || !target.exists || !referrer.exists) return;
      tx.set(referrerMarker,{referrerId,invitedUserId:String(tgUser.id),createdAt:admin.firestore.FieldValue.serverTimestamp()});
      tx.update(refDoc,{points:admin.firestore.FieldValue.increment(POINTS_PER_REF),referrals:admin.firestore.FieldValue.increment(1),updatedAt:admin.firestore.FieldValue.serverTimestamp()});
    });
  }
}
async function getState(uid){
  const snap=await db.collection("users").doc(String(uid)).get();
  if(!snap.exists) throw new Error("User not found");
  const d=snap.data();
  const date=todayKey();
  const adsToday=d.lastAdDate===date?Number(d.adsToday||0):0;
  const withdrawalsSnap=await db.collection("withdrawals").where("userId","==",String(uid)).orderBy("createdAt","desc").limit(20).get().catch(()=>null);
  const withdrawals=withdrawalsSnap?withdrawalsSnap.docs.map(x=>({id:x.id,...x.data(),createdAt:x.data().createdAt?.toDate?.()?.toISOString()||new Date().toISOString()})):[];

  return {userId:String(uid),firstName:d.firstName||"",points:Number(d.points||0),referrals:Number(d.referrals||0),adsToday,withdrawals,referralLink:`${WEBAPP_URL.replace(/\/$/,"")}/?ref=${uid}`};
}
async function requireVerified(req){
  const u=getUser(req);
  const verified=await verifyMembership(u.id);
  if(!verified) throw new Error("እባክዎ ሁለቱንም ቻናሎች ተቀላቅለው ያረጋግጡ።");
  return u;
}
function sendErr(res,e){res.status(400).json({error:e.message||"ስህተት ተፈጥሯል"});}

app.get("/",(_,res)=>res.sendFile(path.join(__dirname,"index.html")));
app.post("/api/verify-channels",async(req,res)=>{try{const u=getUser(req);const verified=await verifyMembership(u.id);if(verified) await ensureUser(u,req.body.referralId);res.json({verified})}catch(e){sendErr(res,e)}});

app.post("/api/user",async(req,res)=>{try{const u=await requireVerified(req);await ensureUser(u,req.body.referralId);res.json(await getState(u.id))}catch(e){sendErr(res,e)}});
app.post("/api/ad-complete",async(req,res)=>{
  try{
    const u=await requireVerified(req); const ref=db.collection("users").doc(String(u.id)); const date=todayKey();
    await db.runTransaction(async tx=>{
      const snap=await tx.get(ref); if(!snap.exists) throw new Error("User not found");
      const d=snap.data(); const count=d.lastAdDate===date?Number(d.adsToday||0):0;
      if(count>=DAILY_AD_LIMIT) throw new Error("የዛሬ 50 ማስታወቂያ ገደብ ደርሷል።");
      tx.update(ref,{points:admin.firestore.FieldValue.increment(POINTS_PER_AD),adsToday:count+1,lastAdDate:date,updatedAt:admin.firestore.FieldValue.serverTimestamp()});
      tx.set(db.collection("adEvents").doc(),{userId:String(u.id),date,points:POINTS_PER_AD,createdAt:admin.firestore.FieldValue.serverTimestamp()});
    });
    res.json({state:await getState(u.id)});
  }catch(e){sendErr(res,e)}
});
app.post("/api/withdraw",async(req,res)=>{
  try{
    const u=await requireVerified(req); const firstName=String(req.body.firstName||"").trim(); const telebirr=cleanPhone(req.body.telebirr);
    if(!firstName || !/^09\d{8}$/.test(telebirr)) throw new Error("ስም እና ትክክለኛ የTelebirr ቁጥር ያስገቡ።");
    let withdrawalId;
    await db.runTransaction(async tx=>{
      const userRef=db.collection("users").doc(String(u.id)); const snap=await tx.get(userRef); if(!snap.exists) throw new Error("User not found");
      const d=snap.data(); if(Number(d.points||0)<WITHDRAW_POINTS) throw new Error("20,000 ነጥብ ሳይደርስ ማውጣት አይችሉም።");
      const q=await db.collection("withdrawals").where("userId","==",String(u.id)).where("status","==","PENDING").limit(1).get();
      if(!q.empty) throw new Error("አንድ የሚጠባበቅ የክፍያ ጥያቄ አለዎት።");
      const wr=db.collection("withdrawals").doc(); withdrawalId=wr.id;
      tx.update(userRef,{points:admin.firestore.FieldValue.increment(-WITHDRAW_POINTS),updatedAt:admin.firestore.FieldValue.serverTimestamp()});
      tx.set(wr,{userId:String(u.id),firstName,telebirr,points:WITHDRAW_POINTS,amountBirr:WITHDRAW_BIRR,status:"PENDING",createdAt:admin.firestore.FieldValue.serverTimestamp()});
    });
    const text=`💸 <b>የክፍያ ጥያቄ</b>\n\n👤 ስም: ${escapeHtml(firstName)}\n🆔 ID: <code>${u.id}</code>\n📱 Telebirr: <code>${escapeHtml(telebirr)}</code>\n💰 ነጥብ: 20,000\n💵 መጠን: 25 ብር\n📌 ሁኔታ: Pending ⏳\n\n#BirrGram`;
    const msg=await bot("sendMessage",{chat_id:PAYMENT_CHANNEL,text,parse_mode:"HTML",reply_markup:{inline_keyboard:[[{text:"✅ Done Payment",callback_data:`done:${withdrawalId}`}]]}});
    await db.collection("withdrawals").doc(withdrawalId).update({telegramMessageId:msg.message_id,telegramChatId:String(msg.chat.id)});
    res.json({state:await getState(u.id)});
  }catch(e){sendErr(res,e)}
});
function escapeHtml(s){return String(s).replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"}[c]));}

app.post("/telegram/webhook",async(req,res)=>{
  try{
    const u=req.body?.callback_query?.from; const cb=req.body?.callback_query;
    if(cb){
      const data=String(cb.data||"");
      if(data.startsWith("done:")){
        if(!ADMINS.has(String(u?.id))){await bot("answerCallbackQuery",{callback_query_id:cb.id,text:"⛔ ፈቃድ የለዎትም።",show_alert:true});return res.sendStatus(200)}
        const id=data.slice(5), wr=db.collection("withdrawals").doc(id), snap=await wr.get();
        if(!snap.exists){await bot("answerCallbackQuery",{callback_query_id:cb.id,text:"ጥያቄው አልተገኘም።",show_alert:true});return res.sendStatus(200)}
        const d=snap.data();
        if(d.status!=="PENDING"){await bot("answerCallbackQuery",{callback_query_id:cb.id,text:"ይህ ክፍያ አስቀድሞ ተጠናቋል።",show_alert:true});return res.sendStatus(200)}
        await wr.update({status:"SUCCESSFULLY",paidBy:String(u.id),paidAt:admin.firestore.FieldValue.serverTimestamp()});
        await bot("editMessageText",{chat_id:d.telegramChatId,message_id:d.telegramMessageId,text:`💸 <b>የክፍያ ጥያቄ</b>\n\n👤 ስም: ${escapeHtml(d.firstName)}\n🆔 ID: <code>${d.userId}</code>\n📱 Telebirr: <code>${escapeHtml(d.telebirr)}</code>\n💰 ነጥብ: 20,000\n💵 መጠን: 25 ብር\n📌 ሁኔታ: Successfully ✅\n\n#BirrGram`,parse_mode:"HTML",reply_markup:{inline_keyboard:[]}});
        await bot("answerCallbackQuery",{callback_query_id:cb.id,text:"ክፍያው Successfully ሆኗል።"});
      }
    }
    res.sendStatus(200);
  }catch(e){res.sendStatus(200)}
});

app.get("/health",async(_,res)=>{
  try{
    await db.collection("users").limit(1).get();
    res.json({ok:true,service:"Birr Gram",firebase:"ok"});
  }catch(e){
    res.status(500).json({ok:false,service:"Birr Gram",firebase:"error"});
  }
});
module.exports=app;
if(require.main===module) app.listen(process.env.PORT||3000);
