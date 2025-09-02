// index.js
require('dotenv').config();
const express = require('express');
const bodyParser = require('body-parser');
const axios = require('axios');
const fs = require('fs');
const path = require('path');

const { askAI } = require('./ai');
const { lookupFAQ, composeContext } = require('./storage');

const app = express();
app.use(bodyParser.json());

// ── ENV
const PORT = process.env.PORT || 3000;
const VERIFY_TOKEN = process.env.VERIFY_TOKEN;
const PAGE_ID = process.env.PAGE_ID;

let PAGE_ACCESS_TOKEN = process.env.PAGE_ACCESS_TOKEN || null;
const USER_LL_TOKEN = process.env.ACCESS_TOKEN || null; // optional: to fetch page token

// ── Paths
const DB_DIR = path.join(__dirname, 'db');
if (!fs.existsSync(DB_DIR)) fs.mkdirSync(DB_DIR, { recursive: true });
const CONFIG_PATH = path.join(DB_DIR, 'config.json');
const LEADS_PATH = path.join(DB_DIR, 'leads.json');

// ── State
const seenUsers = new Set();         // to send intro once
const setupState = new Map();        // senderId -> step (onboarding wizard)

// ── Helpers
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

function readJSON(p) {
  try { return JSON.parse(fs.readFileSync(p)); } catch { return null; }
}
function writeJSON(p, data) {
  fs.writeFileSync(p, JSON.stringify(data, null, 2));
}

function saveConfig(patch) {
  const cur = readJSON(CONFIG_PATH) || {};
  const next = { ...cur, ...patch };
  writeJSON(CONFIG_PATH, next);
  return next;
}
function saveLead(lead) {
  const list = readJSON(LEADS_PATH) || [];
  list.push({ ...lead, ts: new Date().toISOString() });
  writeJSON(LEADS_PATH, list);
}

// ── Intro message (English only)
function introMessage() {
  return [
    "👋 Hi, great to meet you! I’m **Manoya**, your AI Sales Manager.",
    "",
    "I’m not here to sell you a photoshoot. Instead, I replace human sales managers for businesses on Instagram:",
    "• I automatically answer DMs in a professional, human-like way.",
    "• I qualify leads, handle FAQs, and close sales.",
    "• I collect contacts, build reports, and learn from new questions.",
    "• I integrate with your Meta account so I can answer through your business profile, not mine.",
    "",
    "Think of me as your full-time sales assistant that never sleeps. 🚀",
    "",
    "To get started, type **/setup** and I’ll guide you through onboarding (offer, FAQs, leads storage)."
  ].join("\n");
}

// Root + Health
app.get('/', (_req, res) => res.status(200).send('OK'));
app.get('/health', (_req, res) => {
  res.json({
    status: 'ok',
    page_id: PAGE_ID ? 'set' : 'missing',
    ai: !!process.env.OPENAI_API_KEY
  });
});

// Debug AI
app.get('/debug/ai', async (req, res) => {
  try {
    const prompt = String(req.query.prompt || 'Hello from Manoya test');
    const text = await askAI({ userMessage: prompt, context: 'Debug route' });
    res.json({ ok: true, prompt, answer: text });
  } catch (e) {
    res.status(500).json({ ok: false, error: e?.message || String(e) });
  }
});

// Debug Meta (simple self-check)
app.get('/debug/meta', async (_req, res) => {
  try {
    const token = USER_LL_TOKEN || PAGE_ACCESS_TOKEN;
    if (!token) return res.status(400).json({ ok: false, error: 'No token available' });
    const me = await axios.get('https://graph.facebook.com/v23.0/me/accounts', {
      params: { access_token: token }
    });
    res.json({ ok: true, accounts: me.data?.data?.length || 0, page_id: PAGE_ID });
  } catch (e) {
    res.status(500).json({ ok: false, error: e?.response?.data || e?.message });
  }
});

// Weekly report skeleton
app.get('/report/weekly', (_req, res) => {
  const leads = readJSON(LEADS_PATH) || [];
  const total = leads.length;
  const byStatus = leads.reduce((acc, l) => {
    acc[l.status || 'new'] = (acc[l.status || 'new'] || 0) + 1;
    return acc;
  }, {});
  res.json({ ok: true, total_leads: total, byStatus });
});

// IG reply
async function sendIGReply(igScopedUserId, text) {
  try {
    if (!PAGE_ACCESS_TOKEN) throw new Error('PAGE_ACCESS_TOKEN missing');
    const url = `https://graph.facebook.com/v23.0/${PAGE_ID}/messages`;
    await axios.post(
      url,
      { recipient: { id: igScopedUserId }, message: { text } },
      { params: { access_token: PAGE_ACCESS_TOKEN } }
    );
  } catch (err) {
    if (err?.response?.data?.error?.error_subcode === 2018001) {
      console.warn('↪️ IG says no matching user (likely echo/24h window).');
      return;
    }
    logMeta('sendIGReply', err);
  }
}

