// Projetos de madeira: lê a especificação JSON (peças), cria geometria para visualizar e deriva a lista de cortes.
// Unidades: mm. X = largura (esquerda→direita), Y = profundidade (frente→trás), Z = altura.
import * as THREE from 'three';

const strip = (s) => String(s).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
function normKeys(o) {
  const r = {};
  for (const [k, v] of Object.entries(o)) r[strip(k).replace(/\s+/g, '_')] = v;
  return r;
}

const TIPOS = {
  tabua: 'tabua', placa: 'tabua', ripa: 'tabua', barrote: 'tabua', prancha: 'tabua', caixa: 'tabua',
  varao: 'varao', cilindro: 'varao', tubo: 'varao', cabo: 'varao',
  perfil: 'perfil', recorte: 'perfil', contorno: 'perfil',
  parafuso: 'parafuso', prego: 'parafuso', cavilha: 'cavilha', dobradica: 'dobradica', ferragem: 'parafuso',
};
const FERRAGENS = new Set(['parafuso', 'cavilha', 'dobradica']);

export const MADEIRAS = {
  pinho: '#e3c08d', carvalho: '#c99a62', nogueira: '#8a5d3b', castanho: '#a8774a', faia: '#ddb48a', eucalipto: '#c79470',
  contraplacado: '#e8cc9c', mdf: '#c9a982', aglomerado: '#cdb48c', cerejeira: '#b8734c', tola: '#c9905e', sucupira: '#8f5f3a', mogno: '#9a5636', branco: '#f1ede4', preto: '#3a3530',
};
export function corMadeira(nome) {
  const n = strip(nome || '');
  for (const [k, v] of Object.entries(MADEIRAS)) if (n.includes(k)) return v;
  return MADEIRAS.pinho;
}

class SpecError extends Error {}
const err = (i, nome, msg) => new SpecError(`Peça ${i + 1}${nome ? ` (${nome})` : ''}: ${msg}`);

function num(v, campo, i, nome, { min = 0, allowZero = false, max = 20000 } = {}) {
  if (typeof v === 'string' && v.trim() !== '' && !isNaN(Number(v.replace(',', '.')))) v = Number(v.replace(',', '.'));
  if (typeof v !== 'number' || !isFinite(v)) throw err(i, nome, `"${campo}" tem de ser um número.`);
  if (allowZero ? v < min : v <= min) throw err(i, nome, `"${campo}" tem de ser maior que ${min}.`);
  if (Math.abs(v) > max) throw err(i, nome, `"${campo}" (${v}) é demasiado grande. Confirma se está em milímetros.`);
  return v;
}
function vec(v, campo, i, nome, { positive = false, def } = {}) {
  if (v == null) {
    if (def) return def;
    throw err(i, nome, `falta "${campo}".`);
  }
  if (!Array.isArray(v) || v.length !== 3) throw err(i, nome, `"${campo}" tem de ter 3 números [x, y, z].`);
  return v.map((x) => (positive ? num(x, campo, i, nome) : num(x, campo, i, nome, { min: -Infinity, allowZero: true })));
}
const EIXOS = ['x', 'y', 'z'];
function dir(v, i, nome, def = 'z') {
  const s = strip(v ?? def).replace(/\s/g, '');
  const m = s.match(/^([+-]?)([xyz])$/);
  if (!m) throw err(i, nome, `"direcao" deve ser x, y, z, -x, -y ou -z.`);
  const d = [0, 0, 0];
  d[EIXOS.indexOf(m[2])] = m[1] === '-' ? -1 : 1;
  return d;
}

// ---------- Contornos ----------
function sub(a, b) { return [a[0] - b[0], a[1] - b[1]]; }
function len(a) { return Math.hypot(a[0], a[1]); }
function norm(a) { const l = len(a) || 1; return [a[0] / l, a[1] / l]; }
function signedArea(pts) {
  let s = 0;
  for (let i = 0; i < pts.length; i++) { const a = pts[i], b = pts[(i + 1) % pts.length]; s += a[0] * b[1] - b[0] * a[1]; }
  return s / 2;
}

