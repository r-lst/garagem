# Worker da Garagem

Fica entre a página pública (r-lst.github.io/garagem) e o repositório **privado** onde se guarda o histórico.
A chave do GitHub só existe aqui, como segredo. A página só sabe o **código de sincronização**.

```
página  ──(código)──►  Worker  ──(token GitHub)──►  repositório privado / historico.json
```

## Preparar

1. **Repositório de dados:** criar um repositório **privado** no GitHub (ex.: `r-lst/garagem-dados`), com um README para ficar com o ramo `main`.
2. **Token do GitHub:** Settings → Developer settings → Personal access tokens → **Fine-grained tokens** → Generate.
   - Repository access: **Only select repositories** → só o repositório de dados.
   - Permissions → Repository → **Contents: Read and write**. Mais nada.
   - Anotar a data de validade: quando expirar, a cópia online para (a página continua a funcionar e a guardar no computador).
3. **Código de sincronização:** inventar uma frase comprida e aleatória (ex.: gerar com `openssl rand -hex 24`). É isto que se escreve uma vez no Equipamento do pai.

## Publicar

Na pasta `worker/`:

```
npx wrangler login
```

Editar `wrangler.toml` e pôr o nome do repositório de dados em `REPO`. Depois:

```
npx wrangler secret put GITHUB_TOKEN
npx wrangler secret put CODIGO
npx wrangler deploy
```

O `deploy` mostra o endereço (ex.: `https://garagem.<conta>.workers.dev`). Pô-lo em `src/config.js` → `WORKER_URL`, fazer commit e publicar a página.

## Ligar no computador do pai

Garagem → **Equipamento** → **Cópia online** → escrever o código de sincronização → **Ligar**.

## Proteções

- Só aceita pedidos vindos das páginas em `ORIGENS`.
- Sem o código certo responde 401 e não toca no GitHub.
- Até 30 pedidos por minuto por endereço IP (`[[ratelimits]]`).
- O token só tem acesso ao repositório de dados.

## Testar

Os testes do Worker correm com `npm test` na raiz (`test-worker.mjs`), com o GitHub simulado.
