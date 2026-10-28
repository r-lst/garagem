// Histórico de pedidos e projetos. Lógica pura (sem DOM): guardar, ligar o projeto ao pedido, juntar cópias.
// Cada entrada: {id, criado, atualizado, modo, estado:'pedido'|'projeto'|'resolvida', texto, pedido, nome, projeto, area, resposta}
// 'resolvida' só nas reparações; 'resposta' nas reparações e nos projetos de madeira;
// oficina: {cortar:{chave:true}, comprar:{chave:true}, tenho:{chave:true}, extras:{chave:texto}} = o que foi riscado no modo oficina
// (comprar = comprado, tenho = já tinha em casa, extras = linhas que o pai juntou à lista de compras).
// Apagar deixa só {id, atualizado, apagado:true}, para a sincronização não ressuscitar o que foi apagado.

export const CHAVE = 'garagem_historico';
export const MAX = 50;
export const MODOS_HIST = ['madeira', 'reparacao', 'plano', 'outro'];

const novoId = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
const visiveis = (lista) => lista.filter((e) => !e.apagado);

export function carregar(storage) {
  try {
    const v = JSON.parse(storage.getItem(CHAVE) || '[]');
    return Array.isArray(v) ? v.filter((e) => e && typeof e.id === 'string') : [];
  } catch { return []; }
}
export function guardar(storage, lista) {
  try { storage.setItem(CHAVE, JSON.stringify(lista)); return true; } catch { return false; }
}

/** Os mais recentes primeiro, sem os apagados. */
export function ordenados(lista) {
  return visiveis(lista).sort((a, b) => b.criado - a.criado);
}

export function titulo(e, nomesModo = {}) {
  if (e.estado === 'projeto' && e.nome) return e.nome;
  const t = String(e.texto || '').trim().replace(/\s+/g, ' ');
  if (!t) return nomesModo[e.modo] || 'Pedido';
  return t.length > 60 ? t.slice(0, 57).replace(/\s+\S*$/, '') + '…' : t;
}

function limitar(lista, agora) {
  const vis = ordenados(lista);
  if (vis.length <= MAX) return lista;
  const sai = new Set(vis.slice(MAX).map((e) => e.id));
  return lista.map((e) => (sai.has(e.id) ? { id: e.id, atualizado: agora, apagado: true } : e));
}

/**
 * Regista o pedido do passo 3. Se `id` for de um pedido ainda sem projeto (o pai voltou atrás e mudou), atualiza-o.
 * Devolve {lista, id}.
 */
export function registarPedido(lista, { id, modo, texto, pedido, area = '' }, agora = Date.now()) {
  const atual = id && lista.find((e) => e.id === id && !e.apagado && e.estado === 'pedido');
  if (atual) {
    return { lista: lista.map((e) => (e === atual ? { ...e, modo, texto, pedido, area, atualizado: agora } : e)), id };
  }
  const e = { id: novoId(), criado: agora, atualizado: agora, modo, estado: 'pedido', texto, pedido, nome: '', projeto: null, area };
  return { lista: limitar([...lista, e], agora), id: e.id };
}

/**
 * Liga um projeto desenhado ao último pedido de madeira ainda sem projeto.
 * Se o mesmo projeto já estiver no histórico, não repete. Se não houver pedido à espera, cria uma entrada nova.
 * Devolve {lista, id, novo}.
 */
export function registarProjeto(lista, spec, agora = Date.now()) {
  const txt = JSON.stringify(spec);
  const igual = visiveis(lista).find((e) => e.projeto && JSON.stringify(e.projeto) === txt);
  if (igual) return { lista, id: igual.id, novo: false };
  const nome = String(spec?.nome || '').trim() || 'Projeto sem nome';
  const espera = ordenados(lista).find((e) => e.modo === 'madeira' && e.estado === 'pedido');
  if (espera) {
    return { lista: lista.map((e) => (e === espera ? { ...e, estado: 'projeto', nome, projeto: spec, atualizado: agora } : e)), id: espera.id, novo: false };
  }
  const e = { id: novoId(), criado: agora, atualizado: agora, modo: 'madeira', estado: 'projeto', texto: '', pedido: '', nome, projeto: spec };
  return { lista: limitar([...lista, e], agora), id: e.id, novo: true };
}

/** Reparação: marcar como resolvida (ou voltar a "pedido"). */
export function marcarResolvida(lista, id, resolvida = true, agora = Date.now()) {
  return lista.map((e) => (e.id === id && !e.apagado ? { ...e, estado: resolvida ? 'resolvida' : 'pedido', atualizado: agora } : e));
}

/** Reparação: guardar o texto da resposta do Claude (vazio apaga). */
export function guardarResposta(lista, id, texto, agora = Date.now()) {
  const t = String(texto || '').trim();
  return lista.map((e) => (e.id === id && !e.apagado ? { ...e, resposta: t, atualizado: agora } : e));
}

