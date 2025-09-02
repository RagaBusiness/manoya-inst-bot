// ai.js
const OpenAI = require('openai');

const client = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

// Простая эвристика языка: если есть кириллица — отвечаем по-русски, иначе по-английски
function inferLocale(s = "") {
  return /[А-Яа-яЁё]/.test(s) ? "ru" : "en";
}

function systemPrompt(locale = "en") {
  const common = `
You are Manoya — a professional Instagram content & DM assistant.
Tone: warm, confident, expert; concise but helpful; no fluff, no emojis unless user uses them.
Objectives:
- Understand the intent quickly (sales inquiry, booking, info).
- If info is enough → answer directly. If not → ask ONE precise clarifying question.
- Guide the user to the next action (check availability, share contact, confirm details).
Product (MVP): £200 package — 30–40 min session, 10 retouched photos, all RAWs, 15–30s vertical reel. Optional add-ons.
Policies: reschedule ≥24h; no refunds post-delivery; we adjust edits.
Constraints: Do not invent unavailable services, prices, or slots. If unsure, say so and suggest a next step.
Response style:
- 1–3 short paragraphs or tight bullet points.
- Mirror the user’s language.
- End with a clear next step.
`.trim();

  const ru = `
Ты — профессиональный ассистент Manoya для Instagram.
Тон: тёплый, уверенный, экспертный; по делу; без воды; без эмодзи, если клиент сам их не использует.
Задачи:
- Быстро понять запрос (продажи, бронь, информация).
- Если данных достаточно — ответь прямо. Если нет — задай ОДИН чёткий уточняющий вопрос.
- Веди к следующему шагу (проверка доступности, контакты, подтверждение деталей).
Продукт (MVP): пакет £200 — 30–40 мин съёмки, 10 ретушей, все RAW, вертикальный ролик 15–30 с. Опции — по запросу.
Политика: перенос ≥24ч; возвратов после выдачи нет; правки возможны.
Ограничения: ничего не выдумывай. Если не уверен — скажи и предложи шаг.
Стиль ответа:
- 1–3 коротких абзаца или лаконичные пункты.
- Отвечай на языке пользователя.
- Заверши понятным следующим шагом.
  `.trim();

  return locale === "ru" ? ru : common;
}

async function askAI({ userMessage, context }) {
  try {
    if (!process.env.OPENAI_API_KEY) {
      console.error("AI error: OPENAI_API_KEY is missing");
      return inferLocale(userMessage) === "ru"
        ? "Извини, AI временно недоступен."
        : "Sorry, the AI is temporarily unavailable.";
    }

    const locale = inferLocale(userMessage);
    const sys = systemPrompt(locale);

    const messages = [
      { role: "system", content: sys },
      { role: "user", content: `Context:\n${context || "N/A"}\n\nUser message:\n${userMessage}` }
    ];

    const resp = await client.chat.completions.create({
      model: "gpt-4o-mini",
      messages,
      temperature: 0.5,
      max_tokens: 280
    });

    const text = resp?.choices?.[0]?.message?.content?.trim();
    if (!text) {
      console.error("AI error: empty completion", resp);
      return locale === "ru"
        ? "Спасибо! Вернусь с ответом чуть позже."
        : "Thanks! I’ll get back to you shortly.";
    }
    return text;
  } catch (err) {
    if (err?.response?.data) {
      console.error("AI error (API):", JSON.stringify(err.response.data, null, 2));
    } else {
      console.error("AI error (generic):", err?.message || err);
    }
    return inferLocale(userMessage) === "ru"
      ? "Спасибо! Чуть позже вернусь с ответом."
      : "Thanks! I’ll get back to you shortly.";
  }
}

module.exports = { askAI };