async function maybeFetchPageTokenFromUserToken() {
  try {
    if (!USER_LL_TOKEN || PAGE_ACCESS_TOKEN) return;
    const res = await axios.get(
      'https://graph.facebook.com/v23.0/me/accounts',
      { params: { access_token: USER_LL_TOKEN } }
    );
    const page = res.data?.data?.find(p => String(p.id) === String(PAGE_ID));
    if (page?.access_token) {
      PAGE_ACCESS_TOKEN = page.access_token;
      console.log('🟣 PAGE token fetched from USER LL (in-memory).');
    } else {
      console.warn('⚠️ PAGE_ID not found in /me/accounts.');
    }
  } catch (err) {
    logMeta('maybeFetchPageTokenFromUserToken', err);
  }
}

// Webhook verify
app.get('/webhook', (req, res) => {
  try {
    const mode = req.query['hub.mode'];
    const token = req.query['hub.verify_token'];
    const challenge = req.query['hub.challenge'];
    if (mode === 'subscribe' && token === VERIFY_TOKEN) {
      console.log('✅ Webhook verified');
      return res.status(200).send(challenge);
    }
    return res.sendStatus(403);
  } catch {
    return res.sendStatus(403);
  }
});

// ── Simple setup wizard (/setup)
async function handleSetup(senderId, text) {
  const step = setupState.get(senderId) || 1;

  if (step === 1) {
    setupState.set(senderId, 2);
    await sendIGReply(senderId, "1/3 Describe your **niche and offer** (base price is £200 ≈ $250). Include what’s included and any add-ons.");
    return;
  }
  if (step === 2) {
    saveConfig({ offer: text });
    setupState.set(senderId, 3);
    await sendIGReply(senderId, "2/3 List **top FAQs and best answers** (separate by semicolons).");
    return;
  }
  if (step === 3) {
    const faqs = text.split(';').map(s => s.trim()).filter(Boolean);
    saveConfig({ owner_faqs: faqs });
    setupState.set(senderId, 4);
    await sendIGReply(senderId, "3/3 Where to store leads? (email or Google Sheet/Airtable URL)");
    return;
  }
  if (step === 4) {
    saveConfig({ leads_sink: text });
    setupState.delete(senderId);
    await sendIGReply(senderId, "Done! Draft knowledge created. Switch mode with `/mode sandbox` (test), `/mode softlaunch`, or `/mode prod`.");
    return;
  }
}

// Webhook incoming
app.post('/webhook', async (req, res) => {
  try {
    const body = req.body;

    if (body.object === 'instagram') {
      for (const entry of body.entry ?? []) {
        const messaging = entry.messaging ?? [];
        for (const event of messaging) {
          const msg = event.message;
          const senderId = event.sender?.id;

          if (msg?.is_echo) { // ignore echos
            console.log('↩️ Echo message ignored.');
            continue;
          }

          if (msg && senderId) {
            const text = (msg.text || '').trim();
            console.log(`📩 IG message from ${senderId}: "${text}"`);

            // One-time intro
            if (!seenUsers.has(senderId)) {
              seenUsers.add(senderId);
              await sendIGReply(senderId, introMessage());
            }

            // Commands
            if (/^\/capabilities$/i.test(text)) {
              const reply = lookupFAQ('/capabilities');
              await sendIGReply(senderId, reply);
              return res.sendStatus(200);
            }
            if (/^\/setup$/i.test(text)) {
              setupState.set(senderId, 1);
              await handleSetup(senderId, text);
              return res.sendStatus(200);
            }
            if (/^\/mode (sandbox|softlaunch|prod)$/i.test(text)) {
              const mode = text.split(' ')[1];
              saveConfig({ mode });
              await sendIGReply(senderId, `Mode switched to: **${mode}**`);
              return res.sendStatus(200);
            }

            // Save quick lead if message already contains contact/slots keywords (very simple heuristic)
            if (/\b(whatsapp|email|@|\.com|\.co|phone|\+\d)/i.test(text)) {
              saveLead({
                ig_user: senderId,
                intent: 'contact-provided',
                raw: text,
                status: 'new'
              });
            }

            // 1) FAQ
            let reply = lookupFAQ(text);

            // 2) AI
            if (!reply) {
              const context = composeContext();
              reply = await askAI({ userMessage: text, context });
            }

            console.log(`🤖 Reply to ${senderId}: "${reply}"`);
            await sendIGReply(senderId, reply);
          }
        }
      }
      return res.sendStatus(200);
    }
    return res.sendStatus(404);
  } catch (err) {
    logMeta('webhook handler', err);
    return res.sendStatus(500);
  }
});

// Global error handlers
process.on('unhandledRejection', (reason) => {
  console.error('UNHANDLED REJECTION:', reason);
});
process.on('uncaughtException', (err) => {
  console.error('UNCAUGHT EXCEPTION:', err);
});

// Start
app.listen(PORT, async () => {
  console.log(`🚀 Server is running on port ${PORT}`);
  await maybeFetchPageTokenFromUserToken();
  if (PAGE_ACCESS_TOKEN) {
    console.log(`🟢 PAGE token detected (len=${String(PAGE_ACCESS_TOKEN).length}).`);
  } else {
    console.warn('⚠️ PAGE token is missing. Provide PAGE_ACCESS_TOKEN or USER LL token in ACCESS_TOKEN with PAGE_ID.');
  }
});