/** Lê o contorno: [a,b], [a,b,raioCanto] ou {"ate":[a,b],"flecha":f}. Devolve pontos amostrados. */
export function contourPoints(raw, i, nome) {
  if (!Array.isArray(raw) || raw.length < 3) throw err(i, nome, '"contorno" precisa de pelo menos 3 pontos.');
  const verts = raw.map((p, k) => {
    if (Array.isArray(p)) {
      if (p.length < 2) throw err(i, nome, `ponto ${k + 1} do contorno inválido.`);
      return { p: [num(p[0], 'contorno', i, nome, { min: -Infinity, allowZero: true }), num(p[1], 'contorno', i, nome, { min: -Infinity, allowZero: true })], r: p[2] != null ? num(p[2], 'raio do canto', i, nome, { min: 0, allowZero: true }) : 0, f: 0 };
    }
    if (p && typeof p === 'object') {
      const o = normKeys(p);
      const ate = o.ate ?? o.ponto ?? o.para;
      if (!Array.isArray(ate) || ate.length < 2) throw err(i, nome, `ponto ${k + 1}: o arco precisa de "ate":[a,b].`);
      return { p: [num(ate[0], 'contorno', i, nome, { min: -Infinity, allowZero: true }), num(ate[1], 'contorno', i, nome, { min: -Infinity, allowZero: true })], r: 0, f: num(o.flecha ?? o.curva ?? 0, 'flecha', i, nome, { min: -Infinity, allowZero: true }) };
    }
    throw err(i, nome, `ponto ${k + 1} do contorno inválido.`);
  });
  // remove último ponto se repetir o primeiro
  const a0 = verts[0].p, aN = verts[verts.length - 1].p;
  if (verts.length > 3 && Math.abs(a0[0] - aN[0]) < 1e-6 && Math.abs(a0[1] - aN[1]) < 1e-6 && !verts[verts.length - 1].f) verts.pop();
  const base = verts.map((v) => v.p);
  const area = signedArea(base);
  if (Math.abs(area) < 1e-6) throw err(i, nome, 'o contorno não tem área (os pontos estão todos em linha?).');
  const ccw = area > 0;
  const n = verts.length;
  const out = [];
  for (let k = 0; k < n; k++) {
    const v = verts[k];
    const prev = verts[(k - 1 + n) % n].p, next = verts[(k + 1) % n];
    // aresta que chega a este vértice (de prev para v.p): pode ser arco
    if (v.f) {
      const P0 = prev, P1 = v.p;
      const c = len(sub(P1, P0));
      if (c > 1e-9) {
        const s = Math.abs(v.f);
        const t = norm(sub(P1, P0));
        const left = [-t[1], t[0]];
        // para fora: lado direito se o contorno for anti-horário
        const outward = ccw ? [-left[0], -left[1]] : left;
        const side = v.f > 0 ? outward : [-outward[0], -outward[1]];
        const R = (c * c / 4 + s * s) / (2 * s);
        const M = [(P0[0] + P1[0]) / 2, (P0[1] + P1[1]) / 2];
        const C = [M[0] - side[0] * (R - s), M[1] - side[1] * (R - s)];
        const ang = (P) => Math.atan2(P[1] - C[1], P[0] - C[0]);
        let a0 = ang(P0), a1 = ang(P1);
        const apex = [M[0] + side[0] * s, M[1] + side[1] * s];
        const aA = ang(apex);
        // escolher o sentido de varrimento que passa pelo ápice
        const norm2 = (x) => { while (x < 0) x += 2 * Math.PI; while (x >= 2 * Math.PI) x -= 2 * Math.PI; return x; };
        const ccwSweep = norm2(a1 - a0);
        const apexOnCcw = norm2(aA - a0) < ccwSweep;
        const sweep = apexOnCcw ? ccwSweep : -norm2(a0 - a1);
        const segs = Math.max(6, Math.min(48, Math.ceil(Math.abs(sweep) / (Math.PI / 24))));
        for (let j = 1; j < segs; j++) {
          const a = a0 + (sweep * j) / segs;
          out.push([C[0] + R * Math.cos(a), C[1] + R * Math.sin(a), 'arc']);
        }
      }
    }
    // canto arredondado neste vértice (só entre arestas retas)
    if (v.r > 0 && !v.f && !next.f) {
      const P = v.p;
      const u1 = norm(sub(prev, P)), u2 = norm(sub(next.p, P));
      const cosT = u1[0] * u2[0] + u1[1] * u2[1];
      const theta = Math.acos(Math.max(-1, Math.min(1, cosT)));
      if (theta > 1e-3 && theta < Math.PI - 1e-3) {
        let tdist = v.r / Math.tan(theta / 2);
        const maxT = Math.min(len(sub(prev, P)), len(sub(next.p, P))) / 2;
        let r = v.r;
        if (tdist > maxT) { tdist = maxT; r = tdist * Math.tan(theta / 2); }
        const A = [P[0] + u1[0] * tdist, P[1] + u1[1] * tdist];
        const B = [P[0] + u2[0] * tdist, P[1] + u2[1] * tdist];
        const bis = norm([u1[0] + u2[0], u1[1] + u2[1]]);
        const dC = r / Math.sin(theta / 2);
        const C = [P[0] + bis[0] * dC, P[1] + bis[1] * dC];
        let a0 = Math.atan2(A[1] - C[1], A[0] - C[0]), a1 = Math.atan2(B[1] - C[1], B[0] - C[0]);
        let sw = a1 - a0;
        while (sw > Math.PI) sw -= 2 * Math.PI;
        while (sw < -Math.PI) sw += 2 * Math.PI;
        const segs = 10;
        for (let j = 0; j <= segs; j++) {
          const a = a0 + (sw * j) / segs;
          out.push([C[0] + r * Math.cos(a), C[1] + r * Math.sin(a), 'arc']);
        }
        continue;
      }
    }
    out.push([v.p[0], v.p[1]]);
  }
  return out.map((p) => [p[0], p[1]]);
}

