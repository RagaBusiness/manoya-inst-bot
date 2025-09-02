// ai.js
const OpenAI = require('openai');

const client = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

async function askAI({ userMessage, context }) {
  try {
    if (!process.env.OPENAI_API_KEY) {
      console.error("AI error: OPENAI_API_KEY is missing");
      return "Извини, AI временно недоступен.";
    }

    const messages = [
      {
        role: "system",
        content: "You are Manoya AI assistant. Be concise, friendly and respond in the user's language."
      },
      {
        role: "user",
        content: `Context:\n${context || "N/A"}\n\nUser: ${userMessage}`
      }
    ];

    const resp = await client.chat.completions.create({
      model: "gpt-4o-mini",
      messages,
      temperature: 0.4,
      max_tokens: 300
    });

    const text = resp?.choices?.[0]?.message?.content?.trim();
    if (!text) {
      console.error("AI error: empty completion", resp);
      return "Спасибо! Вернусь с ответом чуть позже.";
    }
    return text;
  } catch (err) {
    // подробный лог, чтобы понять причину
    if (err?.response?.data) {
      console.error("AI error (API):", JSON.stringify(err.response.data, null, 2));
    } else {
      console.error("AI error (generic):", err?.message || err);
    }
    return "Спасибо за сообщение! Чуть позже вернусь с ответом.";
  }
}

module.exports = { askAI };
