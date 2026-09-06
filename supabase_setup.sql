-- ============================================================================
-- ГИС-база геотехнического мониторинга зданий. г. Норильск · АНО «АНИИГБ» им. М.В. Кима
-- Настройка общего реестра раздела «Телефонограммы» в Supabase
-- ----------------------------------------------------------------------------
-- Что это даёт:
--   1) общий реестр телефонограмм для всех пользователей (не только в одном браузере);
--   2) настоящую верификацию email при регистрации исполнителей (письмо со ссылкой);
--   3) журнал изменений с отметкой времени (updated_at).
--
-- Порядок настройки (один раз, ~5 минут):
--   1. Зарегистрируйтесь на https://supabase.com и создайте проект (Free-тарифа достаточно).
--   2. В Dashboard → SQL Editor выполните этот файл целиком.
--   3. В Dashboard → Authentication → Providers убедитесь, что включён Email
--      и включено «Confirm email» (по умолчанию включено).
--   4. В Dashboard → Project Settings → API скопируйте:
--      - Project URL (https://xxxx.supabase.co)
--      - anon public key
--   5. На сайте базы откройте карточку любого объекта → «Телефонограммы» →
--      «⚙ подключение общего реестра», введите URL и ключ, нажмите «Сохранить».
--
-- Уведомления УК о новых предписаниях (опционально):
--   Dashboard → Database → Webhooks → Create webhook на таблицу telegrammy
--   (событие INSERT) → вызов Edge Function / внешнего почтового сервиса.
--   Либо настройте триггер в конце файла (см. раздел NOTIFY).
-- ============================================================================

-- 1. Таблица реестра телефонограмм
create table if not exists public.telegrammy (
  addr        text        not null,               -- адрес объекта (как в базе ГИС)
  rec_id      text        not null,               -- id записи: «L…» — правки к письмам ЖКС, «u…» — новые предписания
  data        jsonb       not null default '{}',  -- содержимое записи (нарушение, требование, ответы УК, статус)
  updated_at  timestamptz not null default now(),
  primary key (addr, rec_id)
);

create index if not exists telegrammy_addr_idx on public.telegrammy (addr);

-- 2. Безопасность: доступ только зарегистрированным (прошедшим email-верификацию) пользователям
alter table public.telegrammy enable row level security;

drop policy if exists tg_select_auth on public.telegrammy;
create policy tg_select_auth on public.telegrammy
  for select to authenticated
  using (true);

drop policy if exists tg_insert_auth on public.telegrammy;
create policy tg_insert_auth on public.telegrammy
  for insert to authenticated
  with check (true);

drop policy if exists tg_update_auth on public.telegrammy;
create policy tg_update_auth on public.telegrammy
  for update to authenticated
  using (true)
  with check (true);

-- Удаление записей через API запрещено (политика delete не создаётся) —
-- история предписаний и ответов сохраняется полностью.

-- 3. Автоматическая отметка времени обновления
create or replace function public.tg_touch()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;

drop trigger if exists telegrammy_touch on public.telegrammy;
create trigger telegrammy_touch
  before update on public.telegrammy
  for each row execute function public.tg_touch();

-- ============================================================================
-- NOTIFY (опционально): уведомление о новых предписаниях через Edge Function.
-- Требуется развернуть Edge Function (например, отправку письма через SMTP/Resend)
-- и подставить её URL и service-role ключ. Без этого блока система полностью
-- работоспособна — уведомления просто не отправляются.
--
-- create extension if not exists pg_net;
--
-- create or replace function public.tg_notify_new()
-- returns trigger language plpgsql security definer as $$
-- begin
--   if new.rec_id like 'u%' then  -- только новые предписания надзора
--     perform net.http_post(
--       url     := 'https://xxxx.supabase.co/functions/v1/tg-notify',
--       headers := jsonb_build_object('Content-Type','application/json',
--                                     'Authorization','Bearer <service-role-key>'),
--       body    := jsonb_build_object('addr', new.addr, 'rec_id', new.rec_id, 'data', new.data)
--     );
--   end if;
--   return new;
-- end $$;
--
-- drop trigger if exists telegrammy_notify on public.telegrammy;
-- create trigger telegrammy_notify
--   after insert on public.telegrammy
--   for each row execute function public.tg_notify_new();
-- ============================================================================
