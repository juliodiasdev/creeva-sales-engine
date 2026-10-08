# Configurar o banco na nuvem (Supabase) — uma vez só

O aplicativo Creava Digital - Agência guarda tudo no Supabase (Postgres) e tem **um único login**.
Quem entrar com esse login vê todos os contatos, prospects e histórico, em qualquer computador.

## 1. Criar o projeto
1. Crie uma conta em https://supabase.com e clique em **New project**.
2. Escolha um nome (ex.: `creava`), uma senha de banco (guarde) e a região **South America (São Paulo)**.
3. Aguarde ~2 minutos.

## 2. Criar as tabelas
1. No projeto: **SQL Editor → New query**.
2. Abra o arquivo `supabase/schema.sql` deste repositório, copie **todo** o conteúdo, cole e clique em **Run**.
3. Deve aparecer "Success". (Pode rodar de novo sem problema.)

## 3. Criar o login único
1. **Authentication → Users → Add user → Create new user**.
2. Informe e-mail e senha e marque **Auto Confirm User**.
3. **Authentication → Sign In / Providers → Email**: desative **Allow new users to sign up**
   (assim ninguém além de você cria contas).

## 4. Copiar a conexão
**Project Settings → API**:
- **Project URL** (`https://xxxx.supabase.co`)
- **anon public key**

> Estes dois valores são públicos por design. A proteção dos dados é o login + as regras (RLS) do `schema.sql`.
> **Nunca** use a chave `service_role` no app.

## 5. Usar no app
- Abra o app. Na primeira vez ele pede **Project URL** e **anon key**; cole e clique em **Conectar**.
- Entre com o e-mail e a senha do passo 3.
- Em **Settings**, cadastre as chaves do Google Places e da OpenAI (ficam no banco, compartilhadas por quem entrar).

### Instalador já configurado (opcional)
No GitHub: **Settings → Secrets and variables → Actions → Variables** → crie
`VITE_SUPABASE_URL` e `VITE_SUPABASE_ANON_KEY`. Os instaladores gerados pelo workflow
abrem direto na tela de login.

## Trazer os dados do app antigo (local)
No app antigo: **Settings → Exportar backup**. No novo: **Settings → Importar backup**.
