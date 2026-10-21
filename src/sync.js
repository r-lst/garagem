// Cópia online do histórico, através do Worker da Garagem (que guarda num repositório privado do GitHub).
import { juntar, iguais } from './historico.js';

export const CHAVE_SYNC = 'garagem_sync'; // {codigo, ultima}

export function lerConfig(storage) {
  try { return JSON.parse(storage.getItem(CHAVE_SYNC) || '{}') || {}; } catch { return {}; }
}
export function gravarConfig(storage, cfg) {
  try { storage.setItem(CHAVE_SYNC, JSON.stringify(cfg)); } catch { /* sem armazenamento */ }
}

async function pedido(url, codigo, opts = {}, fetchFn = fetch) {
  let r;
  try {
    r = await fetchFn(url, { ...opts, headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + codigo, ...(opts.headers || {}) } });
  } catch { throw new Error('Sem ligação à internet.'); }
  if (r.status === 401) throw new Error('O código de sincronização está errado.');
  if (r.status === 429) throw new Error('Demasiados pedidos. Tenta daqui a um minuto.');
  if (r.status === 409) { const e = new Error('conflito'); e.conflito = true; throw e; }
  if (!r.ok) throw new Error('A cópia online não respondeu (erro ' + r.status + ').');
  return r.json();
}

/**
 * Junta o histórico local com o online e grava o resultado nos dois lados.
 * Devolve a lista junta. Tenta outra vez se outro aparelho gravou entretanto.
 */
export async function sincronizar(base, codigo, local, fetchFn = fetch) {
  const url = base.replace(/\/+$/, '') + '/historico';
  for (let tentativa = 0; tentativa < 3; tentativa++) {
    const remoto = await pedido(url, codigo, { method: 'GET' }, fetchFn);
    const lista = Array.isArray(remoto?.conteudo?.historico) ? remoto.conteudo.historico : [];
    const junta = juntar(local, lista);
    if (remoto.sha && iguais(junta, lista)) return junta;
    try {
      await pedido(url, codigo, { method: 'PUT', body: JSON.stringify({ sha: remoto.sha || null, conteudo: { versao: 1, historico: junta } }) }, fetchFn);
      return junta;
    } catch (e) {
      if (!e.conflito) throw e;
    }
  }
  throw new Error('A cópia online está a ser alterada noutro sítio. Tenta mais tarde.');
}
