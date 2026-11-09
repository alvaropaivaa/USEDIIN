# Assistente do Dinn no WhatsApp

A pessoa liga o próprio WhatsApp à conta (app > Configurações > WhatsApp) e passa a mandar para o
número do Dinn texto, áudio, foto (comprovante, nota, print do banco) ou PDF (extrato, fatura).
A função entende a mensagem com o Claude, lança em `public.records` e responde no WhatsApp.
O app recebe os lançamentos na hora pelo Realtime.

O que ela faz:
- lança despesas, receitas, transferências, compras no cartão (na fatura certa), parcelados e pagamentos de fatura;
- corrige o que acabou de lançar ("na verdade foi 50", "era no cartão");
- desfaz a última mensagem quando a pessoa responde "desfazer";
- responde perguntas (saldo, gastos do mês, faturas, limites, contas a pagar) com números já somados no servidor;
- avisa quando uma categoria passa de 80% do limite (ou do aviso configurado no app).

## Arquivos

| Arquivo | O que faz |
|---|---|
| `index.ts` | Rotas (webhooks da Lure API e da Meta, `/setup`), responde 200 na hora e trata em segundo plano |
| `flow.ts` | Caminho de cada mensagem: repetida? vínculo pelo código, acesso, mídia, cérebro comum, gravação, resposta |
| `providers.ts` | Leitura dos webhooks (Lure e Meta) e conferência das assinaturas |
| `transport.ts` | Envio de texto e download de mídia (Lure e Meta) |
| `data.ts` | Dados da pessoa e o contexto do assistente (saldos, mês, faturas, limites, contas a pagar, o que a última mensagem criou) |
| `actions.ts` | Aplica as operações (ops) do assistente: lançar, corrigir, desfazer e montar a confirmação |
| `ledger.ts` | Espelho das regras do app (`src/lib/ledger.ts` e `addTransaction`), conferido nos testes |
| `defaults.ts` | Categorias padrão do app (contas antigas sem categorias na nuvem) |
| `link.ts` | Telefone (com e sem o 9) e código de vínculo |
| `format.ts` | Dinheiro, datas e as mensagens fixas |
| `db.ts` | Consultas no Supabase com a chave de serviço |

O cérebro (instruções, formato da resposta, chamada ao Claude e conferência) e a transcrição ficam em
`../_shared/assistente/`, junto com o chat do app (`../assistente/`). Os dois canais recebem as mesmas
operações (`AssistantOps` em `_shared/assistente/types.ts`): aqui elas são aplicadas no servidor; no chat,
o app aplica pelo próprio store.

Os testes (`*.test.ts`) rodam com o `npm run test` do projeto e comparam as contas com as do app.

## Banco

Aplicar antes: `supabase/migrations/20261022000000_whatsapp.sql`.
Ela cria `whatsapp_links` (vínculo número ↔ conta, código de 30 min), `whatsapp_log` (mensagens tratadas, evita repetição e guarda o que desfazer) e liga o Realtime em `public.records`.

## Segredos

`SUPABASE_URL` e `SUPABASE_SERVICE_ROLE_KEY` já vêm no ambiente das funções. Os demais vão com
`supabase secrets set NOME=valor` (ou no painel, em Edge Functions > Secrets).

Sempre:

| Nome | Obrigatório | Para quê |
|---|---|---|
| `WHATSAPP_PROVIDER` | não (padrão `lure`) | `lure` ou `meta` |
| `WHATSAPP_WEBHOOK_SECRET` | sim | Assina a URL do webhook da Lure API e protege a rota `/setup`. Um texto aleatório longo |
| `ANTHROPIC_API_KEY` | sim | Chave da API do Claude |
| `CLAUDE_MODEL` | não (padrão `claude-opus-5-5`) | Modelo do Claude (ver custos abaixo) |
| `TRANSCRICAO_URL` | para áudio | Endpoint compatível com `/v1/audio/transcriptions`. Ex.: `https://api.openai.com/v1/audio/transcriptions` ou `https://api.groq.com/openai/v1/audio/transcriptions` |
| `TRANSCRICAO_API_KEY` | para áudio | Chave do serviço de transcrição |
| `TRANSCRICAO_MODELO` | não (padrão `whisper-1`) | Ex.: `whisper-1` (OpenAI) ou `whisper-large-v3-turbo` (Groq) |
| `APP_URL` | não | Link do app na resposta a números ainda não ligados |

Sem os dois de transcrição, o assistente pede para a pessoa escrever em vez de mandar áudio.

Lure API (`WHATSAPP_PROVIDER=lure`):

