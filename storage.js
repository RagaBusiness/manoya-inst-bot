// MVP-хранилище контекста (профиль бизнеса, FAQ)
// Потом можно заменить на Mongo/Supabase/Postgres

const businessProfile = {
  brand: "Manoya",
  about: "Мы делаем умных IG-ботов, отвечающих клиентам 24/7, ведём лидов до оплаты.",
  hours: "Пн-Вс 10:00–20:00",
  contacts: "support@manoya.ai",
};

const faq = [
  { q: /цен|стоим|price/i, a: "Базовый план от $49/мес, про — от $199/мес. Дам подробности, если нужно :)" },
  { q: /как подключ|как нач/i, a: "Доступ к IG Business странице + 3 клика в кабинете Meta. Помогу настроить." },
  { q: /поддержк|support/i, a: "Пишите на support@manoya.ai — отвечаем быстро!" },
];

function lookupFAQ(text) {
  const item = faq.find(f => f.q.test(text));
  return item?.a || null;
}

function composeContext() {
  const faqLines = faq.map((f, i) => `- ${f.q} → ${f.a}`).join("\n");
  return `Бренд: ${businessProfile.brand}
О компании: ${businessProfile.about}
Время работы: ${businessProfile.hours}
Контакты: ${businessProfile.contacts}

FAQ:
${faqLines}
`;
}

module.exports = {
  lookupFAQ,
  composeContext
};
