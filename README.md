# PK Radar

Painel independente para monitoramento de personagens de Tibia. O projeto não depende do Lovable para executar ou hospedar.

## Stack
- Vite + React + TypeScript
- Supabase/PostgreSQL
- Tibia Stalker REST/WebSocket
- TibiaData como fonte oficial complementar

## Configuração
1. Crie um projeto no Supabase.
2. Execute supabase/schema.sql no SQL Editor.
3. Crie pelo menos um usuário no Supabase Auth.
4. Copie .env.example para .env e preencha VITE_SUPABASE_URL e VITE_SUPABASE_ANON_KEY.
5. npm install
6. npm run dev ou npm run build.


## Deploy
Pode hospedar como SPA em Vercel, Netlify, Cloudflare Pages ou outro servidor estático com fallback para index.html. Configure as variáveis VITE_* no ambiente de build.

## Monitoramento contínuo
O navegador usa o WebSocket do Tibia Stalker enquanto o painel está aberto. Para continuar monitorando quando ninguém estiver no site, execute node worker/monitor.mjs. O worker usa SUPABASE_SERVICE_ROLE_KEY somente no servidor e registra LOGIN/LOGOUT e MASS LOGIN (3+ em 5 minutos).

## Fontes
Tibia Stalker fornece online realtime e sugestões de possíveis outros chars. TibiaData fornece dados públicos complementares. TibiaRing/GuildStats podem ser adicionados como adapters independentes.

Sugestões de relacionamento são evidências probabilísticas, nunca fatos automáticos.


## Monitoramento de PvP em segundo plano
A coleta de kills não depende da aba do navegador. O endpoint `/api/monitor-tick` roda no servidor e usa o Supabase como estado persistente.

### Produção
- Vercel Cron chama `/api/monitor-tick` a cada 1 minuto.
- GitHub Actions (`.github/workflows/pvp-monitor.yml`) serve como fallback a cada 5 minutos.
- O endpoint exige `CRON_SECRET`.
- Kills novas geram registros em `death_events`, `pvp_events` e `alerts`.
- Se `TELEGRAM_BOT_TOKEN` e `TELEGRAM_CHAT_ID` estiverem configurados na Vercel, uma kill nova dentro da janela de 15 minutos também dispara Telegram imediatamente.

### Variáveis de servidor
Na Vercel:
- `SUPABASE_URL`
- `SUPABASE_SECRET_KEY`
- `CRON_SECRET`
- `TELEGRAM_BOT_TOKEN` (opcional, recomendado)
- `TELEGRAM_CHAT_ID` (opcional, recomendado)

No GitHub Actions, adicione `CRON_SECRET` com o mesmo valor usado na Vercel para habilitar o fallback de 5 minutos.
