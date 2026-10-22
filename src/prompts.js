// Gera o pedido completo para colar no Claude (sem DOM).

export const MODOS = {
  peca3d: { nome: 'Peça nova para imprimir em 3D', placeholder: 'Ex.: um suporte para pendurar a rebarbadora na parede da oficina, tenho um varão de 25 mm onde vai assentar...', pos: 'Quando o Claude entregar o bloco de código, copia-o, vai a <b>Peça 3D</b> → <b>Importar do Claude</b>, cola e carrega em <b>Construir</b>. Depois guarda o STL.', destino: 'peca' },
  alterar: { nome: 'Alterar uma peça 3D que já tenho', placeholder: 'Ex.: quero um furo de 6 mm no meio da face de cima e uma base mais larga...', pos: 'Carrega primeiro a peça no separador <b>Peça 3D</b> (para o pedido levar as medidas dela). Quando o Claude entregar o bloco de código, vai a <b>Peça 3D</b> → <b>Importar do Claude</b>, marca "Aplicar sobre a peça que está aberta", cola e carrega em <b>Construir</b>.', destino: 'peca' },
  madeira: { nome: 'Projeto de madeira', placeholder: 'Ex.: uma bancada para a oficina com 1,2 m de comprimento, tenho tábuas de pinho de 2,4 m...', pos: 'No fim o Claude entrega um bloco de código. Copia-o, vai a <b>Ver projeto</b>, cola e carrega em <b>Desenhar</b>. Vês o móvel em 3D e a lista de cortes sai sozinha.', destino: 'projeto' },
  plano: { nome: 'Plano de trabalho', placeholder: 'Ex.: quero pintar e montar 6 cadeiras até ao fim do mês...', pos: 'Guarda ou imprime o plano que o Claude entregar.' },
  outro: { nome: 'Não sei bem / outra coisa', placeholder: 'Escreve o que tens em mente, mesmo que seja vago...', pos: 'Responde às perguntas do Claude uma a uma.' },
};

const REGRAS = `És um colega experiente de oficina (marcenaria e impressão 3D) e vais ajudar-me a pensar bem o que quero fazer.
Escreve em português de Portugal, com frases curtas e sem jargão. Se usares uma palavra técnica, explica-a em meia frase.

COMO QUERO QUE TRABALHES
1. Não me dês a solução logo. Primeiro faz-me perguntas, UMA de cada vez, só sobre o que falta e é mesmo importante (no máximo 6). Se eu não souber responder, sugere tu um valor sensato e diz porquê.
2. Quando tiveres o suficiente, resume numa lista curta o que percebeste e propõe 2 a 3 melhorias, com uma linha de justificação cada. Pergunta quais quero aceitar.
3. Só depois de eu confirmar, entrega o resultado final no formato indicado no fim.
4. Se o que peço não for boa ideia (frágil, não cabe, não imprime bem, material errado), diz-me com franqueza e propõe alternativa.`;

const FORMATO_JSON = `FORMATO DA ENTREGA FINAL
Nas perguntas, se a peça vai aguentar peso ou força, pergunta-me onde e em que direção.
Antes do bloco, escreve 3 linhas: medidas finais; posição para imprimir (que face fica assente na mesa e porquê; as camadas da impressão separam-se facilmente se a força as puxar uma da outra, por isso escolhe a posição em que a força fica ao longo das camadas); e se precisa de suportes.
Depois entrega UM único bloco de código com JSON (e mais nada dentro do bloco). Eu vou colá-lo numa aplicação que constrói o ficheiro STL. Regras do JSON:
- Medidas em milímetros. O eixo Z é para cima. Cada forma é posicionada pelo seu CENTRO.
- "add" junta uma forma, "sub" retira (furos, rebaixos). As operações são aplicadas pela ordem. A primeira tem de ser "add".
- Formas possíveis:
  caixa:    {"op":"add","forma":"caixa","tamanho":[X,Y,Z],"centro":[x,y,z]}
  cilindro: {"op":"add","forma":"cilindro","diametro":20,"altura":10,"eixo":"z","centro":[x,y,z]}   (eixo: x, y ou z)
  cone:     {"op":"add","forma":"cone","diametro_base":20,"diametro_topo":10,"altura":15,"eixo":"z","centro":[x,y,z]}
  esfera:   {"op":"add","forma":"esfera","diametro":20,"centro":[x,y,z]}
  Opcional em qualquer forma: "rotacao":[rx,ry,rz] em graus.
- Estrutura: {"nome":"nome da peça","operacoes":[ ... ]}
- Faz as contas das posições com cuidado e confirma que as formas se tocam/sobrepõem onde devem ficar ligadas.
- Só podes usar estas formas. Se a peça pedir curvas complexas, aproxima com estas formas e diz-me o que ficou simplificado.
- Para impressão em PLA: paredes com pelo menos 1,2 mm; folga de 0,2 a 0,3 mm entre peças que encaixam; furos saem um pouco mais pequenos, por isso soma 0,2 mm ao diâmetro; evita grandes saliências horizontais sem apoio; a face maior deve assentar na mesa.`;

