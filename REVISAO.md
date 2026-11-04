# GEX Talents — revisão dos questionários por vaga

Atualização: 4 de novembro de 2026 (America/Sao_Paulo). Branch: `feat/questionario-158928`.
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
| `questionnaires.js` | Cadastro por ID de vaga: sete perguntas de Atendimento, oito de Dados Sênior, sete de Afiliação e dez de Editor de Vídeo, com validação compartilhada. |
| `app.js`, `index.html`, `application.css` | Questionário próprio de cada vaga cadastrada e aviso de observação pendente; versão dos recursos atualizada para evitar cache antigo. |
| `worker/src/index.js` | Validação antes da criação, observação multipart com HTML escapado, isolamento de falhas posteriores e diagnóstico limitado. |
| `wrangler.toml` | Configuração de prévia na raiz apontando ao Worker existente, com candidaturas habilitadas nesta homologação. |
| `tests/`, `package.json`, `package-lock.json` | Verificações simuladas e de interface. |

O site não foi recriado. Identidade visual, estrutura das páginas, logos e estilos
gerais aprovados foram preservados. As vagas sem cadastro não recebem questionário
ou observação. Os questionários anteriores mantêm integralmente suas perguntas, tipos e alternativas. O helper compartilhado de perfil voltou ao contrato original:
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
real desta vaga durante a implementação. A vaga 158921 (Afiliação) possui o questionário descrito abaixo.

### Analista de CS - Afiliação — 158921

As sete perguntas dos dois prints foram transcritas, todas obrigatórias:

1. Aceita vaga PJ? — resposta curta.
2. Qual é a sua pretensão de remuneração mensal no modelo PJ? — resposta curta.
3. Qual sua idade? — resposta curta.
4. Você possui experiência profissional com Customer Success, atendimento ao cliente, suporte ou relacionamento com parceiros? — escolha única: Sim, tenho experiência em Customer Success; Sim, tenho experiência em atendimento/suporte; Sim, tenho experiência com relacionamento com parceiros; Tenho experiência em mais de uma dessas áreas; Não possuo experiência.
5. Você possui experiência utilizando o ClickUp? — escolha única: Sim, utilizo ou já utilizei no dia a dia; Já utilizei, mas de forma básica; Conheço a ferramenta, mas nunca utilizei profissionalmente; Nunca utilizei.
6. Você já trabalhou com alguma ferramenta de CRM? — escolha única: Sim; Não.
7. Em uma rotina com várias solicitações chegando ao mesmo tempo, como você organiza e prioriza os atendimentos? — resposta longa.

A pergunta 7 usa textarea obrigatório de seis linhas, com limite de 5000 caracteres
no navegador e no Worker. O textarea ocupa a largura da grade e reutiliza os tokens
dos controles existentes. Somente essa pergunta recebe o novo controle; os campos
das outras vagas são preservados. O HTML escapa a resposta antes de converter suas
quebras de linha para `<br>`. Não há eliminação automática nem escrita em campos
nativos de perguntas personalizadas. Não foram criadas candidaturas reais nesta etapa.

### Editor de Vídeo — 158786

As dez perguntas dos três prints foram transcritas nesta ordem:

1. Você aceita atuar como PJ - Prestador de serviços? — múltipla escolha: Sim; Não.
2. Você possui estrutura ( computador/notebook e internet) para trabalhar remoto / home office? — múltipla escolha: Sim; Não.
3. Qual sua idade? — resposta curta.
4. Você tem experiência com ferramentas de lipsync? — múltipla escolha: Sim; Não.
5. Você tem experiência ou já teve algum contato com edição de VSL's e criativos de resposta direta? — escolha única: Sim; Não.
6. Você tem experiência com ferramentas de IA? Ex: Heygen, ElevenLabs, SyncLabs — escolha única: Sim; Não.
7. Você tem experiencia com edição de anúncios para venda online? (e-commerce, infoprodutos, etc.) — escolha única: Sim; Não.
8. Já trabalhou com alguma empresa digital anteriormente? — escolha única: Sim; Não.
9. Coloque aqui o seu Instagram, LinkedIn, Portifólio, etc. — resposta curta **opcional**.
10. Qual sua pretensão salarial para um contrato PJ? — resposta curta.

Somente a pergunta 9 está com obrigatoriedade desligada no print. O cadastro usa
`required: false` nela; os demais itens continuam obrigatórios por padrão. O navegador
identifica o campo como opcional e o Worker permite ausência, nulo ou texto vazio.
Um valor preenchido ainda deve ser texto com até 500 caracteres. A observação registra
“Não informado” quando vazio, sem omitir a pergunta ou mudar a numeração.

As perguntas 1, 2 e 4 mantêm checkboxes, inclusive todas as alternativas selecionadas.
O print marca “Não” da pergunta PJ como eliminatória na Recrutei. Essa marca nativa
não é reproduzida pelo fluxo de observações: a integração registra a escolha para
análise do RH, sem reprovação automática. Não foram criadas candidaturas reais.

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

- **153 testes do Worker aprovados**, incluindo 27 novos casos para Editor de Vídeo e portfólio opcional. Incluem
  preservação do query com ID do talento, outra vaga, retorno 404 sem dados pessoais,
  validações, multipart, HTML escapado e tratamento de falhas posteriores à criação.
  Os novos casos conferem as oito obrigatórias antes de chamadas externas, ordem e
  título da observação, múltiplas seleções e isolamento entre as vagas. Afiliação
  acrescenta limite de 5000, espaços em branco, tipos inválidos, HTML escapado com
  quebras de linha, sete obrigatórias e pendência de observação sem duplicação.
- **9 testes dos controles aprovados em Node VM**, usando as funções reais do app:
  textarea obrigatório, ausência nas outras vagas, espaços inválidos, normalização
  de respostas longas e limite consistente com o Worker. Os casos do Editor conferem
  seis checkboxes, oito rádios, portfólio opcional e manutenção da obrigatoriedade
  dos questionários anteriores. Total do repositório: 162 testes.
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
  as novas telas ainda requerem conferência visual na prévia.

Os testes locais usam respostas simuladas e não comprovam o contrato externo.
Nenhuma nova candidatura real foi criada nesta etapa de implementação e testes.
Os resultados reais conhecidos estão separados acima.

## Próximo passo

Revisar visualmente os questionários 158883, 158921 e 158786 na prévia, sem enviar uma candidatura.
A Cloudflare confirmou build/deploy da versão de código `d053d83` (Editor de Vídeo),
que também inclui Afiliação. A confirmação veio pelo check do GitHub e pelo print
da aba Implantações com status “Pronto”. Essa confirmação valida a publicação da
prévia, não substitui um teste real de candidatura dessas novas vagas.
Para a pendência do perfil, solicitar ao suporte um cURL mínimo válido e confirmar IDs da query/corpo, grupos,
formato da data e campo de remuneração. Não é necessária outra candidatura para
analisar o cadastro existente. O draft permanece sem produção até resolver essa
pendência; este relatório não autoriza deploy de produção.

Referências: [observações em candidato](https://developers.recrutei.com.br/docs/criando-observa%C3%A7%C3%B5es-em-um-candidato),
[edição de prospecção](https://developers.recrutei.com.br/docs/editando-uma-prospec%C3%A7%C3%A3o-de-candidato),
[visualização de candidatos](https://developers.recrutei.com.br/docs/visualizando-candidatos) e
[prévias Cloudflare](https://developers.cloudflare.com/workers/previews/configuration/).
