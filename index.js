const express = require("express");
const path = require("path");
const crypto = require("crypto");
const admin = require("firebase-admin");

const app = express();
app.use(express.json({ limit: "200kb" }));

const BOT_TOKEN = process.env.BOT_TOKEN;
const CHANNELS = ["@usdt_g_ram", "@usdt_hub_payment_proof"];
const REWARD_TASKS = [
  { id: "phone_teach", title: "Phone Teach", username: "@phone_teach", url: "https://t.me/phone_teach", points: 500 },
  { id: "forex_big", title: "Forex Big", username: "@forex_big", url: "https://t.me/forex_big", points: 500 }
];
const PAYMENT_CHANNEL = "@usdt_hub_payment_proof";
const ADMINS = new Set(["5479488791", "5980396006"]);
const MINI_APP_SHORT_NAME = "birr";
const REFERRAL_BASE_URL = "https://t.me/Birrgram_bot/birr";

const POINTS_PER_AD = 200;
const POINTS_PER_REF = 1000;
const DAILY_AD_LIMIT = 50;
const DAILY_CLAIM_POINTS = 500;
const WITHDRAW_POINTS = 30000;
const WITHDRAW_BIRR = 30;

if (!admin.apps.length) {
  if (!process.env.FIREBASE_SERVICE_ACCOUNT_JSON) {
    throw new Error("FIREBASE_SERVICE_ACCOUNT_JSON is missing.");
  }
  let serviceAccount;
  try {
    serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_JSON);
  } catch (e) {
    throw new Error("FIREBASE_SERVICE_ACCOUNT_JSON is invalid JSON.");
  }
  admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
}

const db = admin.firestore();

