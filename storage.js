// storage.js
// Примитивный FAQ + контекст; можешь править под свой бизнес

const FAQ = [
  { q: /price|стоим|цена|сколько/i, a: "Our base package is £400: 30–40 min shoot, 1 of 2 dresses, 10 retouched photos, all RAWs, and a 15–30s reel." },
  { q: /hello|hi|привет/i, a: "Hi! How can we help your brand today?" },
  { q: /refund|refunds|возврат/i, a: "We don’t offer refunds after a shoot is delivered, but we’re happy to adjust edits." }
];

function lookupFAQ(msg) {
  if (!msg) return null;
  for (const item of FAQ) {
    if (item.q.test(msg)) return item.a;
  }
  return null;
}

function composeContext() {
  return [
    "Brand: Manoya — AI-driven Instagram assistant for businesses.",
    "We answer DMs and help with sales inquiries automatically.",
    "If the user asks for price: £400 base package (30–40 min; 1 of 2 dresses; 10 retouched photos; RAWs; 15–30s reel).",
    "If user asks something we don't know, politely ask 1 clarifying question."
  ].join("\n");
}

module.exports = { lookupFAQ, composeContext };
