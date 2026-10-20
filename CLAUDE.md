# Garagem

App web estática (sem servidor) para marcenaria e impressão 3D. Publicada em https://r-lst.github.io/garagem/

## Para quem é
- **Utilizador final:** o pai do Leston, 70 e tal anos, usa o Claude gratuito (conversa no browser, sem API). Precisa de letra grande, poucos campos por ecrã, nada técnico. Tem uma Creality K1 (PLA, volume 220×220×250 mm) e trabalha madeira na garagem do prédio.
- **Quem mantém:** o Leston (administrador de sistemas; não programa de raiz). Explicar alterações em linguagem simples e dizer sempre o que mudou no ecrã.

## Regras do projeto
- Tudo o que o utilizador vê: português de Portugal, direto, sem enchimento.
- **Propor antes de alterar o visual ou o fluxo** e esperar confirmação do Leston. Só avançar sem perguntar em correções de erros.
- Repositório público: nunca pôr chaves de API, dados pessoais ou servidores. Tudo corre no browser e nada é enviado para fora.
- A saída é **um único `dist/index.html`**, com fontes e bibliotecas embutidas. Sem CDN, sem pedidos de rede em execução.
- Unidades em **mm**. Eixos: X = largura (esquerda→direita), Y = profundidade (frente→trás), Z = altura (Z para cima, chão em Z=0).
- A chave `oficina_perfil` no localStorage guarda o equipamento do utilizador. Não a renomear sem migrar os dados (senão o pai perde o que preencheu).
- Não commitar `node_modules/` nem `dist/` (já estão no `.gitignore`).

## Estrutura (`src/`)
| Ficheiro | Faz |
|---|---|
| `main.js` | Interface: navegação, os 6 separadores, visualizadores 3D, ligação a tudo o resto |
| `template.html`, `style.css`, `icons.js` | Página, estilo (tons madeira/papel, fontes Zilla Slab e Atkinson Hyperlegible), ícones |
| `geo.js` | Operações sobre malhas STL: furos, cortes, base, escala, espelho, rodar, estatísticas |
| `shapes.js` | Peça 3D a partir de JSON do Claude (formas `add`/`sub`) e geradores simples (caixa, tampa, tubo, suporte em L, placa) |
| `project.js` | Projeto de madeira: lê o JSON, cria a geometria, deteta peças soltas, calcula a lista de cortes |
| `cuts.js` | Cálculo de cortes de tábuas (1D), por grupos |
| `prompts.js` | Texto dos pedidos que o pai cola no Claude |

## Contrato entre os pedidos e os leitores (crítico)
`prompts.js` ensina o Claude gratuito a produzir JSON, e `shapes.js` / `project.js` leem-no. Têm de mudar juntos.

- **Peça 3D:** `{"nome", "operacoes":[{"op":"add|sub","forma":"caixa|cilindro|cone|esfera", ...}], "base":"carregada" (opcional)}`
- **Projeto de madeira:** `{"nome","madeira","pecas":[{"tipo":"tabua|varao|perfil|parafuso|cavilha|dobradica", ...}]}`
  - `posicao` = canto da peça com menor X, Y e Z
  - `perfil`: `orientacao` frente|lado|cima; `contorno` com pontos `[a,b]`, `[a,b,raio]` ou `{"ate":[a,b],"flecha":f}` (flecha positiva = curva para fora)
  - `repetir: {vezes, passo:[x,y,z]}`; ferragens: `posicao`, `direcao`, `comprimento`
- Os leitores toleram chaves em maiúsculas/acentos (`normKeys`) e devolvem erros em português que dizem **que peça** e **que campo** falhou, porque é isso que o pai pode dizer ao Claude para corrigir.
- Se mudares um campo: atualizar o texto em `prompts.js`, o leitor, o exemplo `EXEMPLO_PROJETO` e os testes.

## Geometria: cuidados
- Booleanas com `three-bvh-csg`. O resultado passa por `clean()` e `repairTJunctions()`; sem isto saem junções em T e a malha parece aberta.
- `stats().closed` usa o balanço de área (tolerante a ruído de ~1e-4 mm das booleanas). `strictClosed` é o rigoroso. Não simplificar sem correr `npm test`: já falhou por isto.
- Os avisos `BVH: "maxLeafSize" ... deprecated` nos testes são inofensivos.

## Como testar
```
npm ci
npm test         # lógica: geometria, cortes, projetos, pedidos
npm run build    # gera dist/index.html
```
Abrir `dist/index.html` no browser (duplo clique) e experimentar: Início; Pedir ao Claude (3 passos); Ver projeto → "Ver um exemplo"; Peça 3D → criar suporte em L, furar, cortar, guardar; Cortes.
Os testes automáticos não cobrem a interface. Depois de mexer em UI, abrir a página e verificar à mão.

## Ramos e publicação
- `main` é o que o pai vê. Cada push a `main` corre testes + build e, se passarem, publica no Pages.
- Trabalhar em `dev` (corre os testes, não publica). Passar para `main` quando estiver bom.
- Voltar atrás: `git revert <commit>` e push. Marcos estáveis com etiquetas (`v1.0.0`).

## Limites conhecidos (não prometer o contrário)
- Madeira: tábuas, varões, peças recortadas por contorno, tampos redondos, ferragens simples. Sem peças torneadas nem madeira vergada.
- Peça 3D: caixa, cilindro, cone e esfera, juntos ou subtraídos. Sem formas orgânicas.
- Peças com largura ≥ 250 mm contam como placas (contraplacado/MDF) e não entram no cálculo de tábuas.
- O desenho só está certo se as contas do Claude estiverem certas. O aviso de peça solta apanha erros grandes, não pequenos.
- Não há integração com a API do Claude: numa página pública a chave ficaria exposta.
