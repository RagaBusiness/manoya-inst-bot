// index.js
require('dotenv').config();
const express = require('express');
const bodyParser = require('body-parser');
const axios = require('axios');

const {
  readConfig, saveConfig, isInstalled,
  setAdmin, isAdmin, saveLead
} = require('./storage');
const { askAI } = require('./ai');

const app = express();
app.use(bodyParser.json({ limit: '1mb' }));

// ===== ENV =====
const PORT = process.env.PORT || 3000;
const VERIFY_TOKEN = process.env.VERIFY_TOKEN;
const PAGE_ID = process.env.PAGE_ID;
let PAGE_ACCESS_TOKEN = process.env.PAGE_ACCESS_TOKEN || null;   // PAGE token (желательно)
const USER_LL_TOKEN   = process.env.ACCESS_TOKEN || null;         // long-lived USER token (опционально, чтобы достать PAGE)

// ===== utils =====
function logMeta(where, err) {
  if (err?.response) {
    console.error(`✗ ${where} error:`, {
      status: err.response.status,
      data: err.response.data
    });
  } else {
    console.error(`✗ ${where} error:`, err?.message || err);
  }
}

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

// простенький ретрай с экспон. бэкоффом для Send API
async function withRetry(fn, { tries = 3, base = 250 } = {}) {
  let lastErr;
  for (let i = 0; i < tries; i++) {
    try { return await fn(); } catch (e) {
      lastErr = e;
      await sleep(base * Math.pow(2, i));
    }
  }
  throw lastErr;
}

// дедупликация входящих (по message.mid)
const seen = new Map(); // mid -> ts
const SEEN_TTL_MS = 5 * 60 * 1000;
setInterval(() => {
  const now = Date.now();
  for (const [mid, ts] of seen.entries()) {
    if (now - ts > SEEN_TTL_MS) seen.delete(mid);
  }
}, 60 * 1000);

// ===== health =====
app.get('/', (_req, res) => res.status(200).send('OK'));
app.get('/health', (_req, res) => {
  res.json({
    status: 'ok',
    page_id: !!PAGE_ID,
    ai: !!process.env.OPENAI_API_KEY,
    installed: isInstalled()
  });
});

// ===== webhook verify (GET) =====
app.get('/webhook', (req, res) => {
  try {
    const mode = req.query['hub.mode'];
    const token = req.query['hub.verify_token'];
    const challenge = req.query['hub.challenge'];
    if (mode === 'subscribe' && token === VERIFY_TOKEN) {
      return res.status(200).send(challenge);
    }
    return res.sendStatus(403);
  } catch {
    return res.sendStatus(403);
  }
});

// ===== IG send =====
async function sendIGReply(igScopedUserId, text) {
  if (!text) return;
  const url = `https://graph.facebook.com/v23.0/${PAGE_ID}/messages`;
  try {
    await withRetry(() => axios.post(url, {
      recipient: { id: igScopedUserId },
      message: { text }
    }, {
      params: { access_token: PAGE_ACCESS_TOKEN }
    }));
  } catch (err) {
    // часто встречается subcode 2018001 — “no matching user” (эхо/окно 24ч)
    if (err?.response?.data?.error?.error_subcode === 2018001) {
      console.warn('↪️ IG says no matching user (echo / 24h window).');
      return;
    }
    logMeta("sendIGReply", err);
  }
}

// ===== optional: get PAGE token from USER LL =====
async function maybeFetchPageTokenFromUserToken() {
  try {
    if (!USER_LL_TOKEN || PAGE_ACCESS_TOKEN) return;
    const { data } = await axios.get(
      'https://graph.facebook.com/v23.0/me/accounts',
      { params: { access_token: USER_LL_TOKEN } }
    );
    const page = data?.data?.find(p => String(p.id) === String(PAGE_ID));
    if (page?.access_token) {
      PAGE_ACCESS_TOKEN = page.access_token;
      console.log('🟣 PAGE token fetched from USER LL (in-memory).');
    }
  } catch (err) {
    logMeta('maybeFetchPageTokenFromUserToken', err);
  }
}

// ===== NATURAL ONBOARDING (без слэшей) =====
const onboarding = new Map(); // senderId -> { step, data }

function looksLikeOwnerIntent(text = "") {
  const t = text.toLowerCase();
  return /(connect|set ?up|setup|integrat|use your bot|owner|we are|i am|my business|our page|meta|instagram api|replace sales|need your ai)/i.test(t);
}
function looksLikeGreeting(text = "") {
  return /^(hi|hello|hey|good\s+(morning|afternoon|evening))\b/i.test(text);
}

