// ai.js (CommonJS)
const OpenAI = require('openai');

const client = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

async function askAI({ userMessage, context }) {
  try {
    const messages = [
      {
        role: "system",
        content:
          "You are Manoya AI assistant for an Instagram business. Be concise, helpful, friendly, and answer in the user's language. If a short factual answer is enough, keep it short."
      },
      {
        role: "user",
        content:
          `Context:\n${context || "N/A"}\n\nUser: ${userMessage}`
      }
    ];

    const resp = await client.chat.completions.create({
      model: "gpt-4o-mini",
      messages,
      temperature: 0.4,
      max_tokens: 300
    });

    const text =
      resp?.choices?.[0]?.message?.content?.trim() ||
      "Спасибо! Чуть позже вернусь с ответом.";
    return text;
  } catch (err) {
    console.error("AI fatal:", err?.response?.data || err?.message || err);
    return "Спасибо за сообщение! Чуть позже вернусь с ответом.";
  }
}

module.exports = { askAI };
