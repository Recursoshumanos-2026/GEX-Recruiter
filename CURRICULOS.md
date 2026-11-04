# Integração de currículos — GEX Talents (revisão, não publicar)

## Fluxo

1. A pessoa candidata anexa currículo **PDF ou DOCX**, máximo **5 MB**, no formulário da vaga.
2. O Cloudflare Worker verifica o formato e a assinatura inicial do arquivo (PDF ou ZIP/DOCX).
3. **Antes de criar a candidatura**, converte o arquivo em Markdown usando `env.AI.toMarkdown()` (Cloudflare Workers AI). Se não for possível extrair texto, a candidatura **não** é criada.
4. A candidatura é criada na Recrutei pela API existente, mantendo a tag e o questionário.
5. O Markdown **integral** é salvo em **bucket R2 privado**, na chave `curriculos/{vaga}/{candidatura}/{uuid}.md`. O original não é armazenado nesta integração; nenhum link público do R2 é gerado.
6. O backend tenta salvar a versão Markdown (até 12 mil caracteres) no campo personalizado da Recrutei via `PUT /api/v2/curriculum/filled`, em `informations`:
   ```json
   {
     "informations": [
       {
         "type": "text",
         "title": "Currículo GEX Talents (Markdown)",
         "value": "Conteúdo convertido..."
       }
     ]
   }
   ```
7. Se essa rota falhar, o backend tenta **uma observação privada** no candidato, com Markdown em HTML escapado (até 24 mil caracteres), via `POST /api/v2/talents-observations`. O Markdown completo continua no R2.
8. A resposta da candidatura informa separadamente se houve armazenamento privado, campo personalizado e/ou observação. **Não repetir a candidatura** se qualquer etapa posterior falhar.

## Limitação real da Recrutei — importante

O endpoint documentado aceita `informations`, mas a integração existente da GEX retornou **HTTP 404** ao tentar atualizar dados complementares. Portanto, o campo personalizado **ainda não está homologado**. O fallback de observações busca evitar a perda do conteúdo no ATS, mas também deve ser validado com o suporte. **Não tratar testes simulados como confirmação de persistência real.** Pode ser necessário cadastrar o campo no painel da Recrutei e ajustar o ID correto da prospecção. Ver `SUPORTE-RECRUTEI.md`.

## Configurar na Cloudflare (pendente de acesso administrativo)

1. Criar um bucket privado R2 chamado, por exemplo, `gex-talents-curriculos`. **Não habilitar `r2.dev` nem domínio público** para currículos. Verificar as permissões do Worker para gravar no bucket.
2. Nos arquivos `wrangler.toml` (raiz e/ou worker), descomentar/adicionar:
   ```toml
   [[r2_buckets]]
   binding = "RESUME_BUCKET"
   bucket_name = "gex-talents-curriculos"
   ```
   Para ambientes de prévia, preferir **outro bucket de testes** e nunca misturar documentos fictícios com currículos reais.
3. O binding da IA já está preparado:
   ```toml
   [ai]
   binding = "AI"
   ```
4. Com os bindings operacionais, validar o endpoint `GET /health`. Quando `RESUME_UPLOAD_ENABLED` for `false`, o campo de upload permanece oculto/desabilitado e nenhuma candidatura muda de comportamento.
5. **Somente após homologação**, definir `RESUME_UPLOAD_ENABLED = "true"` no ambiente autorizado. Isso torna o currículo obrigatório nas candidaturas novas `form_version=2`.
6. Definir política de retenção/exclusão de currículos e processamento de solicitações de titulares da LGPD. O R2 pode receber uma regra de ciclo de vida aprovada internamente; não definir prazo automaticamente sem decisão do RH/jurídico.
7. Adicionar proteção contra abuso (rate limiting e Turnstile/WAF) antes de receber arquivos do público. O limite de arquivo está no backend, mas **não substitui** mitigação de uploads massivos e análise de segurança. A conversão não deve ser interpretada como verificação de vírus.
8. Confirmar com jurídico/privacidade o texto de aviso ao candidato. A conversão usa Workers AI e os dados de currículo contêm informações pessoais; acesso ao bucket e à conta Cloudflare deve ser restrito ao RH.

## Segurança e experiência

- Uploads e requisições multipart são aceitos apenas na origem configurada; CORS sozinho não é autenticação e **não** impede clientes não navegador.
- Nomes de candidatos/arquivos nunca entram na chave R2. A chave contém IDs e UUID, não é publicada no site ou na resposta ao candidato.
- Currículos com conversão inválida, com assinatura incompatível, acima de 5 MB ou quando a funcionalidade estiver desativada são rejeitados antes de criar a candidatura.
- Após criação bem-sucedida, falhas no R2 ou Recrutei geram aviso, não uma segunda inscrição.
- O arquivo original não é preservado: apenas o Markdown convertido. Se o RH precisar do PDF original, isso requer decisão e implementação adicional de armazenamento privado.
- O conteúdo pode conter dados pessoais e deve ser revisado por humanos, sem utilizar a conversão automaticamente para reprovar candidatos.

## Testes

- `npm run check`
- `npm test` (inclui `tests/resumes.test.mjs`: formatos, R2 privado, campo personalizado, fallback 404, falhas e configuração desabilitada)
- Navegador: `GEX_RESUME_PREVIEW=true node tests/vacancy-browser.mjs`, com arquivo **fictício** e sem submissão de candidatura.
- Antes de publicar: testar com conta de homologação e documentos fictícios; confirmar que o Markdown aparece na Recrutei no campo ou observação correta e que as permissões privadas do R2 funcionam.

**Status: implementação no código e mocks, sem bucket de produção provisionado e sem teste end-to-end real com dados de candidatos.**