async function startOnboarding(senderId) {
  onboarding.set(senderId, { step: 1, data: {} });
  setAdmin(senderId); // помечаем этого пользователя владельцем
  await sendIGReply(senderId,
    "Great — I’ll get you set up. First, what’s your **brand name**?");
}
async function handleOnboarding(senderId, text) {
  const s = onboarding.get(senderId) || { step: 1, data: {} };

  if (s.step === 1) {
    s.data.brand = text.trim();
    s.step = 2; onboarding.set(senderId, s);
    await sendIGReply(senderId,
      "Thanks. Describe your **starter package** (one line). Example: “Starter package £200 (≈ $250): 30–40 min session, 10 retouched photos, all RAWs, 15–30s vertical reel.”");
    return;
  }

  if (s.step === 2) {
    s.data.package_text = text.trim();
    s.step = 3; onboarding.set(senderId, s);
    await sendIGReply(senderId, "Got it. What’s your **policy** (reschedule/refund/edits)?");
    return;
  }

  if (s.step === 3) {
    s.data.policy_text = text.trim();
    s.step = 4; onboarding.set(senderId, s);
    await sendIGReply(senderId, "And your **typical availability**? (e.g., “within 7–10 days” or specific slots)");
    return;
  }

  if (s.step === 4) {
    s.data.availability_text = text.trim();

    saveConfig({ ...s.data }); // сохраняем черновик
    s.step = 5; onboarding.set(senderId, s);

    await sendIGReply(senderId,
      "Perfect — I’ve saved your brand, package, policy, and availability.\n" +
      "Would you like me to **go live now** and answer customers as your sales manager?\n" +
      "Reply: **Yes** or **Not yet**.");
    return;
  }

  if (s.step === 5) {
    const t = text.trim().toLowerCase();
    if (t.startsWith('yes') || t.includes('go live')) {
      saveConfig({ installed: true, mode: 'prod' });
      onboarding.delete(senderId);
      await sendIGReply(senderId, "✅ Live. I’ll now answer customers directly from your business profile.");
      return;
    }
    if (t.startsWith('not')) {
      saveConfig({ installed: false, mode: 'sandbox' });
      onboarding.delete(senderId);
      await sendIGReply(senderId, "Saved in sandbox mode. Say “Go live” anytime to switch.");
      return;
    }
    await sendIGReply(senderId, "Please reply **Yes** or **Not yet**.");
  }
}