function segsCross(a, b, c, d) {
  const o = (p, q, r) => (q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0]);
  const d1 = o(c, d, a), d2 = o(c, d, b), d3 = o(a, b, c), d4 = o(a, b, d);
  return ((d1 > 1e-9 && d2 < -1e-9) || (d1 < -1e-9 && d2 > 1e-9)) && ((d3 > 1e-9 && d4 < -1e-9) || (d3 < -1e-9 && d4 > 1e-9));
}
export function selfIntersects(pts) {
  const n = pts.length;
  for (let i = 0; i < n; i++) {
    const a = pts[i], b = pts[(i + 1) % n];
    for (let j = i + 2; j < n; j++) {
      if (i === 0 && j === n - 1) continue;
      if (segsCross(a, b, pts[j], pts[(j + 1) % n])) return true;
    }
  }
  return false;
}

function circlePts(d) {
  const r = d / 2, n = 72, out = [];
  for (let k = 0; k < n; k++) { const a = (2 * Math.PI * k) / n; out.push([r + r * Math.cos(a), r + r * Math.sin(a)]); }
  return out;
}

// ---------- Leitura da especificação ----------
/** Normaliza o JSON do projeto. Devolve {nome, madeira, pecas:[...], avisos:[...]}. */
export function parseProject(spec) {
  if (!spec || typeof spec !== 'object') throw new SpecError('Especificação inválida.');
  const s = normKeys(spec);
  const raw = s.pecas ?? s.pieces ?? s.operacoes;
  if (!Array.isArray(raw) || !raw.length) throw new SpecError('Falta a lista "pecas".');
  if (raw.length > 400) throw new SpecError('Demasiadas peças (máximo 400).');
  const madeiraGeral = s.madeira || 'pinho';
  const avisos = [];
  const pecas = raw.map((r, i) => {
    if (!r || typeof r !== 'object') throw err(i, '', 'inválida.');
    const o = normKeys(r);
    const nome = String(o.nome ?? '').trim();
    const tipo = TIPOS[strip(o.tipo ?? (o.contorno || o.redondo ? 'perfil' : o.diametro && !o.medidas ? 'varao' : 'tabua'))];
    if (!tipo) throw err(i, nome, `tipo "${o.tipo}" desconhecido (usa tabua, varao, perfil, parafuso, cavilha ou dobradica).`);
    const p = { i, nome: nome || tipo, tipo, madeira: o.madeira || madeiraGeral, rotacao: vec(o.rotacao, 'rotacao', i, nome, { def: [0, 0, 0] }) };
    p.posicao = vec(o.posicao ?? o.centro, 'posicao', i, nome, { def: FERRAGENS.has(tipo) ? undefined : [0, 0, 0] });
    if (tipo === 'tabua') p.medidas = vec(o.medidas ?? o.tamanho, 'medidas', i, nome, { positive: true });
    else if (tipo === 'varao') {
      p.diametro = num(o.diametro, 'diametro', i, nome);
      p.comprimento = num(o.comprimento ?? o.altura, 'comprimento', i, nome);
      p.eixo = strip(o.eixo ?? 'z');
      if (!EIXOS.includes(p.eixo)) throw err(i, nome, '"eixo" deve ser x, y ou z.');
    } else if (tipo === 'perfil') {
      p.espessura = num(o.espessura, 'espessura', i, nome);
      p.orientacao = strip(o.orientacao ?? 'frente');
      if (!['frente', 'lado', 'cima'].includes(p.orientacao)) throw err(i, nome, '"orientacao" deve ser frente, lado ou cima.');
      if (o.redondo != null || o.circulo != null) p.pts = circlePts(num(o.redondo ?? o.circulo, 'redondo', i, nome));
      else p.pts = contourPoints(o.contorno, i, nome);
      if (selfIntersects(p.pts)) avisos.push(`Peça ${i + 1} (${p.nome}): o contorno cruza-se a si próprio. O desenho pode sair estranho; pede ao Claude para rever os pontos.`);
      p.furos = [];
      if (Array.isArray(o.furos)) {
        o.furos.forEach((f, k) => {
          if (!Array.isArray(f) || f.length < 3) throw err(i, nome, `furo ${k + 1} deve ser [a, b, diametro].`);
          p.furos.push([num(f[0], 'furos', i, nome, { min: -Infinity, allowZero: true }), num(f[1], 'furos', i, nome, { min: -Infinity, allowZero: true }), num(f[2], 'furos', i, nome)]);
        });
      }
    } else {
      p.direcao = dir(o.direcao ?? o.eixo, i, nome, tipo === 'dobradica' ? 'y' : 'z');
      p.comprimento = o.comprimento != null ? num(o.comprimento, 'comprimento', i, nome) : tipo === 'parafuso' ? 40 : tipo === 'cavilha' ? 30 : 60;
      p.diametro = o.diametro != null ? num(o.diametro, 'diametro', i, nome) : tipo === 'parafuso' ? 4 : tipo === 'cavilha' ? 8 : 40;
      p.nome = nome || { parafuso: 'parafuso', cavilha: 'cavilha', dobradica: 'dobradiça' }[tipo];
    }
    const rep = o.repetir ? normKeys(o.repetir) : null;
    p.vezes = 1;
    p.passo = [0, 0, 0];
    if (rep) {
      p.vezes = Math.round(num(rep.vezes ?? rep.quantidade, 'repetir.vezes', i, nome, { max: 200 }));
      p.passo = vec(rep.passo ?? rep.espaco, 'repetir.passo', i, nome);
    }
    return p;
  });
  return { nome: s.nome || 'Projeto', madeira: madeiraGeral, pecas, avisos };
}

