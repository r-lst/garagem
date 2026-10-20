// Constrói peças a partir de uma especificação JSON (a que o Claude entrega) e geradores paramétricos.
import * as G from './geo.js';

const strip = (s) => String(s).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();

function normKeys(o) {
  const r = {};
  for (const [k, v] of Object.entries(o)) r[strip(k).replace(/\s+/g, '_')] = v;
  return r;
}

const FORMAS = { caixa: 'caixa', cubo: 'caixa', box: 'caixa', paralelepipedo: 'caixa', cilindro: 'cilindro', cylinder: 'cilindro', esfera: 'esfera', sphere: 'esfera', cone: 'cone' };
const OPS = { add: 'add', adicionar: 'add', unir: 'add', juntar: 'add', sub: 'sub', subtrair: 'sub', tirar: 'sub', furar: 'sub', furo: 'sub', remover: 'sub' };

function n(v, nome, i, { min = 0, max = 2000, allowZero = false } = {}) {
  if (typeof v !== 'number' || !isFinite(v)) throw new Error(`Operação ${i + 1}: "${nome}" tem de ser um número.`);
  if (allowZero ? v < min : v <= min) throw new Error(`Operação ${i + 1}: "${nome}" tem de ser maior que ${min}.`);
  if (Math.abs(v) > max) throw new Error(`Operação ${i + 1}: "${nome}" (${v}) é demasiado grande. Confirma se está em milímetros.`);
  return v;
}

function v3(v, nome, i, { positive = false, def = null } = {}) {
  if (v == null) {
    if (def) return def;
    throw new Error(`Operação ${i + 1}: falta "${nome}".`);
  }
  if (!Array.isArray(v) || v.length !== 3) throw new Error(`Operação ${i + 1}: "${nome}" tem de ter 3 números [x, y, z].`);
  return v.map((x) => (positive ? n(x, nome, i) : n(x, nome, i, { min: -Infinity, allowZero: true })));
}

/** Valida e normaliza uma operação do JSON. */
export function normalizeOp(raw, i) {
  if (!raw || typeof raw !== 'object') throw new Error(`Operação ${i + 1} inválida.`);
  const o = normKeys(raw);
  const op = OPS[strip(o.op ?? 'add')];
  if (!op) throw new Error(`Operação ${i + 1}: "op" deve ser "add" ou "sub".`);
  const forma = FORMAS[strip(o.forma ?? '')];
  if (!forma) throw new Error(`Operação ${i + 1}: forma "${o.forma}" desconhecida (usa caixa, cilindro, esfera ou cone).`);
  const r = { op, forma, centro: v3(o.centro, 'centro', i, { def: [0, 0, 0] }), rotacao: v3(o.rotacao, 'rotacao', i, { def: [0, 0, 0] }) };
  if (forma === 'caixa') r.tamanho = v3(o.tamanho, 'tamanho', i, { positive: true });
  if (forma === 'cilindro' || forma === 'esfera') {
    if (o.diametro != null) r.diametro = n(o.diametro, 'diametro', i);
    else if (o.raio != null) r.raio = n(o.raio, 'raio', i);
    else throw new Error(`Operação ${i + 1}: falta "diametro".`);
  }
  if (forma === 'cilindro') {
    r.altura = n(o.altura, 'altura', i);
    r.eixo = strip(o.eixo ?? 'z');
    if (!['x', 'y', 'z'].includes(r.eixo)) throw new Error(`Operação ${i + 1}: "eixo" deve ser x, y ou z.`);
  }
  if (forma === 'cone') {
    r.diametro_base = n(o.diametro_base, 'diametro_base', i);
    r.diametro_topo = n(o.diametro_topo ?? 0, 'diametro_topo', i, { min: 0, allowZero: true });
    r.altura = n(o.altura, 'altura', i);
    r.eixo = strip(o.eixo ?? 'z');
    if (!['x', 'y', 'z'].includes(r.eixo)) throw new Error(`Operação ${i + 1}: "eixo" deve ser x, y ou z.`);
  }
  return r;
}

/** Aplica as operações de `spec` por ordem, partindo de `base` (geometria) ou de nada. */
export function buildSpec(spec, base = null) {
  if (!spec || typeof spec !== 'object') throw new Error('Especificação inválida.');
  const raw = spec.operacoes ?? spec.operations;
  if (!Array.isArray(raw) || raw.length === 0) throw new Error('Falta a lista "operacoes".');
  if (raw.length > 300) throw new Error('Demasiadas operações (máximo 300).');
  const ops = raw.map(normalizeOp);
  let g = base ? G.clean(base) : null;
  ops.forEach((op, i) => {
    const p = G.primitive(op);
    if (!g) {
      if (op.op === 'sub') throw new Error(`Operação ${i + 1}: a primeira operação tem de ser "add" (não há nada para subtrair).`);
      g = p;
      return;
    }
    try {
      g = G.csg(g, p, op.op === 'sub' ? G.SUBTRACTION : G.ADDITION);
    } catch (e) {
      throw new Error(`Operação ${i + 1} falhou: ${e.message}`);
    }
  });
  return g;
}

/** Extrai JSON de um texto colado (com ou sem ```json). */
export function extractJSON(text) {
  let t = String(text).trim();
  const fence = t.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) t = fence[1].trim();
  else {
    const a = t.indexOf('{'), b = t.lastIndexOf('}');
    if (a >= 0 && b > a) t = t.slice(a, b + 1);
  }
  try {
    return JSON.parse(t);
  } catch (e) {
    throw new Error(`O texto colado não é JSON válido (${e.message}). Pede ao Claude: "devolve só o bloco JSON, corrigido".`);
  }
}

