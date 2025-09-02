// storage.js
const FAQ = [
  { q: /^(hi|hello|привет)\b/i, a: "Hi! How can we help your brand today?" },
  { q: /(price|стоим|цена|сколько)/i, a: "Base package is £400: 30–40 min shoot, 1 of 2 dresses, 10 retouched photos, all RAWs, and a 15–30s reel." }
];

function lookupFAQ(text) {
  if (!text) return null;
  for (const item of FAQ) {
    if (item.q.test(text)) return item.a;
  }
  return null;
}

function composeContext() {
  return [
    "Brand: Manoya — AI-driven Instagram assistant for businesses.",
    "We answer DMs and help with sales inquiries automatically.",
    "If the user asks for price: £400 base package (30–40 min; 1 of 2 dresses; 10 retouched photos; RAWs; 15–30s reel).",
    "If we lack info, ask 1 clarifying question."
  ].join("\n");
}

module.exports = { lookupFAQ, composeContext };
