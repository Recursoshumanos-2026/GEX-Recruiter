# GEX Talents — revisão do questionário da vaga 158928

Data: 3 de novembro de 2026.
Base: `253641126defebd7761443fb913fb2550a32262b`.
Branch local: `feat/questionario-158928`.
Status: implementação para revisão em branch separada e pull request em rascunho; sem merge ou deploy em produção.

## Alterações

| Arquivo | Mudança |
| --- | --- |
| `questionnaires.js` | Cadastro compartilhado por ID de vaga, sete perguntas solicitadas e validação reutilizada no navegador e Worker. |
| `app.js` | Renderização exclusiva da vaga 158928; texto, rádio e checkboxes; envio de todas as alternativas; aviso de observação pendente. |
| `index.html` | Contêiner inicialmente oculto; carregamento do app como módulo; anúncio acessível do resultado; versões dos recursos atualizadas. |
| `application.css` | Estilos restritos ao novo questionário, com os tokens visuais existentes. |
| `worker/src/index.js` | Validação antes da criação; observação multipart após criação; HTML escapado; estados explícitos de sucesso parcial. |
| `wrangler.toml` | Configuração descoberta pela Cloudflare na raiz; aponta para o Worker existente e declara `previews.vars` com candidaturas desabilitadas. |
| `tests/`, `package.json`, `package-lock.json` | Testes de integração simulados e de interface com Chromium. Playwright é dependência somente de desenvolvimento. |
| `.gitignore`, `README.md`, `REVISAO.md` | Exclusão dos arquivos de trabalho/dependências e instruções para revisão. |

Não foram alterados `styles.css`, `tokens.css`, logos, conteúdos das páginas, URL do
backend, credenciais ou o arquivo existente `worker/wrangler.toml`. O fluxo existente de perfil e tag foi
preservado. Suas exceções de rede agora são isoladas para que uma falha posterior à
criação não impeça tentar registrar a observação nem seja apresentada como falha de criação.

## Formulário

1. Você aceita oportunidade PJ? — texto obrigatório.
2. Qual sua pretensão salarial para a vaga PJ? — texto obrigatório.
3. Qual sua idade? — texto obrigatório, sem conversão numérica adicional.
4. Você possui experiência profissional com atendimento ao cliente? — uma alternativa obrigatória.
5. Você já trabalhou com retenção de clientes? — uma ou mais alternativas obrigatórias.
6. Você já trabalhou com metas ou indicadores de atendimento? — uma ou mais alternativas obrigatórias.
7. Quais canais de atendimento você já utilizou profissionalmente? — uma ou mais alternativas obrigatórias.

As alternativas seguem integralmente a solicitação. As perguntas 5, 6 e 7 usam checkboxes.
O campo existente de pretensão salarial continua preenchendo o perfil; a pergunta 2
é registrada separadamente na observação, conforme solicitado.

## Contrato da integração

A documentação oficial foi consultada em
https://developers.recrutei.com.br/docs/criando-observa%C3%A7%C3%B5es-em-um-candidato.

Após `POST /api/v2/prospects`, a integração reutiliza os IDs reais retornados. O novo
`POST /api/v2/talents-observations` envia `application_id`, `talent_id`,
`talent_observation_type_id=7`, `action=1` e `description` em HTML. `FormData` gera o
boundary multipart; o Bearer continua exclusivamente no Worker.

A descrição começa com **GEX Talents | Respostas da candidatura** e
**Vaga: Analista de Atendimento**, seguida das sete perguntas e respectivas respostas
em ordem numérica. Alternativas múltiplas são registradas em lista, sem perder seleções.

A validação rejeita texto vazio, espaços, tipos inválidos, respostas curtas acima de
500 caracteres, opções desconhecidas e grupos múltiplos vazios ou duplicados.
O HTML escapa `&`, `<`, `>`, aspas e apóstrofos. Labels e título vêm do cadastro do servidor,
nunca de campos enviados pelo candidato. Vagas sem cadastro ignoram respostas extras.

Resposta de questionário inválido: HTTP 400, sem criar candidatura.
Resposta de candidatura criada: HTTP 201 e `application_created: true`.
Somente vagas com questionário recebem `observation_completed` e, se necessário,
`observation_warning`. Falhas HTTP, exceções de rede e ausência dos IDs produzem
pendência explícita. Uma falha de rede pode significar resultado desconhecido; o aviso
usa “não foi possível confirmar” e não afirma que a observação certamente não existe.

Na pendência, o navegador mostra que a candidatura já foi criada, orienta contato com
RH, mantém os campos preenchidos e bloqueia o botão naquele formulário. Não tenta
reenviar automaticamente. Fechar e reabrir inicia um formulário novo: não há garantia
de idempotência entre sessões, e a recuperação das respostas depende do contato com RH.
A tela também trata ausência da confirmação da observação como pendência, caso uma
versão antiga do backend seja usada por engano.

