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
const STATE_PATH = path.join(DB_DIR, 'chat_state.json');

// ---- small JSON helpers
const readJSON = (p) => { try { return JSON.parse(fs.readFileSync(p)); } catch { return null; } };
const writeJSON = (p, data) => fs.writeFileSync(p, JSON.stringify(data, null, 2));

// ---- config helpers
function readConfig() { return readJSON(CONFIG_PATH) || {}; }
function saveConfig(patch) {
  const cur = readConfig();
  const next = { ...cur, ...patch };
  writeJSON(CONFIG_PATH, next);
  return next;
}
function isInstalled() {
  const cfg = readConfig();
  return !!cfg.installed; // true = уже подключены к бизнес-аккаунту клиента
}

// ---- leads
function saveLead(lead) {
  const list = readJSON(LEADS_PATH) || [];
  list.push({ ...lead, ts: new Date().toISOString() });
  writeJSON(LEADS_PATH, list);
}

// ---- per-user role memory { [userId]: { role: 'owner'|'customer', seenIntro: bool } }
function getState() { return readJSON(STATE_PATH) || {}; }
function setState(s) { writeJSON(STATE_PATH, s); }
function setUserRole(userId, role) {
  const s = getState(); s[userId] = { ...(s[userId]||{}), role }; setState(s);
}
function getUserRole(userId) {
  const s = getState(); return s[userId]?.role || null;
}
function setSeenIntro(userId) {
  const s = getState(); s[userId] = { ...(s[userId]||{}), seenIntro: true }; setState(s);
}
function hasSeenIntro(userId) {
  const s = getState(); return !!s[userId]?.seenIntro;
}

// ---- heuristics: try to detect owner vs customer by text intent
function detectRoleFromText(txt = "") {
  const t = txt.toLowerCase();
  const ownerHints = /(connect|install|meta|webhook|render|token|page access|price for bot|pricing for bot|onboard|setup|integrat|how to add|my page|use your bot|owner|manager)/i;
  const customerHints = /(price|cost|book|booking|availability|when|package|refund|shoot|session)/i;
  if (ownerHints.test(t) && !customerHints.test(t)) return 'owner';
  if (customerHints.test(t) && !ownerHints.test(t)) return 'customer';
  return null; // unclear
}

// ---- Intros
function ownerIntro() {
  return [
    "👋 Hi! I’m **Manoya**, an AI Sales Manager you connect to your business page.",
    "I answer DMs like a human, qualify leads, store them to a table/CRM, learn from feedback, and send weekly reports.",
    "To start, run **/setup** for onboarding. When you’re ready, set **/mode prod** and **/install done**."
  ].join("\n");
}
function customerIntro() {
  return [
    "Hi! I’m **Manoya** — your AI Sales Manager here to help with sales inquiries.",
    "Our starter package is **£200 (around $250)**: 30–40 min session, 10 retouched photos, all RAWs, and a 15–30s vertical reel.",
    "How can I help — pricing, availability, or something else?"
  ].join("\n");
}

// ---- utils
function logMeta(where, err) {
  if (err?.response) console.error(`✗ ${where} error:`, { status: err.response.status, data: err.response.data });
  else console.error(`✗ ${where} error:`, err?.message || err);
}

// Root + Health
app.get('/', (_req, res) => res.status(200).send('OK'));
app.get('/health', (_req, res) => {
  res.json({ status: 'ok', page_id: PAGE_ID ? 'set' : 'missing', ai: !!process.env.OPENAI_API_KEY });
});

// Debug AI
app.get('/debug/ai', async (req, res) => {
  try {
    const prompt = String(req.query.prompt || 'Hello from Manoya test');
    const role = String(req.query.role || 'customer');
    const text = await askAI({ userMessage: prompt, context: 'Debug route', role });
    res.json({ ok: true, prompt, role, answer: text });
  } catch (e) {
    res.status(500).json({ ok: false, error: e?.message || String(e) });
  }
});

