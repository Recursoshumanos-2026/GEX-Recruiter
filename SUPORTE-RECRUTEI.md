# Mensagem para o suporte da Recrutei

## Resposta recebida e correção (novembro de 2026)

O suporte esclareceu que a documentação anterior continha um erro: o ID do talento
vai **no caminho** do endpoint, não na query. Deve ser `data.talent.id` retornado
na criação da prospecção; `data.talent.prospect.id` é outro identificador.

```http
PUT /api/v2/curriculum/filled/<data.talent.id>
Content-Type: application/json

{
  "application_id": 11350000,
  "basic_infos": [{ "key": "birthday", "value": "2001-01-01", "title": "Data de nascimento" }],
  "additional": [{ "key": "intended_remuneration", "value": "5000", "title": "Pretensão salarial" }]
}
```

Os IDs e dados acima são fictícios. `talent_id` não é necessário no corpo.
Nascimento e salário podem ser enviados juntos; salário deve ser numérico,
sem `R$` ou separador de milhar, aceitando ponto decimal.

O `GET /api/v1/applications/<application_id>` permite verificar o nascimento em
`talent.birthday` e a pretensão em `talent.professional_profile`. Se um candidato
já possui conta própria na Recrutei, o PUT retorna **HTTP 406** e não permite
alterar o perfil. Nossa integração mantém a candidatura e registra os dados
complementares numa observação para o RH, sem contornar a restrição.

O código foi atualizado para o novo formato e testado com dados fictícios.
O resultado de uma candidatura real ainda deve ser conferido no perfil do candidato.

## Consulta original enviada ao suporte

Olá! Precisamos confirmar como atualizar nascimento e pretensão salarial de um
candidato em prospecção criado pela API. A candidatura, a tag e a observação são
registradas, mas os dados complementares ainda não foram confirmados.

O `GET /api/v1/applications/<ID_DA_CANDIDATURA>` retorna HTTP 200 e confirma o
cadastro de teste e sua vaga. O `PUT /api/v2/curriculum/filled` retorna HTTP 404,
com “Não foi possível encontrar essa informação!”, sem indicar campo de validação.
Esse status foi capturado na tentativa de usar o ID da prospecção na query.
Anteriormente, com o ID do talento, recebíamos a mesma mensagem, mas o status HTTP
não foi preservado. No corpo, mantivemos os IDs numéricos do talento e da candidatura.

Formato tentado, com IDs e token substituídos por placeholders:

```text
PUT /api/v2/curriculum/filled?talent_id=<ID_DO_TALENTO>
Authorization: Bearer <TOKEN_OMITIDO>
Content-Type: application/json

talent_id: <ID_DO_TALENTO> (inteiro)
application_id: <ID_DA_CANDIDATURA> (inteiro)
basic_infos: [{"key":"birthday","value":"2001-01-01","title":"Data de nascimento"}]
additional: [{"key":"intended_remuneration","value":"5000","title":"Pretensão salarial"}]
```

Na segunda tentativa, somente a query usou `<ID_DA_PROSPECCAO>`. Os placeholders
não foram enviados literalmente. A data `2001-01-01` e o salário `5000` são
exclusivamente fictícios. A leitura posterior não confirmou o nascimento e não
permitiu confirmar a remuneração.

Podem fornecer um **cURL mínimo válido**, com valores fictícios, e confirmar:

1. Qual ID vai em `talent_id` da query e qual vai no corpo?
2. `basic_infos` e `additional` podem ir juntos ou exigem requisições separadas?
3. O nascimento usa `birthday` e aceita `YYYY-MM-DD`?
4. A pretensão usa `intended_remuneration` em `additional`, com string numérica?
5. Qual condição gera esse 404 e onde consultar os valores persistidos?

Não precisamos criar outra candidatura para esse diagnóstico. O responsável pode
fornecer os identificadores reais em canal privado, se necessário; o token não
deve ser compartilhado.

Guias consultados: [editar prospecção](https://developers.recrutei.com.br/docs/editando-uma-prospec%C3%A7%C3%A3o-de-candidato)
e [visualizar candidato](https://developers.recrutei.com.br/docs/visualizando-candidatos).