// ---------- Geradores paramétricos ----------
const box = (tamanho, centro) => ({ op: 'add', forma: 'caixa', tamanho, centro });
const cyl = (op, diametro, altura, eixo, centro) => ({ op, forma: 'cilindro', diametro, altura, eixo, centro });

function req(cond, msg) {
  if (!cond) throw new Error(msg);
}

export const GERADORES = {
  caixa: {
    nome: 'Caixa (aberta em cima)',
    campos: [
      { k: 'x', l: 'Comprimento (mm)', v: 80 },
      { k: 'y', l: 'Largura (mm)', v: 50 },
      { k: 'z', l: 'Altura (mm)', v: 30 },
      { k: 'parede', l: 'Espessura das paredes (mm)', v: 2 },
      { k: 'fundo', l: 'Espessura do fundo (mm)', v: 2 },
    ],
    gerar: (p) => {
      req(p.x > 2 * p.parede && p.y > 2 * p.parede, 'As paredes são demasiado grossas para estas medidas.');
      req(p.z > p.fundo, 'O fundo é mais alto que a caixa.');
      return {
        operacoes: [
          box([p.x, p.y, p.z], [0, 0, p.z / 2]),
          { op: 'sub', forma: 'caixa', tamanho: [p.x - 2 * p.parede, p.y - 2 * p.parede, p.z], centro: [0, 0, p.fundo + p.z / 2] },
        ],
      };
    },
  },
  tampa: {
    nome: 'Tampa para a caixa (com encaixe)',
    campos: [
      { k: 'x', l: 'Comprimento da caixa (mm)', v: 80 },
      { k: 'y', l: 'Largura da caixa (mm)', v: 50 },
      { k: 'parede', l: 'Espessura das paredes da caixa (mm)', v: 2 },
      { k: 'esp', l: 'Espessura da tampa (mm)', v: 2 },
      { k: 'alt', l: 'Altura do encaixe (mm)', v: 4 },
      { k: 'folga', l: 'Folga do encaixe (mm)', v: 0.3 },
    ],
    gerar: (p) => {
      const ix = p.x - 2 * p.parede - 2 * p.folga, iy = p.y - 2 * p.parede - 2 * p.folga;
      req(ix > 0 && iy > 0, 'Medidas do encaixe inválidas.');
      return { operacoes: [box([p.x, p.y, p.esp], [0, 0, p.esp / 2]), box([ix, iy, p.alt], [0, 0, p.esp + p.alt / 2])] };
    },
  },
  tubo: {
    nome: 'Tubo / anilha / espaçador',
    campos: [
      { k: 'de', l: 'Diâmetro exterior (mm)', v: 20 },
      { k: 'di', l: 'Diâmetro interior (mm)', v: 8 },
      { k: 'h', l: 'Altura (mm)', v: 10 },
    ],
    gerar: (p) => {
      req(p.di < p.de, 'O diâmetro interior tem de ser menor que o exterior.');
      return { operacoes: [cyl('add', p.de, p.h, 'z', [0, 0, p.h / 2]), cyl('sub', p.di, p.h + 2, 'z', [0, 0, p.h / 2])] };
    },
  },
  suporteL: {
    nome: 'Suporte em L com furos',
    campos: [
      { k: 'larg', l: 'Largura (mm)', v: 30 },
      { k: 'a1', l: 'Comprimento da aba horizontal (mm)', v: 50 },
      { k: 'a2', l: 'Altura da aba vertical (mm)', v: 50 },
      { k: 'esp', l: 'Espessura (mm)', v: 4 },
      { k: 'furo', l: 'Diâmetro dos furos (mm)', v: 5 },
    ],
    gerar: (p) => {
      req(p.furo < p.larg, 'O furo é maior que a largura.');
      req(p.a1 - p.esp > p.furo && p.a2 - p.esp > p.furo, 'As abas são curtas demais para o furo.');
      return {
        operacoes: [
          box([p.a1, p.larg, p.esp], [p.a1 / 2, 0, p.esp / 2]),
          box([p.esp, p.larg, p.a2], [p.esp / 2, 0, p.a2 / 2]),
          cyl('sub', p.furo, p.esp + 2, 'z', [p.esp + (p.a1 - p.esp) / 2, 0, p.esp / 2]),
          cyl('sub', p.furo, p.esp + 2, 'x', [p.esp / 2, 0, p.esp + (p.a2 - p.esp) / 2]),
        ],
      };
    },
  },
  placa: {
    nome: 'Placa com 4 furos nos cantos',
    campos: [
      { k: 'x', l: 'Comprimento (mm)', v: 80 },
      { k: 'y', l: 'Largura (mm)', v: 60 },
      { k: 'esp', l: 'Espessura (mm)', v: 4 },
      { k: 'furo', l: 'Diâmetro dos furos (mm)', v: 4 },
      { k: 'margem', l: 'Distância do furo à borda (mm)', v: 8 },
    ],
    gerar: (p) => {
      req(p.margem > p.furo / 2, 'A margem é pequena demais para o furo.');
      req(p.x / 2 > p.margem && p.y / 2 > p.margem, 'A margem é grande demais para a placa.');
      const hx = p.x / 2 - p.margem, hy = p.y / 2 - p.margem;
      const ops = [box([p.x, p.y, p.esp], [0, 0, p.esp / 2])];
      for (const sx of [-1, 1]) for (const sy of [-1, 1]) ops.push(cyl('sub', p.furo, p.esp + 2, 'z', [sx * hx, sy * hy, p.esp / 2]));
      return { operacoes: ops };
    },
  },
};