// Debug Meta
app.get('/debug/meta', async (_req, res) => {
  try {
    const token = USER_LL_TOKEN || PAGE_ACCESS_TOKEN;
    if (!token) return res.status(400).json({ ok: false, error: 'No token available' });
    const me = await axios.get('https://graph.facebook.com/v23.0/me/accounts', { params: { access_token: token } });
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

// IG Send API
async function sendIGReply(igScopedUserId, text) {
  try {
    if (!PAGE_ACCESS_TOKEN) throw new Error('PAGE_ACCESS_TOKEN missing');
    const url = `https://graph.facebook.com/v23.0/${PAGE_ID}/messages`;
    await axios.post(url, { recipient: { id: igScopedUserId }, message: { text } }, { params: { access_token: PAGE_ACCESS_TOKEN } });
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
    const res = await axios.get('https://graph.facebook.com/v23.0/me/accounts', { params: { access_token: USER_LL_TOKEN } });
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

// Setup wizard
const setupState = new Map(); // senderId -> step

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
    await sendIGReply(senderId, "Done! Draft knowledge created. Switch mode with `/mode prod` when ready, then confirm install via `/install done`.");
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

          if (msg?.is_echo) { console.log('↩️ Echo message ignored.'); continue; }

          if (msg && senderId) {
            const text = (msg.text || '').trim();
            console.log(`📩 IG message from ${senderId}: "${text}"`);

            // ROLE manual commands
            if (/^\/iam owner$/i.test(text)) { setUserRole(senderId, 'owner'); await sendIGReply(senderId, "Role set to **owner**."); return res.sendStatus(200); }
            if (/^\/iam customer$/i.test(text)) { setUserRole(senderId, 'customer'); await sendIGReply(senderId, "Role set to **customer**."); return res.sendStatus(200); }
            if (/^\/resetmode$/i.test(text)) { const s = getState(); delete s[senderId]; setState(s); await sendIGReply(senderId, "Role reset. I’ll auto-detect from your next message."); return res.sendStatus(200); }

            // install flag
            if (/^\/install done$/i.test(text)) {
              saveConfig({ installed: true });
              await sendIGReply(senderId, "✅ Installation marked as done. I’ll now act for end customers by default.");
              return res.sendStatus(200);
            }

            // detect or use remembered role
            let role = getUserRole(senderId);
            if (!role) {
              // if installed for business → default to customer
              role = isInstalled() ? 'customer' : (detectRoleFromText(text) || 'owner');
              setUserRole(senderId, role);
            }

            // one-time intro by role (and STOP after intro)
            if (!hasSeenIntro(senderId)) {
              setSeenIntro(senderId);
              await sendIGReply(senderId, role === 'owner' ? ownerIntro() : customerIntro());
              return res.sendStatus(200); // <── важное: больше ничего не отправляем
            }

            // owner-only commands
            if (role === 'owner') {
              if (/^\/capabilities$/i.test(text)) {
                const reply = "Capabilities:\n" + lookupFAQ('/capabilities', 'owner');
                await sendIGReply(senderId, reply);
                return res.sendStatus(200);
              }
              if (/^\/setup$/i.test(text)) { setupState.set(senderId, 1); await handleSetup(senderId, text); return res.sendStatus(200); }
              if (/^\/mode (sandbox|softlaunch|prod)$/i.test(text)) {
                const mode = text.split(' ')[1]; saveConfig({ mode }); await sendIGReply(senderId, `Mode switched to: **${mode}**`);
                // авто-установка при проде, если хотим:
                if (mode === 'prod') saveConfig({ installed: true });
                return res.sendStatus(200);
              }
            }

            // quick save lead when user shares contact/slots (applies to customer)
            if (role === 'customer' && /\b(whatsapp|email|@|\.com|\.co|phone|\+\d)/i.test(text)) {
              saveLead({ ig_user: senderId, intent: 'contact-provided', raw: text, status: 'new' });
            }

            // 1) FAQ by role
            let reply = lookupFAQ(text, role);

            // 2) AI by role
            if (!reply) {
              const context = composeContext(role);
              reply = await askAI({ userMessage: text, context, role });
            }

            console.log(`🤖 [${role}] Reply to ${senderId}: "${reply}"`);
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
process.on('unhandledRejection', (reason) => console.error('UNHANDLED REJECTION:', reason));
process.on('uncaughtException', (err) => console.error('UNCAUGHT EXCEPTION:', err));

// Start
app.listen(PORT, async () => {
  console.log(`🚀 Server is running on port ${PORT}`);
  try { if (!PAGE_ACCESS_TOKEN && USER_LL_TOKEN) await maybeFetchPageTokenFromUserToken(); } catch {}
  if (PAGE_ACCESS_TOKEN) console.log(`🟢 PAGE token detected (len=${String(PAGE_ACCESS_TOKEN).length}).`);
  else console.warn('⚠️ PAGE token missing. Provide PAGE_ACCESS_TOKEN or USER LL in ACCESS_TOKEN + PAGE_ID.');
});

