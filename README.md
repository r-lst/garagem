# Garagem

Ferramentas para marcenaria e impressão 3D, a correr no browser (nada é enviado para servidores).

**Usar:** https://r-lst.github.io/garagem/

| Separador | Para quê |
|---|---|
| Pedir ao Claude | Gera o pedido certo para colar no Claude, que faz perguntas e só depois entrega |
| Ver projeto | Cola o modelo que o Claude entrega e vê o móvel em 3D, com a lista de cortes |
| Peça 3D | Abre/cria STL, altera medidas, furos, cortes, e guarda para o Cura/Creality Print |
| Cortes | Quantas tábuas comprar e como cortar |
| Equipamento | Impressora e ferramentas; ficam guardadas no browser |

Os dados do utilizador (equipamento, ficheiros STL, projetos) ficam só no browser.

## Desenvolvimento

```
npm ci
npm test        # testes da lógica (geometria, cortes, projetos)
npm run build   # gera dist/index.html (ficheiro único)
```

- `src/geo.js` operações sobre malhas (furos, cortes, base, escala)
- `src/project.js` leitura e desenho dos projetos de madeira, lista de cortes
- `src/cuts.js` cálculo de cortes
- `src/prompts.js` texto dos pedidos ao Claude
- `src/main.js` interface

## Versões e publicação

- O ramo `main` é o que está publicado. Cada push a `main` corre os testes e, se passarem, publica.
- Para experimentar, trabalhar no ramo `dev` (os testes correm, não publica) e passar para `main` quando estiver bom.
- Voltar atrás: `git revert <commit>` e push; ou voltar a um marco, ex.: `v1.0.0`.

Licença MIT.
