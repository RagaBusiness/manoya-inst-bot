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

// Вариант 1: уже есть PAGE access token -> кладём в .env PAGE_ACCESS_TOKEN
// Вариант 2: есть только long-lived USER token -> можно получить PAGE token через /me/accounts
let PAGE_ACCESS_TOKEN = process.env.PAGE_ACCESS_TOKEN;

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

// IG Send API
async function sendIGReply(igScopedUserId, text) {
  try {
    // В v23.0 отправка идёт на: POST /{PAGE_ID}/messages
    const url = `https://graph.facebook.com/v23.0/${PAGE_ID}/messages`;
    await axios.post(url, {
      recipient: { id: igScopedUserId },
      message: { text }
    }, {
      params: { access_token: PAGE_ACCESS_TOKEN }
    });
  } catch (err) {
    logMeta("sendIGReply", err);
  }
}

// Если у нас в .env лежит USER long-lived токен (а не PAGE),
// можно разово получить PAGE token (и сохранить вручную в .env).
async function maybeFetchPageTokenFromUserToken() {
  if (PAGE_ACCESS_TOKEN && PAGE_ACCESS_TOKEN.startsWith("EA")) return;

  try {
    const userToken = process.env.PAGE_ACCESS_TOKEN; // допустим, это LL user token
    if (!userToken) return;

    const { data } = await axios.get(
      "https://graph.facebook.com/v23.0/me/accounts",
      { params: { access_token: userToken } }
    );
    const page = data.data.find(p => String(p.id) === String(PAGE_ID));
    if (page?.access_token) {
      PAGE_ACCESS_TOKEN = page.access_token;
      console.log("🟣 PAGE token получен из USER токена (в .env пока не записываем).");
    }
  } catch (err) {
    logMeta("fetch page token", err);
  }
}

// ===== health =====
app.get('/health', async (req, res) => {
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
    // Логируем сырое
    // console.log("📨 Incoming POST:", JSON.stringify(body, null, 2));

    if (body.object === 'instagram') {
      for (const entry of body.entry ?? []) {
        const messaging = entry.messaging ?? [];
        for (const event of messaging) {
          if (event.message && event.sender) {
            const igUser = event.sender.id;
            const text = (event.message.text || "").trim();

            // 1) быстрый FAQ
            let reply = lookupFAQ(text);

            // 2) если FAQ не нашёл — спрашиваем ИИ
            if (!reply) {
              const context = composeContext();
              try {
                reply = await askAI({ userMessage: text, context });
              } catch (err) {
                console.error("AI error:", err?.message || err);
                reply = "Спасибо за сообщение! Чуть позже вернусь с ответом.";
              }
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
    console.log("🟢 PAGE token готов.");
  } else {
    console.warn("⚠️ PAGE token отсутствует. Укажи PAGE_ACCESS_TOKEN в .env (или USER LL и PAGE_ID).");
  }
});
