# GEX Talents - versão visual aprovada

Esta versão mantém o GEX Design System, com ícones em SVG e páginas individuais de vagas em revisão.

# GEX Talents — GitHub Pages + Recrutei

Primeira versão do portal externo de carreiras da GEX, seguindo o design oficial utilizado nos materiais internos da GEX.

## O que já está pronto

- Home responsiva no padrão visual GEX.
- Cultura e benefícios.
- Área de vagas com busca e filtro.
- Modo demonstração para publicar no GitHub Pages sem credenciais.
- Backend seguro separado para consultar vagas da Recrutei e criar candidatos via `prospects`.
- Nenhuma chave da Recrutei fica no HTML/JavaScript público.

## Arquitetura

GitHub Pages (site) → backend seguro → API Recrutei

O GitHub Pages é somente o front-end. Isso é obrigatório para não expor `token da empresa`, `chave privada`, e-mail ou senha no navegador.

## 1. Publicar a prévia no GitHub Pages

1. Crie um repositório, por exemplo `GEX-Talents`.
2. Envie os arquivos públicos da raiz: `index.html`, `styles.css`, `tokens.css`, `application.css`, `app.js`, `questionnaires.js`, `config.js` e a pasta `assets`.
3. No GitHub: **Settings → Pages → Deploy from a branch → main / root**.
4. Abra o endereço gerado pelo GitHub Pages.

O `config.js` atual usa `DEMO_MODE: false` e aponta ao backend configurado. Para uma
demonstração sem envio à Recrutei, use explicitamente `DEMO_MODE: true`.

## 2. Backend seguro

A pasta `worker/` contém um backend compatível com Cloudflare Workers. Ele pode usar um endereço `workers.dev`, portanto não exige domínio próprio.

Configure os segredos diretamente no painel/CLI do backend — nunca no GitHub público:

- `RECRUTEI_API_KEY` = Token da empresa mostrado em Configurações → API.
- `RECRUTEI_API_SECRET` = Chave privada mostrada em Configurações → API.
- `RECRUTEI_EMAIL` = e-mail do usuário autorizado na Recrutei.
- `RECRUTEI_PASSWORD` = senha desse usuário.
- `PROSPECT_CHANNEL_ID` = ID real do canal de aquisição a ser usado nos prospects.

**Não envie esses valores por chat e não os salve em `config.js`, `wrangler.toml` ou qualquer arquivo público.**

O backend usa `/api/v1/login-api` para obter o Bearer Token e depois chama:

- `POST /api/v2/vacancies/filter` para listar vagas.
- `POST /api/v2/prospects` para criar o candidato na vaga e na etapa do pipeline.

## 3. Ligar o site ao backend

Depois de publicar o backend, edite `config.js`:

```js
window.GEX_TALENTS_CONFIG = {
  API_BASE_URL: "https://SEU-BACKEND.workers.dev",
  DEMO_MODE: false
};
```

Depois faça commit no GitHub. O site passará a buscar as vagas reais.

## 4. Segurança antes de produção

Configure `ALLOWED_ORIGIN` no backend com a origem do GitHub Pages. Exemplo:

```toml
ALLOWED_ORIGIN = "https://recursoshumanos-2026.github.io"
```

Também valide com a Recrutei qual canal de aquisição (`PROSPECT_CHANNEL_ID`) deve representar candidaturas vindas do GEX Talents.

## Observação sobre currículo e campos extras

A criação usa nome, e-mail, telefone, vaga, etapa e canal de aquisição. O backend
também tenta atualizar os dados complementares existentes; essa atualização ainda
não foi homologada, pois retornou HTTP 404 no teste real. O formulário não oferece
upload de currículo. A integração Cloudflare está configurada.

## Questionários por vaga (revisão, ainda sem publicação)

