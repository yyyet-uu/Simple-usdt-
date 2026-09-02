/*
 * Simple USDT — Vercel backend
 *
 * IMPORTANT:
 * Required Vercel environment variables:
 *   BOT_TOKEN
 *   FIREBASE_SERVICE_ACCOUNT
 *   WALLET_PRIVATE_KEY
 *
 * Optional:
 *   BSC_RPC_URL
 *   USDT_CONTRACT
 *   PAYMENT_PROOF_CHANNEL
 *   ADMIN_TELEGRAM_ID
 *   ADSGRAM_BLOCK_ID
 *
 * This single file routes:
 *   POST /api/user
 *   POST /api/progress
 *   POST /api/ad-complete
 *   POST /api/channel-check
 *   POST /api/channels
 *   POST /api/withdraw
 *
 * Install dependencies:
 *   firebase-admin
 *   ethers
 */

const crypto = require("crypto");
const admin = require("firebase-admin");
const { ethers } = require("ethers");

const CONFIG = {
  botUsername: "Simple_usdt_bot",

  channels: {
    channel1: "@usdt_hub_payment_proof",
    channel2: "@usdt_g_ram",
  },

  requirements: {
    montageAds: 50,
    adsgramAds: 30,
    referrals: 3,
    channels: 2,
  },

  reward: 0.10,
  cooldownHours: 24,
  adsgramBlockId: process.env.ADSGRAM_BLOCK_ID || "",

  // BNB Smart Chain
  bscRpcUrl:
    process.env.BSC_RPC_URL ||
    "https://bsc-dataseed.binance.org/",

  // Binance-Peg BSC-USDt contract.
  // Verify this address against your intended BSC USDT token before funding.
  usdtContract:
    process.env.USDT_CONTRACT ||
    "0x55d398326f99059fF775485246999027B3197955",

  proofChannel:
    process.env.PAYMENT_PROOF_CHANNEL ||
    "@usdt_hub_payment_proof",
};

function json(res, status, data) {
  res.status(status).json(data);
}

function bodyOf(req) {
  if (!req.body) return {};
  if (typeof req.body === "object") return req.body;

  try {
    return JSON.parse(req.body);
  } catch {
    return {};
  }
}

function now() {
  return Date.now();
}

function cleanString(value, max = 500) {
  return String(value ?? "").trim().slice(0, max);
}

function getTelegramInitData(req, body) {
  const header =
    req.headers["x-telegram-init-data"] ||
    req.headers["x-telegram-web-app-init-data"];

  return cleanString(header || body.initData, 10000);
}

/*
 * Telegram Web App initData validation.
 *
 * Telegram's algorithm:
 * secret_key = HMAC-SHA256(bot_token, "WebAppData")
 * data_check_string = sorted key=value pairs except hash
 * calculated_hash = HMAC-SHA256(secret_key, data_check_string)
 */
function validateTelegramInitData(initData) {
  if (!initData || !process.env.BOT_TOKEN) {
    throw new Error("Telegram authentication is not configured.");
  }

  const params = new URLSearchParams(initData);
  const receivedHash = params.get("hash");

  if (!receivedHash || !/^[a-f0-9]{64}$/i.test(receivedHash)) {
    throw new Error("Invalid Telegram authentication data.");
  }

  const pairs = [];

  for (const [key, value] of params.entries()) {
    if (key === "hash") continue;
    pairs.push(`${key}=${value}`);
  }

  pairs.sort();

  const dataCheckString = pairs.join("\n");

  const secretKey = crypto
    .createHmac("sha256", "WebAppData")
    .update(process.env.BOT_TOKEN)
    .digest();

  const calculatedHash = crypto
    .createHmac("sha256", secretKey)
    .update(dataCheckString)
    .digest("hex");

  const a = Buffer.from(calculatedHash, "utf8");
  const b = Buffer.from(receivedHash, "utf8");

  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    throw new Error("Telegram authentication failed.");
  }

  const authDate = Number(params.get("auth_date") || 0);

  // Reject very old initData. The frontend should request fresh Telegram initData.
  if (!authDate || Math.abs(Math.floor(Date.now() / 1000) - authDate) > 86400) {
    throw new Error("Telegram authentication data has expired.");
  }

  let user = {};
  try {
    user = JSON.parse(params.get("user") || "{}");
  } catch {
    throw new Error("Invalid Telegram user data.");
  }

  if (!user.id) {
    throw new Error("Telegram user was not found.");
  }

  return {
    user,
    params,
  };
}