// ---------- Geometria ----------
const ORIENT = {
  // forma no plano local (a,b), extrusão em +Z local → mundo
  frente: new THREE.Matrix4().set(1, 0, 0, 0, 0, 0, -1, 0, 0, 1, 0, 0, 0, 0, 0, 1),
  lado: new THREE.Matrix4().set(0, 0, 1, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 1),
  cima: new THREE.Matrix4(),
};

function placeAtCorner(g, pos, rot) {
  g.computeBoundingBox();
  const b = g.boundingBox;
  const size = b.getSize(new THREE.Vector3());
  // centrar, rodar em torno do centro, colocar com o canto mínimo (antes de rodar) em pos
  g.translate(-(b.min.x + size.x / 2), -(b.min.y + size.y / 2), -(b.min.z + size.z / 2));
  if (rot.some((r) => r)) {
    const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(...rot.map((d) => THREE.MathUtils.degToRad(d)), 'XYZ'));
    g.applyQuaternion(q);
  }
  g.translate(pos[0] + size.x / 2, pos[1] + size.y / 2, pos[2] + size.z / 2);
  return g;
}

function pieceGeometry(p) {
  let g;
  if (p.tipo === 'tabua') g = new THREE.BoxGeometry(...p.medidas);
  else if (p.tipo === 'varao') {
    g = new THREE.CylinderGeometry(p.diametro / 2, p.diametro / 2, p.comprimento, 32);
    if (p.eixo === 'x') g.rotateZ(Math.PI / 2);
    else if (p.eixo === 'z') g.rotateX(Math.PI / 2);
  } else if (p.tipo === 'perfil') {
    const shape = new THREE.Shape(p.pts.map((q) => new THREE.Vector2(q[0], q[1])));
    for (const [a, b, d] of p.furos) {
      const h = new THREE.Path();
      h.absarc(a, b, d / 2, 0, Math.PI * 2, true);
      shape.holes.push(h);
    }
    g = new THREE.ExtrudeGeometry(shape, { depth: p.espessura, bevelEnabled: false, curveSegments: 24 });
    g.applyMatrix4(ORIENT[p.orientacao]);
  } else return hardwareGeometry(p);
  return placeAtCorner(g, p.posicao, p.rotacao);
}

