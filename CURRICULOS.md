# Currículos GEX Talents — Cloudflare D1 Free (revisão, sem publicação)

## Decisão de custo

A GEX optou por **não ativar a assinatura R2 com cobrança por uso**. O fluxo passa a usar **Cloudflare D1 no plano Workers Free** para armazenar apenas o Markdown convertido, sem PDF/DOCX original.

- D1 Free: até **5 GB de armazenamento por conta**, no máximo **500 MB por banco**, 5 milhões de linhas lidas/dia e 100 mil gravadas/dia. Ao esgotar limites gratuitos, o serviço bloqueia operações em vez de cobrar excedentes. Ver [D1 pricing](https://developers.cloudflare.com/d1/platform/pricing/) e [D1 limits](https://developers.cloudflare.com/d1/platform/limits/).
- Workers Free: até 100 mil requisições/dia, 10 ms de CPU por request. A execução e o processamento de arquivos exigem homologação real no ambiente Free. Ver [Workers limits](https://developers.cloudflare.com/workers/platform/limits/).
- Workers AI: o método `toMarkdown` é gratuito para a maioria dos formatos, mas documentos que demandam modelos de IA podem consumir a cota de 10 mil neurons gratuitos por dia. No plano Free, ao exceder a cota o processamento falha, sem cobrança automática; não migrar para Workers Paid sem nova autorização. Ver [Markdown conversion](https://developers.cloudflare.com/workers-ai/features/markdown-conversion/) e [AI pricing](https://developers.cloudflare.com/workers-ai/platform/pricing/).
- A Recrutei pode ter custos de assinatura já contratados. Isso não está incluído na gratuidade da Cloudflare.
- **Não fazer upgrade nem cadastrar forma de pagamento para ativar R2 neste fluxo.**

## Etapas de processamento

1. Candidata ou candidato envia um currículo PDF ou DOCX de até 5 MB.
2. O Worker confirma se o banco D1 existe e verifica o tipo e assinatura do arquivo, antes de criar a candidatura.
3. Workers AI `toMarkdown` converte o conteúdo. Se falhar ou não extrair texto suficiente, o fluxo interrompe a candidatura (422).
4. Recrutei cria a candidatura e preserva questionário e tag GEX Talents.
5. O Markdown é armazenado em tabela D1 **privada** `candidate_resumes`, com UUID, IDs de vaga/candidatura e data de criação. O arquivo original não é guardado. Não há rota pública de download de currículos.
6. Worker tenta persistir o Markdown (resumo até 12 mil caracteres) em `informations` via `PUT /api/v2/curriculum/filled`.
7. Se a Recrutei recusar a atualização, o Markdown escapado (até 24 mil caracteres) é registrado como observação. O conteúdo integral permanece na D1.
8. A resposta diferencia candidatura criada, currículo armazenado e registrado; falhas posteriores nunca criam uma segunda candidatura.

**Atenção:** a API da Recrutei já retornou HTTP 404 na atualização do perfil. O campo personalizado **ainda não foi homologado** em conta real. O fallback por observação também precisa ser validado especificamente para currículos. Não prometer que o candidato terá um currículo nativo anexado à Recrutei.

## Próximo passo na Cloudflare (manual e gratuito)

1. Ignorar a tela de assinatura R2 e escolher **Banco de dados SQLite D1** no menu lateral da Cloudflare.
2. Criar banco D1 com o nome `gex-talents-curriculos-teste` (prévia com dados fictícios). No plano Workers Free, a criação do D1 não exige contratação de R2.
3. No banco, acessar **Console** e executar o SQL do arquivo `worker/schema.sql` para criar a tabela `candidate_resumes` e o índice.
4. Copiar o ID do banco (UUID). No `wrangler.toml` do Worker, descomentar/adicionar o binding com o ID real:
   ```toml
   [[d1_databases]]
   binding = "RESUME_DB"
   database_name = "gex-talents-curriculos-teste"
   database_id = "ID_REAL_DA_CLOUDFLARE"
   ```
   O código já usa `RESUME_DB`. Não enviar IDs de credenciais, senhas ou tokens.
5. O binding AI está preparado:
   ```toml
   [ai]
   binding = "AI"
   ```
6. Manter `RESUME_UPLOAD_ENABLED = "false"` em produção e habilitar somente em ambiente de prévia após as etapas anteriores. No `/health`, confirmar `resume_upload_enabled: true` com o banco devidamente migrado. O código também faz preflight da tabela antes de criar o candidato.
7. Fazer testes exclusivamente com PDF/DOCX e candidaturas fictícias, sem colocar currículos reais no banco de testes. Conferir o Markdown na D1 e na Recrutei e testar limite de quotas.
8. Definir política de retenção e exclusão sob a LGPD antes de produção; acesso ao banco e ao Worker deve ser restrito aos responsáveis autorizados. Configurar limitação de envios/rate limiting, proteção contra abuso e validação de arquivos; isso não é antivírus.
9. Só após validação e autorização, criar banco separado para produção, migrar schema, configurar binding de produção e liberar upload. **Manter conta/plano Workers Free.**

## Schema

`worker/schema.sql` cria a tabela privada `candidate_resumes`:

- `id`: UUID opaco.
- `vacancy_id`: ID de vaga na Recrutei.
- `application_id`: ID da candidatura.
- `markdown`: currículo convertido.
- `created_at`: timestamp.

SQL usa parâmetros vinculados; sem dados pessoais em URLs públicas. Tamanho máximo do Markdown limitado a 120 mil caracteres (bem abaixo do limite de 2 MB por valor no D1).

## Proteção e limites

- Upload obrigatório só quando `RESUME_UPLOAD_ENABLED=true` **e** bindings `AI` e `RESUME_DB` presentes.
- `GET /health` não retorna currículos.
- Se a tabela ainda não existir, upload falha antes de criar candidatura.
- Arquivos inválidos / muito grandes / sem texto geram erro antes da criação na Recrutei.
- Após criação de candidatura, uma falha de banco ou Recrutei gera aviso, mas o sistema não repete automaticamente a candidatura.
- PDF/DOCX **não são preservados**. Se RH precisar do anexo original, isso demanda outro desenho.
- Requisitos LGPD: retenção, exclusão, acesso mínimo, base legal e aviso de privacidade revisado.

## Testes de revisão

```bash
npm run check
npm test
GEX_RESUME_PREVIEW=true node tests/vacancy-browser.mjs
```

Testes de código incluem mock de D1 Free, schema preflight, SQL parametrizado, conversão/erros, Recrutei 404 e fallback de observações; testes de interface usam arquivo fictício.

**Status: implementação apenas na branch de revisão, sem D1 real provisionada e sem upload ativado no site oficial.**


## Retenção e exclusão automática — código preparado, não ativado

**Escopo confirmado:** somente o Markdown do D1 será apagado após o prazo; o conteúdo já recebido na Recrutei deve ser preservado pela rotina. Ninguém do RH precisa autorizar cada exclusão depois que o agendamento estiver ativado e validado.

A rotina `worker/src/retention.js` considera **12 meses desde a data do armazenamento no D1** como prazo técnico inicial, sujeito à política de retenção aprovada pela GEX. Isso não é a mesma coisa que "12 meses após o encerramento da vaga": para usar a data de encerramento, precisamos integrar estados da Recrutei e revisar a regra antes de ativar.

O Worker já possui um handler `scheduled()` protegido. Quando autorizado e implantado com um Cron Trigger diário `0 6 * * *` (06h UTC), verifica o banco `RESUME_DB` e:
- Sem `RESUME_RETENTION_ENABLED="true"`: não consulta nem exclui dados.
- Com `RESUME_RETENTION_ENABLED="true"`, mas sem `RESUME_RETENTION_DRY_RUN="false"`: **simula**, retornando apenas a contagem de currículos elegíveis, sem excluir.
- Somente com ambas as flags explicitamente aprovadas, remove até 500 registros vencidos por execução, em lotes de 100, sem imprimir currículos, IDs ou e-mails nos logs.

Configuração já preparada na branch de revisão:
- **Produção, após futura implantação:** `RESUME_RETENTION_ENABLED="true"`, `RESUME_RETENTION_DRY_RUN="false"`, `RESUME_RETENTION_MONTHS="12"`. O Cron está previsto para uma execução diária, sem intervenção de colaboradores. Se ainda não houver `RESUME_DB` conectado em produção, ele simplesmente não excluirá nenhum registro.
- **Prévia:** `RESUME_RETENTION_ENABLED="true"`, `RESUME_RETENTION_DRY_RUN="true"` e prazo de 12 meses; só contabiliza registros que venceriam, sem excluir.
- **Estado atual do site oficial:** nenhum desses commits foi mesclado ou implantado na produção, portanto a limpeza real não está em execução na Cloudflare. A ativação efetiva depende de implantação e ligação de um banco D1 de produção que possua o esquema do `worker/schema.sql`.

O escopo já foi confirmado pelo RH: após a ativação, a Cloudflare exclui somente sua cópia de Markdown, preservando toda informação na Recrutei. É necessária revisão final de privacidade antes de receber currículos reais; titular pode solicitar eliminação antecipada nos sistemas conforme direitos legais.

**Regra expressamente escolhida pelo RH:** a exclusão automática de 12 meses é **exclusiva do banco Cloudflare D1**. O sistema **não solicita exclusão nem modifica dados na Recrutei**: candidato, candidatura, observações e informações já registradas na Recrutei permanecem lá, conforme as regras próprias da plataforma e a política de retenção da GEX. Essa retenção separada precisa constar no aviso de privacidade. Em caso de pedido de exclusão de dados do titular ou obrigação legal, a GEX deverá tratar também a Recrutei conforme aplicável; a automação do D1 não substitui esse procedimento.

Para evitar exclusão de um currículo em um processo seletivo ainda ativo, validar antes a regra temporal e um mecanismo que proteja candidaturas com retenção legítima. Pedidos de exclusão por titulares e obrigações legais podem exigir tratamento diferente.


## Verificação ponta a ponta sem candidatos reais

O GitHub Actions inclui `tests/live-preview-integration.mjs`, um teste que acessa **somente a API de prévia**. Ele consulta `/health?check=resume` e, depois, `/health?check=conversion`. O segundo teste usa um PDF PDF simples gerado inteiramente pelo sistema, com texto fictício, passa pelo conversor Workers AI e insere/relê uma única linha fictícia no D1 de testes (IDs 2147483647). Requisições posteriores reutilizam essa linha, sem consumir novamente processamento da IA. O teste não aciona a Recrutei e não usa dados pessoais.

Esse processo é exclusivo do ambiente de prévia, pois depende de `RESUME_DIAGNOSTIC_ENABLED="true"`, variável que não está prevista em produção. O upload para candidatos permanece desativado até concluir teste real da integração Recrutei e revisão de segurança. Nunca usar essa rota para candidatos reais.


## Homologação Recrutei e currículos fictícios — 04/11/2026

O teste foi executado **somente no Worker de prévia**, com os quatro segredos cadastrados
pelo RH em Base de Prévias. Não houve publicação de credenciais nem uso de candidatos reais.

- Consulta do cadastro fictício da Recrutei: **HTTP 200**, IDs de vaga e candidatura
  confirmados; nenhum candidato adicional foi criado.
- Requisição `PUT /api/v2/curriculum/filled` (campo personalizado): **HTTP 404** para
  esse cadastro fictício, apesar de ser o endpoint descrito na documentação oficial.
  Portanto, não presumir que o campo personalizado esteja funcional.
- `POST /api/v2/talents-observations`: **aceito pela Recrutei** com o Markdown de teste
  vinculado à candidatura existente. O conteúdo pode ser consultado pelo RH em
  observações, mas **não corresponde a um anexo PDF/DOCX original**.

| Etapa de homologação | PDF fictício | DOCX fictício |
| --- | --- | --- |
| Arquivo reconhecido e convertido em Markdown | PASS | PASS |
| Gravação e leitura de conferência no D1 privado | PASS | PASS (ID fictício isolado) |
| Observação associada à candidatura fictícia Recrutei | PASS | PASS |
| Candidaturas novas criadas | 0 | 0 |

O D1 tem unicidade em `(vacancy_id, application_id)`, como esperado para **um
currículo por candidatura**. Por isso, o segundo arquivo não podia ser gravado
usando novamente os IDs do teste PDF; a gravação DOCX foi validada isoladamente
com outro identificador **somente no banco de testes**, sem alterar dados reais.

Após a homologação, as rotas temporárias de escrita foram **removidas da branch
de prévia**, com o CI aprovado. As flags `APPLICATIONS_ENABLED=false` e
`RESUME_UPLOAD_ENABLED=false` continuam na Base de Prévias; em produção,
`RESUME_UPLOAD_ENABLED=false` também continua em vigor. O layout da página de
vagas não foi alterado.

### Pendente antes da liberação pública

1. Confirmar com o RH se basta o **conteúdo textual convertido** na observação
   da Recrutei, já que o arquivo original não é salvo como anexo.
2. Consultar o suporte da Recrutei sobre o HTTP 404 em
   `PUT /api/v2/curriculum/filled`; a observação é o fallback homologado.
3. Validar uma candidatura fictícia completa em prévia restrita com formulário,
   consentimento e arquivo, sem abrir a criação pública de candidaturas.
4. Validar a política de retenção, limitação de acesso e tratamento de falhas
   antes de habilitar `RESUME_UPLOAD_ENABLED` na produção.