function requireAuth(req, body) {
  const initData = getTelegramInitData(req, body);
  return validateTelegramInitData(initData);
}

function firebaseServiceAccount() {
  const raw = process.env.FIREBASE_SERVICE_ACCOUNT;

  if (!raw) {
    throw new Error(
      "FIREBASE_SERVICE_ACCOUNT is missing in Vercel environment variables."
    );
  }

  try {
    return JSON.parse(raw);
  } catch {
    throw new Error("FIREBASE_SERVICE_ACCOUNT is not valid JSON.");
  }
}

function getDb() {
  if (!admin.apps.length) {
    admin.initializeApp({
      credential: admin.credential.cert(firebaseServiceAccount()),
      databaseURL:
        process.env.FIREBASE_DATABASE_URL ||
        "https://simple-usdt-default-rtdb.firebaseio.com",
    });
  }

  return admin.database();
}

function userRef(db, telegramId) {
  return db.ref(`users/${telegramId}`);
}

function withdrawalRef(db, id) {
  return db.ref(`withdrawals/${id}`);
}

function normalizeUserRecord(data, telegramUser) {
  const cycle = data?.cycle || {};

  return {
    telegramId: String(telegramUser.id),
    username: telegramUser.username || data?.username || "",
    firstName: telegramUser.first_name || data?.firstName || "",

    referralCode:
      data?.referralCode || `ref_${String(telegramUser.id)}`,

    referralLink:
      data?.referralLink ||
      `https://t.me/${CONFIG.botUsername}?start=ref_${String(
        telegramUser.id
      )}`,

    balance: Number(data?.balance || 0),

    montageAds: Number(cycle.montageAds || data?.montageAds || 0),
    adsgramAds: Number(cycle.adsgramAds || data?.adsgramAds || 0),
    referrals: Number(cycle.referrals || data?.referrals || 0),
    channels: Number(cycle.channels || data?.channels || 0),

    channel1: Boolean(cycle.channel1 ?? data?.channel1),
    channel2: Boolean(cycle.channel2 ?? data?.channel2),

    cycleCompleted: Boolean(
      cycle.completed ?? data?.cycleCompleted
    ),

    cooldownUntil: data?.cooldownUntil || null,

    walletAddress: data?.walletAddress || "",
  };
}

function publicUser(data, telegramUser) {
  return normalizeUserRecord(data, telegramUser);
}

function cooldownActive(data) {
  return Number(data?.cooldownUntil || 0) > now();
}

function requirementsMet(data, membershipOverride = null) {
  const cycle = data?.cycle || {};
  const channel1 = membershipOverride ? Boolean(membershipOverride.channel1) : Boolean(cycle.channel1);
  const channel2 = membershipOverride ? Boolean(membershipOverride.channel2) : Boolean(cycle.channel2);

  return (
    Number(cycle.montageAds || 0) >= CONFIG.requirements.montageAds &&
    Number(cycle.adsgramAds || 0) >= CONFIG.requirements.adsgramAds &&
    Number(cycle.referrals || 0) >= CONFIG.requirements.referrals &&
    channel1 &&
    channel2
  );
}

async function maybeCompleteCycle(db, telegramId) {
  const ref = userRef(db, telegramId);
  let completedNow = false;

  await ref.transaction((current) => {
    if (!current || cooldownActive(current)) return current;
    if (current.cycle?.completed === true) return current;
    if (!requirementsMet(current)) return current;

    completedNow = true;
    return {
      ...current,
      balance: CONFIG.reward,
      cycle: {
        ...(current.cycle || {}),
        completed: true,
      },
      updatedAt: admin.database.ServerValue.TIMESTAMP,
    };
  });

  return completedNow;
}

function cycleSnapshot(data) {
  const cycle = data?.cycle || {};

  return {
    montageAds: Number(cycle.montageAds || 0),
    adsgramAds: Number(cycle.adsgramAds || 0),
    referrals: Number(cycle.referrals || 0),
    channels:
      Number(Boolean(cycle.channel1)) +
      Number(Boolean(cycle.channel2)),
    channel1: Boolean(cycle.channel1),
    channel2: Boolean(cycle.channel2),
    completed: Boolean(cycle.completed),
  };
}

