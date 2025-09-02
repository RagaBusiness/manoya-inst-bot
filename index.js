require('dotenv').config();
const express = require('express');
const bodyParser = require('body-parser');
const axios = require('axios');

const { askAI } = require('./ai');
const { lookupFAQ, composeContext } = require('./storage');

const app = express();
app.use(bodyParser.json());

// ===== ENV =====
const PORT = process.env.PORT || 3000;
const VERIFY_TOKEN = process.env.VERIFY_TOKEN;
const PAGE_ID = process.env.PAGE_ID;

// Если есть готовый PAGE токен — используем.
// Если нет, можно временно положить USER LL токен в ACCESS_TOKEN.
let PAGE_ACCESS_TOKEN = process.env.PAGE_ACCESS_TOKEN || null;
const USER_LL_TOKEN = process.env.ACCESS_TOKEN || null;

// ===== helpers =====
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

// Отправка сообщения в Instagram
async function sendIGReply(igScopedUserId, text) {
  try {
    if (!PAGE_ACCESS_TOKEN) throw new Error("PAGE_ACCESS_TOKEN missing");
    const url = `https://graph.facebook.com/v23.0/${PAGE_ID}/messages`;
    await axios.post(
      url,
      { recipient: { id: igScopedUserId }, message: { text } },
      { params: { access_token: PAGE_ACCESS_TOKEN } }
    );
  } catch (err) {
    logMeta("sendIGReply", err);
  }
}

// Попробовать получить Page токен из USER LL (если Page токена нет)
async function maybeFetchPageTokenFromUserToken() {
  try {
    if (!USER_LL_TOKEN || PAGE_ACCESS_TOKEN) return;

    const res = await axios.get(
      "https://graph.facebook.com/v23.0/me/accounts",
      { params: { access_token: USER_LL_TOKEN } }
    );

    const page = res.data?.data?.find(p => String(p.id) === String(PAGE_ID));
    if (page?.access_token) {
      PAGE_ACCESS_TOKEN = page.access_token;
      console.log("🟣 PAGE token получен из USER LL токена (в памяти процесса).");
    } else {
      console.warn("⚠️ Не нашли страницу с таким PAGE_ID при /me/accounts.");
    }
  } catch (err) {
    logMeta("maybeFetchPageTokenFromUserToken", err);
  }
}

// ===== health =====
app.get('/health', (req, res) => {
  res.json({
    status: "ok",
    page_id: PAGE_ID ? "set" : "missing",
    ai: !!process.env.OPENAI_API_KEY
  });
});

// ===== webhook verify (GET) =====
app.get('/webhook', (req, res) => {
  try {
    const mode = req.query['hub.mode'];
    const token = req.query['hub.verify_token'];
    const challenge = req.query['hub.challenge'];

    if (mode === 'subscribe' && token === VERIFY_TOKEN) {
      console.log("✅ Webhook verified");
      return res.status(200).send(challenge);
    }
    return res.sendStatus(403);
  } catch {
    return res.sendStatus(403);
  }
});

// ===== webhook incoming (POST) =====
app.post('/webhook', async (req, res) => {
  try {
    const body = req.body;

    if (body.object === 'instagram') {
      for (const entry of body.entry ?? []) {
        const messaging = entry.messaging ?? [];
        for (const event of messaging) {
          if (event.message && event.sender && event.sender.id) {
            const igUser = event.sender.id;
            const text = (event.message?.text || "").trim();

            let reply = lookupFAQ(text);
            if (!reply) {
              const context = composeContext();
              reply = await askAI({ userMessage: text, context });
            }

            await sendIGReply(igUser, reply);
          }
        }
      }
      return res.sendStatus(200);
    }

    return res.sendStatus(404);
  } catch (err) {
    logMeta("webhook handler", err);
    return res.sendStatus(500);
  }
});

// ===== start =====
app.listen(PORT, async () => {
  console.log(`🚀 Server is running on port ${PORT}`);
  await maybeFetchPageTokenFromUserToken();
  if (PAGE_ACCESS_TOKEN) {
    console.log(`🟢 PAGE token detected (len=${String(PAGE_ACCESS_TOKEN).length}).`);
  } else {
    console.warn("⚠️ PAGE token отсутствует. Укажи PAGE_ACCESS_TOKEN или USER LL в ACCESS_TOKEN + PAGE_ID.");
  }
});
