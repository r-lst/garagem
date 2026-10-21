# Garagem

Ferramentas para marcenaria e impressão 3D, a correr no browser. Funciona sem internet; a única coisa que sai do browser é a cópia online do histórico, se for ligada (ver abaixo).

**Usar:** https://r-lst.github.io/garagem/

| Separador | Para quê |
|---|---|
| Pedir ao Claude | Gera o pedido certo para colar no Claude, que faz perguntas e só depois entrega |
| Ver projeto | Cola o modelo que o Claude entrega e vê o móvel em 3D, com a lista de cortes |
| Peça 3D | Abre/cria STL, altera medidas, furos, cortes, e guarda para o Cura/Creality Print |
| Cortes | Quantas tábuas comprar e como cortar |
| Histórico | Pedidos e projetos de madeira feitos; ver em 3D outra vez, copiar o pedido, cópia de segurança |
| Equipamento | Impressora e ferramentas; ficam guardadas no browser |

## Dados

- Equipamento, histórico e ficheiros STL ficam no browser. Os STL nunca saem do computador.
- **Cópia de segurança:** no Histórico, "Guardar uma cópia" descarrega um ficheiro com o histórico e o equipamento; "Recuperar uma cópia" repõe-no.
- **Cópia online (opcional):** se `src/config.js` tiver o endereço do Worker e o código for ligado no Equipamento, o histórico é guardado também num repositório privado do GitHub, através de um Cloudflare Worker (`worker/`, instruções em `worker/LEIA-ME.md`). A página nunca tem a chave do GitHub.

## Desenvolvimento

```
npm ci
npm test        # testes da lógica (geometria, cortes, projetos, histórico, Worker)
npm run build   # gera dist/index.html (ficheiro único)
```

- `src/geo.js` operações sobre malhas (furos, cortes, base, escala)
- `src/project.js` leitura e desenho dos projetos de madeira, lista de cortes
- `src/cuts.js` cálculo de cortes
- `src/prompts.js` texto dos pedidos ao Claude
- `src/historico.js` e `src/sync.js` histórico e cópia online
- `src/main.js` interface
- `worker/` Cloudflare Worker da cópia online

## Versões e publicação

- O ramo `main` é o que está publicado. Cada push a `main` corre os testes e, se passarem, publica.
- Para experimentar, trabalhar no ramo `dev` (os testes correm, não publica) e passar para `main` quando estiver bom.
- Voltar atrás: `git revert <commit>` e push; ou voltar a um marco, ex.: `v1.0.0`.

Licença MIT.