async function telegramApi(method, payload = {}) {
  if (!process.env.BOT_TOKEN) {
    throw new Error("BOT_TOKEN is missing.");
  }

  const response = await fetch(
    `https://api.telegram.org/bot${process.env.BOT_TOKEN}/${method}`,
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify(payload),
    }
  );

  const data = await response.json();

  if (!data.ok) {
    throw new Error(
      data.description || `Telegram API error: ${method}`
    );
  }

  return data.result;
}

function isMemberStatus(member) {
  if (!member) return false;

  if (
    member.status === "creator" ||
    member.status === "administrator" ||
    member.status === "member"
  ) {
    return true;
  }

  if (member.status === "restricted" && member.is_member === true) {
    return true;
  }

  return false;
}

async function checkChannelMembership(telegramId, channel) {
  const member = await telegramApi("getChatMember", {
    chat_id: channel,
    user_id: Number(telegramId),
  });

  return isMemberStatus(member);
}

async function verifyBothChannels(telegramId) {
  const [channel1, channel2] = await Promise.all([
    checkChannelMembership(telegramId, CONFIG.channels.channel1),
    checkChannelMembership(telegramId, CONFIG.channels.channel2),
  ]);

  return {
    channel1,
    channel2,
    channels: Number(channel1) + Number(channel2),
  };
}

function parseReferrer(body, telegramParams) {
  const candidates = [
    body.referralCode,
    body.ref,
    telegramParams?.get("start_param"),
    telegramParams?.get("start"),
  ];

  for (const candidate of candidates) {
    const value = cleanString(candidate, 200);

    if (!value) continue;

    if (value.startsWith("ref_")) {
      const id = value.slice(4).trim();

      if (/^\d+$/.test(id)) return id;
    }
  }

  return null;
}

async function assignReferralIfPossible(
  db,
  referredTelegramId,
  referrerTelegramId
) {
  if (!referrerTelegramId) {
    return { assigned: false };
  }

  if (String(referredTelegramId) === String(referrerTelegramId)) {
    return { assigned: false };
  }

  const referredRef = userRef(db, referredTelegramId);
  const referrerRef = userRef(db, referrerTelegramId);

  const [referredSnap, referrerSnap] = await Promise.all([
    referredRef.once("value"),
    referrerRef.once("value"),
  ]);

  const referred = referredSnap.val() || {};
  const referrer = referrerSnap.val() || {};

  // Referral is permanent once assigned.
  if (
    referred.referral &&
    referred.referral.referrerId
  ) {
    return {
      assigned:
        String(referred.referral.referrerId) ===
        String(referrerTelegramId),
      alreadyAssigned: true,
    };
  }

  // Referrer must exist.
  if (!referrerSnap.exists()) {
    return { assigned: false };
  }

  await referredRef.child("referral").set({
    referrerId: String(referrerTelegramId),
    valid: false,
    assignedAt: admin.database.ServerValue.TIMESTAMP,
  });

  return { assigned: true };
}

async function validateReferralAfterChannels(db, referredTelegramId) {
  const referredRef = userRef(db, referredTelegramId);
  const snap = await referredRef.once("value");
  const referral = snap.val()?.referral;

  if (!referral?.referrerId || referral.valid === true) {
    return {
      becameValid: false,
      referrerId: referral?.referrerId || null,
    };
  }

  const membership = await verifyBothChannels(referredTelegramId);
  if (!membership.channel1 || !membership.channel2) {
    return {
      becameValid: false,
      referrerId: referral.referrerId,
      membership,
    };
  }

  // Claim the referral exactly once. Only the transaction that changes
  // valid:false -> valid:true is allowed to increment the referrer.
  let claimed = false;
  const claim = await referredRef.child("referral").transaction((current) => {
    if (!current || current.valid === true) return current;
    claimed = true;
    return {
      ...current,
      valid: true,
      validatedAt: admin.database.ServerValue.TIMESTAMP,
    };
  });

  if (!claimed || !claim.committed) {
    return {
      becameValid: false,
      referrerId: referral.referrerId,
      membership,
    };
  }

  const referrerRef = userRef(db, referral.referrerId);
  await referrerRef.transaction((current) => {
    if (!current) return current;
    const cycle = current.cycle || {};
    const referrals = Number(cycle.referrals || 0);
    const updatedReferrals = Math.min(
      referrals + 1,
      CONFIG.requirements.referrals
    );
    return {
      ...current,
      cycle: { ...cycle, referrals: updatedReferrals },
      updatedAt: admin.database.ServerValue.TIMESTAMP,
    };
  });

  return {
    becameValid: true,
    referrerId: referral.referrerId,
    membership,
  };
}