## Resultados das verificações

- **32 testes do Worker aprovados**, com `fetch` substituído por uma API simulada:
  criação, ordem, multipart, IDs, HTML escapado, todas as seleções, validações,
  preservação do perfil/tag, outras vagas, falhas posteriores à criação e bloqueio de
  candidaturas na prévia desabilitada.
- **Testes do Chromium aprovados**: campos obrigatórios, espaços em branco,
  exclusividade do rádio, seleção mínima em cada grupo, envio de múltiplas respostas,
  ausência do questionário em outra vaga e aviso de sucesso parcial.
- **Comparação visual aprovada**: captura do formulário de outra vaga idêntica, byte a
  byte, à captura da base aprovada no mesmo navegador e viewport. Recursos externos
  são bloqueados em ambos; isso compara o ambiente de teste, não todos os navegadores.
- **Responsividade aprovada** em 390 e 1440 px, sem overflow horizontal do modal.
- **Nenhum erro JavaScript** capturado nos cenários de interface.
- **Verificação de sintaxe e `git diff --check` aprovados**.
- **Bundle do Worker aprovado com Wrangler 4.157.0 em `--dry-run`**, sem publicação.

Os testes do navegador bloqueiam acessos externos; o backend é testado apenas com
respostas simuladas. Após os testes simulados, uma candidatura real de teste foi enviada com autorização
explícita. Capturas do painel confirmaram a candidatura, a tag e a observação com as
sete perguntas e respostas. A validação dos dados complementares permanece pendente:
a data de nascimento não aparece na ficha apresentada. A origem dessa pendência
ainda não foi identificada; nenhuma correção especulativa foi aplicada a esses dados.

## Homologação proposta, após revisão

1. Revisar o patch e conferir as sete perguntas e a apresentação do formulário.
2. Preparar um Worker de homologação com os segredos existentes mantidos no backend
   e um front-end de homologação apontando para ele; ambos devem usar o mesmo cadastro.
3. Somente com autorização explícita para criar um registro real: enviar uma
   candidatura identificada como teste na vaga acordada e conferir no painel Recrutei
   a candidatura, o perfil complementar, a tag e a observação com as sete respostas.
4. Confirmar o resultado antes de autorizar qualquer publicação em produção.

O envio real autorizado ocorreu apenas na prévia, para uma candidatura de teste.
O portal oficial continua sem publicação ou merge. A prévia foi bloqueada novamente
após esse envio; não é necessário reenviar a candidatura para conferir o registro.


## Correção da compilação de prévia da Cloudflare

O build `3e479bb5-7b9a-4d81-9858-a42cbd9caac5` falhou ao executar
`npx wrangler preview` na raiz: faltava o bloco `previews` exigido pelo Wrangler 4.157.0.
O repositório tinha configuração somente em `worker/wrangler.toml`.

A configuração adicional `wrangler.toml` na raiz aponta para `worker/src/index.js`,
reproduz os parâmetros de produção existentes e define `[previews.vars]` com
`APPLICATIONS_ENABLED = "false"`, canal 8 e a origem da prévia privada do formulário.
O arquivo dentro de `worker/` foi preservado. Ao alterar futuramente parâmetros de
produção, mantenha os dois arquivos consistentes.

Validação do ajuste: equivalência das variáveis de produção e do caminho resolvido
para o entrypoint; configuração interpretada pelo Wrangler 4.157.0; bundle de
`wrangler deploy --dry-run` executado da raiz; sintaxe e 32 testes aprovados.
As mudanças estão restritas à branch do PR, sem merge ou publicação em produção.
A confirmação do novo build remoto depende do resultado da Cloudflare.

As prévias não herdam os segredos de produção: as credenciais de teste deverão ser
configuradas de forma segura na Base de Prévias, sem envio por chat ou commit.
Mesmo com credenciais configuradas, o envio continua bloqueado por `APPLICATIONS_ENABLED`.
Nenhuma candidatura real será criada sem autorização explícita.
A prévia privada do formulário continua usando simulação até a ligação ao backend
real de homologação ser preparada e revisada.

Referência: https://developers.cloudflare.com/workers/previews/configuration/


## Mensagem para candidaturas desativadas

Uma página que já estava aberta ainda podia tentar enviar após o bloqueio da prévia.
O backend agora responde HTTP 503 com `code: APPLICATIONS_DISABLED`,
`applications_enabled: false` e `application_created: false`, antes de qualquer
chamada à Recrutei. O front-end exibe a informação de bloqueio, preserva os campos
preenchidos e desabilita os botões de candidatura, sem sugerir uma nova tentativa.
O caso de prévia desativada integra os 32 testes do Worker aprovados; a sintaxe dos
scripts também foi verificada. Este ajuste não corrige nem diagnostica por si só
os campos complementares que não apareceram na ficha.