O cadastro compartilhado em `questionnaires.js` contém os questionários obrigatórios das vagas
`158928` (Analista de Atendimento, sete perguntas), `158883` (Analista de Dados Sênior,
oito perguntas), `158921` (Analista de CS - Afiliação, sete perguntas) e `158786`
(Editor de Vídeo, dez perguntas) e `158684` (Desenvolvedor Backend e Integrações SMS - Sênior,
seis perguntas transcritas dos prints). Cada vaga recebe somente seu próprio questionário
e a observação correspondente; as demais vagas continuam sem perguntas ou observações.
Para futuras vagas, acrescente uma entrada pelo ID, com título, IDs estáveis de perguntas,
rótulos, tipos `text`, `long`, `single` ou `multiple` e alternativas. As perguntas são
obrigatórias por padrão; `required: false` permite um item opcional. No Editor de Vídeo,
somente o campo Instagram/LinkedIn/portfólio é opcional. Quando não preenchido, a
observação registra “Não informado” no lugar da resposta, mantendo a numeração; respostas curtas aceitam até 500 caracteres e longas até 5000 após
remover espaços externos. A pergunta longa de Afiliação usa textarea; suas quebras de
linha são preservadas na observação depois do escape HTML.

O navegador envia `questionnaire_answers` junto dos dados existentes. O Worker valida
novamente as respostas antes de qualquer chamada à Recrutei e, após criar a candidatura,
mantém a tentativa de preenchimento complementar e a tag `GEX Talents`, acrescentando
`POST /api/v2/talents-observations` em multipart com HTML escapado.
Nenhum token foi acrescentado ao front-end.

Quando a observação falha, a API mantém HTTP 201 e informa `application_created: true`,
`observation_completed: false` e `observation_warning`. O formulário informa a pendência,
preserva as respostas para contato com o RH e bloqueia novo envio naquele formulário.
Não há repetição automática nem armazenamento local persistente das respostas.

Verificações locais (Node 20+ e Chromium):

```sh
npm ci
npm test
npm run check
CHROMIUM_PATH=/usr/bin/chromium npm run test:ui
```

O teste visual compara outra vaga com o commit aprovado
`253641126defebd7761443fb913fb2550a32262b` e requer esse commit no histórico Git.
Pode-se selecionar outra referência com `GEX_BASELINE_REF`.
Os testes usam exclusivamente respostas simuladas e um servidor local.

Consulte `REVISAO.md` para resultados, limitações e ordem proposta de homologação.
Testes reais autorizados na prévia confirmaram candidatura, tag e as sete respostas.
O perfil complementar permanece pendente; não houve merge ou publicação em produção.


### Compilação de prévias na Cloudflare

A Cloudflare executa `npx wrangler preview` a partir da raiz. O `wrangler.toml`
da raiz aponta para o backend existente e declara `[previews.vars]`, exigido por
esse comando. A configuração original `worker/wrangler.toml` continua disponível
para os comandos que já usam esse caminho; mantenha os parâmetros de produção
consistentes entre ambos.

A prévia usa `APPLICATIONS_ENABLED = "true"` durante a homologação autorizada,
conforme instrução do usuário para manter os envios disponíveis.
Os segredos de produção não são herdados pelas prévias: configure-os somente no
painel seguro da Cloudflare, na Base de Prévias, quando for preparar a homologação.
A existência de uma URL de prévia não confirma por si só a integração com a Recrutei.


Se uma página aberta tentar enviar depois que as candidaturas forem desativadas,
a API responde HTTP 503, `code: APPLICATIONS_DISABLED` e `application_created: false`,
sem consultar ou escrever na Recrutei. A interface informa o bloqueio e desativa
o envio, preservando o preenchimento.


Quando a atualização complementar falha, `profile_error` informa o status HTTP
(se houver) e somente nomes conhecidos dos campos recusados. Os valores das
mensagens de validação não são incluídos nesse novo diagnóstico. O retorno
`profile_warning` existente foi mantido. A conferência real identificou HTTP 404
no PUT do perfil, `birthday_verified: false` e `salary_verified: null`.
Isso não determina a causa nem comprova problema no CPF ou na data informada.


Na homologação, a rota `GET /api/diagnostico-perfil` só fica disponível quando
`PROFILE_DIAGNOSTIC_ENABLED`, `PROFILE_DIAGNOSTIC_APPLICATION_ID` e
`PROFILE_DIAGNOSTIC_VACANCY_ID` são configurados explicitamente na prévia. Ela
consulta somente o cadastro fictício fixado e devolve metadados sem valores
pessoais ou IDs; não altera registros e ignora IDs enviados por querystring.
A configuração de produção não declara essas variáveis.