/*
 * The client tells us an ad was completed.
 *
 * NOTE:
 * A browser callback alone cannot be considered cryptographically secure.
 * For production ad payouts, configure the ad provider's server-side
 * reward/callback mechanism when available.
 *
 * We still protect this endpoint with:
 *   - Telegram initData authentication
 *   - allowed platform check
 *   - one-at-a-time session lock
 *   - server-side cycle limits
 *   - cooldown checks
 */
async function completeAd(db, telegramId, platform) {
  if (!["montage", "adsgram"].includes(platform)) {
    throw new Error("Invalid ad platform.");
  }

  const ref = userRef(db, telegramId);

  let response = null;

  await ref.transaction((current) => {
    if (!current) return current;

    if (cooldownActive(current)) {
      throw new Error("Your 24-hour cooldown is active.");
    }

    const cycle = current.cycle || {};

    const key =
      platform === "montage" ? "montageAds" : "adsgramAds";

    const limit =
      platform === "montage"
        ? CONFIG.requirements.montageAds
        : CONFIG.requirements.adsgramAds;

    const count = Number(cycle[key] || 0);

    if (count >= limit) {
      throw new Error(
        `${platform} ad requirement is already complete.`
      );
    }

    response = {
      previous: count,
      next: count + 1,
    };

    return {
      ...current,
      cycle: {
        ...cycle,
        [key]: count + 1,
      },
      updatedAt: admin.database.ServerValue.TIMESTAMP,
    };
  });

  return response;
}

function validBscAddress(address) {
  return typeof address === "string" && ethers.isAddress(address);
}

function getWallet() {
  const privateKey = process.env.WALLET_PRIVATE_KEY;

  if (!privateKey) {
    throw new Error("WALLET_PRIVATE_KEY is missing.");
  }

  const provider = new ethers.JsonRpcProvider(
    CONFIG.bscRpcUrl,
    56,
    { staticNetwork: true }
  );

  return new ethers.Wallet(privateKey, provider);
}

const ERC20_ABI = [
  "function transfer(address to,uint256 amount) returns (bool)",
  "function decimals() view returns (uint8)",
  "function balanceOf(address account) view returns (uint256)",
];

async function sendUsdt(recipient, amount) {
  if (!validBscAddress(recipient)) {
    throw new Error("Invalid BSC wallet address.");
  }

  if (Number(amount) !== CONFIG.reward) {
    throw new Error("Invalid withdrawal amount.");
  }

  const wallet = getWallet();

  const token = new ethers.Contract(
    CONFIG.usdtContract,
    ERC20_ABI,
    wallet
  );

  const decimals = Number(await token.decimals());
  const tokenAmount = ethers.parseUnits(
    amount.toFixed(2),
    decimals
  );

  const senderBalance = await token.balanceOf(wallet.address);

  if (senderBalance < tokenAmount) {
    throw new Error("Withdrawal wallet does not have enough USDT.");
  }

  // Sending BEP-20 USDT also requires native BNB for gas.
  const bnbBalance = await wallet.provider.getBalance(
    wallet.address
  );

  if (bnbBalance <= 0n) {
    throw new Error(
      "Withdrawal wallet needs BNB for network gas."
    );
  }

  const tx = await token.transfer(
    recipient,
    tokenAmount
  );

  const receipt = await tx.wait();

  return {
    txHash: tx.hash,
    blockNumber: receipt?.blockNumber || null,
    sender: wallet.address,
    recipient,
    amount,
    network: "BNB Smart Chain",
  };
}

async function sendPaymentProof({
  telegramId,
  username,
  address,
  amount,
  txHash,
}) {
  const text = [
    "💸 <b>USDT PAYMENT</b>",
    "",
    `👤 User: ${username ? `@${username}` : telegramId}`,
    `🆔 ID: <code>${telegramId}</code>`,
    `💰 Amount: <b>${Number(amount).toFixed(2)} USDT</b>`,
    `🌐 Network: <b>BEP-20</b>`,
    `📬 Address: <code>${address}</code>`,
    `🔗 TX: <code>${txHash}</code>`,
  ].join("\n");

  try {
    await telegramApi("sendMessage", {
      chat_id: CONFIG.proofChannel,
      text,
      parse_mode: "HTML",
      disable_web_page_preview: true,
    });
  } catch (error) {
    console.error(
      "Payment proof message failed:",
      error.message
    );
  }
}

