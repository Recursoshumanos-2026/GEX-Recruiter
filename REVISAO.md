# GEX Talents — revisão dos questionários por vaga

Atualização: 3 de novembro de 2026 (America/Sao_Paulo). Branch: `feat/questionario-158928`.
Base visual: `253641126defebd7761443fb913fb2550a32262b`.
Status: draft para revisão, sem merge ou publicação em produção. A homologação
completa permanece pendente por causa dos dados complementares.

## Resultado confirmado

Na vaga 158928, os testes reais autorizados na prévia confirmaram candidatura, tag automática
`GEX Talents` e observação com as sete perguntas e respostas. As respostas ficam
nas observações, conforme alternativa indicada pelo suporte, sem preencher os
campos nativos de perguntas personalizadas.

O perfil complementar não foi confirmado. O GET do cadastro existente retornou
HTTP 200; o PUT de atualização retornou HTTP 404, sem campos de validação
reconhecidos (`profile_error.fields: []`). A leitura posterior indicou
`birthday_verified: false` e `salary_verified: null`: nascimento não confirmado
e remuneração sem confirmação pelos caminhos de leitura disponíveis.

O 404 foi capturado com o ID da prospecção na query e, em um envio posterior
mostrado pelo usuário, também no fluxo restaurado com ID do talento. A mensagem
foi “Não foi possível encontrar essa informação!”. A troca de ID não resolveu a pendência.
Isso não identifica a causa nem comprova problema no CPF, na data ou na API. É necessário confirmar o contrato com o suporte;
[SUPORTE-RECRUTEI.md](SUPORTE-RECRUTEI.md) contém uma mensagem pronta.

## Mudanças para revisão

| Arquivos | Comportamento |
| --- | --- |
| `questionnaires.js` | Cadastro por ID de vaga: sete perguntas de Atendimento e oito de Dados Sênior, com validação compartilhada. |
| `app.js`, `index.html`, `application.css` | Questionário próprio de cada vaga cadastrada e aviso de observação pendente; versão dos recursos atualizada para evitar cache antigo. |
| `worker/src/index.js` | Validação antes da criação, observação multipart com HTML escapado, isolamento de falhas posteriores e diagnóstico limitado. |
| `wrangler.toml` | Configuração de prévia na raiz apontando ao Worker existente, com candidaturas habilitadas nesta homologação. |
| `tests/`, `package.json`, `package-lock.json` | Verificações simuladas e de interface. |

O site não foi recriado. Identidade visual, estrutura das páginas, logos e estilos
gerais aprovados foram preservados. As vagas sem cadastro não recebem questionário
ou observação. O formulário de Atendimento mantém suas sete perguntas. O helper compartilhado de perfil voltou ao contrato original:
ID do talento no query `talent_id` e no corpo, junto ao ID da candidatura. A retirada
da hipótese preserva o comportamento das outras vagas; não é uma correção do 404.

## Formulários e integração

### Analista de Atendimento — 158928

1. Aceite de oportunidade PJ — resposta curta.
2. Pretensão salarial para a vaga PJ — resposta curta.
3. Idade — resposta curta.
4. Experiência com atendimento ao cliente — escolha única.
5. Experiência com retenção — uma ou mais alternativas.
6. Experiência com metas ou indicadores — uma ou mais alternativas.
7. Canais de atendimento utilizados — uma ou mais alternativas.

Todos os itens são obrigatórios; textos e alternativas seguem a solicitação.
As perguntas 5, 6 e 7 usam checkboxes. O Worker rejeita respostas inválidas antes
de criar a candidatura. Respostas curtas aceitam até 500 caracteres após trim.

### Analista de Dados Sênior — 158883

As oito perguntas dos prints foram transcritas, todas obrigatórias, nesta ordem:

1. Qual sua idade? — resposta curta.
2. LinkedIn (Cole o link do seu perfil) — resposta curta.
3. Compartilhe uma rede social sua (Instagram, TikTok ou outra que utilize). — resposta curta.
4. Atualmente você está trabalhando? — escolha única: Sim, CLT; Sim, PJ; Sim, como freelancer/autônomo; Não estou trabalhando atualmente.
5. Qual é a sua disponibilidade para início? — escolha única: Imediata; Em até 7 dias; Em até 15 dias; Em até 30 dias; Acima de 30 dias.
6. Você possui estrutura adequada para trabalho remoto? Computador, internet estável e ambiente adequado para realização das atividades. — escolha única: Sim; Não.
7. Você possui CNPJ ou disponibilidade para atuar no modelo PJ? — múltipla escolha: Sim, já possuo CNPJ; Ainda não possuo, mas tenho disponibilidade para abrir; Não tenho interesse no modelo PJ.
8. Qual é a sua pretensão de remuneração mensal no modelo PJ? — resposta curta.