/** Modo oficina: riscar (ou desfazer) uma linha. tipo 'cortar' ou 'comprar'; fica em e.oficina[tipo][chave]. */
export function marcarOficina(lista, id, tipo, chave, feito = true, agora = Date.now()) {
  return lista.map((e) => {
    if (e.id !== id || e.apagado) return e;
    const of = { cortar: {}, comprar: {}, ...(e.oficina || {}) };
    const t = { ...(of[tipo] || {}) };
    if (feito) t[chave] = true; else delete t[chave];
    return { ...e, oficina: { ...of, [tipo]: t }, atualizado: agora };
  });
}

/** Lista de compras: estado de uma linha: '' (por comprar), 'tenho' (já tenho em casa) ou 'comprado'. */
export function estadoCompra(oficina, chave) {
  if (oficina?.comprar?.[chave]) return 'comprado';
  if (oficina?.tenho?.[chave]) return 'tenho';
  return '';
}

/** Cada toque passa ao estado seguinte: por comprar → já tenho → comprado → por comprar. */
export function ciclarCompra(lista, id, chave, agora = Date.now()) {
  return lista.map((e) => {
    if (e.id !== id || e.apagado) return e;
    const of = { cortar: {}, comprar: {}, tenho: {}, ...(e.oficina || {}) };
    const seguinte = { '': 'tenho', tenho: 'comprado', comprado: '' }[estadoCompra(of, chave)];
    const comprar = { ...of.comprar }, tenho = { ...of.tenho };
    delete comprar[chave]; delete tenho[chave];
    if (seguinte === 'tenho') tenho[chave] = true;
    if (seguinte === 'comprado') comprar[chave] = true;
    return { ...e, oficina: { ...of, comprar, tenho }, atualizado: agora };
  });
}

/** Junta uma linha à lista de compras do projeto (lixa, cola…). Se já lá estiver com o mesmo nome, não repete. */
export function juntarExtra(lista, id, texto, agora = Date.now()) {
  const t = String(texto || '').trim();
  if (!t) return lista;
  return lista.map((e) => {
    if (e.id !== id || e.apagado) return e;
    const of = e.oficina || {};
    const extras = { ...(of.extras || {}) };
    if (Object.values(extras).some((x) => x.toLowerCase() === t.toLowerCase())) return e;
    extras['x|' + novoId()] = t;
    return { ...e, oficina: { cortar: {}, comprar: {}, ...of, extras }, atualizado: agora };
  });
}

/** Tira uma linha extra (e o que estava marcado nela). */
export function tirarExtra(lista, id, chave, agora = Date.now()) {
  return lista.map((e) => {
    if (e.id !== id || e.apagado || !e.oficina?.extras?.[chave]) return e;
    const of = e.oficina;
    const sem = (o) => { const c = { ...(o || {}) }; delete c[chave]; return c; };
    return { ...e, oficina: { ...of, extras: sem(of.extras), comprar: sem(of.comprar), tenho: sem(of.tenho) }, atualizado: agora };
  });
}

export function apagar(lista, id, agora = Date.now()) {
  return lista.map((e) => (e.id === id ? { id, atualizado: agora, apagado: true } : e));
}

/** Junta duas listas (este computador e a cópia): por id, fica a versão mais recente. */
export function juntar(a, b) {
  const m = new Map();
  for (const e of [...a, ...b]) {
    const cur = m.get(e.id);
    if (!cur || (e.atualizado || 0) > (cur.atualizado || 0)) m.set(e.id, e);
  }
  return [...m.values()].sort((x, y) => (x.criado || 0) - (y.criado || 0) || (x.id < y.id ? -1 : 1));
}

export const iguais = (a, b) => JSON.stringify(juntar(a, [])) === JSON.stringify(juntar(b, []));

// ---------- cópia num ficheiro ----------
export function exportar({ perfil, historico, medidas = [] }, agora = Date.now()) {
  return { app: 'garagem', versao: 1, guardado: new Date(agora).toISOString(), perfil, historico, medidas };
}

/** Lê o ficheiro de cópia. Erros em português, para mostrar ao pai. */
export function importar(texto) {
  let o;
  try { o = JSON.parse(texto); } catch { throw new Error('Este ficheiro não é uma cópia da Garagem.'); }
  if (!o || o.app !== 'garagem') throw new Error('Este ficheiro não é uma cópia da Garagem.');
  if (!Array.isArray(o.historico)) throw new Error('A cópia não tem histórico.');
  return {
    perfil: o.perfil && typeof o.perfil === 'object' ? o.perfil : null,
    historico: o.historico.filter((e) => e && typeof e.id === 'string'),
    medidas: Array.isArray(o.medidas) ? o.medidas.filter((m) => m && typeof m.id === 'string' && typeof m.nome === 'string') : [],
  };
}
