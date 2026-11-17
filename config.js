// Сайт работает с облачным Supabase.
window.MESTO_CONFIG = {
  SUPABASE_URL: 'https://ekoqeeskifjahoanuptt.supabase.co',
  SUPABASE_ANON_KEY: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImVrb3FlZXNraWZqYWhvYW51cHR0Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTIzMjU2NzcsImV4cCI6MjEwNzkwMTY3N30.APEM0KAyK0ORAPmgQbgmNdZ5Z1vOkIyTJJ1rZza_nFE',
  // Ключ карты 2ГИС (MapGL JS API). Чтобы вернуть старую карту (OpenStreetMap) — удалите эту строку.
  DGIS_KEY: '392bdc8e-dd65-4b89-a350-a99e27e7321c',
  // Имя бота в Telegram без «@» (например 'mesto_vmeste_bot'). Пока пусто — Telegram выключен.
  TG_BOT: 'mestovmeste_bot',
  // Вход только через Telegram (почта и пароль скрыты). Вернуть вход по паролю: false
  TG_ONLY: true
};