/** Ferragens: a posição é o ponto à superfície; a peça entra no sentido de "direcao". */
function hardwareGeometry(p) {
  const d = new THREE.Vector3(...p.direcao);
  const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), d);
  let g;
  if (p.tipo === 'parafuso') {
    const shaft = new THREE.CylinderGeometry(p.diametro / 2, p.diametro / 4, p.comprimento, 12);
    shaft.translate(0, p.comprimento / 2, 0);
    const head = new THREE.CylinderGeometry(p.diametro, p.diametro * 0.9, p.diametro * 0.6, 16);
    head.translate(0, -p.diametro * 0.3, 0);
    g = mergeGeos([shaft, head]);
  } else if (p.tipo === 'cavilha') {
    g = new THREE.CylinderGeometry(p.diametro / 2, p.diametro / 2, p.comprimento, 16);
  } else {
    // dobradiça: duas abas finas
    const w = p.comprimento, h = p.diametro;
    const a = new THREE.BoxGeometry(h, w, 2); a.translate(-h / 2, 0, 0);
    const b = new THREE.BoxGeometry(h, w, 2); b.translate(h / 2, 0, 0);
    const pin = new THREE.CylinderGeometry(2.5, 2.5, w, 12);
    g = mergeGeos([a, b, pin]);
  }
  g.applyQuaternion(q);
  g.translate(...p.posicao);
  return g;
}

