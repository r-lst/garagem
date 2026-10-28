// Descrição das fotos de uma reparação (Gemini, através do Worker). Sem DOM.
// O Gemini só descreve o que vê; o conselho continua a ser do Claude.
export const MAX_FOTOS = 3;

/** fotos: JPEG em base64, sem o prefixo "data:". Devolve {descricao, modelo, guardadas}. */
export async function descreverFotos(base, codigo, { id, texto, area, fotos }, fetchFn = fetch) {
  let r;
  try {
    r = await fetchFn(base.replace(/\/+$/, '') + '/descrever', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + codigo },
      body: JSON.stringify({ id, texto, area, fotos }),
    });
  } catch { throw new Error('Não consegui ligar. Verifica a internet.'); }
  const d = await r.json().catch(() => ({}));
  if (r.ok && d.descricao) return d;
  if (r.status === 401) throw new Error('A chave da cópia online está errada.');
  if (r.status === 429) throw new Error('Demasiados pedidos. Tenta daqui a um minuto.');
  if (r.status === 400 || r.status === 413) throw new Error('Alguma das fotos é grande demais ou não é uma foto. Tira outra.');
  if ((r.status === 502 || r.status === 503) && d.erro) throw new Error(d.erro);
  throw new Error('Não consegui descrever as fotos (erro ' + r.status + '). Podes copiar o pedido na mesma.');
}
