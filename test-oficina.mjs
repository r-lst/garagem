import * as P from './src/project.js';
import * as H from './src/historico.js';
import { listasOficina, progresso } from './src/oficina.js';
import { paraFicheiros } from './src/sync.js';

let fails = 0;
const ok = (c, m) => { console.log((c ? '✓ ' : '✗ ') + m); if (!c) fails++; };

const l = listasOficina(P.EXEMPLO_PROJETO);
const linhas = l.cortar.flatMap((g) => g.itens);
ok(l.nome === 'Mesa de centro' && l.medidas.map(Math.round).join('×') === '1000×550×450' && l.madeira === 'pinho', 'nome, medidas e madeira');
ok(l.cortar.map((g) => g.grupo).join(' | ') === 'Tábua 45×45 mm | Tábua 90×20 mm | Tábua 30×20 mm | Placas', 'cortar: agrupado por tábua, placas no fim');
ok(linhas.length === 6 && linhas.find((i) => i.nome === 'perna').qty === 4 && linhas.find((i) => i.nome === 'travessa curta').recorte, 'cortar: 6 linhas, 4 pernas, travessa curta recortada');
ok(linhas.find((i) => i.nome === 'tampo').medida === '1000 × 550 × 25 mm', 'placa com espessura');
ok(new Set(linhas.map((i) => i.chave)).size === linhas.length && new Set(l.comprar.map((i) => i.chave)).size === l.comprar.length, 'chaves únicas');
ok(l.comprar.length === 6 && l.comprar[1].qtd === '2 tábuas de 2400 mm' && l.comprar.at(-1).qtd === '4', 'comprar: 3 tábuas, 2 placas, parafusos');
const l3 = listasOficina(P.EXEMPLO_PROJETO, { board: 3000 });
ok(l3.comprar[1].chave === l.comprar[1].chave && l3.cortar[1].itens[0].chave === l.cortar[1].itens[0].chave, 'chaves não mudam com o comprimento da tábua');

// riscar
let L = H.registarProjeto([], P.EXEMPLO_PROJETO, 1000).lista;
const id = L[0].id;
L = H.marcarOficina(L, id, 'cortar', linhas[0].chave, true, 1100);
L = H.marcarOficina(L, id, 'cortar', linhas[1].chave, true, 1200);
L = H.marcarOficina(L, id, 'comprar', l.comprar[0].chave, true, 1300);
let e = L[0];
ok(progresso(linhas, e.oficina.cortar).feitos === 2 && progresso(l.comprar, e.oficina.comprar).feitos === 1 && e.atualizado === 1300, 'riscar: 2 cortes e 1 compra');
L = H.marcarOficina(L, id, 'cortar', linhas[0].chave, false, 1400);
ok(progresso(linhas, L[0].oficina.cortar).feitos === 1, 'desfazer um risco');
ok(H.juntar([e], L).find((x) => x.id === id).atualizado === 1400, 'o mais recente ganha ao juntar');
ok(paraFicheiros(L)[`historico/${id}.json`].oficina.cortar[linhas[1].chave] === true, 'o que foi riscado vai na cópia online');

console.log(fails ? `\n${fails} falha(s)` : '\nTudo OK');
process.exit(fails ? 1 : 0);
