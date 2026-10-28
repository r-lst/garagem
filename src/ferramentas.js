// Ferramentas pequenas da oficina (sem DOM): temporizador, caderno de medidas, tinta/verniz/cola e guia de madeiras.
// Tudo funciona sem rede. Os valores de rendimento e de secagem são os habituais: a embalagem manda.

const novoId = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);

// ---------- Temporizador ----------
export const CHAVE_TEMP = 'garagem_temporizadores';

/** Tempos habituais, em minutos. */
export const TEMPOS = [
  { nome: 'Cola de madeira: apertar', min: 30 },
  { nome: 'Cola de madeira: secar', min: 24 * 60 },
  { nome: 'Cola rápida ou epóxi', min: 5 },
  { nome: 'Verniz: entre demãos', min: 6 * 60 },
  { nome: 'Tinta: entre demãos', min: 4 * 60 },
  { nome: 'Óleo ou cera: absorver', min: 20 },
  { nome: 'Massa de madeira: secar', min: 60 },
];

export function carregarTemp(storage) {
  try {
    const v = JSON.parse(storage.getItem(CHAVE_TEMP) || '[]');
    return Array.isArray(v) ? v.filter((t) => t && typeof t.id === 'string' && Number.isFinite(t.fim)) : [];
  } catch { return []; }
}
export function guardarTemp(storage, lista) {
  try { storage.setItem(CHAVE_TEMP, JSON.stringify(lista)); return true; } catch { return false; }
}
/** Junta um temporizador que termina daqui a `min` minutos. */
export function iniciarTemp(lista, nome, min, agora = Date.now()) {
  const m = Number(min);
  if (!(m > 0) || m > 60 * 24 * 14) return lista;
  return [...lista, { id: novoId(), nome: String(nome || '').trim() || 'Temporizador', fim: agora + Math.round(m * 60000), min: m }];
}
export const pararTemp = (lista, id) => lista.filter((t) => t.id !== id);
/** Texto do tempo que falta: "2 h 05 min", "12 min 30 s", "40 s". */
export function restante(ms) {
  const s = Math.max(0, Math.ceil(ms / 1000));
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), r = s % 60;
  if (h >= 24) { const d = Math.floor(h / 24); return `${d} ${d === 1 ? 'dia' : 'dias'}${h % 24 ? ` ${h % 24} h` : ''}`; }
  if (h) return `${h} h ${String(m).padStart(2, '0')} min`;
  if (m) return `${m} min ${String(r).padStart(2, '0')} s`;
  return `${r} s`;
}
/** "2 h", "30 min", "1 dia": a duração escolhida, para os botões. */
export function duracao(min) {
  if (min >= 1440 && min % 1440 === 0) return `${min / 1440} ${min === 1440 ? 'dia' : 'dias'}`;
  if (min >= 60 && min % 60 === 0) return `${min / 60} h`;
  if (min >= 60) return `${Math.floor(min / 60)} h ${min % 60} min`;
  return `${min} min`;
}
export const terminados = (lista, agora = Date.now()) => lista.filter((t) => t.fim <= agora);

// ---------- Caderno de medidas ----------
export const CHAVE_MEDIDAS = 'garagem_medidas';