function telegramAuth(initData) {
  if (!initData || !BOT_TOKEN) throw new Error("Telegram authentication is unavailable.");
  const p = new URLSearchParams(initData);
  const hash = p.get("hash");
  const authDate = Number(p.get("auth_date"));
  if (!hash || !authDate || Date.now() / 1000 - authDate > 86400) {
    throw new Error("Telegram session expired.");
  }
  p.delete("hash");
  const dataCheck = [...p.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${k}=${v}`)
    .join("\n");
  const secret = crypto.createHmac("sha256", "WebAppData").update(BOT_TOKEN).digest();
  const check = crypto.createHmac("sha256", secret).update(dataCheck).digest("hex");
  if (check.length !== hash.length || !crypto.timingSafeEqual(Buffer.from(check), Buffer.from(hash))) {
    throw new Error("Invalid Telegram authentication.");
  }
  return JSON.parse(p.get("user") || "{}");
}

function getUser(req) {
  return telegramAuth(req.body?.initData);
}

function todayKey() {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Addis_Ababa" }).format(new Date());
}

function cleanPhone(value) {
  return String(value || "").replace(/\s+/g, "");
}

async function bot(method, params) {
  if (!BOT_TOKEN) throw new Error("BOT_TOKEN is missing.");
  const r = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/${method}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(params)
  });
  const d = await r.json();
  if (!d.ok) throw new Error(d.description || "Telegram API error");
  return d.result;
}

async function verifyMembership(uid) {
  for (const chat of CHANNELS) {
    try {
      const member = await bot("getChatMember", { chat_id: chat, user_id: Number(uid) });
      const ok = ["creator", "administrator", "member"].includes(member.status) ||
        (member.status === "restricted" && member.is_member === true);
      if (!ok) return false;
    } catch (e) {
      console.error(`Membership check failed for ${chat}:`, e.message);
      throw new Error(`የ${chat} አባልነት ማረጋገጥ አልተቻለም። Bot በዚህ ቻናል administrator መሆኑን ያረጋግጡ።`);
    }
  }
  return true;
}

async function ensureUser(tgUser, referralId) {
  const uid = String(tgUser.id);
  const userRef = db.collection("users").doc(uid);
  const existing = await userRef.get();
  const old = existing.exists ? existing.data() : {};
  const incoming = String(referralId || "").trim();
  const pending = String(old.pendingReferralId || "").trim();
  const ref = incoming || pending;

  const validRef = /^\d+$/.test(ref) && ref !== uid;
  const baseUser = {
    userId: uid,
    firstName: String(tgUser.first_name || old.firstName || ""),
    lastName: String(tgUser.last_name || old.lastName || ""),
    username: String(tgUser.username || old.username || ""),
    points: Number(old.points || 0),
    referrals: Number(old.referrals || 0),
    adsToday: Number(old.adsToday || 0),
    lastAdDate: old.lastAdDate || null,
    lastClaimDate: old.lastClaimDate || null,
    claimStreak: Number(old.claimStreak || 0),
    pendingReferralId: validRef ? ref : (old.pendingReferralId || null),
    createdAt: old.createdAt || admin.firestore.FieldValue.serverTimestamp(),
    updatedAt: admin.firestore.FieldValue.serverTimestamp()
  };
  await userRef.set(baseUser, { merge: true });

  if (!validRef) return false;

  const referrerRef = db.collection("users").doc(ref);
  const claimRef = db.collection("referralClaims").doc(uid);
  let credited = false;

  await db.runTransaction(async tx => {
    const [claimSnap, referrerSnap] = await Promise.all([
      tx.get(claimRef),
      tx.get(referrerRef)
    ]);
    if (claimSnap.exists || !referrerSnap.exists) return;

    tx.set(claimRef, {
      referrerId: ref,
      invitedUserId: uid,
      points: POINTS_PER_REF,
      createdAt: admin.firestore.FieldValue.serverTimestamp()
    });
    tx.update(referrerRef, {
      points: admin.firestore.FieldValue.increment(POINTS_PER_REF),
      referrals: admin.firestore.FieldValue.increment(1),
      updatedAt: admin.firestore.FieldValue.serverTimestamp()
    });
    credited = true;
  });

  if (credited) {
    await userRef.set({
      pendingReferralId: admin.firestore.FieldValue.delete(),
      updatedAt: admin.firestore.FieldValue.serverTimestamp()
    }, { merge: true });
  }
  return credited;
}
async function getState(uid) {
  const snap = await db.collection("users").doc(String(uid)).get();
  if (!snap.exists) throw new Error("User not found");
  const d = snap.data();
  const date = todayKey();
  const adsToday = d.lastAdDate === date ? Number(d.adsToday || 0) : 0;
  const claimedToday = d.lastClaimDate === date;

  const withdrawalsSnap = await db.collection("withdrawals")
    .where("userId", "==", String(uid))
    .orderBy("createdAt", "desc")
    .get()
    .catch(() => null);

  const withdrawals = withdrawalsSnap
    ? withdrawalsSnap.docs.map(x => ({
        id: x.id,
        ...x.data(),
        createdAt: x.data().createdAt?.toDate?.()?.toISOString() || new Date().toISOString()
      }))
    : [];

  return {
    userId: String(uid),
    firstName: d.firstName || "",
    points: Number(d.points || 0),
    referrals: Number(d.referrals || 0),
    adsToday,
    remainingAds: Math.max(0, DAILY_AD_LIMIT - adsToday),
    claimedToday,
    claimStreak: Number(d.claimStreak || 0),
    dailyClaimPoints: DAILY_CLAIM_POINTS,
    referralReward: POINTS_PER_REF,
    referralLink: `${REFERRAL_BASE_URL}?startapp=${encodeURIComponent(uid)}`,
    withdrawPoints: WITHDRAW_POINTS,
    withdrawBirr: WITHDRAW_BIRR,
    withdrawalCount: withdrawals.length,
    withdrawals,
    rewardTasks: await getRewardTasks(uid)
  };
}

async function getRewardTasks(uid) {
  const out = [];
  for (const task of REWARD_TASKS) {
    const claim = await db.collection("taskClaims").doc(`${String(uid)}_${task.id}`).get();
    if (!claim.exists) out.push(task);
  }
  return out;
}

async function claimRewardTask(uid, taskId) {
  const task = REWARD_TASKS.find(x => x.id === String(taskId));
  if (!task) throw new Error("ይህ ተግባር አይገኝም።");

  const claimRef = db.collection("taskClaims").doc(`${String(uid)}_${task.id}`);
  const userRef = db.collection("users").doc(String(uid));
  const member = await bot("getChatMember", { chat_id: task.username, user_id: Number(uid) });
  const joined = ["creator", "administrator", "member"].includes(member.status) ||
    (member.status === "restricted" && member.is_member === true);
  if (!joined) throw new Error(`❌ ${task.username} ቻናልን ተቀላቅለው ከዚያ VERIFY ያድርጉ።`);

  let credited = false;
  await db.runTransaction(async tx => {
    const [claimSnap, userSnap] = await Promise.all([tx.get(claimRef), tx.get(userRef)]);
    if (!userSnap.exists) throw new Error("User not found");
    if (claimSnap.exists) return;
    tx.set(claimRef, {
      userId: String(uid),
      taskId: task.id,
      channel: task.username,
      points: task.points,
      createdAt: admin.firestore.FieldValue.serverTimestamp()
    });
    tx.update(userRef, {
      points: admin.firestore.FieldValue.increment(task.points),
      updatedAt: admin.firestore.FieldValue.serverTimestamp()
    });
    credited = true;
  });
  return credited;
}

async function requireVerified(req) {
  const user = getUser(req);
  const verified = await verifyMembership(user.id);
  if (!verified) throw new Error("እባክዎ ሁለቱንም ቻናሎች ተቀላቅለው ያረጋግጡ።");
  return user;
}

function sendErr(res, e) {
  res.status(400).json({ error: e.message || "ስህተት ተፈጥሯል" });
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;"
  }[c]));
}


// Telegram webhook: replies to /start and /start REFERRER_ID.
// Configure Telegram once with: setWebhook -> https://YOUR_DOMAIN/telegram/webhook
app.get("/", (_, res) => res.sendFile(path.join(__dirname, "index.html")));
app.get("/health", async (_, res) => {
  try {
    await db.collection("_health").doc("ping").get();
    res.json({ ok: true, service: "Birr Gram", firebase: true });
  } catch (e) {
    res.status(500).json({ ok: false, service: "Birr Gram", firebase: false, error: e.message });
  }
});

app.post("/api/reward-tasks", async (req, res) => {
  try {
    const u = getUser(req);
    const verified = await verifyMembership(u.id);
    if (!verified) throw new Error("እባክዎ ሁለቱንም ዋና ቻናሎች ተቀላቅለው ያረጋግጡ።");
    res.json({ tasks: await getRewardTasks(u.id) });
  } catch (e) { sendErr(res, e); }
});

app.post("/api/claim-task", async (req, res) => {
  try {
    const u = getUser(req);
    const verified = await verifyMembership(u.id);
    if (!verified) throw new Error("እባክዎ ሁለቱንም ዋና ቻናሎች ተቀላቅለው ያረጋግጡ።");
    const taskId = String(req.body.taskId || "").trim();
    const credited = await claimRewardTask(u.id, taskId);
    const state = await getState(u.id);
    res.json({ credited, state });
  } catch (e) { sendErr(res, e); }
});

app.post("/api/verify-channels", async (req, res) => {
  try {
    const u = getUser(req);
    const verified = await verifyMembership(u.id);
    let referralCredited = false;
    if (verified) referralCredited = await ensureUser(u, req.body.referralId);
    res.json({ verified, referralCredited });
  } catch (e) {
    sendErr(res, e);
  }
});

app.post("/api/claim-referral", async (req, res) => {
  try {
    const u = getUser(req);
    const verified = await verifyMembership(u.id);
    if (!verified) throw new Error("እባክዎ ሁለቱንም ቻናሎች ተቀላቅለው ያረጋግጡ።");
    const incoming = String(req.body.referralId || "").trim();
    const credited = await ensureUser(u, incoming);
    res.json({ credited, state: await getState(u.id) });
  } catch (e) {
    sendErr(res, e);
  }
});

app.post("/api/user", async (req, res) => {
  try {
    const u = getUser(req);
    const incoming = String(req.body.referralId || "").trim();
    if(/^\d+$/.test(incoming) && incoming !== String(u.id)){
      await db.collection("users").doc(String(u.id)).set({
        pendingReferralId: incoming,
        updatedAt: admin.firestore.FieldValue.serverTimestamp()
      }, {merge:true});
    }
    const verified = await verifyMembership(u.id);
    if(!verified) throw new Error("እባክዎ ሁለቱንም ቻናሎች ተቀላቅለው ያረጋግጡ።");
    await ensureUser(u, incoming);
    res.json(await getState(u.id));
  } catch (e) {
    sendErr(res, e);
  }
});

app.post("/api/daily-claim", async (req, res) => {
  try {
    const u = await requireVerified(req);
    const ref = db.collection("users").doc(String(u.id));
    const date = todayKey();
    let streak = 1;

    await db.runTransaction(async tx => {
      const snap = await tx.get(ref);
      if (!snap.exists) throw new Error("User not found");
      const d = snap.data();
      if (d.lastClaimDate === date) throw new Error("የዛሬን ዕለታዊ ሽልማት አስቀድመው ወስደዋል።");

      const previous = String(d.lastClaimDate || "");
      let nextStreak = 1;
      if (previous) {
        const prevDate = new Date(`${previous}T00:00:00+03:00`);
        const nowDate = new Date(`${date}T00:00:00+03:00`);
        const diff = Math.round((nowDate - prevDate) / 86400000);
        nextStreak = diff === 1 ? Number(d.claimStreak || 0) + 1 : 1;
      }
      streak = nextStreak;

      tx.update(ref, {
        points: admin.firestore.FieldValue.increment(DAILY_CLAIM_POINTS),
        lastClaimDate: date,
        claimStreak: nextStreak,
        updatedAt: admin.firestore.FieldValue.serverTimestamp()
      });
      tx.set(db.collection("claimEvents").doc(), {
        userId: String(u.id),
        date,
        points: DAILY_CLAIM_POINTS,
        streak: nextStreak,
        createdAt: admin.firestore.FieldValue.serverTimestamp()
      });
    });

    res.json({ state: await getState(u.id), streak });
  } catch (e) {
    sendErr(res, e);
  }
});

app.post("/api/ad-complete", async (req, res) => {
  try {
    const u = await requireVerified(req);
    const ref = db.collection("users").doc(String(u.id));
    const date = todayKey();

    await db.runTransaction(async tx => {
      const snap = await tx.get(ref);
      if (!snap.exists) throw new Error("User not found");
      const d = snap.data();
      const count = d.lastAdDate === date ? Number(d.adsToday || 0) : 0;
      if (count >= DAILY_AD_LIMIT) throw new Error("የዛሬ 50 ማስታወቂያ ገደብ ደርሷል።");

      tx.update(ref, {
        points: admin.firestore.FieldValue.increment(POINTS_PER_AD),
        adsToday: count + 1,
        lastAdDate: date,
        updatedAt: admin.firestore.FieldValue.serverTimestamp()
      });
      tx.set(db.collection("adEvents").doc(), {
        userId: String(u.id), date, points: POINTS_PER_AD,
        createdAt: admin.firestore.FieldValue.serverTimestamp()
      });
    });

    res.json({ state: await getState(u.id) });
  } catch (e) {
    sendErr(res, e);
  }
});

app.post("/api/withdraw", async (req, res) => {
  try {
    const u = await requireVerified(req);
    const firstName = String(req.body.firstName || "").trim();
    const telebirr = cleanPhone(req.body.telebirr);
    if (!firstName || !/^09\d{8}$/.test(telebirr)) {
      throw new Error("ስም እና ትክክለኛ የTelebirr ቁጥር ያስገቡ።");
    }

    let withdrawalId;
    await db.runTransaction(async tx => {
      const userRef = db.collection("users").doc(String(u.id));
      const snap = await tx.get(userRef);
      if (!snap.exists) throw new Error("User not found");
      const d = snap.data();
      if (Number(d.points || 0) < WITHDRAW_POINTS) throw new Error("30,000 ነጥብ ሳይደርስ ማውጣት አይችሉም።");

      // Each withdrawal request consumes one verified referral.
      const allWithdrawals = await db.collection("withdrawals")
        .where("userId", "==", String(u.id)).get();
      const previousWithdrawalCount = allWithdrawals.size;
      if (Number(d.referrals || 0) <= previousWithdrawalCount) {
        throw new Error("ለዚህ ማውጣት ቢያንስ 1 ተጨማሪ ሪፈራል ያስፈልግዎታል።");
      }

      const q = await db.collection("withdrawals")
        .where("userId", "==", String(u.id))
        .where("status", "==", "PENDING")
        .limit(1).get();
      if (!q.empty) throw new Error("አንድ የሚጠባበቅ የክፍያ ጥያቄ አለዎት።");

      const wr = db.collection("withdrawals").doc();
      withdrawalId = wr.id;
      tx.update(userRef, {
        points: admin.firestore.FieldValue.increment(-WITHDRAW_POINTS),
        updatedAt: admin.firestore.FieldValue.serverTimestamp()
      });
      tx.set(wr, {
        userId: String(u.id), firstName, telebirr,
        points: WITHDRAW_POINTS, amountBirr: WITHDRAW_BIRR,
        status: "PENDING", createdAt: admin.firestore.FieldValue.serverTimestamp()
      });
    });

    const text = `💸 <b>የክፍያ ጥያቄ</b>\n\n👤 ስም: ${escapeHtml(firstName)}\n🆔 ID: <code>${u.id}</code>\n📱 Telebirr: <code>${escapeHtml(telebirr)}</code>\n💰 ነጥብ: 30,000\n📌 ሁኔታ: Pending ⏳\n\n#BirrGram`;
    // Public payment-proof channel: request text only, NO admin button.
    const msg = await bot("sendMessage", {
      chat_id: PAYMENT_CHANNEL,
      text,
      parse_mode: "HTML"
    });
    await db.collection("withdrawals").doc(withdrawalId).update({
      telegramMessageId: msg.message_id,
      telegramChatId: String(msg.chat.id)
    });

    // Private admin controls: only the two configured Telegram IDs receive the Done button.
    const adminText = `💸 <b>Withdrawal requires payment</b>\n\n👤 Name: ${escapeHtml(firstName)}\n🆔 ID: <code>${u.id}</code>\n📱 Telebirr: <code>${escapeHtml(telebirr)}</code>\n💰 Points: 30,000\n📌 Status: Pending ⏳\n\nRequest ID: <code>${withdrawalId}</code>`;
    for (const adminId of ADMINS) {
      await bot("sendMessage", {
        chat_id: adminId,
        text: adminText,
        parse_mode: "HTML",
        reply_markup: { inline_keyboard: [[{ text: "✅ Done Payment", callback_data: `done:${withdrawalId}` }]] }
      });
    }

    res.json({ state: await getState(u.id) });
  } catch (e) {
    sendErr(res, e);
  }
});

