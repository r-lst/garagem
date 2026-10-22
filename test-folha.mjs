import * as P from './src/project.js';
import { parseLines, planGroups } from './src/cuts.js';
import { folhaCortes } from './src/folha.js';

let fails = 0;
const ok = (c, m) => { console.log((c ? '✓ ' : '✗ ') + m); if (!c) fails++; };
const conta = (txt, s) => txt.split(s).length - 1;

const proj = P.parseProject(P.EXEMPLO_PROJETO);
const cl = P.cutList(proj);
const { groups } = parseLines(P.cutListText(cl), 1);
const plans = planGroups(groups, { board: 2400, kerf: 3 });
const h = folhaCortes({ titulo: 'Mesa de centro', medidas: [1000, 550, 450], madeira: 'pinho', plans, f: 1, extra: { placas: cl.placas, ferragens: cl.ferragens }, data: Date.UTC(2026, 9, 22, 12) });

ok(h.includes('Mesa de centro — folha de cortes') && h.includes('22 out 2026'), 'cabeçalho com nome e data');
ok(h.includes('1000 × 550 × 450 mm · pinho'), 'medidas totais e madeira');
for (const p of plans) ok(h.includes(`${p.nome}</span><span class="ft-q">${p.count} ${p.count === 1 ? 'tábua' : 'tábuas'} de 2400 mm`), `comprar: ${p.nome} → ${p.count}`);
ok(h.includes('Placa 25 mm: tampo (recortar)') && h.includes('1000 × 550 mm'), 'comprar: placa do tampo, recortada');
ok(h.includes('Placa 18 mm: prateleira') && h.includes('830 × 380 mm'), 'comprar: placa da prateleira');
ok(/Parafuso[^<]*<\/span><span class="ft-q">4</.test(h), 'comprar: 4 parafusos');
ok(h.includes('travessa curta (recortar)'), 'cortar: marca o que é para recortar');
ok(h.includes('(conta com 3 mm de serra)'), 'cortar: indica o corte da serra');
const nTabuas = plans.reduce((s, p) => s + p.count, 0);
ok(conta(h, 'class="ft-tabua"') === nTabuas, `como cortar: uma barra por tábua (${nTabuas})`);
ok(conta(h, 'class="cx"') === plans.length + cl.placas.length + cl.ferragens.length + plans.reduce((s, p) => s + new Set(p.boards.flatMap((b) => b.items.map((i) => i.nome + i.len))).size, 0), 'uma caixa para riscar por linha');

// lista escrita à mão, em cm, com varão e uma peça maior que a tábua
const m = parseLines('# Varão Ø20 mm\ncabide; 90; 3\n# Tábua 90×20 mm\nprateleira; 300; 1', 10);
const pm = planGroups(m.groups, { board: 2400, kerf: 0 });
const hm = folhaCortes({ plans: pm, f: 10 });
ok(hm.startsWith('<header class="ft-cab"><h1>folha de cortes</h1>'), 'sem projeto: título simples');
ok(hm.includes('2 varões de 240 cm') && hm.includes('Varão nº'), 'varões contam como varões, em cm');
ok(hm.includes('prateleira (300 cm)') && hm.includes('Atenção'), 'avisa peças maiores do que a tábua');
ok(!hm.includes('Placa') && !hm.includes('Ferragens') && !hm.includes('de serra'), 'sem placas, ferragens nem serra quando não há');
const hx = folhaCortes({ titulo: '<script>x</script>', plans: planGroups(parseLines('<b>; 100; 1').groups, { board: 2400 }) });
ok(!hx.includes('<script>') && !hx.includes('<b>;') && hx.includes('&lt;b&gt;'), 'nomes escapados');

console.log(fails ? `\n${fails} falha(s)` : '\nTudo OK');
process.exit(fails ? 1 : 0);
