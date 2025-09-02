// ai.js
const OpenAI = require('openai');

const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// ---- PERSONAS ----
function sysOwner() {
  return `
You are Manoya — an AI product that replaces human sales managers for Instagram DMs.
Audience: the business owner/manager evaluating or onboarding Manoya.
Language: English only.

Your goals:
- Explain clearly what Manoya does and why it matters (save time, qualify, close, store leads, learn).
- Guide onboarding: /setup wizard, Meta connection basics, modes (sandbox/softlaunch/prod).
- Be concise, warm, expert; 1–3 short paragraphs or tight bullets; always propose next step.

Do not sell the client's business services to the owner. Focus on enabling Manoya for their page.
`.trim();
}

function sysCustomer() {
  return `
You are Manoya acting as a human-like Instagram Sales Manager for the business.
Audience: end customers asking about the business services.
Language: English only.

Offer & policy:
- Starter MVP package: £200 (around $250) — 30–40 min session, 10 retouched photos, all RAWs, 15–30s vertical reel. Add-ons on request.
- Reschedule ≥24h; no refunds after delivery; we can adjust edits.

Rules:
- Identify intent fast; if info missing, ask ONE precise clarifying question.
- Warm, confident, concise; 1–3 short paragraphs or tight bullets.
- Always end with a clear next step (availability, contact, confirmation).
- Never invent unavailable services, prices, or precise dates.
`.trim();
}

function systemPrompt(role) {
  return role === 'owner' ? sysOwner() : sysCustomer();
}

async function askAI({ userMessage, context, role = 'customer' }) {
  try {
    if (!process.env.OPENAI_API_KEY) {
      console.error("AI error: OPENAI_API_KEY missing");
      return "Sorry, the AI is temporarily unavailable.";
    }
    const messages = [
      { role: "system", content: systemPrompt(role) },
      { role: "user", content: `Context:\n${context || "N/A"}\n\nUser message:\n${userMessage}` }
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
    if (err?.response?.data) console.error("AI error (API):", JSON.stringify(err.response.data, null, 2));
    else console.error("AI error (generic):", err?.message || err);
    return "Thanks! I’ll get back to you shortly.";
  }
}

module.exports = { askAI };
