// Calculadora de cortes (1D): aproveita tábuas de comprimento fixo com o mínimo de desperdício.

const toNum = (s) => parseFloat(String(s).replace(',', '.'));

/** Lê linhas do tipo "nome; 800; 2", "800 x 2", "800*2", "tampo 800 2", "800". */
/** Linhas começadas por "#" abrem um grupo (ex.: "# Tábua 90×20 mm"). Devolve {pieces, groups, errors}. */
export function parseLines(text, factor = 1) {
  const pieces = [];
  const errors = [];
  const groups = [];
  let cur = null;
  String(text).split(/\r?\n/).forEach((raw, i) => {
    const line = raw.trim();
    if (!line || line.startsWith('//')) return;
    if (line.startsWith('#')) {
      cur = { nome: line.replace(/^#+\s*/, '') || 'Tábuas', pieces: [] };
      groups.push(cur);
      return;
    }
    if (!cur) { cur = { nome: '', pieces: [] }; groups.push(cur); }
    let nome = '', len, qty = 1, m;
    const toks = line.split(/[;\t|]/).map((t) => t.trim()).filter((t) => t !== '');
    if (toks.length >= 2) {
      nome = toks[0];
      len = toNum(toks[1].replace(/mm|cm/gi, ''));
      if (toks[2] != null) qty = parseInt(toks[2], 10);
    } else if ((m = line.match(/^([\d.,]+)\s*(?:mm|cm)?\s*(?:[x*×]\s*(\d+))?$/i))) {
      len = toNum(m[1]);
      if (m[2]) qty = parseInt(m[2], 10);
    } else if ((m = line.match(/^(.*?)\s+([\d.,]+)\s*(?:mm|cm)?\s*(?:[x*×]?\s*(\d+))?$/i))) {
      nome = m[1].trim();
      len = toNum(m[2]);
      if (m[3]) qty = parseInt(m[3], 10);
    } else {
      errors.push(`Linha ${i + 1} não percebida: "${line}"`);
      return;
    }
    if (!(len > 0) || !(qty >= 1)) {
      errors.push(`Linha ${i + 1} com medida ou quantidade inválida: "${line}"`);
      return;
    }
    const pc = { nome: nome || 'peça', len: len * factor, qty };
    pieces.push(pc);
    cur.pieces.push(pc);
  });
  return { pieces, errors, groups: groups.filter((g) => g.pieces.length) };
}

function pack(items, cap, kerf, best) {
  const bins = [];
  for (const it of items) {
    let target = null;
    let bestLeft = Infinity;
    for (const b of bins) {
      const need = b.sum + (b.items.length ? kerf : 0) + it.len;
      if (need <= cap + 1e-9) {
        const left = cap - need;
        if (!best) { target = b; break; }
        if (left < bestLeft) { bestLeft = left; target = b; }
      }
    }
    if (!target) {
      target = { items: [], sum: 0 };
      bins.push(target);
    }
    target.sum += (target.items.length ? kerf : 0) + it.len;
    target.items.push(it);
  }
  return bins;
}

export function planCuts(pieces, { board, kerf = 0, trim = 0 }) {
  if (!(board > 0)) throw new Error('Indica o comprimento da tábua.');
  const cap = board - 2 * trim;
  const items = [];
  for (const p of pieces) for (let i = 0; i < p.qty; i++) items.push({ nome: p.nome, len: p.len });
  const oversize = items.filter((i) => i.len > cap + 1e-9);
  const fit = items.filter((i) => i.len <= cap + 1e-9).sort((a, b) => b.len - a.len);
  const a = pack(fit, cap, kerf, false);
  const b = pack(fit, cap, kerf, true);
  const bins = b.length < a.length ? b : a;
  const boards = bins.map((x) => ({ items: x.items, used: x.sum, resto: cap - x.sum }));
  const totalPieces = fit.reduce((s, i) => s + i.len, 0);
  const totalBoards = boards.length * board;
  return {
    boards,
    cap,
    board,
    kerf,
    oversize,
    count: boards.length,
    pecas: fit.length,
    aproveitamento: totalBoards ? (totalPieces / totalBoards) * 100 : 0,
    sobra: totalBoards - totalPieces,
  };
}

export function planGroups(groups, opts) {
  return groups.map((g) => ({ nome: g.nome, ...planCuts(g.pieces, opts) }));
}
