# Garagem

App web estática para marcenaria e impressão 3D, com um Cloudflare Worker para o que precisa de rede (ver **Rede**). Publicada em https://r-lst.github.io/garagem/

## Para quem é
- **Utilizador final:** o pai do Leston, 70 e tal anos, usa o Claude (já tem a versão paga, Pro; conversa no browser, sem API), no computador e no telemóvel. Precisa de letra grande, poucos campos por ecrã, nada técnico. Ecrãs novos têm de funcionar a 375 px de largura. Tem uma Creality K1 (PLA, volume 220×220×250 mm) e trabalha madeira na garagem do prédio.
- **Quem mantém:** o Leston (administrador de sistemas; não programa de raiz). Explicar alterações em linguagem simples e dizer sempre o que mudou no ecrã.

## Regras do projeto
- Tudo o que o utilizador vê: português de Portugal, direto, sem enchimento.
- **Propor antes de alterar o visual ou o fluxo** e esperar confirmação do Leston. Só avançar sem perguntar em correções de erros.
- Repositório público: nunca pôr chaves de API, tokens ou dados pessoais. Os segredos ficam só no Worker (`wrangler secret put`).
- A saída é **um único `dist/index.html`**, com fontes e bibliotecas embutidas. Sem CDN. A página tem de funcionar sem internet; o que usa rede é um extra.
- Unidades em **mm**. Eixos: X = largura (esquerda→direita), Y = profundidade (frente→trás), Z = altura (Z para cima, chão em Z=0).
- Chaves no localStorage (não renomear sem migrar os dados, senão o pai perde o que tem):
  - `oficina_perfil`: equipamento
  - `garagem_historico`: histórico de pedidos e projetos
  - `garagem_prefs`: aspeto deste aparelho (`animacoes` true|false; `tema` reservado). Fora da cópia de segurança e da cópia online
  - `garagem_sync`: chave da cópia online, `perfilAtualizado`, `conhecidos` (sha de cada ficheiro online), hora da última sincronização
  - `garagem_medidas`: caderno de medidas (`[{id, nome, medida, nota, atualizado}]`). Vai na cópia de segurança em ficheiro; **não** vai na cópia online (ainda)
  - `garagem_temporizadores`: temporizadores a contar (`[{id, nome, fim, min}]`, `fim` em ms). Só deste aparelho
- Não commitar `node_modules/` nem `dist/` (já estão no `.gitignore`).