async function handleUser(req, res, body) {
  const { user: telegramUser, params } = requireAuth(
    req,
    body
  );

  const db = getDb();
  const id = String(telegramUser.id);
  const ref = userRef(db, id);

  const snapshot = await ref.once("value");
  const existing = snapshot.val() || {};

  const referralCode =
    existing.referralCode || `ref_${id}`;

  const referralLink =
    existing.referralLink ||
    `https://t.me/${CONFIG.botUsername}?start=${referralCode}`;

  const patch = {
    telegramId: id,
    username: telegramUser.username || "",
    firstName: telegramUser.first_name || "",
    referralCode,
    referralLink,
    updatedAt: admin.database.ServerValue.TIMESTAMP,
  };

  if (!snapshot.exists()) {
    patch.balance = 0;
    patch.cycle = {
      montageAds: 0,
      adsgramAds: 0,
      referrals: 0,
      channel1: false,
      channel2: false,
      completed: false,
    };
    patch.cooldownUntil = null;
    patch.referral = null;
    patch.createdAt =
      admin.database.ServerValue.TIMESTAMP;
  }

  await ref.update(patch);

  // Refresh channel membership from Telegram so the client never controls verification.
  const membership = await verifyBothChannels(id);
  await ref.child("cycle").update({
    channel1: membership.channel1,
    channel2: membership.channel2,
  });

  const referralCodeFromStart = parseReferrer(
    body,
    params
  );

  if (referralCodeFromStart) {
    await assignReferralIfPossible(
      db,
      id,
      referralCodeFromStart
    );
  }

  const referralResult = await validateReferralAfterChannels(db, id);
  if (referralResult.referrerId) {
    await maybeCompleteCycle(db, referralResult.referrerId);
  }
  await maybeCompleteCycle(db, id);

  const fresh = await ref.once("value");

  return json(res, 200, {
    ok: true,
    adsgramBlockId: CONFIG.adsgramBlockId || null,
    user: publicUser(
      fresh.val() || {},
      telegramUser
    ),
  });
}

async function handleProgress(req, res, body) {
  const { user: telegramUser } = requireAuth(
    req,
    body
  );

  const db = getDb();
  const id = String(telegramUser.id);

  const snapshot = await userRef(db, id).once("value");

  if (!snapshot.exists()) {
    throw new Error("User has not been initialized.");
  }

  const data = snapshot.val();

  return json(res, 200, {
    ok: true,
    progress: cycleSnapshot(data),
    cooldownUntil: data.cooldownUntil || null,
  });
}

async function handleAdComplete(req, res, body) {
  const { user: telegramUser } = requireAuth(
    req,
    body
  );

  const platform = cleanString(body.platform, 30).toLowerCase();

  const db = getDb();
  const id = String(telegramUser.id);

  const result = await completeAd(
    db,
    id,
    platform
  );

  const fresh = await userRef(db, id).once("value");
  const data = fresh.val() || {};

  return json(res, 200, {
    ok: true,
    platform,
    count: result.next,
    progress: cycleSnapshot(data),
    user: publicUser(data, telegramUser),
  });
}

async function handleChannelCheck(req, res, body) {
  const { user: telegramUser } = requireAuth(
    req,
    body
  );

  const channel = cleanString(body.channel, 100);

  if (
    channel !== CONFIG.channels.channel1 &&
    channel !== CONFIG.channels.channel2
  ) {
    throw new Error("Invalid channel.");
  }

  const db = getDb();
  const id = String(telegramUser.id);

  const joined = await checkChannelMembership(
    id,
    channel
  );

  if (joined) {
    const key =
      channel === CONFIG.channels.channel1
        ? "channel1"
        : "channel2";

    await userRef(db, id)
      .child("cycle")
      .child(key)
      .set(true);

    await userRef(db, id)
      .child("updatedAt")
      .set(admin.database.ServerValue.TIMESTAMP);

    // A referral becomes valid only after both required channels
    // have been verified.
    const referralResult = await validateReferralAfterChannels(db, id);
    if (referralResult.referrerId) {
      await maybeCompleteCycle(db, referralResult.referrerId);
    }
    await maybeCompleteCycle(db, id);
  }

  const fresh = await userRef(db, id).once("value");
  const data = fresh.val() || {};

  return json(res, 200, {
    ok: true,
    joined,
    channel,
    progress: cycleSnapshot(data),
    user: publicUser(data, telegramUser),
  });
}

