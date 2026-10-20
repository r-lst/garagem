// Operações de geometria (sem DOM). Unidades: mm. Eixo Z para cima.
import * as THREE from 'three';
import { mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { Brush, Evaluator, SUBTRACTION, ADDITION } from 'three-bvh-csg';

export { SUBTRACTION, ADDITION };
export const AXIS = { x: 0, y: 1, z: 2 };

/** Malha limpa: só posições, vértices soldados, sem triângulos degenerados, normais calculadas. */
export function clean(src, tol = 1e-4) {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', src.getAttribute('position').clone());
  if (src.index) g.setIndex(src.index.clone());
  const m = mergeVertices(g, tol);
  const idx = m.index.array;
  const out = [];
  for (let i = 0; i < idx.length; i += 3) {
    const a = idx[i], b = idx[i + 1], c = idx[i + 2];
    if (a !== b && b !== c && a !== c) out.push(a, b, c);
  }
  m.setIndex(out);
  m.computeVertexNormals();
  return m;
}

export function bbox(g) {
  g.computeBoundingBox();
  const b = g.boundingBox;
  return { min: b.min.clone(), max: b.max.clone(), size: b.getSize(new THREE.Vector3()), center: b.getCenter(new THREE.Vector3()) };
}

function applied(g, m) {
  const c = g.clone();
  c.applyMatrix4(m);
  return c;
}

function aboutCenter(g, m) {
  const c = bbox(g).center;
  const full = new THREE.Matrix4().makeTranslation(c.x, c.y, c.z).multiply(m).multiply(new THREE.Matrix4().makeTranslation(-c.x, -c.y, -c.z));
  return full;
}

function flipWinding(g) {
  const a = g.index.array;
  for (let i = 0; i < a.length; i += 3) {
    const t = a[i + 1]; a[i + 1] = a[i + 2]; a[i + 2] = t;
  }
  g.index.needsUpdate = true;
  return g;
}

/** Escala (fatores por eixo) em torno do centro da peça. */
export function scaleAxes(g, sx, sy, sz) {
  for (const s of [sx, sy, sz]) if (!(s > 0) || !isFinite(s)) throw new Error('Medida inválida.');
  const r = applied(g, aboutCenter(g, new THREE.Matrix4().makeScale(sx, sy, sz)));
  r.computeVertexNormals();
  return r;
}

export function mirror(g, axis) {
  const s = [1, 1, 1];
  s[AXIS[axis]] = -1;
  const r = applied(g, aboutCenter(g, new THREE.Matrix4().makeScale(...s)));
  flipWinding(r);
  r.computeVertexNormals();
  return r;
}

export function rotate(g, axis, deg) {
  const a = THREE.MathUtils.degToRad(deg);
  const m = axis === 'x' ? new THREE.Matrix4().makeRotationX(a) : axis === 'y' ? new THREE.Matrix4().makeRotationY(a) : new THREE.Matrix4().makeRotationZ(a);
  const r = applied(g, aboutCenter(g, m));
  r.computeVertexNormals();
  return r;
}

/** Centra em XY na origem e assenta a face mais baixa em Z=0. */
export function placeOnBed(g) {
  const b = bbox(g);
  return applied(g, new THREE.Matrix4().makeTranslation(-b.center.x, -b.center.y, -b.min.z));
}

/** Contagem de triângulos, volume (mm³) e se a malha está fechada (sem buracos que se vejam). */
export function stats(g) {
  const p = g.getAttribute('position');
  const idx = g.index.array;
  let vol = 0, area = 0;
  const sum = new THREE.Vector3();
  const edges = new Map();
  const N = p.count;
  const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3(), t1 = new THREE.Vector3(), t2 = new THREE.Vector3();
  for (let i = 0; i < idx.length; i += 3) {
    a.fromBufferAttribute(p, idx[i]); b.fromBufferAttribute(p, idx[i + 1]); c.fromBufferAttribute(p, idx[i + 2]);
    vol += a.dot(t1.copy(b).cross(c)) / 6;
    t1.copy(b).sub(a); t2.copy(c).sub(a);
    t1.cross(t2).multiplyScalar(0.5);
    sum.add(t1);
    area += t1.length();
    for (let k = 0; k < 3; k++) {
      const u = idx[i + k], v = idx[i + (k + 1) % 3];
      const key = u < v ? u * N + v : v * N + u;
      edges.set(key, (edges.get(key) || 0) + 1);
    }
  }
  let open = 0;
  for (const n of edges.values()) if (n !== 2) open++;
  // Numa superfície fechada a soma dos vetores de área é zero. As booleanas deixam ruído minúsculo
  // nas arestas (que os slicers fundem sozinhos), por isso avaliamos pelo balanço de área e não aresta a aresta.
  const balance = area > 0 ? sum.length() / area : 1;
  return { tris: idx.length / 3, volume: Math.abs(vol), closed: open === 0 || balance < 1e-4, strictClosed: open === 0, openEdges: open, balance };
}

/** Solda junções em T: parte triângulos cujas arestas têm vértices de outros triângulos a meio. */
export function repairTJunctions(g, tol = 1e-4, passes = 6) {
  const pos = g.getAttribute('position');
  const P = pos.array;
  const N = pos.count;
  let idx = Array.from(g.index.array);
  const CELL = 1;
  for (let pass = 0; pass < passes; pass++) {
    const count = new Map();
    const key = (u, v) => (u < v ? u * N + v : v * N + u);
    for (let i = 0; i < idx.length; i += 3) {
      for (let k = 0; k < 3; k++) {
        const kk = key(idx[i + k], idx[i + (k + 1) % 3]);
        count.set(kk, (count.get(kk) || 0) + 1);
      }
    }
    const open = [];
    const cand = new Set();
    for (let i = 0; i < idx.length; i += 3) {
      for (let k = 0; k < 3; k++) {
        const u = idx[i + k], v = idx[i + (k + 1) % 3];
        if (count.get(key(u, v)) === 1) { open.push([i, k, u, v]); cand.add(u); cand.add(v); }
      }
    }
    if (!open.length) break;
    const grid = new Map();
    const cellOf = (x) => Math.floor(x / CELL);
    for (const w of cand) {
      const ck = `${cellOf(P[3 * w])},${cellOf(P[3 * w + 1])},${cellOf(P[3 * w + 2])}`;
      let arr = grid.get(ck);
      if (!arr) grid.set(ck, (arr = []));
      arr.push(w);
    }
    const candArr = [...cand];
    const splits = new Map(); // triângulo -> {k, ws}
    for (const [i, k, u, v] of open) {
      if (splits.has(i)) continue;
      const ux = P[3 * u], uy = P[3 * u + 1], uz = P[3 * u + 2];
      const dx = P[3 * v] - ux, dy = P[3 * v + 1] - uy, dz = P[3 * v + 2] - uz;
      const len2 = dx * dx + dy * dy + dz * dz;
      if (len2 < 1e-12) continue;
      const lo = [Math.min(ux, P[3 * v]) - tol, Math.min(uy, P[3 * v + 1]) - tol, Math.min(uz, P[3 * v + 2]) - tol];
      const hi = [Math.max(ux, P[3 * v]) + tol, Math.max(uy, P[3 * v + 1]) + tol, Math.max(uz, P[3 * v + 2]) + tol];
      const nc = (cellOf(hi[0]) - cellOf(lo[0]) + 1) * (cellOf(hi[1]) - cellOf(lo[1]) + 1) * (cellOf(hi[2]) - cellOf(lo[2]) + 1);
      let pool;
      if (nc > 2000) pool = candArr;
      else {
        pool = [];
        for (let a = cellOf(lo[0]); a <= cellOf(hi[0]); a++) for (let b = cellOf(lo[1]); b <= cellOf(hi[1]); b++) for (let c = cellOf(lo[2]); c <= cellOf(hi[2]); c++) {
          const arr = grid.get(`${a},${b},${c}`);
          if (arr) pool.push(...arr);
        }
      }
      const found = [];
      for (const w of pool) {
        if (w === u || w === v) continue;
        const wx = P[3 * w] - ux, wy = P[3 * w + 1] - uy, wz = P[3 * w + 2] - uz;
        const t = (wx * dx + wy * dy + wz * dz) / len2;
        if (t <= 0 || t >= 1) continue;
        const px = wx - t * dx, py = wy - t * dy, pz = wz - t * dz;
        if (px * px + py * py + pz * pz > tol * tol * 4) continue;
        const tl = tol / Math.sqrt(len2);
        if (t < tl || t > 1 - tl) continue;
        found.push([t, w]);
      }
      if (found.length) {
        found.sort((a, b) => a[0] - b[0]);
        splits.set(i, { k, ws: found.map((f) => f[1]) });
      }
    }
    if (!splits.size) break;
    const out = [];
    for (let i = 0; i < idx.length; i += 3) {
      const s = splits.get(i);
      if (!s) { out.push(idx[i], idx[i + 1], idx[i + 2]); continue; }
      const p = idx[i + s.k], q = idx[i + (s.k + 1) % 3], r = idx[i + (s.k + 2) % 3];
      const chain = [p, ...s.ws, q];
      for (let j = 0; j < chain.length - 1; j++) out.push(chain[j], chain[j + 1], r);
    }
    idx = out;
  }
  g.setIndex(idx);
  return g;
}

// ---------- Booleanas ----------
const evaluator = new Evaluator();
evaluator.attributes = ['position', 'normal'];

function toBrush(g) {
  const b = new Brush(clean(g), new THREE.MeshBasicMaterial());
  b.updateMatrixWorld();
  return b;
}

export function csg(a, b, op) {
  const r = evaluator.evaluate(toBrush(a), toBrush(b), op);
  const out = repairTJunctions(clean(r.geometry));
  if (!out.getAttribute('position') || out.getAttribute('position').count === 0) throw new Error('O resultado ficou vazio.');
  return out;
}

// ---------- Primitivas ----------
const SEG = 64;

/** Cria uma forma. op = {forma, tamanho|diametro|raio|altura|eixo|diametro_base|diametro_topo, centro, rotacao} (chaves já normalizadas). */
export function primitive(op) {
  let g;
  const axis = op.eixo || 'z';
  const alongAxis = (geo) => {
    if (axis === 'x') geo.rotateY(Math.PI / 2);
    else if (axis === 'y') geo.rotateX(-Math.PI / 2);
    return geo;
  };
  switch (op.forma) {
    case 'caixa':
      g = new THREE.BoxGeometry(op.tamanho[0], op.tamanho[1], op.tamanho[2]);
      break;
    case 'cilindro': {
      const r = op.raio ?? op.diametro / 2;
      g = new THREE.CylinderGeometry(r, r, op.altura, SEG);
      g.rotateX(Math.PI / 2);
      alongAxis(g);
      break;
    }
    case 'cone': {
      g = new THREE.CylinderGeometry(op.diametro_topo / 2, op.diametro_base / 2, op.altura, SEG);
      g.rotateX(Math.PI / 2);
      alongAxis(g);
      break;
    }
    case 'esfera':
      g = new THREE.SphereGeometry(op.raio ?? op.diametro / 2, 48, 32);
      break;
    default:
      throw new Error(`Forma desconhecida: ${op.forma}`);
  }
  const [cx, cy, cz] = op.centro || [0, 0, 0];
  const rot = op.rotacao || [0, 0, 0];
  const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(...rot.map((d) => THREE.MathUtils.degToRad(d)), 'XYZ'));
  g.applyMatrix4(new THREE.Matrix4().compose(new THREE.Vector3(cx, cy, cz), q, new THREE.Vector3(1, 1, 1)));
  return clean(g);
}

