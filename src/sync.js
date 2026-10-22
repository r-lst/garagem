// Cópia online, através do Worker da Garagem (que guarda num repositório privado do GitHub).
// No repositório: perfil.json, historico/<id>.json, projetos/<id>.json. Um ficheiro por item.
// Em cada ficheiro há `atualizado`: entre o local e o online, ganha o mais recente.
import { juntar } from './historico.js';

export const CHAVE_SYNC = 'garagem_sync'; // {codigo, ultima, perfilAtualizado, conhecidos:{path:{sha, atualizado}}}
const LOTE_LER = 40;
const LOTE_GRAVAR = 100;
const ID_OK = /^[a-z0-9]{4,40}$/;

export function lerConfig(storage) {
  try { return JSON.parse(storage.getItem(CHAVE_SYNC) || '{}') || {}; } catch { return {}; }
}
export function gravarConfig(storage, cfg) {
  try { storage.setItem(CHAVE_SYNC, JSON.stringify(cfg)); } catch { /* sem armazenamento */ }
}

/** Tira a chave de um link "#k=<chave>" (ou "#historico&k=<chave>"). Devolve {chave, resto} ou null. */
export function chaveDoLink(hash) {
  const m = /^#?(?:([^&=]*)&)?k=([^&]+)$/.exec(hash || '');
  return m ? { chave: decodeURIComponent(m[2]), resto: m[1] || '' } : null;
}

// ---------- histórico ↔ ficheiros ----------
const cH = (id) => `historico/${id}.json`;
const cP = (id) => `projetos/${id}.json`;

/** Ficheiros que o histórico local daria: {path: conteudo}. O projeto vai em ficheiro à parte. */
export function paraFicheiros(lista) {
  const f = {};
  for (const e of lista) {
    if (!ID_OK.test(e.id)) continue;
    if (e.apagado) { f[cH(e.id)] = { id: e.id, atualizado: e.atualizado, apagado: true }; continue; }
    const { projeto, ...resto } = e;
    f[cH(e.id)] = resto;
    if (projeto) f[cP(e.id)] = { id: e.id, atualizado: e.atualizado, nome: e.nome, projeto };
  }
  return f;
}

async function pedido(base, caminho, codigo, opts, fetchFn) {
  let r;
  try {
    r = await fetchFn(base.replace(/\/+$/, '') + caminho, { ...opts, headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + codigo } });
  } catch { throw new Error('Não consegui ligar. Verifica a internet.'); }
  if (r.status === 401) throw new Error('A chave da cópia online está errada.');
  if (r.status === 429) throw new Error('Demasiados pedidos. Tenta daqui a um minuto.');
  if (r.status === 409) throw new Error('A cópia online está a ser alterada noutro sítio. Tenta mais tarde.');
  if (!r.ok) throw new Error('A cópia online não respondeu (erro ' + r.status + ').');
  return r.json();
}

/**
 * Junta o local com o online e grava no online o que for mais recente cá.
 * Entra: {hist, perfil, perfilAtualizado, conhecidos}. Sai: o mesmo, atualizado
 * (perfil só vem preenchido se o online for mais recente).
 */
export async function sincronizar(base, codigo, local, fetchFn = fetch) {
  const conhecidos = { ...(local.conhecidos || {}) };
  const { ficheiros } = await pedido(base, '/lista', codigo, { method: 'GET' }, fetchFn);
  const online = new Map(ficheiros.filter((f) => f.path === 'perfil.json' || /^(historico|projetos)\//.test(f.path)).map((f) => [f.path, f.sha]));
  for (const p of Object.keys(conhecidos)) if (!online.has(p)) delete conhecidos[p];

  // ler o que mudou desde a última vez, e o que falte cá (ex.: o browser foi limpo)
  const ca = new Map(local.hist.map((e) => [e.id, e]));
  const falta = (p) => {
    const m = /^(historico|projetos)\/(.+)\.json$/.exec(p);
    if (!m) return false;
    const e = ca.get(m[2]);
    return m[1] === 'historico' ? !e : !(e && (e.apagado || e.projeto));
  };
  const aLer = [...online].filter(([p, sha]) => conhecidos[p]?.sha !== sha || falta(p));
  const lido = {};
  for (let i = 0; i < aLer.length; i += LOTE_LER) {
    const lote = aLer.slice(i, i + LOTE_LER);
    const { conteudos } = await pedido(base, '/ler', codigo, { method: 'POST', body: JSON.stringify({ shas: lote.map(([, s]) => s) }) }, fetchFn);
    for (const [p, sha] of lote) {
      const c = conteudos[sha];
      lido[p] = c;
      conhecidos[p] = { sha, atualizado: Number(c?.atualizado) || 0 };
    }
  }

  // juntar com o local
  const projetos = new Map();
  const doOnline = [];
  for (const [p, c] of Object.entries(lido)) {
    if (!c || typeof c !== 'object' || !ID_OK.test(c.id || '')) continue;
    if (p.startsWith('projetos/')) projetos.set(c.id, c);
    else if (p.startsWith('historico/')) doOnline.push(c);
  }
  let hist = juntar(local.hist, doOnline).map((e) => {
    if (e.apagado || e.estado !== 'projeto') return e;
    const pj = projetos.get(e.id);
    if (pj && (!e.projeto || (pj.atualizado || 0) >= (e.atualizado || 0))) return { ...e, projeto: pj.projeto, nome: e.nome || pj.nome };
    return e;
  });
  let perfil = null;
  let perfilAtualizado = local.perfilAtualizado || 0;
  const pOnline = lido['perfil.json'];
  // perfilAtualizado 0 = este aparelho nunca guardou equipamento: só recebe, nunca envia os valores de origem
  if (pOnline?.perfil && (pOnline.atualizado || 0) > perfilAtualizado) { perfil = pOnline.perfil; perfilAtualizado = pOnline.atualizado; }

  // gravar o que é mais recente cá
  const meus = paraFicheiros(hist);
  if (!perfil && local.perfil && perfilAtualizado > 0) meus['perfil.json'] = { atualizado: perfilAtualizado, perfil: local.perfil };
  const aGravar = Object.entries(meus).filter(([p, c]) => !online.has(p) || (c.atualizado || 0) > (conhecidos[p]?.atualizado ?? -1));
  for (let i = 0; i < aGravar.length; i += LOTE_GRAVAR) {
    const lote = aGravar.slice(i, i + LOTE_GRAVAR);
    const { shas } = await pedido(base, '/gravar', codigo, { method: 'POST', body: JSON.stringify({ ficheiros: lote.map(([path, conteudo]) => ({ path, conteudo })) }) }, fetchFn);
    for (const [p, c] of lote) conhecidos[p] = { sha: shas?.[p] || null, atualizado: c.atualizado || 0 };
  }
  return { hist, perfil, perfilAtualizado, conhecidos, gravados: aGravar.length };
}