export function carregarMedidas(storage) {
  try {
    const v = JSON.parse(storage.getItem(CHAVE_MEDIDAS) || '[]');
    return Array.isArray(v) ? v.filter((m) => m && typeof m.id === 'string' && typeof m.nome === 'string') : [];
  } catch { return []; }
}
export function guardarMedidas(storage, lista) {
  try { storage.setItem(CHAVE_MEDIDAS, JSON.stringify(lista)); return true; } catch { return false; }
}
/** Nova medida ou, com `id`, corrige uma existente. Sem nome ou sem medida não guarda nada. */
export function guardarMedida(lista, { id, nome, medida, nota = '' }, agora = Date.now()) {
  const n = String(nome || '').trim(), m = String(medida || '').trim();
  if (!n || !m) return lista;
  const dados = { nome: n, medida: m, nota: String(nota || '').trim(), atualizado: agora };
  if (id && lista.some((x) => x.id === id)) return lista.map((x) => (x.id === id ? { ...x, ...dados } : x));
  return [...lista, { id: novoId(), ...dados }];
}
export const apagarMedida = (lista, id) => lista.filter((m) => m.id !== id);
/** A linha que entra no pedido ao Claude: "Vão da porta da cozinha: 810 × 2040 mm". */
export const linhaMedida = (m) => `${m.nome}: ${m.medida}${m.nota ? ` (${m.nota})` : ''}`;
/** Junta o caderno de uma cópia ao daqui: por id, ganha o mais recente. */
export function juntarMedidas(a, b) {
  const m = new Map();
  for (const x of [...a, ...b]) {
    const cur = m.get(x.id);
    if (!cur || (x.atualizado || 0) > (cur.atualizado || 0)) m.set(x.id, x);
  }
  return [...m.values()].sort((x, y) => x.nome.localeCompare(y.nome, 'pt'));
}

// ---------- Tinta, verniz e cola ----------
/** rend = área que 1 unidade cobre por demão (m² por litro ou por kg). embal = tamanhos de embalagem habituais. */
export const PRODUTOS = [
  { id: 'verniz', nome: 'Verniz', un: 'L', rend: 12, demaos: 2, embal: [0.25, 0.5, 0.75, 2.5] },
  { id: 'tinta', nome: 'Tinta', un: 'L', rend: 10, demaos: 2, embal: [0.75, 2, 5] },
  { id: 'oleo', nome: 'Óleo ou cera', un: 'L', rend: 15, demaos: 2, embal: [0.25, 0.5, 1] },
  { id: 'cola', nome: 'Cola de madeira', un: 'kg', rend: 6, demaos: 1, embal: [0.25, 0.5, 1, 5] },
];
export const MARGEM = 1.1; // 10% a mais para o que se perde

/** Área em m² de `faces` faces de c × l (cm). */
export const areaM2 = (comprCm, largCm, faces = 1) => (comprCm * largCm * faces) / 10000;

/** Embalagens: a mais pequena que chega; se nenhuma chega sozinha, a maior as vezes que for preciso. */
export function embalagens(precisa, tamanhos) {
  const t = [...tamanhos].sort((a, b) => a - b);
  const unica = t.find((x) => x >= precisa - 1e-9);
  if (unica) return { n: 1, tam: unica };
  const maior = t[t.length - 1];
  return { n: Math.ceil(precisa / maior - 1e-9), tam: maior };
}

/**
 * @param produto  um de PRODUTOS
 * @param area     m² a cobrir (todas as faces)
 * @param demaos   número de demãos
 * @param rend     m² por unidade e por demão (opcional: o da embalagem)
 * @returns {precisa, embal:{n,tam}} ou null se faltar algum valor. `precisa` na unidade do produto, com margem.
 */
export function quantidade(produto, area, demaos = produto.demaos, rend = produto.rend) {
  if (!(area > 0) || !(demaos > 0) || !(rend > 0)) return null;
  const precisa = (area * demaos * MARGEM) / rend;
  return { precisa, embal: embalagens(precisa, produto.embal) };
}

/** "0,6 L" / "250 g" / "1,5 kg": o texto de uma quantidade. */
export function textoQuantidade(v, un) {
  const r = (x, d) => String(Math.round(x * 10 ** d) / 10 ** d).replace('.', ',');
  if (un === 'kg' && v < 1) return `${r(v * 1000, 0)} g`;
  return `${r(v, v < 10 ? 2 : 1)} ${un}`;
}

