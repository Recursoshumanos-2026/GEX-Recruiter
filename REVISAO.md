# GEX Talents — revisão do questionário da vaga 158928

Data: 4 de novembro de 2026. Branch: `feat/questionario-158928`.
Base visual: `253641126defebd7761443fb913fb2550a32262b`.
Status: draft para revisão, sem merge ou publicação em produção. A homologação
completa permanece pendente por causa dos dados complementares.

## Resultado confirmado

Os testes reais autorizados na prévia confirmaram candidatura, tag automática
`GEX Talents` e observação com as sete perguntas e respostas. As respostas ficam
nas observações, conforme alternativa indicada pelo suporte, sem preencher os
campos nativos de perguntas personalizadas.

O perfil complementar não foi confirmado. O GET do cadastro existente retornou
HTTP 200; o PUT de atualização retornou HTTP 404, sem campos de validação
reconhecidos (`profile_error.fields: []`). A leitura posterior indicou
`birthday_verified: false` e `salary_verified: null`: nascimento não confirmado
e remuneração sem confirmação pelos caminhos de leitura disponíveis.

O 404 foi capturado na tentativa com o ID da prospecção na query. No fluxo
anterior, com ID do talento, o Console mostrava “Não foi possível encontrar essa
informação!”, sem status HTTP preservado. A troca de ID não resolveu a pendência.
Isso não identifica a causa nem comprova problema no CPF, na data ou na API. É necessário confirmar o contrato com o suporte;
[SUPORTE-RECRUTEI.md](SUPORTE-RECRUTEI.md) contém uma mensagem pronta.

## Mudanças para revisão

| Arquivos | Comportamento |
| --- | --- |
| `questionnaires.js` | Cadastro por ID de vaga e validação compartilhada das sete perguntas obrigatórias. |
| `app.js`, `index.html`, `application.css` | Perguntas exclusivas da vaga 158928 e aviso de observação pendente, usando os controles existentes. |
| `worker/src/index.js` | Validação antes da criação, observação multipart com HTML escapado, isolamento de falhas posteriores e diagnóstico limitado. |
| `wrangler.toml` | Configuração de prévia na raiz apontando ao Worker existente, com candidaturas habilitadas nesta homologação. |
| `tests/`, `package.json`, `package-lock.json` | Verificações simuladas e de interface. |

O site não foi recriado. Identidade visual, estrutura das páginas, logos e estilos
gerais aprovados foram preservados. As demais vagas não recebem este questionário
ou sua observação. O helper compartilhado de perfil voltou ao contrato original:
ID do talento no query `talent_id` e no corpo, junto ao ID da candidatura. A retirada
da hipótese preserva o comportamento das outras vagas; não é uma correção do 404.

## Formulário e integração

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

- **75 testes do Worker aprovados** após restaurar o contrato original. Incluem
  preservação do query com ID do talento, outra vaga, retorno 404 sem dados pessoais,
  validações, multipart, HTML escapado e tratamento de falhas posteriores à criação.
- **7 testes Node VM do observador aprovados**, incluindo visibilidade inicial,
  privacidade, restauração e ausência de repetição.
- **5 testes Node VM da conferência aprovados**, incluindo envio de somente dois
  campos, validação, falhas e separação entre aceite e persistência dos dados.
- **`npm run check` e `git diff --check` aprovados** após o ajuste do helper.
- As verificações anteriores em Chromium aprovaram validações, exclusividade por
  vaga, seleções múltiplas, aviso de sucesso parcial e modal em 390 e 1440 px.
  O formulário de outra vaga coincidiu com a base visual aprovada no mesmo
  navegador e viewport. Esse conjunto não foi repetido para a restauração do helper.

Os testes locais usam respostas simuladas e não comprovam o contrato externo.
Nenhuma nova candidatura real foi criada nesta etapa de restauração e documentação.
Os resultados reais conhecidos estão separados acima.

## Próximo passo

Solicitar ao suporte um cURL mínimo válido e confirmar IDs da query/corpo, grupos,
formato da data e campo de remuneração. Não é necessária outra candidatura para
analisar o cadastro existente. O draft permanece sem produção até resolver essa
pendência; este relatório não autoriza deploy de produção.

Referências: [observações em candidato](https://developers.recrutei.com.br/docs/criando-observa%C3%A7%C3%B5es-em-um-candidato),
[edição de prospecção](https://developers.recrutei.com.br/docs/editando-uma-prospec%C3%A7%C3%A3o-de-candidato),
[visualização de candidatos](https://developers.recrutei.com.br/docs/visualizando-candidatos) e
[prévias Cloudflare](https://developers.cloudflare.com/workers/previews/configuration/).
