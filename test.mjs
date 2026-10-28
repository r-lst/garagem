import * as THREE from 'three';
import { STLExporter } from 'three/examples/jsm/exporters/STLExporter.js';
import { STLLoader } from 'three/examples/jsm/loaders/STLLoader.js';
import * as G from './src/geo.js';
import { GERADORES, buildSpec, extractJSON } from './src/shapes.js';
import { parseLines, planCuts } from './src/cuts.js';
import { buildPrompt } from './src/prompts.js';

let fails = 0;
const ok = (c, m) => { console.log((c ? '✓ ' : '✗ ') + m); if (!c) fails++; };
const near = (a, b, t = 0.05) => Math.abs(a - b) <= t;

// Geradores
for (const [k, g] of Object.entries(GERADORES)) {
  const p = Object.fromEntries(g.campos.map((c) => [c.k, c.v]));
  const geo = G.placeOnBed(buildSpec(g.gerar(p)));
  const s = G.stats(geo);
  const b = G.bbox(geo);
  ok(s.closed && s.volume > 0, `${k}: malha fechada, ${s.tris} tris, vol ${(s.volume / 1000).toFixed(2)} cm³, ${b.size.toArray().map((v) => v.toFixed(1)).join('×')}`);
}

// Volume exato da caixa: 80*50*30 - 76*46*30(+fundo..)  -> 80*50*30 - 76*46*28
const cx = buildSpec(GERADORES.caixa.gerar({ x: 80, y: 50, z: 30, parede: 2, fundo: 2 }));
ok(near(G.stats(cx).volume, 80 * 50 * 30 - 76 * 46 * 28, 1), `volume da caixa ${G.stats(cx).volume.toFixed(1)} vs ${80 * 50 * 30 - 76 * 46 * 28}`);

// Esfera e cone
const esf = buildSpec({ operacoes: [{ op: 'add', forma: 'esfera', diametro: 20 }, { op: 'add', forma: 'cone', diametro_base: 20, diametro_topo: 0, altura: 15, centro: [0, 0, 20] }] });
ok(G.stats(esf).closed, 'esfera + cone (ponta) fechada');

// Operações do editor sobre um bloco 40x30x20
let blk = G.placeOnBed(buildSpec({ operacoes: [{ op: 'add', forma: 'caixa', tamanho: [40, 30, 20] }] }));
let h = G.addHole(blk, { axis: 'z', d: 6, a: 20, b: 15 });
ok(near(G.stats(h).volume, 40 * 30 * 20 - Math.PI * 9 * 20, 8) && G.stats(h).closed, `furo passante: vol ${G.stats(h).volume.toFixed(0)}`);
let hb = G.addHole(blk, { axis: 'z', d: 6, a: 20, b: 15, depth: 8, from: 'topo' });
ok(near(G.stats(hb).volume, 40 * 30 * 20 - Math.PI * 9 * 8, 8), `furo cego 8 mm: vol ${G.stats(hb).volume.toFixed(0)}`);
let hx = G.addHole(blk, { axis: 'x', d: 6, a: 15, b: 10 });
ok(near(G.stats(hx).volume, 40 * 30 * 20 - Math.PI * 9 * 40, 10), 'furo em X');
let c1 = G.cut(blk, { axis: 'x', pos: 15, keep: 'baixo' });
let c2 = G.cut(blk, { axis: 'x', pos: 15, keep: 'cima' });
ok(near(G.bbox(c1).size.x, 15) && near(G.bbox(c2).size.x, 25) && G.stats(c1).closed && G.stats(c2).closed, 'corte em duas partes 15 + 25');
let bs = G.addBase(blk, { margin: 3, thick: 2 });
ok(near(G.bbox(bs).size.x, 46) && near(G.bbox(bs).size.z, 22) && G.stats(bs).closed, `base plana: ${G.bbox(bs).size.toArray().join('×')}`);
let sc = G.scaleAxes(blk, 2, 1, 0.5);
ok(near(G.bbox(sc).size.x, 80) && near(G.bbox(sc).size.z, 10), 'escala');
let mr = G.mirror(G.addHole(blk, { axis: 'z', d: 6, a: 10, b: 10 }), 'x');
ok(G.stats(mr).volume > 0 && G.stats(mr).closed, 'espelho mantém volume positivo');
let rt = G.rotate(blk, 'y', 90);
ok(near(G.bbox(rt).size.x, 20) && near(G.bbox(rt).size.z, 40), 'rodar 90° em Y');

// STL ida e volta
const ex = new STLExporter().parse(new THREE.Mesh(h), { binary: true });
const buf = ex.buffer.slice(ex.byteOffset, ex.byteOffset + ex.byteLength);
const back = G.clean(new STLLoader().parse(buf));
ok(near(G.stats(back).volume, G.stats(h).volume, 1) && G.stats(back).closed, `STL binário ida e volta (${ex.byteLength} bytes)`);
// e voltar a furar o que veio do STL
const again = G.addHole(back, { axis: 'y', d: 4, a: 10, b: 10 });
ok(G.stats(again).closed, 'furar peça lida de STL');

