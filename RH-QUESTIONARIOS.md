# GEX Talents | Administração de Questionários do RH

Este painel permite que pessoas autorizadas do RH administrem **perguntas das vagas**, sem editar GitHub ou o código do site.

## O que ele faz

- Mostra apenas as vagas que continuam aceitando inscrições na Recrutei.
- Destaca vagas sem questionário, configuradas pelo RH, com perguntas anteriores e desativadas.
- Adiciona, edita, desativa e reorganiza perguntas; os tipos são texto curto, texto longo, escolha única e múltipla escolha.
- Define perguntas obrigatórias/opcionais, alternativas, modelos reaproveitáveis e cópia de outra vaga.
- Salva o conteúdo no banco D1 privado já configurado. A versão de edição evita sobrescrever uma mudança feita por outro usuário ao mesmo tempo.
- Atualiza automaticamente o formulário público na próxima carga da listagem de vagas. O Worker valida as mesmas perguntas antes de criar a candidatura.
- Preserva as cinco configurações legadas enquanto não forem alteradas no painel. A desativação é uma sobreposição recuperável; não remove os dados de currículos nem apaga observações anteriores.
- Envia as respostas para **Observações** da candidatura na Recrutei. Não modifica as perguntas nativas na Recrutei nem reprova candidaturas automaticamente.

## Segurança: passo obrigatório para ativar o RH

O endereço privado será `https://gex-talents-api.rh-75e.workers.dev/rh/perguntas`. **Sem a configuração de autenticação abaixo, ele retorna 403** e ninguém pode criar ou editar perguntas. A área pública de candidaturas permanece funcionando.

1. Na conta Cloudflare da GEX, abra **Zero Trust → Access → Applications → Add an application → Self-hosted**.
2. Proteja **somente o caminho do RH** no domínio do Worker, cobrindo `/rh/*` (e, se necessário, `/rh`): `gex-talents-api.rh-75e.workers.dev`. **Não proteja o Worker inteiro**: `/api/vagas`, `/api/candidatar` e `/health` devem continuar públicos para os candidatos.
3. Na política Access, autorize **apenas as contas individuais do RH aprovadas pela GEX**, por e-mail. Evite acesso genérico a todo o domínio da empresa.
4. Copie a **Application Audience (AUD) Tag** da aplicação criada. Não é uma senha, mas deve coincidir com o valor configurado na API.
5. Em **Workers & Pages → gex-talents-api → Settings → Variables**, configure na produção, sem expor dados no GitHub:
   - `QUESTIONNAIRE_ADMIN_ENABLED` = `true`
   - `QUESTIONNAIRE_ACCESS_AUD` = a Audience (AUD) Tag da aplicação Access para `/rh/*`
   - `QUESTIONNAIRE_RH_EMAILS` = lista de e-mails individuais autorizados, separados por vírgula.
6. Abra o link `/rh/perguntas` e entre com a conta RH autorizada. O painel verificará **duas condições**: login Access com o AUD correto e e-mail presente na lista permitida.
7. Escolha uma vaga de teste publicada, configure um questionário e salve. Acesse a mesma vaga no site público em outra janela atualizada e confira perguntas e ordem. Use somente candidatos fictícios e ambiente de teste para validar o envio à Recrutei.

**Não é necessário compartilhar com o ChatGPT senhas, tokens, cookies ou chaves da Recrutei/Cloudflare.** A configuração de Access é feita diretamente na conta da GEX.

## Banco e comportamento das alterações

O primeiro acesso autenticado cria duas tabelas adicionais e isoladas no banco D1 existente (usando `CREATE TABLE IF NOT EXISTS`):

- `gex_questionnaires`: configuração da vaga, versão, data, autor e indicador de desativação.
- `gex_questionnaire_templates`: modelos de perguntas e dados básicos de atualização.

Não há migração destrutiva; nenhuma tabela `candidate_resumes` é alterada. O texto das perguntas não contém respostas de candidatos. A leitura pública expõe **somente** as perguntas das vagas publicadas, não identidades de quem editou nem configurações internas do RH.

Ao editar, o painel solicita a mesma versão carregada; alterações concorrentes recebem **HTTP 409** e exigem atualizar antes de salvar. Ao desativar, é gravado um marcador para que o questionário antigo não reapareça. Para reativar, salve um novo conjunto de perguntas. Os candidatos que já tenham aberto o formulário devem atualizar a página caso o RH edite as perguntas durante a sessão.

## Estado de publicação

- Código e testes podem ser publicados sem abrir o painel: `QUESTIONNAIRE_ADMIN_ENABLED` ausente significa acesso negado.
- **Ativação final depende da GEX**: criar política Access para `/rh/*`, fornecer os valores das variáveis de produção no painel Cloudflare e validar uma sessão autorizada. Nunca criar uma senha compartilhada em arquivo público.

## Testes

```sh
npm run check
npm test
```

O teste `tests/rh-questionnaires.test.mjs` cobre controle de acesso, CSP, entrada inválida, salvamento, concorrência, reutilização, desativação e integração simulada com o formulário e as observações da Recrutei.

Referência oficial de controle de acesso por caminho: https://developers.cloudflare.com/workers/configuration/cloudflare-access/