app.post("/telegram/webhook", async (req, res) => {
  // Process the update before responding. Vercel serverless functions may stop
  // execution immediately after the response, so fire-and-forget processing can
  // silently prevent /start replies and callback handling.
  try {
    const message = req.body?.message;
    if (message?.text) {
      const text = String(message.text).trim();
      if (/^\/start(?:@\w+)?(?:\s+.*)?$/i.test(text)) {
        // Telegram can retry the same webhook update. Store update_id atomically
        // so one /start update can never produce multiple welcome messages.
        const updateId = req.body?.update_id;
        if (updateId !== undefined && updateId !== null) {
          try {
            await db.collection("telegramUpdates").doc(String(updateId)).create({
              processedAt: admin.firestore.FieldValue.serverTimestamp(),
              type: "start"
            });
          } catch (e) {
            if (e?.code === 6 || e?.code === "already-exists") return res.sendStatus(200);
            throw e;
          }
        }

        const user = message.from || {};
        const parts = text.split(/\s+/);
        const startPayload = parts.length > 1 ? parts.slice(1).join(" ").trim() : "";
        const uid = String(user.id || message.chat.id);
        const validRef = /^\d+$/.test(startPayload) && uid !== startPayload;

        if (validRef) {
          await db.collection("users").doc(uid).set({
            pendingReferralId: startPayload,
            userId: uid,
            firstName: String(user.first_name || ""),
            lastName: String(user.last_name || ""),
            username: String(user.username || ""),
            updatedAt: admin.firestore.FieldValue.serverTimestamp()
          }, { merge: true });
        }

        const welcome = `👋 <b>እንኳን ወደ Birr Gram በደህና መጡ!</b>\n\n📺 ማስታወቂያዎችን በመመልከት 200 points ያግኙ።\n👥 ጓደኞችን በመጋበዝ 1000 points ያግኙ።\n🎁 በየቀኑ 500 points ይውሰዱ።\n💰 points ሰብስበው ወደ Telebirr ያውጡ።\n\n👇 <b>Birr Gram ን በቀጥታ ለመክፈት</b>`;
        const appUrl = `${REFERRAL_BASE_URL}${validRef ? `?startapp=${encodeURIComponent(startPayload)}` : "?startapp=" + encodeURIComponent(uid)}`;
        await bot("setChatMenuButton", {
          chat_id: message.chat.id,
          menu_button: { type: "web_app", text: "🚀 Open Birr Gram", web_app: { url: appUrl } }
        });
        await bot("sendMessage", {
          chat_id: message.chat.id,
          text: welcome,
          parse_mode: "HTML",
          reply_markup: {
            inline_keyboard: [[{
              text: "🚀 Birr Gram ክፈት",
              url: appUrl
            }]]
          }
        });
        return;
      }
    }

    const cb = req.body?.callback_query;
    if (cb) {
      const fromId = String(cb.from?.id || "");
      const data = String(cb.data || "");
      if (!data.startsWith("done:")) return;

      if (!ADMINS.has(fromId)) {
        await bot("answerCallbackQuery", {
          callback_query_id: cb.id,
          text: "⛔ ፈቃድ የለዎትም።",
          show_alert: true
        });
        return;
      }

      const id = data.slice(5);
      const wr = db.collection("withdrawals").doc(id);
      const snap = await wr.get();
      if (!snap.exists) {
        await bot("answerCallbackQuery", { callback_query_id: cb.id, text: "ጥያቄው አልተገኘም።", show_alert: true });
        return;
      }

      const d = snap.data();
      if (d.status !== "SUCCESSFULLY") {
        await wr.update({ status: "SUCCESSFULLY", paidBy: fromId, paidAt: admin.firestore.FieldValue.serverTimestamp() });
      }
      await bot("answerCallbackQuery", { callback_query_id: cb.id, text: "✅ Payment marked successfully." });

      if (cb.message?.chat?.id && cb.message?.message_id) {
        const oldText = cb.message.text || "";
        await bot("editMessageText", {
          chat_id: cb.message.chat.id,
          message_id: cb.message.message_id,
          text: `${oldText}\n\n✅ <b>PAID / SUCCESSFULLY</b>`,
          parse_mode: "HTML"
        }).catch(() => {});
      }
    }
    return res.sendStatus(200);
  } catch (e) {
    console.error("Webhook error:", e);
    return res.sendStatus(200);
  }
});

// Registers the Telegram webhook whenever the app is opened/health-checked.
// This makes initial deployment less error-prone; WEBAPP_URL must be the public
// HTTPS Vercel URL of this project.
async function ensureWebhook() {
  const base = String(process.env.WEBAPP_URL || "").replace(/\/$/, "");
  if (!base || !BOT_TOKEN) return;
  const url = `${base}/telegram/webhook`;
  try {
    await bot("setWebhook", { url, allowed_updates: ["message", "callback_query"] });
  } catch (e) {
    console.error("Webhook setup failed:", e.message);
  }
}
app.get("/setup-webhook", async (_, res) => {
  await ensureWebhook();
  res.json({ ok: true, webhook: `${String(process.env.WEBAPP_URL || "").replace(/\/$/, "")}/telegram/webhook` });
});
app.get("/webhook-status", async (_, res) => {
  try {
    const info = await bot("getWebhookInfo", {});
    res.json({ ok: true, result: info });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

module.exports = app;