async function handleChannels(req, res, body) {
  const { user: telegramUser } = requireAuth(
    req,
    body
  );

  const db = getDb();
  const id = String(telegramUser.id);

  const membership = await verifyBothChannels(id);

  await userRef(db, id)
    .child("cycle")
    .update({
      channel1: membership.channel1,
      channel2: membership.channel2,
    });

  const referralResult = await validateReferralAfterChannels(db, id);
  if (referralResult.referrerId) {
    await maybeCompleteCycle(db, referralResult.referrerId);
  }
  await maybeCompleteCycle(db, id);

  const fresh = await userRef(db, id).once("value");
  const data = fresh.val() || {};

  return json(res, 200, {
    ok: true,
    ...membership,
    progress: cycleSnapshot(data),
    user: publicUser(data, telegramUser),
  });
}

async function handleWallet(req, res, body) {
  const { user: telegramUser } = requireAuth(req, body);
  const walletAddress = cleanString(body.walletAddress || body.address || "", 200);

  if (!validBscAddress(walletAddress)) {
    throw new Error("Please provide a valid BEP-20/BSC wallet address.");
  }

  const db = getDb();
  const id = String(telegramUser.id);
  await userRef(db, id).update({
    walletAddress,
    updatedAt: admin.database.ServerValue.TIMESTAMP,
  });

  return json(res, 200, { ok: true, walletAddress });
}

async function handleWithdraw(req, res, body) {
  const { user: telegramUser } = requireAuth(
    req,
    body
  );

  const amount = Number(body.amount);
  const walletAddress = cleanString(
    body.walletAddress ||
      body.address ||
      body.recipient,
    200
  );

  if (amount !== CONFIG.reward) {
    throw new Error(
      `Withdrawal amount must be exactly ${CONFIG.reward.toFixed(
        2
      )} USDT.`
    );
  }

  if (!validBscAddress(walletAddress)) {
    throw new Error(
      "Please provide a valid BEP-20/BSC wallet address."
    );
  }

  const db = getDb();
  const id = String(telegramUser.id);
  const ref = userRef(db, id);

  // Re-check membership live immediately before paying.
  const membership = await verifyBothChannels(id);
  await ref.child("cycle").update({
    channel1: membership.channel1,
    channel2: membership.channel2,
  });

  // Lock the cycle before sending money so two simultaneous requests
  // cannot pay the same cycle twice.
  let locked = false;

  await ref.transaction((current) => {
    if (!current) return current;

    if (current.withdrawalLock === true) {
      return current;
    }

    if (cooldownActive(current)) {
      return current;
    }

    if (!requirementsMet(current, membership)) {
      return current;
    }

    if (Number(current.balance || 0) < amount) {
      return current;
    }

    locked = true;

    return {
      ...current,
      withdrawalLock: true,
      walletAddress,
      updatedAt: admin.database.ServerValue.TIMESTAMP,
    };
  });

  if (!locked) {
    const latest = await ref.once("value");
    const latestData = latest.val() || {};

    if (latestData.withdrawalLock === true) {
      throw new Error(
        "A withdrawal is already being processed."
      );
    }

    if (cooldownActive(latestData)) {
      throw new Error(
        "Your 24-hour cooldown is active."
      );
    }

    if (!requirementsMet(latestData)) {
      throw new Error(
        "Complete all requirements before withdrawing."
      );
    }

    throw new Error("Insufficient balance.");
  }

  const withdrawalId = `${id}_${Date.now()}`;

  await withdrawalRef(db, withdrawalId).set({
    telegramId: id,
    username: telegramUser.username || "",
    amount,
    walletAddress,
    network: "BEP-20",
    status: "processing",
    createdAt: admin.database.ServerValue.TIMESTAMP,
  });

  try {
    const payment = await sendUsdt(
      walletAddress,
      amount
    );

    const cooldownUntil =
      Date.now() +
      CONFIG.cooldownHours * 60 * 60 * 1000;

    // After successful withdrawal:
    // - balance resets
    // - all cycle progress resets
    // - 24-hour cooldown begins
    await ref.update({
      balance: 0,

      cycle: {
        montageAds: 0,
        adsgramAds: 0,
        referrals: 0,
        channel1: false,
        channel2: false,
        completed: false,
      },

      cooldownUntil,
      walletAddress,

      withdrawalLock: false,

      lastWithdrawal: {
        amount,
        walletAddress,
        txHash: payment.txHash,
        network: "BEP-20",
        completedAt:
          admin.database.ServerValue.TIMESTAMP,
      },

      updatedAt: admin.database.ServerValue.TIMESTAMP,
    });

    await withdrawalRef(db, withdrawalId).update({
      status: "completed",
      txHash: payment.txHash,
      blockNumber: payment.blockNumber,
      completedAt:
        admin.database.ServerValue.TIMESTAMP,
    });

    await sendPaymentProof({
      telegramId: id,
      username: telegramUser.username || "",
      address: walletAddress,
      amount,
      txHash: payment.txHash,
    });

    const fresh = await ref.once("value");

    return json(res, 200, {
      ok: true,
      message: "Withdrawal successful.",
      txHash: payment.txHash,
      cooldownUntil,
      user: publicUser(
        fresh.val() || {},
        telegramUser
      ),
    });
  } catch (error) {
    await ref.update({
      withdrawalLock: false,
      updatedAt: admin.database.ServerValue.TIMESTAMP,
    });

    await withdrawalRef(db, withdrawalId).update({
      status: "failed",
      error: cleanString(error.message, 500),
      failedAt:
        admin.database.ServerValue.TIMESTAMP,
    });

    throw error;
  }
}

