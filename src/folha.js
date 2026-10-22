// Folha de cortes para imprimir (A4, preto e branco, letra grande). Sem DOM: devolve HTML.
// 1. Comprar (tábuas, varões, placas, ferragens) · 2. Cortar (lista para riscar) · 3. Como cortar cada tábua

const MESES = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const num = (v, d = 0) => (Math.round(v * 10 ** d) / 10 ** d).toString().replace('.', ',');
const ehVarao = (nome) => /^var[aã]o/i.test(nome || '');
const unidade = (nome, n) => (ehVarao(nome) ? (n === 1 ? 'varão' : 'varões') : n === 1 ? 'tábua' : 'tábuas');
const CX = '<span class="cx"></span>';

/**
 * @param o.titulo   nome do projeto (ou vazio para uma lista escrita à mão)
 * @param o.medidas  [x, y, z] em mm, ou null
 * @param o.madeira  texto, ou ''
 * @param o.plans    resultado de planGroups (comprimentos em mm)
 * @param o.f        1 = mm, 10 = cm (como no separador Cortes)
 * @param o.extra    {placas, ferragens} do projeto, ou null
 * @param o.data     ms
 */
export function folhaCortes({ titulo = '', medidas = null, madeira = '', plans, f = 1, extra = null, data = Date.now() }) {
  const u = f === 10 ? 'cm' : 'mm';
  const show = (mm) => num(mm / f, f === 10 ? 1 : 0);
  const d = new Date(data);
  const kerf = plans[0]?.kerf || 0;
  let h = '<header class="ft-cab">';
  h += `<h1>${titulo ? esc(titulo) + ' — ' : ''}folha de cortes</h1><span class="ft-data">${d.getDate()} ${MESES[d.getMonth()]} ${d.getFullYear()}</span>`;
  const sub = [medidas ? medidas.map((v) => num(v)).join(' × ') + ' mm' : '', madeira].filter(Boolean).join(' · ');
  if (sub) h += `<p class="ft-sub">${esc(sub)}</p>`;
  h += '</header>';

  // 1. Comprar
  h += '<section><h2>1. Comprar</h2><ul class="ft-lista">';
  for (const p of plans) {
    if (!p.count) continue;
    const nome = p.nome || 'Tábuas';
    h += `<li>${CX}<span class="ft-o">${esc(nome)}</span><span class="ft-q">${p.count} ${unidade(p.nome, p.count)} de ${show(p.board)} ${u}</span></li>`;
  }
  for (const p of extra?.placas || []) {
    const mad = p.madeira && p.madeira !== madeira ? ` (${p.madeira})` : '';
    h += `<li>${CX}<span class="ft-o">Placa ${num(p.espessura)} mm${esc(mad)}: ${esc(p.nome)}${p.recorte ? ' (recortar)' : ''}</span><span class="ft-q">${num(p.comprimento)} × ${num(p.largura)} mm${p.qty > 1 ? ` × ${p.qty}` : ''}</span></li>`;
  }
  for (const fe of extra?.ferragens || []) h += `<li>${CX}<span class="ft-o">${esc(fe.nome)}</span><span class="ft-q">${fe.qty}</span></li>`;
  h += '</ul>';
  const fora = plans.flatMap((p) => p.oversize.map((i) => `${i.nome} (${show(i.len)} ${u})`));
  if (fora.length) h += `<p class="ft-aviso">Atenção: maiores do que a tábua, não estão nas contas: ${esc([...new Set(fora)].join(', '))}.</p>`;
  if (extra?.ferragens?.length) h += '<p class="ft-nota">Ferragens: só as que estão no desenho. Confirma na lista de materiais do Claude.</p>';
  h += '</section>';
  if (!plans.some((p) => p.count)) return h;

  // 2. Cortar
  h += `<section><h2>2. Cortar${kerf > 0 ? ` <small>(conta com ${num(kerf, 1)} mm de serra)</small>` : ''}</h2>`;
  for (const p of plans) {
    if (!p.count) continue;
    const grupos = new Map();
    p.boards.forEach((b, i) => b.items.forEach((it) => {
      const k = it.nome + '|' + it.len;
      if (!grupos.has(k)) grupos.set(k, { nome: it.nome, len: it.len, n: 0, tabuas: new Set() });
      const g = grupos.get(k);
      g.n++; g.tabuas.add(i + 1);
    }));
    h += `<div class="ft-grupo">${p.nome ? `<h3>${esc(p.nome)}</h3>` : ''}<table class="ft-tab"><tr><th></th><th>Peça</th><th>Medida</th><th>Qtd</th><th>${ehVarao(p.nome) ? 'Varão' : 'Tábua'} nº</th></tr>`;
    for (const g of grupos.values()) h += `<tr><td>${CX}</td><td>${esc(g.nome)}</td><td>${show(g.len)} ${u}</td><td>${g.n}</td><td>${[...g.tabuas].join(', ')}</td></tr>`;
    h += '</table></div>';
  }
  h += '</section>';

  // 3. Como cortar
  h += '<section class="ft-plano"><h2>3. Como cortar cada tábua</h2>';
  for (const p of plans) {
    p.boards.forEach((b, i) => {
      const sobra = b.resto + (p.board - p.cap);
      const segs = b.items.map((it) => {
        const w = (it.len / p.board) * 100;
        return `<div class="ft-peca" style="width:${w}%">${w >= 8 ? `<b>${esc(it.nome)}</b>` : ''}<span>${show(it.len)}</span></div>`;
      }).join('');
      h += `<div class="ft-tabua"><div class="ft-tit">${esc(p.nome || 'Tábua')} nº ${i + 1} <span>· sobra ${show(sobra)} ${u}</span></div><div class="ft-barra">${segs}<div class="ft-sobra"></div></div></div>`;
    });
  }
  h += '</section>';
  return h;
}
