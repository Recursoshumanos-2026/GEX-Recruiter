# GEX Talents - versão visual aprovada

Esta versão incorpora a identidade visual aprovada do GEX Talents, com tipografia ampliada, cards proporcionais, emojis em Cultura e Benefícios e o símbolo GEX como elemento de marca.

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
2. Envie os arquivos da raiz: `index.html`, `styles.css`, `app.js`, `config.js` e a pasta `assets`.
3. No GitHub: **Settings → Pages → Deploy from a branch → main / root**.
4. Abra o endereço gerado pelo GitHub Pages.

A prévia abre em `DEMO_MODE: true`; portanto nenhum dado é enviado para a Recrutei.

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

Troque `ALLOWED_ORIGIN = "*"` no `worker/wrangler.toml` pelo domínio do GitHub Pages. Exemplo:

```toml
ALLOWED_ORIGIN = "https://recursoshumanos-2026.github.io"
```

Também valide com a Recrutei qual canal de aquisição (`PROSPECT_CHANNEL_ID`) deve representar candidaturas vindas do GEX Talents.

## Observação sobre currículo e campos extras

Nesta primeira versão, o envio usa apenas os campos documentados como obrigatórios pelo endpoint de criação de prospect: nome, e-mail, telefone, vaga, etapa e canal de aquisição. Não foi colocado upload de currículo “de fachada”. Depois de validarmos a criação real do candidato na conta da GEX, podemos evoluir para informações complementares e currículo usando os endpoints suportados pela Recrutei.