function mergeGeos(list) {
  const pos = [];
  const idx = [];
  let off = 0;
  for (const g0 of list) {
    const g = g0.index ? g0 : g0;
    const P = g.getAttribute('position');
    for (let k = 0; k < P.count; k++) pos.push(P.getX(k), P.getY(k), P.getZ(k));
    const I = g.index ? g.index.array : [...Array(P.count).keys()];
    for (const v of I) idx.push(v + off);
    off += P.count;
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  out.setIndex(idx);
  out.computeVertexNormals();
  return out;
}

/** Expande repetições e devolve [{peca, copia, geometry}] */
export function buildItems(proj) {
  const items = [];
  for (const p of proj.pecas) {
    const base = pieceGeometry(p);
    for (let k = 0; k < p.vezes; k++) {
      const g = k === 0 ? base : base.clone();
      if (k) g.translate(p.passo[0] * k, p.passo[1] * k, p.passo[2] * k);
      g.computeVertexNormals();
      g.computeBoundingBox();
      items.push({ peca: p, copia: k, geometry: g, ferragem: FERRAGENS.has(p.tipo) });
    }
  }
  return items;
}

export function assemblyBox(items) {
  const b = new THREE.Box3();
  for (const it of items) if (!it.ferragem) b.union(it.geometry.boundingBox);
  if (b.isEmpty()) for (const it of items) b.union(it.geometry.boundingBox);
  return b;
}

/** Avisos de peças soltas (não tocam em nenhuma outra). */
export function floatingPieces(items, tol = 1.5) {
  const wood = items.filter((x) => !x.ferragem);
  if (wood.length < 2) return [];
  const out = [];
  wood.forEach((a, i) => {
    const ba = a.geometry.boundingBox.clone().expandByScalar(tol);
    const touches = wood.some((b, j) => j !== i && ba.intersectsBox(b.geometry.boundingBox));
    const onFloor = a.geometry.boundingBox.min.z <= assemblyBox(items).min.z + tol;
    if (!touches && !onFloor) out.push(a);
  });
  return out;
}

// ---------- Lista de cortes ----------
const r1 = (v) => Math.round(v * 10) / 10;
const LARGURA_PLACA = 250;

export function cutList(proj) {
  const grupos = new Map();
  const placas = [];
  const ferragens = new Map();
  const add = (seccao, nome, comprimento, qty, recorte = false) => {
    if (!grupos.has(seccao)) grupos.set(seccao, new Map());
    const g = grupos.get(seccao);
    const k = nome + '|' + r1(comprimento) + '|' + recorte;
    const cur = g.get(k) || { nome, comprimento: r1(comprimento), qty: 0, recorte };
    cur.qty += qty;
    g.set(k, cur);
  };
  for (const p of proj.pecas) {
    const q = p.vezes;
    const mad = strip(p.madeira) !== strip(proj.madeira) ? ` ${p.madeira}` : '';
    if (p.tipo === 'tabua') {
      const [L, W, T] = [...p.medidas].sort((a, b) => b - a);
      if (W >= LARGURA_PLACA) placas.push({ nome: p.nome, comprimento: r1(L), largura: r1(W), espessura: r1(T), qty: q, madeira: p.madeira });
      else add(`Tábua ${r1(W)}×${r1(T)} mm${mad}`, p.nome, L, q);
    } else if (p.tipo === 'varao') {
      add(`Varão Ø${r1(p.diametro)} mm${mad}`, p.nome, p.comprimento, q);
    } else if (p.tipo === 'perfil') {
      const xs = p.pts.map((v) => v[0]), ys = p.pts.map((v) => v[1]);
      const a = Math.max(...xs) - Math.min(...xs), b = Math.max(...ys) - Math.min(...ys);
      const L = Math.max(a, b), W = Math.min(a, b);
      if (W >= LARGURA_PLACA) placas.push({ nome: p.nome, comprimento: r1(L), largura: r1(W), espessura: r1(p.espessura), qty: q, madeira: p.madeira, recorte: true });
      else add(`Tábua ${r1(W)}×${r1(p.espessura)} mm${mad}`, p.nome, L, q, true);
    } else {
      const nome = p.tipo === 'dobradica' ? `Dobradiça ${r1(p.comprimento)} mm` : `${p.tipo === 'parafuso' ? 'Parafuso' : 'Cavilha'} ${r1(p.diametro)}×${r1(p.comprimento)} mm`;
      ferragens.set(nome, (ferragens.get(nome) || 0) + q);
    }
  }
  return {
    grupos: [...grupos.entries()].map(([seccao, m]) => ({ seccao, pecas: [...m.values()].sort((a, b) => b.comprimento - a.comprimento) })),
    placas,
    ferragens: [...ferragens.entries()].map(([nome, qty]) => ({ nome, qty })),
  };
}

/** Texto para o separador Cortes (um grupo por secção). */
export function cutListText(cl) {
  return cl.grupos.map((g) => `# ${g.seccao}\n` + g.pecas.map((p) => `${p.nome}${p.recorte ? ' (recortar)' : ''}; ${p.comprimento}; ${p.qty}`).join('\n')).join('\n\n');
}

export const EXEMPLO_PROJETO = {
  nome: 'Mesa de centro',
  madeira: 'pinho',
  pecas: [
    { nome: 'tampo', tipo: 'perfil', orientacao: 'cima', espessura: 25, contorno: [[0, 0, 40], [1000, 0, 40], [1000, 550, 40], [0, 550, 40]], posicao: [0, 0, 425] },
    { nome: 'perna', tipo: 'tabua', medidas: [45, 45, 425], posicao: [40, 40, 0], repetir: { vezes: 2, passo: [875, 0, 0] } },
    { nome: 'perna', tipo: 'tabua', medidas: [45, 45, 425], posicao: [40, 465, 0], repetir: { vezes: 2, passo: [875, 0, 0] } },
    { nome: 'travessa comprida', tipo: 'tabua', medidas: [830, 20, 90], posicao: [85, 45, 335] },
    { nome: 'travessa comprida', tipo: 'tabua', medidas: [830, 20, 90], posicao: [85, 485, 335] },
    { nome: 'travessa curta', tipo: 'perfil', orientacao: 'lado', espessura: 20, contorno: [[0, 0], { ate: [380, 0], flecha: -25 }, [380, 90], [0, 90]], posicao: [57, 85, 335], repetir: { vezes: 2, passo: [866, 0, 0] } },
    { nome: 'prateleira', tipo: 'tabua', medidas: [830, 380, 18], posicao: [85, 85, 120] },
    { nome: 'apoio da prateleira', tipo: 'tabua', medidas: [20, 380, 30], posicao: [65, 85, 90], repetir: { vezes: 2, passo: [850, 0, 0] } },
    { tipo: 'parafuso', posicao: [62, 62, 450], direcao: '-z', comprimento: 50, repetir: { vezes: 2, passo: [875, 0, 0] } },
    { tipo: 'parafuso', posicao: [62, 487, 450], direcao: '-z', comprimento: 50, repetir: { vezes: 2, passo: [875, 0, 0] } },
  ],
};
