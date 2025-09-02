// storage.js
// Быстрый FAQ и бизнес-контекст для ИИ

const FAQ = [
  { q: /^(hi|hello|hey|привет)\b/i,
    a: "Hi! Great to meet you — I’m Manoya’s assistant. How can I help: sales inquiries, content, or general questions?" },

  { q: /(price|стоим|цена|сколько|сколько стоит|rates?)/i,
    a: "Our current MVP package is £200. It includes a focused 30–40 min session, 10 professionally retouched photos, all RAWs, and a 15–30s vertical reel ready for social. Would you like to check availability?" },

  { q: /(book|booking|запис|availability|свободн|когда можно)/i,
    a: "We can schedule within the next 7–10 days. Which city and 2–3 time windows work for you?" },

  { q: /(refund|возврат|cancel|отмен)/i,
    a: "We allow date changes up to 24h before the shoot. Refunds aren’t offered after delivery, but we’re happy to adjust edits to your preference." },

  { q: /(what.*include|что.*включ|package|пакет)/i,
    a: "The £200 MVP package includes: 30–40 min session • 10 retouched photos • all RAWs • 15–30s vertical reel. Add-ons on request." },

  { q: /(contact|manager|human|человек|менеджер)/i,
    a: "I can connect you with a manager for bespoke requests. Leave your WhatsApp or email, and preferred time to chat." },
];

function lookupFAQ(text) {
  if (!text) return null;
  for (const item of FAQ) {
    if (item.q.test(text)) return item.a;
  }
  return null;
}

function composeContext() {
  // Краткий контекст, который ИИ видит при каждом ответе
  return [
    "Brand: Manoya — Instagram-first content & DM assistant.",
    "Goal: respond expertly, convert interest into bookings, keep it concise and friendly.",
    "Active offer: MVP package £200 — 30–40 min session; 10 retouched photos; all RAWs; 15–30s vertical reel; optional add-ons.",
    "Policy: reschedule ≥24h; no refunds post-delivery; we adjust edits.",
    "If user is unsure: ask 1 clarifying question, then propose next step (availability, brief, contact).",
  ].join("\n");
}

module.exports = { lookupFAQ, composeContext };
