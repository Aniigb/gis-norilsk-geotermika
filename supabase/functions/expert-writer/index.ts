// ============================================================================
// Edge Function "expert-writer" — LLM-режим кнопки ✍ в чек-листе осмотра
// ГИС-база геотехнического мониторинга зданий. г. Норильск · АНО «АНИИГБ»
//
// Развёртывание (один раз):
//   1. Установите Supabase CLI:  npm i -g supabase
//   2. supabase login
//   3. supabase link --project-ref <ref вашего проекта ngk-telefonogrammy>
//   4. supabase functions deploy expert-writer --project-ref <ref>
//      (файл должен лежать в supabase/functions/expert-writer/index.ts)
//   5. Задайте секреты (Dashboard → Edge Functions → Secrets):
//        LLM_API_KEY   — ключ провайдера LLM (OpenAI, OpenRouter и т.п.)
//        LLM_BASE_URL  — необязательно; по умолчанию https://api.openai.com/v1
//        LLM_MODEL     — необязательно; по умолчанию gpt-4o-mini
//
// Без LLM_API_KEY функция вернёт 503 — сайт автоматически использует
// встроенный экспертный движок (правила + нормативная терминология).
// NB: в LLM уходят только технические сведения об объекте (адрес, замеры,
// дефекты) — персональные данные не передаются.
// ============================================================================

const LLM_BASE = (Deno.env.get("LLM_BASE_URL") ?? "https://api.openai.com/v1").replace(/\/+$/, "");
const LLM_KEY  = Deno.env.get("LLM_API_KEY") ?? "";
const LLM_MODEL = Deno.env.get("LLM_MODEL") ?? "gpt-4o-mini";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (b: unknown, status = 200) =>
  new Response(JSON.stringify(b), { status, headers: { ...cors, "Content-Type": "application/json" } });

const SYSTEM = `Ты — технический эксперт-писатель организации мерзлотно-технического надзора (г. Норильск, многолетнемёрзлые грунты, Арктическая зона). Глубоко знаешь и применяешь: ГОСТ 31937-2024 (обследование и мониторинг), ГОСТ 25358-2020 (полевые измерения температуры грунтов), ГОСТ 24846-2019 (деформации оснований), ГОСТ 25100-2020 (классификация грунтов), СП 497.1325800.2020 (эксплуатация оснований и фундаментов на ММГ), СП 25.13330.2020 (основания на ММГ), СП 13-102-2003 (обследование конструкций), СП 70.13330 (несущие конструкции), ПП РФ № 491 и № 290, Правила № 170, ЖК РФ ст. 161, ФЗ-384.

Задача: переписать черновой комментарий осмотра в технически выверенный текст для акта текущего осмотра.

Жёсткие правила:
1. НИЧЕГО не выдумывать: используй только факты из черновика и из присланного контекста объекта (JSON). Любое умозаключение привязывай к этим данным.
2. Терминология строго нормативная: коррозия, отслоение защитного слоя, обнажение арматуры, выкол/скол бетона, трещина с раскрытием N мм, морозное выпучивание, неравномерная осадка, наледь, подтопление, модуль вентилирования подполья и т.д.
3. Структура ответа (обычный текст, без markdown):
   1-я строка — фактическое состояние (что, где: оси/марки, размеры, степень).
   2-я строка — оценка дефекта по ГОСТ 31937-2024 (местное/значительное, влияние на несущую способность).
   Далее (только если есть данные в контексте) — привязка к объекту: связь с зарегистрированными осадками/температурным режимом/предыдущими обследованиями.
   Далее — прогноз (только по фактическим рядам наблюдений из контекста) и рекомендуемое мероприятие со ссылкой на норму и сроком.
4. Пиши по-русски, кратко, в стиле инженерного отчёта. Без воды, без оценок «плохо/хорошо» вне нормативных категорий.
5. Если фактов недостаточно — укажи, что требуется уточнить (оси, размеры, марка элемента), не дополняй вымыслом.`;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "POST only" }, 405);
  if (!req.headers.get("Authorization")) return json({ error: "auth required" }, 401);
  if (!LLM_KEY) return json({ error: "LLM_API_KEY не задан в секретах функции — используйте встроенный движок" }, 503);

  const body = await req.json().catch(() => null);
  if (!body || typeof body.raw !== "string" || !body.raw.trim()) return json({ error: "raw required" }, 400);

  const o = body.object ?? {};
  const it = body.item ?? {};
  const userMsg =
    `Пункт чек-листа: ${it.check ?? ""} (норматив: ${it.norm ?? ""})\n` +
    `Черновик комментария: «${body.raw}»\n\n` +
    `Контекст объекта (JSON, только факты):\n${JSON.stringify(o, null, 1)}`;

  try {
    const r = await fetch(`${LLM_BASE}/chat/completions`, {
      method: "POST",
      headers: { "Authorization": `Bearer ${LLM_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: LLM_MODEL,
        messages: [
          { role: "system", content: SYSTEM },
          { role: "user", content: userMsg },
        ],
        temperature: 0.2,
        max_tokens: 900,
      }),
    });
    if (!r.ok) return json({ error: "LLM provider: HTTP " + r.status }, 502);
    const j = await r.json();
    const text = (j.choices?.[0]?.message?.content ?? "").trim();
    if (!text) return json({ error: "пустой ответ LLM" }, 502);
    return json({ text });
  } catch (e) {
    return json({ error: "LLM недоступен: " + String(e) }, 502);
  }
});
