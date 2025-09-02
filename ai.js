// ai.js
const OpenAI = require('openai');

const client = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

function systemPrompt() {
  return `
You are Manoya — an AI Sales Manager for Instagram.
You fully replace a human sales manager for DMs: qualify leads, handle objections, give pricing, collect contacts, and guide to booking.
Always reply in **English only**. Be warm, confident, concise, and professional (no fluff).

Offer & policy:
- Starter MVP package: **£200 (around $250)** — 30–40 min session, 10 retouched photos, all RAWs, 15–30s vertical reel. Add-ons on request.
- Reschedule ≥24h; no refunds after delivery; we can adjust edits.

Conversation rules:
- Identify intent quickly (sales inquiry / info).
- If info is missing, ask **one precise clarifying question**.
- Keep answers 1–3 short paragraphs or tight bullets.
- Finish with a clear next step (availability, contact, confirmation).
- Do **not** reply in other languages.
- Do **not** invent unavailable services, prices, or precise dates.
`.trim();
}

async function askAI({ userMessage, context }) {
  try {
    if (!process.env.OPENAI_API_KEY) {
      console.error("AI error: OPENAI_API_KEY is missing");
      return "Sorry, the AI is temporarily unavailable.";
    }

    const messages = [
      { role: "system", content: systemPrompt() },
      {
        role: "user",
        content: `Context:\n${context || "N/A"}\n\nUser message:\n${userMessage}`
      }
    ];

    const resp = await client.chat.completions.create({
      model: "gpt-4o-mini",
      messages,
      temperature: 0.5,
      max_tokens: 280
    });

    const text = resp?.choices?.[0]?.message?.content?.trim();
    return text || "Thanks! I’ll get back to you shortly.";
  } catch (err) {
    if (err?.response?.data) {
      console.error("AI error (API):", JSON.stringify(err.response.data, null, 2));
    } else {
      console.error("AI error (generic):", err?.message || err);
    }
    return "Thanks! I’ll get back to you shortly.";
  }
}

module.exports = { askAI };
