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
