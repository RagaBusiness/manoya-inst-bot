// faqLogic.js — простая логика поиска ответа по базе бизнеса
function normalize(s) {
  return (s || '').toString().trim().toLowerCase();
}

function includesAny(text, arr) {
  const t = normalize(text);
  return arr.some(k => t.includes(normalize(k)));
}

function answerFor(business, text) {
  const t = normalize(text);

  // быстрые хардкоды на основе профиля
  if (includesAny(t, ['адрес', 'где вы', 'как добраться', 'location', 'address'])) {
    return business.address ? `Наш адрес: ${business.address}` : null;
  }
  if (includesAny(t, ['часы', 'режим', 'когда вы', 'во сколько', 'hours', 'open'])) {
    return business.hours ? `Мы работаем: ${business.hours}` : null;
  }
  if (includesAny(t, ['телефон', 'позвонить', 'whatsapp', 'контакт', 'phone', 'call'])) {
    return business.phone ? `Контакт: ${business.phone}` : null;
  }
  if (includesAny(t, ['прайс', 'цена', 'стоимость', 'услуги', 'price', 'prices', 'services', 'catalog'])) {
    // если в FAQ есть вопросы про цены — вернём их
    const priceFaq = (business.faq || []).find(f => normalize(f.q).includes('цен') || normalize(f.q).includes('price'));
    if (priceFaq?.a) return priceFaq.a;
    return 'По прайсу: напишите, что именно интересует, и я подскажу.';
  }

  // поиск по FAQ — простым включением
  for (const f of business.faq || []) {
    if (!f.q || !f.a) continue;
    const q = normalize(f.q);
    if (t.includes(q) || q.split(' ').some(word => t.includes(word))) {
      return f.a;
    }
  }

  return null;
}

module.exports = { answerFor };