const FORMATO_MADEIRA = `FORMATO DA ENTREGA FINAL
1. Resumo: o que vamos construir e as medidas finais.
2. Lista de materiais e ferragens (parafusos, cola, acabamento) com quantidades.
3. Ferramentas necessárias. Usa as que eu tenho; se faltar alguma, diz-me a alternativa.
4. Passos de montagem, numerados e curtos, pela ordem certa.
5. Erros comuns a evitar neste projeto.
6. No fim, UM único bloco de código com JSON (e mais nada dentro do bloco) com o modelo 3D do projeto. Eu colo-o numa aplicação que desenha o móvel em 3D e calcula sozinha a lista de cortes, por isso não precisas de escrever a lista de cortes à parte.

REGRAS DO JSON
- Medidas em milímetros. X = largura (esquerda para a direita), Y = profundidade (frente para trás), Z = altura (o chão é Z=0).
- "posicao" é sempre o canto da peça com o menor X, Y e Z (canto de baixo, à esquerda, à frente).
- Cada peça de madeira é uma entrada em "pecas", com "nome" (ex.: "perna", "tampo") e um "tipo":
  tabua:   {"nome":"perna","tipo":"tabua","medidas":[45,45,700],"posicao":[0,0,0]}   (medidas = [X,Y,Z])
  varao:   {"nome":"varão","tipo":"varao","diametro":25,"comprimento":800,"eixo":"x","posicao":[0,0,0]}
  perfil (peça recortada com forma própria; desenha o contorno como se olhasses para a face da peça):
           {"nome":"braço","tipo":"perfil","orientacao":"lado","espessura":20,"contorno":[[0,0],[600,0,30],[600,120,30],{"ate":[0,120],"flecha":25}],"posicao":[0,0,0]}
     · "orientacao": "frente" (vês a face de frente: contorno em X e Z, espessura em Y), "lado" (contorno em Y e Z, espessura em X), "cima" (contorno em X e Y, espessura em Z).
     · Pontos do contorno: [a,b] para um canto vivo; [a,b,raio] para arredondar esse canto; {"ate":[a,b],"flecha":f} para chegar a esse ponto em curva, em que f é quanto a curva se afasta da linha reta (positivo = para fora da peça, negativo = cavado para dentro).
     · O contorno começa em [0,0] e dá a volta à peça. Não pode cruzar-se.
     · Tampo redondo: {"nome":"tampo","tipo":"perfil","orientacao":"cima","redondo":600,"espessura":25,"posicao":[0,0,0]}
     · Furos numa peça perfil (opcional): "furos":[[a,b,diametro]]
- Opcional: "rotacao":[rx,ry,rz] em graus (roda a peça em torno do seu centro) para peças inclinadas.
- Peças iguais em fila (ripas, pernas): "repetir":{"vezes":5,"passo":[0,80,0]} em vez de as repetir.
- Ferragens (para mostrar onde vão): {"tipo":"parafuso","posicao":[x,y,z],"direcao":"-z","comprimento":40}. Tipos: parafuso, cavilha, dobradica. "posicao" é o ponto à superfície onde entra, "direcao" é para onde entra (x, y, z, -x, -y, -z). Mostra só as principais.
- Estrutura: {"nome":"nome do projeto","madeira":"pinho","pecas":[ ... ]}. Uma peça pode ter "madeira" própria.
- MUITO IMPORTANTE: faz as contas das posições com cuidado. Cada peça tem de tocar nas peças a que está ligada, sem ficar a flutuar e sem atravessar outras. Confirma as contas antes de entregar.`;