## Aspeto (Blueprint)
- **Só o Blueprint escuro, para já** (decisão do Leston; sem botão de tema). O Blueprint claro (papel de planta) continua no CSS em `:root`, sem uso. Tudo por variáveis CSS em `:root` e `:root[data-tema="escuro"]` (`style.css`); não pôr cores fixas fora das variáveis. O tema aplica-se por um script no `<head>`, para não piscar.
- Laranja: `--accent` (#C2571A) só em detalhes grandes (contornos, brilho, ícones); texto pequeno usa `--accent-t` (#9B4211) e botões `--accent-b` (#B34E12), porque o #C2571A não chega a 4,5:1.
- Mínimos: texto 18 px (≥ .95rem), alvos 48 px, foco `:focus-visible`, animações < 300 ms, nada a piscar. `prefers-reduced-motion` e o interruptor Animações (Equipamento → Aspeto, `data-anim="off"`) desligam todo o movimento.
- Superfícies interativas (`.cartao`, `.tile`, `.hist-item`, `.cont-cartao`, `.of-linha`): brilho que segue o rato, linha de luz no topo, contorno laranja e ícone animado no hover/foco (variáveis `--mx --my --rx --ry`, JS delegado em `main.js`, só com rato). Inclinação só em `.cartao` e `.tile`. O ícone de cada tipo anima pela classe `i-<nome>` que o `icon()` põe no SVG: ao criar um ícone novo, acrescentar a regra em `style.css`.
- Blocos, passos e tipos de trabalho entram com fade e subida escalonados; cada separador abre com um título com ícone (`.titulo-tab`).
- O fundo das cenas 3D muda com o tema (`FUNDO_3D`).

## Estrutura (`src/`)
| Ficheiro | Faz |
|---|---|
| `main.js` | Interface: navegação (menu de cima; barra em baixo no telemóvel), os separadores, modo oficina, visualizadores 3D, ligação a tudo o resto |
| `template.html`, `style.css`, `icons.js` | Página, estilo (tons madeira/papel, fontes Zilla Slab e Atkinson Hyperlegible), ícones |
| `geo.js` | Operações sobre malhas STL: furos, cortes, base, escala, espelho, rodar, estatísticas, caber no volume de impressão |
| `shapes.js` | Peça 3D a partir de JSON do Claude (formas `add`/`sub`) e geradores simples (caixa, tampa, tubo, suporte em L, placa) |
| `project.js` | Projeto de madeira: lê o JSON, cria a geometria, deteta peças soltas, calcula a lista de cortes |
| `cuts.js` | Cálculo de cortes de tábuas (1D), por grupos |
| `oficina.js` | Modo oficina (sem DOM): listas Cortar e Comprar de um projeto, com chaves estáveis para riscar; lista de compras (com extras) e o texto para partilhar |
| `ferramentas.js` | Ferramentas pequenas (sem DOM): temporizador, caderno de medidas, tinta/verniz/cola, guia de madeiras |
| `folha.js` | Folha de cortes para imprimir (sem DOM, devolve HTML): comprar, cortar, como cortar cada tábua |
| `prompts.js` | Texto dos pedidos que o pai cola no Claude |
| `historico.js` | Histórico (sem DOM): registar pedido, ligar projeto, apagar, juntar duas cópias, ficheiro de cópia |
| `descrever.js` | Descrição das fotos (sem DOM): pede ao Worker e traduz os erros para português |
| `sync.js` | Cópia online: lê do Worker o que mudou, junta com o local, grava o que é mais recente cá; chave do link `#k=` |
| `config.js` | `WORKER_URL` (vazio = sem cópia online) |

`worker/` é o Cloudflare Worker (código, `wrangler.toml`, instruções em `worker/LEIA-ME.md`). Não entra no `dist/`.

## Rede
A página só fala com o **Worker da Garagem** (`WORKER_URL`), e só para os usos desta tabela. Cada uso novo é decidido com o Leston e acrescentado aqui antes de se fazer.

| Uso | Rota | O que sai do browser | Quando |
|---|---|---|---|
| Cópia online | `GET /lista`, `POST /ler`, `POST /gravar` | histórico (pedidos, textos, projetos) e equipamento | só com uma chave ligada no aparelho (link `#k=` ou Equipamento) |
| Descrever fotos | `POST /descrever` | texto do pedido, zona e 1 a 3 fotos (JPEG ~1280 px) → Worker → Google (Gemini) | só ao carregar em **Descrever as fotos**, numa reparação, com chave ligada |

- Worker `api-github-garagem-dados`; guarda no repositório **privado** `r-lst/garagem-dados`: `perfil.json`, `historico/<id>.json`, `projetos/<id>.json` (mais tarde `fotos/<id-projeto>/<n>.jpg`). Detalhes em `worker/LEIA-ME.md`.
- Segredos do Worker: `GITHUB_TOKEN`, `GITHUB_REPO`, `PAI_KEY`, `ADMIN_KEY`, `GEMINI_API_KEY`. A página só conhece a chave do aparelho. `PAI_KEY` lê e grava; `ADMIN_KEY` também apaga ficheiros.
- `/descrever`: o Gemini **só descreve** (marca, modelo, estado visível); o conselho é do Claude. O Worker tenta `GEMINI_MODELOS` por ordem (por omissão `gemini-3.8-flash`, `gemini-3.6-flash`, `gemini-3.1-flash-lite`; secret opcional para mudar) e passa ao seguinte em 429, erro 5xx, modelo inexistente (404/400) ou resposta vazia. Os nomes vêm da documentação da Google (aistudio.google.com/docs/models). Usa `generateContent` (a Google diz que continua totalmente suportado; a documentação nova usa `/interactions`). O Worker não descodifica as fotos (CPU do plano grátis): passa o base64 ao Gemini e ao GitHub (`POST /git/blobs`, um só commit), em `fotos/<id-do-pedido>/<n>.jpg`. A sincronização ignora `fotos/`. No plano grátis do Gemini a Google pode usar o que recebe para melhorar os produtos: a página avisa numa linha (sem pessoas nem documentos). Quota grátis (AI Studio): 3.8 Flash 5/min e 20/dia; 3.1 Flash Lite 15/min e 500/dia.
- Plano grátis: 50 pedidos ao GitHub por pedido ao Worker. Por isso a gravação é um só commit (5 pedidos) e a leitura vai em lotes de 40. Não trocar por um pedido por ficheiro.
- Conflitos: por ficheiro, ganha o `atualizado` mais recente. Um aparelho que nunca guardou equipamento (`perfilAtualizado` 0) só recebe o equipamento, nunca envia os valores de origem.
- Sem rede, ou com o Worker em baixo: tudo continua a funcionar e a guardar no aparelho; o Histórico mostra o erro em português.

## Histórico
- Entrada: `{id, criado, atualizado, modo, estado:"pedido"|"projeto"|"resolvida", texto, pedido, nome, projeto, area, resposta, oficina}`. Entram os modos `madeira`, `reparacao`, `plano`, `outro` (não os de Peça 3D). `resolvida` e `area` só nas reparações; `resposta` nas reparações e nos projetos de madeira; `oficina: {cortar:{chave:true}, comprar:{chave:true}, tenho:{chave:true}, extras:{chave:texto}}` = o que foi riscado no modo oficina (`comprar` = comprado, `tenho` = já tinha, `extras` = linhas juntadas à lista de compras).
- "pedido" ao chegar ao passo 3; passa a "projeto" ao carregar em **Desenhar** (liga ao último pedido de madeira sem projeto). O exemplo não entra.
- Apagar deixa `{id, atualizado, apagado:true}`, para a sincronização não ressuscitar o que foi apagado. Juntar: por `id`, ganha o `atualizado` mais recente.
- Mudar o formato: atualizar `historico.js`, `test-historico.mjs` e manter a leitura das entradas antigas.

## Telemóvel (até 700 px de largura)
- O menu de cima dá lugar a uma barra em baixo: Início, Projetos (= Histórico), Pedir (= Novo pedido), Ferramentas. Sem "Mais": Ver projeto, Peça 3D e Equipamento só no computador (o cartão Peça 3D do Novo pedido também fica escondido no telemóvel). Decide-se pela largura, não pelo aparelho.
- Início começa com **Novo pedido** e **Reparar**; depois "Continuar": o projeto mais recente com cortes por fazer e até 2 reparações por resolver. A apresentação e a mesa 3D só no computador.
- **Modo oficina** (`#oficina=<id>`, também no computador): Cortar / Comprar / Montar. Tocar numa linha de Cortar risca-a (fica em `oficina` na entrada e vai na cópia online); o riscado desce para o fim do grupo.
- **Comprar** é a lista de compras do projeto: cada toque passa a linha por *por comprar → já tenho → comprado → por comprar* (`oficina.tenho` e `oficina.comprar`; as entradas antigas, só com `comprar`, leem-se como comprado). Por baixo, **Juntar à lista** (botões de lixa, cola, verniz… e campo "Outra coisa" → `oficina.extras`, linhas com chave `x|…`) e **Partilhar a lista** (partilha do telemóvel, ou copia; leva só o que ainda falta). Montar mostra a `resposta` guardada. Ecrã sempre ligado (Wake Lock) enquanto está aberto.
- As chaves das linhas (`oficina.js`) não dependem do comprimento da tábua: mudar a tábua em Cortes não perde o que foi riscado. Não as mudar sem migrar.
- Sem modo offline: há sempre internet na garagem (decisão do Leston). Mantém-se o ficheiro único.
- `.so-pc` esconde coisas no telemóvel (ex.: "Ver em 3D" e a cópia de segurança no Histórico, o Ctrl+V e o "Ir para Ver projeto" no Pedir); `.so-tel` mostra só no telemóvel. As regras do menu de cima são `#tabs`, não `nav` (a barra também é um `nav`).

## Ferramentas (separador **Ferramentas**)
Menu de cartões (`#ferramentas`); cada ferramenta tem a sua página com "voltar" (`#cortes`, `#temporizador`, `#medidas`, `#tinta`, `#madeiras`). Tudo **offline**, sem Worker. A lógica está em `ferramentas.js` (testada em `test-ferramentas.mjs`).
- **Cortes de madeira**: o que já havia.
- **Temporizador**: tempos habituais (cola, verniz, tinta…) e "Outro tempo". Guarda a hora a que acaba (`fim`), por isso aguenta a página em segundo plano; ao voltar mostra "Acabou". Toca (3 apitos) e vibra só com a página aberta: sem service worker nem notificações, de propósito (não pedir permissões ao pai). Os tempos são os habituais, a embalagem manda.
- **Caderno de medidas**: nome + medida (texto livre, ex. "810 × 2040 mm") + nota. No Novo pedido, passo 2, os botões "Juntar uma medida do caderno" põem a linha no texto.
- **Tinta, verniz e cola**: área (cm) × peças × lados × demãos ÷ rendimento, com 10% de margem, e sugere a embalagem. O rendimento é editável. A cola conta uma só camada.
- **Guia de madeiras**: lista fixa em `MADEIRAS` (maciças e placas), com filtros. Texto curto: serve para quê e o que ter em conta.

## Reparações
- Tipo `reparacao` no Pedir ao Claude (e cartão no Início). Passo 2: área opcional (`AREAS_REPARACAO`) e "O que se passa?". Fotos: com chave ligada, o passo 2 tem **Juntar foto** (até 3, reduzidas na página, só em memória) e o passo 3 **Descrever as fotos**; a descrição aparece numa caixa que se pode corrigir e entra no pedido (`O QUE SE VÊ NAS FOTOS`, `descrever.js`, `buildPrompt({fotos})`), e o Histórico guarda o pedido já com ela. Sem chave ou sem rede, o pedido sai sem fotos e o passo 3 lembra de as juntar na conversa do Claude.
- Pedido em `prompts.js` (`REGRAS_REPARACAO`, `FORMATO_REPARACAO`): texto, sem JSON. Até 3 causas, dificuldade, ferramentas e material, passos, quando chamar um técnico.
- Segurança, no pedido e só no pedido: eletricidade = uma frase a lembrar o disjuntor desligado no quadro; gás = não serve para isso, é para um técnico de gás. **Sem avisos na página** e sem tom de quem fala para uma criança (decisão do Leston).
- No Histórico: "Guardar a resposta" (o pai cola o texto do Claude), "Marcar como resolvida" / "Voltar a abrir".

## Contrato entre os pedidos e os leitores (crítico)
`prompts.js` ensina o Claude a produzir JSON, e `shapes.js` / `project.js` leem-no. Têm de mudar juntos.

- **Peça 3D:** `{"nome", "operacoes":[{"op":"add|sub","forma":"caixa|cilindro|cone|esfera", ...}], "base":"carregada" (opcional)}`
- **Projeto de madeira:** `{"nome","madeira","pecas":[{"tipo":"tabua|varao|perfil|parafuso|cavilha|dobradica", ...}]}`
  - `posicao` = canto da peça com menor X, Y e Z
  - `perfil`: `orientacao` frente|lado|cima; `contorno` com pontos `[a,b]`, `[a,b,raio]` ou `{"ate":[a,b],"flecha":f}` (flecha positiva = curva para fora)
  - `repetir: {vezes, passo:[x,y,z]}`; ferragens: `posicao`, `direcao`, `comprimento`
- Os leitores toleram chaves em maiúsculas/acentos (`normKeys`) e devolvem erros em português que dizem **que peça** e **que campo** falhou, porque é isso que o pai pode dizer ao Claude para corrigir.
- Se mudares um campo: atualizar o texto em `prompts.js`, o leitor, o exemplo `EXEMPLO_PROJETO` e os testes.

## Folha de cortes
- Abre com **Imprimir folha de cortes** (Ver projeto, ou Cortes depois de calcular). Usa o comprimento de tábua, a serra e o aparo do separador Cortes.
- Imprime só `#folha` (`body.a-imprimir`, tirado no `afterprint`). Estilo só dentro de `@media print`, em pt; preto e branco; a sobra tracejada usa `print-color-adjust: exact`.
- Para ver o resultado sem impressora: Edge sem janela com `--print-to-pdf` sobre uma cópia do `dist/index.html` que carrega no botão.

## Peça 3D: fluxo
- A Peça 3D **não está no menu**: entra-se por **Novo pedido → Peça 3D**, que abre três escolhas: **Fazer uma peça nova** (de raiz: pedido ao Claude; depois "Colar a peça"), **Peças simples** (geradores predefinidos) e **Alterar uma peça que já tenho** (abrir STL; lá dentro também "Pedir alterações ao Claude", aplicado sobre a peça aberta). O Voltar leva a estas escolhas; "Mudar de peça" limpa a peça e volta ao caminho por onde entrou. Só com a peça aberta aparecem Medidas, Alterar e Guardar, todos fechados (`painelPeca()` em `main.js`; estado `pecaVista`/`pecaModo`/`pecaOrigem`). O Novo pedido abre sempre no passo 1; um pedido escrito e não criado fica à espera como "Continuar o pedido" (`rascunho()`).

## Equipamento
- Impressora num resumo de uma linha, com "Mudar a impressora" (modelo, material, bico, programa, volume). Ferramentas e materiais são botões de toque + campo "Outras"; continuam guardados como texto em `ferramentas` e `madeiras` (o que não corresponde a um botão vai para "Outras", nada se perde). Notas escondidas até serem precisas.

## Caber na impressora (Peça 3D)
- Limites: os do Equipamento (`vx`, `vy`, `vz`; por omissão a K1, 220 × 220 × 250 mm). Folga de 0,01 mm.
- `G.rodarParaCaber` tenta, por esta ordem: rodar 90° na mesa → diagonal da mesa (estas duas mantêm a face de baixo) → virar para outra face → virada e na diagonal. Não trocar a ordem: uma barra fina ficava de pé.
- Roda **sozinha só quando a peça entra** (abrir STL, criar, importar do Claude) e avisa (faixa acima do desenho com Desfazer, e mensagem em baixo, porque no telemóvel o pai está no formulário). Depois de alterações, só avisa, com o botão **Rodar para caber**. Sem posição possível: "A peça excede o tamanho". Nunca corta sozinha.
- O Guardar avisa mas guarda sempre (decisão do Leston).
- **Melhor posição para imprimir** (`G.melhorPosicao`): das 6 faces que cabem, escolhe menos suportes (faces viradas para baixo mais de 45°, fora da mesa), depois mais área na mesa, depois menos altura; empate fica como está. Não decide a resistência: isso é o Claude, a quem o pedido de Peça 3D pergunta onde a peça faz força e pede a posição para imprimir. A faixa lembra o Desfazer por isso.

## Geometria: cuidados
- Booleanas com `three-bvh-csg`. O resultado passa por `clean()` e `repairTJunctions()`; sem isto saem junções em T e a malha parece aberta.
- `stats().closed` usa o balanço de área (tolerante a ruído de ~1e-4 mm das booleanas). `strictClosed` é o rigoroso. Não simplificar sem correr `npm test`: já falhou por isto.
- Os avisos `BVH: "maxLeafSize" ... deprecated` nos testes são inofensivos.

## Como testar
```
npm ci
npm test         # lógica: geometria, cortes, projetos, pedidos, histórico, Worker (GitHub simulado), folha de cortes, oficina, ferramentas
npm run build    # gera dist/index.html
```
Abrir `dist/index.html` no browser (duplo clique) e experimentar: Início; Pedir ao Claude (3 passos); Ver projeto → "Ver um exemplo"; Peça 3D → criar suporte em L, furar, cortar, guardar; criar uma placa de 280 × 40 (deve rodar para a diagonal e avisar) e uma de 400 × 300 (deve dizer que excede); Cortes; Ver projeto → "Imprimir folha de cortes" (pré-visualização de impressão: A4, preto e branco, 2 páginas no exemplo); Histórico (fazer um pedido de madeira, desenhar, "Ver em 3D", apagar, guardar/recuperar cópia); a 375 px: barra em baixo, Início → Continuar → Abrir na oficina, riscar um corte, Comprar (três toques numa linha, juntar Lixa, Partilhar), Montar → Guardar a resposta; Ferramentas → Temporizador (começar um de 5 min), Caderno de medidas (guardar uma e juntá-la num Novo pedido), Tinta, Guia de madeiras.
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
- Não há integração com a API do Claude. Se vier, passa pelo Worker (a chave nunca vai na página).
- A cópia online não guarda ficheiros STL (decisão do Leston).
- O token do GitHub expira a 21/10/2027.
