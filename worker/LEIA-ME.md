# Worker da Garagem (`api-github-garagem-dados`)

Fica entre a página pública (r-lst.github.io/garagem) e o repositório **privado** `r-lst/garagem-dados`.
O token do GitHub só existe aqui, como segredo. A página só conhece a chave do aparelho (`PAI_KEY` ou `ADMIN_KEY`).

```
página  ──(chave)──►  Worker  ──(token GitHub)──►  r-lst/garagem-dados
```

## Organização do repositório de dados

| Ficheiro | Conteúdo |
|---|---|
| `perfil.json` | `{atualizado, perfil}` — o equipamento (o mesmo que `oficina_perfil`) |
| `historico/<id>.json` | uma entrada do histórico, sem o projeto |
| `projetos/<id>.json` | `{id, atualizado, nome, projeto}` — o JSON do projeto de madeira |
| `fotos/<id-projeto>/<n>.jpg` | mais tarde (Reparações) |
| `README.md` | criado pelo Worker na primeira gravação (a API não grava num repositório vazio) |

Cada gravação é **um commit** com todos os ficheiros que mudaram. Apagar no Histórico deixa `{id, atualizado, apagado:true}` em `historico/<id>.json`; nada se perde, está no histórico do git.

## Rotas

Todas com `Authorization: Bearer <chave>` e só a partir das origens permitidas.

| Rota | Faz | Pedidos ao GitHub |
|---|---|---|
| `GET /lista` | todos os ficheiros e os seus `sha` | 1 |
| `POST /ler` `{shas:[…]}` (até 40) | conteúdo desses ficheiros | 1 por ficheiro |
| `POST /gravar` `{ficheiros:[{path, conteudo}]}` (até 100) | grava tudo num commit | 5 (até 15 se houver gravações ao mesmo tempo) |

O plano grátis da Cloudflare permite 50 pedidos ao GitHub por pedido recebido; os limites acima ficam abaixo disso.
A página só lê o que mudou (compara os `sha`) e só grava o que é mais recente no aparelho (campo `atualizado`).

## Chaves

| Chave | Onde anda | Pode |
|---|---|---|
| `PAI_KEY` | link do telemóvel do pai: `https://r-lst.github.io/garagem/#k=<PAI_KEY>` | ler e gravar `perfil.json`, `historico/`, `projetos/` |
| `ADMIN_KEY` | só no computador do Leston | o mesmo, e apagar ficheiros (`conteudo: null`) |

A página guarda a chave do link no aparelho e tira-a da barra de endereço. A parte depois do `#` nunca é enviada ao GitHub Pages.
Se o link do pai vazar: gerar outra `PAI_KEY`, `wrangler secret put PAI_KEY`, mandar o link novo. A `ADMIN_KEY` não muda.

## Segredos (já criados, todos do tipo Secret)

`GITHUB_TOKEN`, `GITHUB_REPO`, `PAI_KEY`, `ADMIN_KEY` e `GEMINI_API_KEY` (a chave do Google AI Studio, para descrever fotos).
Opcionais: `GEMINI_MODELOS` (lista separada por vírgulas, do preferido para o de reserva; por omissão `gemini-3.8-flash,gemini-3.6-flash,gemini-3.1-flash-lite`), `GITHUB_RAMO` (por omissão `main`), `ORIGENS` (por omissão `https://r-lst.github.io`; para testar o `dist/index.html` aberto com duplo clique, juntar `,null`).

O token expira a **21/10/2027**. Quando expirar, a cópia online mostra um erro e a página continua a funcionar com o que tem no aparelho.

## Publicar

Na pasta `worker/` (o `wrangler.toml` já tem o nome `api-github-garagem-dados`, por isso substitui o "Hello World"):

```
npx wrangler login
npx wrangler deploy
```

Não é preciso voltar a pôr os segredos: o `deploy` mantém os Secrets.

## Verificar depois de publicar

De ponta a ponta (pede a `ADMIN_KEY` sem a mostrar; grava, lê e apaga `historico/verificacao0.json`):

```
powershell -ExecutionPolicy Bypass -File worker\verificar.ps1
```

Só a lista, com a `ADMIN_KEY` (PowerShell, a origem tem de ser a da página):

```
curl.exe -s -H "Origin: https://r-lst.github.io" -H "Authorization: Bearer <ADMIN_KEY>" https://api-github-garagem-dados.rmleston.workers.dev/lista
```

Deve responder `{"ficheiros":[],...}` enquanto o repositório estiver vazio. Sem a chave: `401`. Sem o `Origin`: `403`.

## Proteções

- Só aceita pedidos vindos das origens permitidas (CORS). Isto trava outros sites num browser; contra scripts quem protege é a chave.
- Sem uma chave certa responde 401 e não toca no GitHub.
- Só grava nos caminhos `perfil.json`, `historico/<id>.json` e `projetos/<id>.json`; as fotos só entram por `/descrever`, em `fotos/<id>/<n>.jpg`, e têm de ser JPEG (máx. 3, ~1,3 MB cada).
- Até 30 pedidos por minuto por endereço IP (`[[ratelimits]]` no `wrangler.toml`).
- O token só tem acesso ao `garagem-dados`.

## Fotos (`POST /descrever`)

O Gemini descreve as fotos de uma reparação; o Claude é que aconselha. Se a chave do Gemini (`GEMINI_API_KEY`) não existir ou a quota acabar, a página mostra o erro e o pedido continua a poder ser copiado sem a descrição. Para mudar de modelo sem mexer no código: `npx wrangler secret put GEMINI_MODELOS` (por exemplo `gemini-3.8-flash,gemini-3.1-flash-lite`).

## Testes

`npm test` na raiz corre `test-worker.mjs`: o Worker contra um GitHub simulado (repositório vazio, computador e telemóvel, gravações ao mesmo tempo, browser limpo, chaves).