| Nome | Para quê |
|---|---|
| `LURE_INSTANCE_ID` | Instância do número do assistente |
| `LURE_TOKEN` | Token da instância |
| `LURE_API_URL` | Opcional; padrão `https://api.assessorialuredigital.com.br` |

Meta (`WHATSAPP_PROVIDER=meta`):

| Nome | Para quê |
|---|---|
| `WHATSAPP_PHONE_NUMBER_ID` | Id do número no WhatsApp Business |
| `WHATSAPP_TOKEN` | Token de acesso permanente (usuário do sistema) |
| `WHATSAPP_APP_SECRET` | App Secret do app da Meta (confere o `X-Hub-Signature-256`) |
| `WHATSAPP_VERIFY_TOKEN` | Texto que você inventa e repete no painel da Meta |
| `WHATSAPP_GRAPH_VERSION` | Opcional; padrão `v21.0` |

## Publicar

A função faz a própria autenticação (assinatura do provedor), então precisa ser publicada **sem** a
verificação de JWT do Supabase:

```bash
supabase functions deploy whatsapp --no-verify-jwt
```

(ou `verify_jwt = false` em `[functions.whatsapp]` no `supabase/config.toml`; pela Management API,
`verify_jwt: false` nos metadados, com `entrypoint_path` = `index.ts` e todos os `.ts` desta pasta,
menos os `*.test.ts`, mais os de `../_shared/assistente/`).

## Chat do app (`../assistente`)

Mesma IA, sem gravar nada: o app manda a mensagem e o contexto e aplica as operações que voltam.
Publicada **com** verificação de JWT (`supabase functions deploy assistente`); confere o plano em
`profiles` como aqui. Usa os mesmos segredos `ANTHROPIC_API_KEY`, `CLAUDE_MODEL` e `TRANSCRICAO_*`.

## Webhook

Base: `https://<ref-do-projeto>.supabase.co/functions/v1/whatsapp`

**Lure API.** A URL leva uma assinatura: `…/whatsapp/lure/<assinatura>`, em que a assinatura é o
HMAC-SHA256 de `lure-webhook:<LURE_INSTANCE_ID>` com o `WHATSAPP_WEBHOOK_SECRET`, em base64url,
cortado em 32 caracteres (o mesmo formato do CheckZap). Não precisa calcular: a rota `/setup`
monta a URL e já a aponta como webhook de mensagem recebida da instância:

```bash
curl -X POST https://<ref>.supabase.co/functions/v1/whatsapp/setup -H "x-setup-secret: <WHATSAPP_WEBHOOK_SECRET>"
# → { "provider": "lure", "webhook": "https://…/whatsapp/lure/…", "connected": true }
```

O número do assistente é conectado na Lure API por QR code, como no CheckZap.

**Meta.** No painel do app (WhatsApp > Configuração), em Webhook:
- URL de retorno: `https://<ref>.supabase.co/functions/v1/whatsapp/meta`
- Token de verificação: o valor de `WHATSAPP_VERIFY_TOKEN`
- Campo assinado: `messages`

O `/setup` com o provedor `meta` só devolve essa URL.

## Ligação com o app

- O app mostra o número do assistente (`VITE_WHATSAPP_NUMBER`, só dígitos com DDI) e chama `whatsapp_code()`.
- Depois abre `wa.me/<número>` com o texto `Meu código do Dinn: XXXXXX`.
- Quando essa mensagem chega, a função grava o telefone em `whatsapp_links`, sempre na forma com o 9 do celular. O app vê o vínculo lendo essa tabela.
- O mesmo celular, com ou sem o 9, nunca fica ligado a duas contas.
- Os lançamentos criados aqui têm `via: 'whatsapp'`.
- `whatsapp_log` guarda cada mensagem, com a entrada (texto ou transcrição), a resposta e o que ela criou.

## Custos

- **Claude:** uma chamada por mensagem. "desfazer" sozinho não chama.
  - Cada chamada leva as instruções e o resumo da pessoa: contas, cartões, categorias, o mês e as últimas mensagens. São uns 3 a 5 mil tokens de entrada, e a resposta é um JSON curto.
  - Com `claude-opus-5-5` (US$ 4 por milhão de tokens de entrada, US$ 20 de saída), fica na casa de US$ 0,02 a 0,04 por mensagem de texto. Foto e PDF custam um pouco mais, conforme o tamanho.
  - Com `CLAUDE_MODEL=claude-haiku-5-5` (US$ 0,10 / 0,50) o custo cai dezenas de vezes, com menos precisão em prints e extratos difíceis.
- **Transcrição:** cobrada por minuto de áudio pelo serviço escolhido.
- **WhatsApp:** a Lure API segue o contrato da Lure; a Meta cobra conforme a tabela de preços dela.