// JSON do Claude
const spec = extractJSON('Aqui vai:\n```json\n{"nome":"x","operacoes":[{"op":"add","forma":"caixa","tamanho":[10,10,10]},{"op":"sub","forma":"cilindro","diâmetro":4,"altura":20,"eixo":"z"}]}\n```\nBoa sorte');
ok(G.stats(buildSpec(spec)).closed, 'JSON com acentos e cercas de código');
try { buildSpec({ operacoes: [{ op: 'sub', forma: 'caixa', tamanho: [1, 1, 1] }] }); ok(false, 'devia falhar'); } catch (e) { ok(/primeira operação/.test(e.message), 'erro: ' + e.message); }
try { buildSpec({ operacoes: [{ op: 'add', forma: 'caixa', tamanho: [1, 1, 100000] }] }); ok(false, 'devia falhar'); } catch (e) { ok(/demasiado grande/.test(e.message), 'erro: ' + e.message); }
try { extractJSON('isto não é json'); ok(false, 'devia falhar'); } catch (e) { ok(/JSON válido/.test(e.message), 'erro JSON'); }

// Cortes
const pl = parseLines('tampo; 1200; 2\nperna; 700; 4\n500 x 3\n450\nrodapé 300 2\nlixo sem medida', 1);
ok(pl.pieces.length === 5 && pl.errors.length === 1, `parse: ${pl.pieces.map((p) => p.nome + ':' + p.len + 'x' + p.qty).join(', ')}`);
const plan = planCuts(pl.pieces, { board: 2400, kerf: 3, trim: 0 });
const tot = plan.boards.reduce((s, b) => s + b.items.length, 0);
ok(tot === 2 + 4 + 3 + 1 + 2 && plan.boards.every((b) => b.resto >= -1e-6), `plano: ${plan.count} tábuas, ${plan.aproveitamento.toFixed(1)}% aproveitamento`);
ok(planCuts([{ nome: 'a', len: 3000, qty: 1 }], { board: 2400 }).oversize.length === 1, 'peça maior que a tábua');
const exact = planCuts([{ nome: 'a', len: 1200, qty: 2 }], { board: 2403, kerf: 3 });
ok(exact.count === 1, 'duas de 1200 com serra de 3 mm cabem em 2403');

// Prompts
const pr = buildPrompt({ modo: 'alterar', texto: 'furo de 6 mm', perfil: { impressora: 'Creality K1', vx: 220, vy: 220, vz: 250, material: 'PLA' }, peca: { sx: 40, sy: 30, sz: 20, minx: -20, maxx: 20, miny: -15, maxy: 15, minz: 0, maxz: 20 } });
ok(/40 × 30 × 20/.test(pr) && /carregada/.test(pr) && /Creality K1/.test(pr), 'prompt alterar inclui medidas e perfil');
ok(/lista de cortes/i.test(buildPrompt({ modo: 'madeira', texto: 'x' })), 'prompt madeira');
const prep = buildPrompt({ modo: 'reparacao', texto: 'a torneira pinga', area: 'Canalização' });
ok(/fotos/.test(prep) && /disjuntor/.test(prep) && /técnico de gás/.test(prep) && /É sobre: Canalização/.test(prep) && /Passos para a causa mais provável/.test(prep), 'prompt reparação: fotos, quadro, gás, área, formato');
ok(!/JSON/.test(prep) && !/O QUE QUERO/.test(prep), 'prompt reparação: sem JSON');
const pf = buildPrompt({ modo: 'reparacao', texto: 'a torneira pinga', fotos: 'Torneira cromada, marca ACME 35' });
ok(/O QUE SE VÊ NAS FOTOS/.test(pf) && /ACME 35/.test(pf) && pf.indexOf('A AVARIA') < pf.indexOf('O QUE SE VÊ NAS FOTOS'), 'prompt reparação: leva a descrição das fotos depois da avaria');
ok(!/NAS FOTOS/.test(prep) && !/NAS FOTOS/.test(buildPrompt({ modo: 'madeira', texto: 'x', fotos: 'abc' })), 'sem fotos (ou fora das reparações) não há secção de fotos');
ok(!/Impressora/.test(buildPrompt({ modo: 'reparacao', texto: 'x', perfil: { impressora: 'Creality K1', ferramentas: 'berbequim' } })) && /berbequim/.test(buildPrompt({ modo: 'reparacao', texto: 'x', perfil: { impressora: 'Creality K1', ferramentas: 'berbequim' } })), 'prompt reparação: leva as ferramentas, não a impressora');
ok(/posição para imprimir/.test(buildPrompt({ modo: 'peca3d', texto: 'x' })) && /onde e em que direção/.test(buildPrompt({ modo: 'peca3d', texto: 'x' })), 'prompt peça 3D: pergunta a força e diz a posição');