// ---------- Operações para o editor ----------
/** Forma usada para fazer (ou pré-visualizar) um furo. a, b = mm desde o mínimo da peça nos outros dois eixos (por ordem x,y,z). */
export function holeCutter(g, { axis, d, a, b, depth = 0, from = 'topo' }) {
  if (!(d > 0)) throw new Error('Diâmetro do furo inválido.');
  if (!isFinite(a) || !isFinite(b)) throw new Error('Posição do furo inválida.');
  const bb = bbox(g);
  const ai = AXIS[axis];
  const others = [0, 1, 2].filter((i) => i !== ai);
  const min = bb.min.toArray(), max = bb.max.toArray();
  let len, c;
  if (depth > 0) {
    len = depth + 1;
    c = from === 'topo' ? max[ai] + 1 - len / 2 : min[ai] - 1 + len / 2;
  } else {
    len = max[ai] - min[ai] + 2;
    c = (min[ai] + max[ai]) / 2;
  }
  const centro = [0, 0, 0];
  centro[ai] = c;
  centro[others[0]] = min[others[0]] + a;
  centro[others[1]] = min[others[1]] + b;
  return primitive({ forma: 'cilindro', diametro: d, altura: len, eixo: axis, centro });
}

export function addHole(g, p) {
  return csg(g, holeCutter(g, p), SUBTRACTION);
}