O preenchimento complementar preserva o contrato original: o ID do talento vai
no query `talent_id` e no corpo, junto ao ID da candidatura. A hipótese de usar
o ID da prospecção na query retornou 404 e foi retirada para preservar
o comportamento das demais vagas; isso não é uma correção do perfil.
A conferência temporária da prévia pode
atualizar e reler apenas o cadastro fictício fixado, usando `/api/teste-perfil`;
a rota é desabilitada sem configuração explícita e não cria candidaturas.

O draft permanece sem produção até confirmar o preenchimento complementar.
Consulte a mensagem pronta em [SUPORTE-RECRUTEI.md](SUPORTE-RECRUTEI.md).

## Páginas individuais e sincronização do Job Description (revisão)

O GEX Talents mantém a listagem de vagas pela API autenticada oficial da Recrutei
(`POST /api/v2/vacancies/filter`). Para abrir `?vaga=ID`, o frontend consulta
`GET /api/vagas/ID` no Cloudflare Worker. Essa rota verifica novamente se a vaga
existe e está publicada antes de retornar os detalhes.

Quando a API de listagem não fornecer a descrição, o Worker consulta **apenas a página
pública da própria vaga na Recrutei**, em
`https://jobs.recrutei.com.br/gex-corporation/vacancy/ID-slug`, extraindo
`props.pageProps.retorno.vacancy.description` do JSON público `__NEXT_DATA__`.
O host é fixo, o slug é validado, o ID retornado precisa coincidir, e a página não pode
estar encerrada. **Nenhuma credencial da Recrutei é enviada para esse host**.
O HTML recebido é sanitizado no frontend (lista permitida de tags, links HTTP/HTTPS)
antes de ser exibido.

Esta integração da página pública é um **fallback não documentado como API** e pode
precisar de manutenção caso a estrutura da página da Recrutei mude. Se a fonte falhar,
o sistema conserva o campo retornado pela API privada ou exibe uma mensagem neutra,
sem inventar o conteúdo. O navegador armazena o detalhe em cache por até cinco minutos.

A página individual não repete as seções institucionais `Nosso Jeito de Ser GEX`,
`Aqui, nossos GEXs encontram` e `Benefícios` quando aparecerem na descrição da
Recrutei; esses benefícios são exibidos uma única vez na seção visual aprovada.
Os botões de candidatura e os questionários permanecem ligados ao ID original da vaga.

### Homologação antes da publicação

- `npm run check`, `npm test` e o teste de navegador automatizado devem passar.
- Validar pelo menos uma vaga real aberta, uma encerrada e a responsividade.
- Confirmar o comportamento da extração no Cloudflare Worker de prévia; o teste local
  usa respostas simuladas da Recrutei e não expõe segredos.
- O erro HTTP 404 na atualização de dados complementares de candidatos continua
  pendente; não alterar a criação de candidaturas para mascarar essa falha.
- Não realizar merge ou deploy em produção sem aprovação visual e funcional.

## Currículos em PDF/DOCX (nova revisão)

O fluxo de conversão Cloudflare Workers AI → Markdown → armazenamento **Cloudflare D1 Free privado** → Recrutei está implementado de forma **desativada até a configuração do banco e homologação do campo personalizado**. A GEX optou por manter a infraestrutura de currículos no plano gratuito, sem ativar a assinatura R2 com cobrança por consumo. Veja [CURRICULOS.md](CURRICULOS.md) para configuração, migração SQL, segurança, limites do plano Free, LGPD e testes. Não ativar a flag sem banco D1 privado, proteções contra abuso e testes reais de homologação.

### Prévia Cloudflare para validação do upload

A branch `feat/lucide-icons-gex` é usada somente para homologação de recursos ainda não publicados. No painel Cloudflare, a opção **Builds para branches de preview** deve estar ligada e o comando de prévia deve ser `npx wrangler preview`. Um novo push nessa branch dispara a compilação de prévia; isso não promove a versão para produção. O envio de currículos permanece desativado (`RESUME_UPLOAD_ENABLED=false`) até o teste real com dados fictícios.