// ---------- Guia de madeiras ----------
/** dureza: 1 macia, 2 média, 3 dura. grupo: 'macica' | 'placa'. */
export const MADEIRAS = [
  { nome: 'Pinho', grupo: 'macica', dureza: 1, exterior: false, serve: 'Estruturas, estantes, móveis simples e rústicos. Barata e fácil de trabalhar.', cuidados: 'Marca com facilidade e tem nós e resina. Dá bom resultado com verniz ou tinta.' },
  { nome: 'Cedro', grupo: 'macica', dureza: 1, exterior: true, serve: 'Exterior, armários e arcas. Resiste bem à humidade e aos bichos.', cuidados: 'É macia e racha nas pontas se não furares antes.' },
  { nome: 'Castanho', grupo: 'macica', dureza: 2, exterior: true, serve: 'Móveis, portas e vigas. Aguenta bem o exterior.', cuidados: 'Tem muito tanino: usa parafusos inox para não deixar manchas pretas.' },
  { nome: 'Nogueira', grupo: 'macica', dureza: 2, exterior: false, serve: 'Móveis finos e peças à vista. Muito bonita com óleo ou verniz.', cuidados: 'Cara. Mais vale aproveitar bem as tábuas.' },
  { nome: 'Carvalho', grupo: 'macica', dureza: 3, exterior: true, serve: 'Tampos, mesas, cadeiras e bancadas. Muito resistente e duradoura.', cuidados: 'Dura e pesada: pré-fura sempre. Tem tanino como o castanho.' },
  { nome: 'Faia', grupo: 'macica', dureza: 3, exterior: false, serve: 'Cadeiras, bancadas e brinquedos. Tem grão fino e aguenta pancadas.', cuidados: 'Só para interior: mexe com a humidade e pode empenar.' },
  { nome: 'Freixo', grupo: 'macica', dureza: 3, exterior: false, serve: 'Cabos de ferramentas, escadas e peças que sofrem esforço. É dura e elástica.', cuidados: 'Só para interior.' },
  { nome: 'Teca ou Iroko', grupo: 'macica', dureza: 3, exterior: true, serve: 'Mesas e bancos de jardim, barcos. Aguenta chuva e sol com óleo.', cuidados: 'Cara e oleosa: limpa a cola antes de colar. O pó irrita.' },
  { nome: 'Contraplacado', grupo: 'placa', dureza: 2, exterior: false, serve: 'Prateleiras, caixas, fundos e tampos finos. Estável e não empena. O marítimo aguenta humidade.', cuidados: 'Os topos ficam à vista: tapa com fita ou massa. Corta com serra de dentes finos.' },
  { nome: 'MDF', grupo: 'placa', dureza: 1, exterior: false, serve: 'Peças para pintar, gavetas e móveis lisos. Superfície muito lisa.', cuidados: 'Não gosta de água. O pó é fino: usa máscara. Pré-fura nos topos para não abrir.' },
  { nome: 'Aglomerado', grupo: 'placa', dureza: 1, exterior: false, serve: 'Roupeiros e móveis de cozinha. É barato e vem revestido.', cuidados: 'Fraco a segurar parafusos se os apertares e desapertares muitas vezes. Evita humidade.' },
  { nome: 'OSB', grupo: 'placa', dureza: 1, exterior: false, serve: 'Obras, bancadas de trabalho e prateleiras rústicas. Muito resistente para o preço.', cuidados: 'Superfície áspera e com farpas. Pode pintar-se com bom primário.' },
];
export const DUREZAS = { 1: 'Macia', 2: 'Média', 3: 'Dura' };
export const FILTROS_MADEIRA = [
  { id: 'todas', nome: 'Todas', ok: () => true },
  { id: 'macica', nome: 'Madeira maciça', ok: (m) => m.grupo === 'macica' },
  { id: 'placa', nome: 'Placas', ok: (m) => m.grupo === 'placa' },
  { id: 'exterior', nome: 'Para o exterior', ok: (m) => m.exterior },
];
export const madeirasDe = (filtroId) => MADEIRAS.filter((FILTROS_MADEIRA.find((f) => f.id === filtroId) || FILTROS_MADEIRA[0]).ok);
