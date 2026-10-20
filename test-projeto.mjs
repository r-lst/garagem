import * as P from './src/project.js';
import { parseLines, planGroups } from './src/cuts.js';

let fails = 0;
const ok = (c, m) => { console.log((c ? '✓ ' : '✗ ') + m); if (!c) fails++; };

const proj = P.parseProject(P.EXEMPLO_PROJETO);
const items = P.buildItems(proj);
ok(items.length === 16, `exemplo: ${items.length} itens`);
const box = P.assemblyBox(items);
const s = box.getSize(new (box.min.constructor)());
ok(Math.round(s.x) === 1000 && Math.round(s.y) === 550 && Math.round(s.z) === 450, `conjunto ${s.x.toFixed(0)}×${s.y.toFixed(0)}×${s.z.toFixed(0)}`);
ok(P.floatingPieces(items).length === 0, `peças soltas: ${P.floatingPieces(items).map((x) => x.peca.nome).join(', ') || 'nenhuma'}`);
const cl = P.cutList(proj);
console.log(JSON.stringify(cl, null, 0));
ok(cl.placas.some((p) => p.nome === 'tampo' && p.recorte) && cl.placas.some((p) => p.nome === 'prateleira'), 'tampo e prateleira como placas');
ok(cl.ferragens[0].qty === 4, 'parafusos: 4');
const txt = P.cutListText(cl);
console.log(txt);
const pl = parseLines(txt, 1);
ok(pl.errors.length === 0 && pl.groups.length === cl.grupos.length, `parse grupos: ${pl.groups.map((g) => g.nome + ':' + g.pieces.length).join(' | ')}`);
const plans = planGroups(pl.groups, { board: 2400, kerf: 3 });
ok(plans.every((p) => p.count >= 1), `planos: ${plans.map((p) => p.nome + '=' + p.count).join(', ')}`);

// contornos
const sq = P.contourPoints([[0, 0, 10], [100, 0, 10], [100, 50, 10], [0, 50, 10]], 0, 't');
const xs = sq.map((p) => p[0]), ys = sq.map((p) => p[1]);
ok(Math.min(...xs) > -1e-6 && Math.max(...xs) < 100 + 1e-6 && Math.max(...ys) < 50 + 1e-6 && sq.length > 30, `cantos redondos: ${sq.length} pts, dentro da caixa`);
const arcOut = P.contourPoints([[0, 0], [100, 0], [100, 50], { ate: [0, 50], flecha: 20 }], 0, 't');
ok(Math.abs(Math.max(...arcOut.map((p) => p[1])) - 70) < 0.5, `arco para fora: topo em ${Math.max(...arcOut.map((p) => p[1])).toFixed(1)} (esperado 70)`);
const arcOutCW = P.contourPoints([[0, 0], [0, 50], { ate: [100, 50], flecha: 20 }, [100, 0]], 0, 't');
ok(Math.abs(Math.max(...arcOutCW.map((p) => p[1])) - 70) < 0.5, `arco para fora (sentido horário): ${Math.max(...arcOutCW.map((p) => p[1])).toFixed(1)}`);
const arcIn = P.contourPoints([[0, 0], [100, 0], [100, 50], { ate: [0, 50], flecha: -20 }], 0, 't');
const mid = arcIn.filter((p) => Math.abs(p[0] - 50) < 3);
ok(mid.length && Math.abs(Math.min(...mid.map((p) => p[1])) - 30) < 1, `arco para dentro: meio em ${mid.length ? Math.min(...mid.map((p) => p[1])).toFixed(1) : '?'}`);
ok(P.selfIntersects([[0, 0], [100, 100], [100, 0], [0, 100]]), 'deteta contorno cruzado');
ok(!P.selfIntersects(sq), 'contorno normal não cruza');

// perfil orientações e posição
for (const o of ['frente', 'lado', 'cima']) {
  const pr = P.parseProject({ pecas: [{ tipo: 'perfil', orientacao: o, espessura: 20, contorno: [[0, 0], [300, 0], [300, 100], [0, 100]], posicao: [10, 20, 30] }] });
  const it = P.buildItems(pr)[0].geometry.boundingBox;
  const sz = [it.max.x - it.min.x, it.max.y - it.min.y, it.max.z - it.min.z].map((v) => Math.round(v));
  const exp = { frente: [300, 20, 100], lado: [20, 300, 100], cima: [300, 100, 20] }[o];
  ok(sz.join() === exp.join() && Math.round(it.min.x) === 10 && Math.round(it.min.y) === 20 && Math.round(it.min.z) === 30, `perfil ${o}: ${sz.join('×')} em ${[it.min.x, it.min.y, it.min.z].map(Math.round)}`);
}
// erros
for (const [spec, re] of [
  [{ pecas: [] }, /Falta a lista/],
  [{ pecas: [{ tipo: 'mesa' }] }, /desconhecido/],
  [{ pecas: [{ tipo: 'tabua', medidas: [1, 2] }] }, /3 números/],
  [{ pecas: [{ tipo: 'perfil', espessura: 10, contorno: [[0, 0], [1, 1]] }] }, /3 pontos/],
  [{ pecas: [{ tipo: 'tabua', medidas: [100, 100, 99999] }] }, /demasiado grande/],
]) {
  try { P.parseProject(spec); ok(false, 'devia falhar ' + re); } catch (e) { ok(re.test(e.message), 'erro: ' + e.message); }
}
// placa redonda
const rd = P.parseProject({ pecas: [{ nome: 'tampo', tipo: 'perfil', orientacao: 'cima', redondo: 600, espessura: 25, furos: [[300, 300, 40]] }] });
ok(Math.round(P.buildItems(rd)[0].geometry.boundingBox.max.x) === 600, 'tampo redondo com furo');

console.log(fails ? `\n${fails} FALHAS` : '\nTudo OK');
process.exit(fails ? 1 : 0);