async function handleConfig(req, res) {
  requireAuth(req, bodyOf(req));
  return json(res, 200, {
    ok: true,
    adsgramBlockId: CONFIG.adsgramBlockId || null,
  });
}

async function router(req, res) {
  // Basic CORS. Telegram Web Apps normally call the same origin.
  res.setHeader(
    "Access-Control-Allow-Origin",
    req.headers.origin || "*"
  );
  res.setHeader("Vary", "Origin");
  res.setHeader(
    "Access-Control-Allow-Headers",
    "Content-Type, X-Telegram-Init-Data, X-Telegram-Web-App-Init-Data"
  );
  res.setHeader(
    "Access-Control-Allow-Methods",
    "POST, OPTIONS"
  );

  if (req.method === "OPTIONS") {
    return res.status(204).end();
  }

  if (req.method !== "POST") {
    return json(res, 405, {
      ok: false,
      error: "Method not allowed.",
    });
  }

  const rawUrl = String(req.url || "");
  const parsedUrl = new URL(rawUrl, `https://${req.headers.host || "localhost"}`);
  const rewrittenPath = parsedUrl.searchParams.get("path");
  const path = rewrittenPath
    ? (rewrittenPath.startsWith("/api/") ? rewrittenPath : `/api/${rewrittenPath.replace(/^\/+/, "")}`)
    : parsedUrl.pathname.replace(/\/+$/, "");

  const body = bodyOf(req);

  try {
    if (path === "/api/config") {
      return await handleConfig(req, res, body);
    }

    if (path === "/api/user") {
      return await handleUser(req, res, body);
    }

    if (path === "/api/progress") {
      return await handleProgress(req, res, body);
    }

    if (path === "/api/ad-complete") {
      return await handleAdComplete(req, res, body);
    }

    if (path === "/api/channel-check") {
      return await handleChannelCheck(req, res, body);
    }

    if (path === "/api/channels") {
      return await handleChannels(req, res, body);
    }

    if (path === "/api/wallet") {
      return await handleWallet(req, res, body);
    }

    if (path === "/api/withdraw") {
      return await handleWithdraw(req, res, body);
    }

    return json(res, 404, {
      ok: false,
      error: "API route not found.",
    });
  } catch (error) {
    console.error("API error:", error);

    const message =
      error?.message || "Internal server error.";

    const status =
      /authentication|invalid telegram|expired/i.test(
        message
      )
        ? 401
        : /method not allowed/i.test(message)
        ? 405
        : 400;

    return json(res, status, {
      ok: false,
      error: message,
    });
  }
}

module.exports = router;