const FORMATO_PLANO = `FORMATO DA ENTREGA FINAL
1. Etapas pela ordem certa, cada uma com tempo estimado.
2. Material a comprar (com quantidades) e ferramentas necessárias.
3. Riscos ou pontos onde costuma correr mal.
4. Lista de verificação final.`;

function perfilTexto(p) {
  const l = [];
  if (p.impressora) l.push(`- Impressora 3D: ${p.impressora}${p.vx ? ` (volume de impressão ${p.vx}×${p.vy}×${p.vz} mm)` : ''}${p.bico ? `, bico ${p.bico} mm` : ''}${p.material ? `, material ${p.material}` : ''}${p.slicer ? `, software de laminação: ${p.slicer}` : ''}`);
  if (p.ferramentas?.trim()) l.push(`- Ferramentas e máquinas que tenho: ${p.ferramentas.trim()}`);
  if (p.madeiras?.trim()) l.push(`- Madeiras e materiais que uso habitualmente: ${p.madeiras.trim()}`);
  if (p.notas?.trim()) l.push(`- Outras notas: ${p.notas.trim()}`);
  return l.length ? `O MEU EQUIPAMENTO\n${l.join('\n')}` : '';
}

function pecaTexto(peca) {
  if (!peca) {
    return `A PEÇA QUE JÁ TENHO
Ainda não tens as medidas da peça. Pergunta-me o comprimento, a largura e a altura totais, e usa um sistema de coordenadas em que a peça fica centrada em X e Y e assenta em Z=0 (X para a direita, Y para trás, Z para cima).`;
  }
  const f = (v) => (Math.round(v * 100) / 100).toString();
  return `A PEÇA QUE JÁ TENHO (ficheiro STL que não consegues ver; só tens estes dados)
- Tamanho: ${f(peca.sx)} × ${f(peca.sy)} × ${f(peca.sz)} mm (X × Y × Z)
- Coordenadas ocupadas: X de ${f(peca.minx)} a ${f(peca.maxx)}, Y de ${f(peca.miny)} a ${f(peca.maxy)}, Z de ${f(peca.minz)} a ${f(peca.maxz)}
- X é para a direita, Y é para trás (a frente da peça é Y negativo), Z é para cima. A base assenta em Z=0.
- Como não vês a peça, pergunta-me onde exatamente quero cada alteração (por exemplo "a 20 mm da esquerda, a meio da largura") e converte para coordenadas.
- O JSON da entrega final só leva as ALTERAÇÕES (add/sub) a aplicar sobre esta peça, nunca a peça inteira. Põe "base":"carregada" no topo do JSON.`;
}

export function buildPrompt({ modo, texto, perfil = {}, peca = null }) {
  const partes = [REGRAS];
  const pt = perfilTexto(perfil);
  if (pt) partes.push(pt);
  if (modo === 'alterar') partes.push(pecaTexto(peca));
  partes.push(`O QUE QUERO\n${(texto || '').trim() || '(ainda não sei bem; ajuda-me a descobrir, começando por perguntar o essencial)'}`);
  if (modo === 'peca3d' || modo === 'alterar') partes.push(FORMATO_JSON);
  else if (modo === 'madeira') partes.push(FORMATO_MADEIRA);
  else if (modo === 'plano') partes.push(FORMATO_PLANO);
  else partes.push('FORMATO DA ENTREGA FINAL\nEscolhe o formato mais útil para o que pedi e explica-o em duas linhas antes de entregar.');
  partes.push('Começa agora pela primeira pergunta.');
  return partes.join('\n\n');
}