// Caber na K1 (220 × 220 × 250)
const K1 = { x: 220, y: 220, z: 250 };
const bloco = (x, y, z) => G.placeOnBed(buildSpec({ operacoes: [{ op: 'add', forma: 'caixa', tamanho: [x, y, z] }] }));
const tam = (g) => !g ? "nada" : G.bbox(g).size.toArray().map((v) => Math.round(v));
const exc = G.excessos({ x: 100, y: 230, z: 280 }, K1);
ok(exc.length === 2 && exc[0].eixo === 'y' && near(exc[1].aMais, 30) && exc[1].nome === 'Altura (Z)', 'excessos: largura +10 e altura +30');
ok(G.excessos({ x: 220.005, y: 220, z: 250 }, K1).length === 0, 'excessos: 0,005 mm a mais não conta');
let rc = G.rodarParaCaber(bloco(100, 50, 30), K1);
ok(rc && rc.como === null, 'já cabe: não roda');
rc = G.rodarParaCaber(bloco(60, 40, 260), K1);
ok(rc && /Virei/.test(rc.como) && !G.excessos(G.bbox(rc.geo).size, K1).length && near(G.bbox(rc.geo).min.z, 0), `260 de altura: vira (${tam(rc?.geo)})`);
rc = G.rodarParaCaber(bloco(100, 230, 30), K1);
ok(rc && /Virei/.test(rc.como) && !G.excessos(G.bbox(rc.geo).size, K1).length, `100 × 230 × 30: na diagonal não cabe (233 mm), fica de pé (${tam(rc?.geo)})`);
rc = G.rodarParaCaber(bloco(230, 20, 30), K1);
ok(rc && /diagonal/.test(rc.como) && /mesma face/.test(rc.como) && near(G.bbox(rc.geo).size.z, 30) && !G.excessos(G.bbox(rc.geo).size, K1).length, `230 × 20 × 30: diagonal, mesma face (${tam(rc?.geo)})`);
rc = G.rodarParaCaber(bloco(240, 30, 10), K1);
ok(rc && /mesma face/.test(rc.como) && near(G.bbox(rc.geo).size.z, 10), `barra 240 × 30 × 10: fica deitada, não de pé (${tam(rc?.geo)})`);
ok(G.rodarParaCaber(bloco(300, 100, 30), K1) === null, '300 × 100 × 30: não cabe de nenhuma forma');
rc = G.rodarParaCaber(bloco(300, 20, 10), K1);
ok(rc && /diagonal/.test(rc.como) && !G.excessos(G.bbox(rc.geo).size, K1).length, `300 de comprido: na diagonal (${tam(rc?.geo)}) — ${rc?.como}`);
ok(G.rodarParaCaber(bloco(240, 240, 240), K1) === null, '240 × 240 × 240: não cabe de forma nenhuma');
ok(G.rodarParaCaber(bloco(400, 20, 10), K1) === null, '400 de comprido: nem na diagonal');

// Melhor posição para imprimir
const mesa = G.placeOnBed(buildSpec({ operacoes: [{ op: 'add', forma: 'caixa', tamanho: [10, 10, 40], centro: [0, 0, 20] }, { op: 'add', forma: 'caixa', tamanho: [60, 60, 5], centro: [0, 0, 42.5] }] }));
let mp = G.melhorPosicao(mesa, K1);
ok(mp.mudou && mp.antes.suporte > 3000 && mp.depois.suporte < 50 && near(mp.depois.base, 3600, 5), `"mesa" de pé: vira ao contrário (suporte ${Math.round(mp.antes.suporte)} → ${Math.round(mp.depois.suporte)} mm², mesa ${Math.round(mp.antes.base)} → ${Math.round(mp.depois.base)} mm²)`);
ok(near(G.bbox(mp.geo).min.z, 0) && !G.excessos(G.bbox(mp.geo).size, K1).length, 'fica assente e dentro da K1');
mp = G.melhorPosicao(bloco(10, 50, 100), K1);
ok(mp.mudou && near(mp.depois.altura, 10) && near(mp.depois.base, 5000, 5), `tábua de pé: deita (altura ${Math.round(mp.antes.altura)} → ${Math.round(mp.depois.altura)} mm)`);
mp = G.melhorPosicao(bloco(100, 50, 10), K1);
ok(!mp.mudou && near(mp.depois.base, 5000, 5), 'tábua deitada: já está na melhor posição');
mp = G.melhorPosicao(bloco(300, 30, 10), K1);
ok(mp && !G.excessos(G.bbox(mp.geo).size, K1).length, `300 de comprido: escolhe uma posição que cabe (${tam(mp?.geo)})`);
ok(G.melhorPosicao(bloco(400, 300, 20), K1) === null, 'grande demais: sem posição');

console.log(fails ? `\n${fails} FALHAS` : '\nTudo OK');
process.exit(fails ? 1 : 0);
