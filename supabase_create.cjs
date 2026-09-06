// ============================================================================
// Автоматическое развёртывание серверного контура «Телефонограммы» на Supabase
// ГИС-база геотехнического мониторинга зданий. г. Норильск · АНО «АНИИГБ»
//
// Что делает: создаёт проект Supabase (free), выполняет supabase_setup.sql,
// выводит Project URL и anon key для подключения на сайте (⚙ в разделе).
//
// Как запустить (один раз, ~3 минуты):
//   1. Зарегистрируйтесь на https://supabase.com (можно через GitHub).
//   2. Создайте персональный токен: https://supabase.com/dashboard/account/tokens
//      (кнопка «Generate new token», имя любое).
//   3. В командной строке из папки проекта:
//        set SUPABASE_TOKEN=sbp_...ваш_токен...
//        node supabase_create.cjs
//   4. Скопируйте выведенные Project URL и anon key на сайт:
//      карточка объекта → 🔒/📋 → ⚙ подключение общего реестра.
// ============================================================================
const TOKEN = process.env.SUPABASE_TOKEN;
if (!TOKEN) { console.error('Задайте токен: set SUPABASE_TOKEN=sbp_...'); process.exit(1); }

const fs = require('fs');
const path = require('path');
const SQL_FILE = path.join(__dirname, 'supabase_setup.sql');

const API = 'https://api.supabase.com';
async function api(method, p, body) {
  const r = await fetch(API + p, {
    method,
    headers: { 'Authorization': 'Bearer ' + TOKEN, 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined
  });
  const t = await r.text();
  let j = null; try { j = JSON.parse(t); } catch (e) {}
  if (!r.ok) throw new Error(method + ' ' + p + ' -> ' + r.status + ': ' + t.slice(0, 300));
  return j;
}
const sleep = ms => new Promise(r => setTimeout(r, ms));

(async () => {
  // 1. Организация
  const orgs = await api('GET', '/v1/organizations');
  if (!orgs.length) throw new Error('В аккаунте нет организации — создайте её в dashboard (автоматически предложат при входе).');
  const org = orgs[0];
  console.log('Организация:', org.name);

  // 2. Проект (или найти существующий по имени)
  const PROJ = 'ngk-telefonogrammy';
  const existing = (await api('GET', '/v1/projects')).find(p => p.name === PROJ);
  let ref;
  if (existing) {
    ref = existing.id;
    console.log('Проект уже существует:', ref);
  } else {
    const dbPass = 'Ngk!' + Math.random().toString(36).slice(2, 14) + 'zQ';
    const pr = await api('POST', '/v1/projects', {
      organization_id: org.id, name: PROJ, region: 'fra',
      db_pass: dbPass, plan: 'free'
    });
    ref = pr.id;
    console.log('Проект создаётся:', ref, '— ждём готовности…');
    for (let i = 0; i < 60; i++) {
      await sleep(5000);
      const st = await api('GET', '/v1/projects/' + ref);
      if (st.status === 'ACTIVE_HEALTHY') break;
      process.stdout.write('.');
    }
    console.log('\nПроект активен.');
  }

  // 3. SQL-схема
  const sql = fs.readFileSync(SQL_FILE, 'utf-8');
  await api('POST', '/v1/projects/' + ref + '/database/query', { query: sql });
  console.log('Таблица telegrammy и политики созданы.');

  // 4. Ключи
  const keys = await api('GET', '/v1/projects/' + ref + '/api-keys');
  const anon = (keys.find(k => k.name === 'anon') || keys[0]).api_key;
  const url = 'https://' + ref + '.supabase.co';

  console.log('\n================ ГОТОВО — подключение на сайте ================');
  console.log('Project URL :', url);
  console.log('anon key    :', anon);
  console.log('================================================================');
  console.log('Сайт → карточка объекта → 🔒 Телефонограммы → ⚙ подключение общего реестра.');
  console.log('Важно: встроенная почта Supabase free шлёт мало писем в час. Если регистраций');
  console.log('много — настройте свой SMTP: Dashboard → Project Settings → Auth → SMTP.');
})().catch(e => { console.error('ОШИБКА:', e.message); process.exit(1); });
