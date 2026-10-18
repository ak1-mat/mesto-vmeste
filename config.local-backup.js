// Настройки подключения к серверу Supabase на этом компьютере.
// Сайт и API работают на одном адресе: server.ps1 пересылает /auth, /rest, /storage в Supabase (порт 8000).
window.MESTO_CONFIG = {
  SUPABASE_URL: location.origin,
  SUPABASE_ANON_KEY: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJyb2xlIjoiYW5vbiIsImlzcyI6InN1cGFiYXNlIiwiaWF0IjoxNzkyMDkwODA4LCJleHAiOjE5NDk3NzA4MDh9.e9t6649PhH3GxVceu72O70zn4AIYYV0qa8nnDOa_QoA'
};
