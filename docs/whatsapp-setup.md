# Conectar o WhatsApp oficial (Meta) ao Creava Digital

O app recebe as respostas pelo **webhook** (função `whatsapp-webhook`) e envia pelo servidor
(função `whatsapp-send`). O token da Meta fica só no Supabase, nunca no app.

## 1. Na Meta
1. business.facebook.com: crie o portfólio empresarial da Creava.
2. developers.facebook.com: crie um app do tipo **Empresa** e adicione o produto **WhatsApp**.
3. Conecte o número do **WhatsApp Business** (opção de continuar usando o aplicativo no celular,
   chamada de *coexistência*). O número deve estar em uso no aplicativo há alguns dias e o
   aplicativo precisa estar atualizado. A disponibilidade depende da Meta: se a tela mostrar erro de
   país ou elegibilidade, use um número dedicado.
4. No portfólio, crie um **usuário do sistema**, atribua o app e a conta do WhatsApp a ele e gere um
   **token permanente** com as permissões `whatsapp_business_messaging` e
   `whatsapp_business_management`.
5. Anote: **ID do número de telefone** (Configuração da API) e **chave secreta do app**
   (Configurações do app → Básico).

## 2. No Supabase
1. **Edge Functions → Deploy a new function** (pelo editor do painel):
   - `whatsapp-send`: cole `supabase/functions/whatsapp-send/index.ts` e deixe **Verify JWT** ligado.
   - `whatsapp-webhook`: cole `supabase/functions/whatsapp-webhook/index.ts` e **desligue Verify JWT**
     (a Meta não faz login; a proteção é a assinatura HMAC).
2. **Edge Functions → Secrets**:

   | Segredo | Valor |
   |---|---|
   | `WHATSAPP_TOKEN` | token permanente do usuário do sistema |
   | `WHATSAPP_PHONE_NUMBER_ID` | ID do número de telefone |
   | `WHATSAPP_VERIFY_TOKEN` | uma senha que você inventa |
   | `META_APP_SECRET` | chave secreta do app |
   | `WHATSAPP_API_VERSION` | opcional (padrão `v22.0`) |

3. Rode de novo o `supabase/schema.sql` (cria a tabela `whatsapp_events`).

## 3. De volta à Meta
WhatsApp → Configuração → **Webhook**: endereço
`https://SEU-PROJETO.supabase.co/functions/v1/whatsapp-webhook`, o mesmo `WHATSAPP_VERIFY_TOKEN`,
e assine o campo **messages**.

## 4. Testar
1. No app: Configurações → Conectar o WhatsApp → **Verificar conexão**. Deve aparecer "Envio configurado".
2. **Teste o recebimento**: peça a alguém para escrever para o número. A mensagem deve aparecer em
   Conversas e o painel passa a mostrar "Recebimento funcionando". Sem isso o webhook não está certo.
3. O envio de teste só chega a quem escreveu nas últimas 24 horas ou a números cadastrados como teste
   na Meta: se falhar para outro número, não é erro de configuração.

## Regras que o app respeita
- Só responde por texto livre dentro de **24 horas** depois da última mensagem da pessoa. Fora disso
  é preciso um modelo aprovado pela Meta (ainda não suportado) ou enviar manualmente.
- Pedido formal de parar ("pare", "sair", "descadastrar"…) suprime a empresa na hora.
- Empresas na lista de "não contatar" nunca recebem mensagem.
- Mídia recebida (áudio, imagem) aparece como aviso: abra no WhatsApp para ver.