/** Caixa que representa a parte a remover num corte. keep: 'baixo' mantém o lado de menor coordenada. */
export function cutterBox(g, { axis, pos, keep }) {
  if (!isFinite(pos)) throw new Error('Posição do corte inválida.');
  const bb = bbox(g);
  const ai = AXIS[axis];
  const min = bb.min.toArray(), max = bb.max.toArray();
  const size = bb.size.toArray().map((s) => s + 2);
  const centro = bb.center.toArray();
  const at = min[ai] + pos;
  let lo, hi;
  if (keep === 'baixo') { lo = at; hi = max[ai] + 1; } else { lo = min[ai] - 1; hi = at; }
  if (hi - lo <= 0) throw new Error('O corte fica fora da peça.');
  size[ai] = hi - lo;
  centro[ai] = (lo + hi) / 2;
  return primitive({ forma: 'caixa', tamanho: size, centro });
}

export function cut(g, p) {
  const bb = bbox(g);
  const len = bb.size.toArray()[AXIS[p.axis]];
  if (!(p.pos > 0 && p.pos < len)) throw new Error('A posição do corte tem de ficar dentro da peça.');
  return csg(g, cutterBox(g, p), SUBTRACTION);
}

export function addBase(g, { margin = 3, thick = 2 }) {
  if (!(thick > 0) || margin < 0) throw new Error('Medidas da base inválidas.');
  const bb = bbox(g);
  const overlap = 0.2;
  const sx = bb.size.x + 2 * margin, sy = bb.size.y + 2 * margin;
  const base = primitive({
    forma: 'caixa',
    tamanho: [sx, sy, thick + overlap],
    centro: [bb.center.x, bb.center.y, bb.min.z - thick + (thick + overlap) / 2],
  });
  return csg(g, base, ADDITION);
}