// ===== NATURAL ADMIN PHRASES (без слэшей) =====
function matchNaturalAdmin(text = "") {
  const t = text.toLowerCase().trim();

  if (/(go live|start in production|switch to production)/i.test(t)) {
    return { type: 'mode', value: 'prod' };
  }
  if (/(pause|stop for now|turn off|disable)/i.test(t)) {
    return { type: 'mode', value: 'sandbox-off' }; // выключим установку
  }
  if (/(soft launch|limited interactions)/i.test(t)) {
    return { type: 'mode', value: 'softlaunch' };
  }
  if (/(sandbox)/i.test(t)) {
    return { type: 'mode', value: 'sandbox' };
  }
  // set brand / price / policy / availability
  const setBrand = t.match(/^set\s+brand\s*[:\-]\s*(.+)$/i);
  if (setBrand) return { type: 'set', key: 'brand', value: setBrand[1] };

  const setPrice = t.match(/^set\s+(price|package)\s*[:\-]\s*(.+)$/i);
  if (setPrice) return { type: 'set', key: 'package_text', value: setPrice[2] };

  const setPolicy = t.match(/^set\s+policy\s*[:\-]\s*(.+)$/i);
  if (setPolicy) return { type: 'set', key: 'policy_text', value: setPolicy[1] };

  const setAvail = t.match(/^set\s+availability\s*[:\-]\s*(.+)$/i);
  if (setAvail) return { type: 'set', key: 'availability_text', value: setAvail[1] };

  if (/(what('| i)s|show) (my )?status/i.test(t)) {
    return { type: 'status' };
  }

  return null;
}

async function handleNaturalAdmin(senderId, text) {
  const cfg = readConfig();
  const cmd = matchNaturalAdmin(text);
  if (!cmd) return false; // не админ-фраза

  if (!isAdmin(senderId)) {
    // авто-линк первого владельца (MVP) — один раз сказав “go live / set brand …”
    setAdmin(senderId);
  }

  if (cmd.type === 'status') {
    await sendIGReply(senderId, [
      `Brand: ${cfg.brand || "-"}`,
      `Installed: ${cfg.installed ? "yes" : "no"}`,
      `Mode: ${cfg.mode || "sandbox"}`,
      `Package: ${cfg.package_text ? "set" : "default"}`,
      `Policy: ${cfg.policy_text ? "set" : "default"}`,
      `Availability: ${cfg.availability_text ? "set" : "default"}`
    ].join("\n"));
    return true;
  }

  if (cmd.type === 'set') {
    saveConfig({ [cmd.key]: cmd.value });
    await sendIGReply(senderId, `Saved **${cmd.key.replace('_text','')}**.`);
    return true;
  }

  if (cmd.type === 'mode') {
    if (cmd.value === 'prod') {
      saveConfig({ installed: true, mode: 'prod' });
      await sendIGReply(senderId, "✅ Live in production.");
    } else if (cmd.value === 'softlaunch') {
      saveConfig({ mode: 'softlaunch', installed: true });
      await sendIGReply(senderId, "Soft launch enabled (limited interactions).");
    } else if (cmd.value === 'sandbox') {
      saveConfig({ mode: 'sandbox', installed: false });
      await sendIGReply(senderId, "Sandbox mode set (not answering customers yet).");
    } else if (cmd.value === 'sandbox-off') {
      saveConfig({ mode: 'sandbox', installed: false });
      await sendIGReply(senderId, "Paused. I won't answer customers until you say “go live”.");
    }
    return true;
  }

  return false;
}

// ===== webhook receive (POST) =====
app.post('/webhook', async (req, res) => {
  try {
    if (req.body.object !== 'instagram') return res.sendStatus(404);

    for (const entry of req.body.entry ?? []) {
      for (const event of entry.messaging ?? []) {
        const msg = event.message;
        const senderId = event.sender?.id;
        if (!msg || !senderId) continue;
        if (msg.is_echo) continue;

        const mid = msg.mid;
        if (mid) {
          if (seen.has(mid)) continue; // уже обработали
          seen.set(mid, Date.now());
        }

        const text = (msg.text || '').trim();
        const installed = isInstalled();

        // 0) Натуральные админ-фразы работают всегда (для владельца/менеджера)
        const adminHandled = await handleNaturalAdmin(senderId, text);
        if (adminHandled) continue;

        // 1) Если УСТАНОВЛЕН → всегда режим «sales менеджер»
        if (installed) {
          // простейший lead capture
          if (/\b(whatsapp|email|@|\.com|\.co|phone|\+\d)/i.test(text)) {
            saveLead({ ig_user: senderId, raw: text, status: 'new' });
          }
          const reply = await askAI({ userMessage: text, role: 'customer' });
          await sendIGReply(senderId, reply);
          continue;
        }

        // 2) Если НЕ установлен → онбординг владельца (без команд)
        if (onboarding.has(senderId)) {
          await handleOnboarding(senderId, text);
          continue;
        }

        // Пробуем понять намерение владельца (или просто приветствие)
        if (looksLikeOwnerIntent(text) || looksLikeGreeting(text)) {
          await sendIGReply(senderId,
            "Hi! I can replace a sales rep: answer DMs, qualify leads, store them, and learn over time. " +
            "Let’s connect your business — I’ll ask a few quick questions.");
          await startOnboarding(senderId);
          continue;
        }

        // Любые другие вопросы до подключения — краткий owner-ответ через AI
        const ownerAns = await askAI({ userMessage: text, role: 'owner' });
        await sendIGReply(senderId, ownerAns);
      }
    }

    return res.sendStatus(200);
  } catch (err) {
    logMeta('webhook handler', err);
    return res.sendStatus(500);
  }
});

// ===== start =====
app.listen(PORT, async () => {
  console.log(`🚀 Server is running on port ${PORT}`);
  try {
    if (!PAGE_ACCESS_TOKEN && USER_LL_TOKEN) await maybeFetchPageTokenFromUserToken();
  } catch {}
  if (PAGE_ACCESS_TOKEN) {
    console.log(`🟢 PAGE token ready (len=${String(PAGE_ACCESS_TOKEN).length}).`);
  } else {
    console.warn('⚠️ PAGE token missing. Provide PAGE_ACCESS_TOKEN or ACCESS_TOKEN + PAGE_ID.');
  }
});