A pergunta 7 usa checkboxes conforme o print, sem eliminação automática. As respostas
curtas mantêm a validação de texto existente; não são convertidas para os campos
nativos do perfil. A observação identifica **Analista de Dados Sênior** e inclui as
oito respostas, com HTML escapado e todas as seleções. Não foi criada candidatura
real desta vaga durante a implementação. A vaga 158921 (Afiliação) permanece sem
alteração, aguardando o conteúdo de seu questionário.

### Registro das respostas

Após criar a candidatura, o Worker envia `POST /api/v2/talents-observations` em
multipart, com `application_id`, `talent_id`, `talent_observation_type_id=7`,
`action=1` e HTML escapado em `description`. A descrição contém **GEX Talents |
Respostas da candidatura**, vaga e perguntas/respostas em ordem; seleções múltiplas
ficam em lista. Tokens e credenciais permanecem exclusivamente no backend.

A tag e a tentativa de preenchimento complementar permanecem no fluxo. Falhas
nessas etapas não impedem tentar registrar a observação. Se a candidatura foi
criada, mas a observação não foi confirmada, o retorno mantém HTTP 201 e
`application_created: true`, com pendência explícita. O formulário orienta contato
com RH, preserva as respostas e impede repetir aquele envio. Não há repetição
automática nem garantia de idempotência entre novas sessões.

## Prévia de homologação

A prévia permanece com `APPLICATIONS_ENABLED = "true"`, conforme instrução expressa
do usuário. Não foi acrescentado bloqueio aos envios. A configuração de produção
não habilita as rotas temporárias de diagnóstico e conferência abaixo.

- `/integracao-atual/`: formulário privado com relatório versão 2 visível desde o
  carregamento. O observador não altera nem repete requisições. A sessão guarda
  somente metadados, sem valores de entrada, headers, resposta bruta ou mensagens.
- `GET /api/diagnostico-perfil`: lê somente o registro de teste fixado no backend.
- `/reparo-perfil/` e `POST /api/teste-perfil`: recebem somente nascimento e
  pretensão salarial, atualizam o mesmo registro e consultam o resultado. Não
  criam candidaturas nem alteram tags ou observações. Exigem configuração explícita
  da prévia, origem autorizada e conferência do cadastro de teste.

## Verificações e limites

- **104 testes do Worker aprovados**, incluindo 29 novos casos para Dados Sênior. Incluem
  preservação do query com ID do talento, outra vaga, retorno 404 sem dados pessoais,
  validações, multipart, HTML escapado e tratamento de falhas posteriores à criação.
  Os novos casos conferem as oito obrigatórias antes de chamadas externas, ordem e
  título da observação, múltiplas seleções e isolamento entre as vagas.
- **7 testes Node VM do observador aprovados**, incluindo visibilidade inicial,
  privacidade, restauração e ausência de repetição.
- **5 testes Node VM da conferência aprovados**, incluindo envio de somente dois
  campos, validação, falhas e separação entre aceite e persistência dos dados.
- **`npm run check` e `git diff --check` aprovados** após a inclusão do novo questionário.
- As verificações anteriores em Chromium aprovaram validações, exclusividade por
  vaga, seleções múltiplas, aviso de sucesso parcial e modal em 390 e 1440 px.
  O formulário de outra vaga coincidiu com a base visual aprovada no mesmo
  navegador e viewport. Esse conjunto não foi repetido para o novo questionário.
  A infraestrutura de browser exigida pelo ambiente Sites não está disponível;
  a nova tela ainda requer conferência visual na prévia.

Os testes locais usam respostas simuladas e não comprovam o contrato externo.
Nenhuma nova candidatura real foi criada nesta etapa de implementação e testes.
Os resultados reais conhecidos estão separados acima.

## Próximo passo

Revisar visualmente o questionário 158883 na prévia, sem enviar uma candidatura.
Para a pendência do perfil, solicitar ao suporte um cURL mínimo válido e confirmar IDs da query/corpo, grupos,
formato da data e campo de remuneração. Não é necessária outra candidatura para
analisar o cadastro existente. O draft permanece sem produção até resolver essa
pendência; este relatório não autoriza deploy de produção.

Referências: [observações em candidato](https://developers.recrutei.com.br/docs/criando-observa%C3%A7%C3%B5es-em-um-candidato),
[edição de prospecção](https://developers.recrutei.com.br/docs/editando-uma-prospec%C3%A7%C3%A3o-de-candidato),
[visualização de candidatos](https://developers.recrutei.com.br/docs/visualizando-candidatos) e
[prévias Cloudflare](https://developers.cloudflare.com/workers/previews/configuration/).
