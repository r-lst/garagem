// Worker da Garagem (Cloudflare): api-github-garagem-dados.
// Fica entre a página pública e o repositório privado de dados. O token do GitHub só existe aqui.
//
// Rotas (todas com Authorization: Bearer <PAI_KEY ou ADMIN_KEY>):
//   GET  /lista    → {ficheiros:[{path, sha}]}             todos os ficheiros do repositório (1 pedido ao GitHub)
//   POST /ler      ← {shas:[...]}  (até 40)  → {conteudos:{sha: objeto}}
//   POST /gravar   ← {ficheiros:[{path, conteudo}]} (até 100) → {commit, shas:{path: sha}}
//                    tudo num só commit; conteudo null apaga o ficheiro (só ADMIN_KEY)
//   POST /descrever ← {id, texto, area, fotos:[base64 jpeg] (1 a 3)} → {descricao, modelo, guardadas}
//                    o Gemini descreve as fotos (só descreve; o conselho é do Claude) e as fotos ficam em fotos/<id>/<n>.jpg
//
// Organização do repositório: perfil.json, historico/<id>.json, projetos/<id>.json, fotos/<id>/<n>.jpg
//
// Segredos: GITHUB_TOKEN, GITHUB_REPO ("dono/nome"), PAI_KEY, ADMIN_KEY, GEMINI_API_KEY
// Opcionais: GITHUB_RAMO (main), ORIGENS (separadas por vírgula; por omissão https://r-lst.github.io),
//            GEMINI_MODELOS (separados por vírgula, do preferido para o de reserva; por omissão ver MODELOS_GEMINI)
// Limite de pedidos: binding LIMITE (wrangler.toml)
//
// Limite do plano grátis: 50 pedidos ao GitHub por pedido recebido. Por isso: lista numa só chamada,
// leitura em lotes de 40, gravação com 5 chamadas (ref, commit, tree, commit, ref) seja qual for o nº de ficheiros.
// /descrever: até 3 modelos Gemini + 3 blobs + 5 chamadas de commit = 11. O Worker não descodifica as fotos (CPU):
// passa o base64 tal como veio ao Gemini e ao GitHub.

const MAX_CORPO = 4 * 1024 * 1024;
const MAX_CORPO_FOTOS = 6 * 1024 * 1024;
const MAX_FOTOS = 3;
const MAX_FOTO_B64 = 1_800_000; // ~1,3 MB por foto; a página reduz para ~1280 px antes de enviar
const MODELOS_GEMINI = 'gemini-3.8-flash,gemini-3.6-flash,gemini-3.1-flash-lite';
const ID_OK = /^[a-z0-9]{4,40}$/;
const MAX_LER = 40;
const MAX_GRAVAR = 100;
const CAMINHO_OK = /^(perfil\.json|historico\/[a-z0-9]{4,40}\.json|projetos\/[a-z0-9]{4,40}\.json)$/;

function origemPermitida(req, env) {
  const o = req.headers.get('Origin');
  const lista = String(env.ORIGENS || 'https://r-lst.github.io').split(',').map((s) => s.trim()).filter(Boolean);
  return o && lista.includes(o) ? o : null;
}
function cors(origem) {
  return {
    'Access-Control-Allow-Origin': origem,
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Max-Age': '86400',
    Vary: 'Origin',
  };
}
const json = (dados, status, h) => new Response(JSON.stringify(dados), { status, headers: { ...h, 'Content-Type': 'application/json; charset=utf-8' } });

function igualSeguro(a, b) {
  a = String(a); b = String(b);
  let d = a.length ^ b.length;
  for (let i = 0; i < Math.max(a.length, b.length); i++) d |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
  return d === 0;
}
function papel(req, env) {
  const auth = req.headers.get('Authorization') || '';
  if (env.ADMIN_KEY && igualSeguro(auth, 'Bearer ' + env.ADMIN_KEY)) return 'admin';
  if (env.PAI_KEY && igualSeguro(auth, 'Bearer ' + env.PAI_KEY)) return 'pai';
  return null;
}

const deB64 = (b64) => new TextDecoder().decode(Uint8Array.from(atob(b64.replace(/\s/g, '')), (c) => c.charCodeAt(0)));
const paraB64 = (txt) => {
  const bytes = new TextEncoder().encode(txt);
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
};
/** sha de um blob git: sha1("blob <bytes>\0<conteúdo>"). Igual ao que o GitHub vai mostrar na lista. */
async function shaBlob(txt) {
  const corpo = new TextEncoder().encode(txt);
  const cab = new TextEncoder().encode(`blob ${corpo.length}\0`);
  const tudo = new Uint8Array(cab.length + corpo.length);
  tudo.set(cab); tudo.set(corpo, cab.length);
  const h = new Uint8Array(await crypto.subtle.digest('SHA-1', tudo));
  return [...h].map((b) => b.toString(16).padStart(2, '0')).join('');
}
const texto = (obj) => JSON.stringify(obj, null, 1) + '\n';

class ErroGitHub extends Error {}
async function gh(env, metodo, caminho, corpo) {
  const r = await fetch(`https://api.github.com/repos/${env.GITHUB_REPO}${caminho}`, {
    method: metodo,
    headers: {
      Authorization: 'Bearer ' + env.GITHUB_TOKEN,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'garagem-worker',
      ...(corpo ? { 'Content-Type': 'application/json' } : {}),
    },
    body: corpo ? JSON.stringify(corpo) : undefined,
  });
  return r;
}
async function ghOk(env, metodo, caminho, corpo) {
  const r = await gh(env, metodo, caminho, corpo);
  if (!r.ok) throw new ErroGitHub(`${metodo} ${caminho.split('?')[0]}: ${r.status}`);
  return r.json();
}
const ramo = (env) => env.GITHUB_RAMO || 'main';

async function lista(env, h) {
  const r = await gh(env, 'GET', `/git/trees/${encodeURIComponent(ramo(env))}?recursive=1`);
  // 404: o ramo ainda não existe; 409: repositório vazio
  if (r.status === 404 || r.status === 409) return json({ ficheiros: [] }, 200, h);
  if (!r.ok) throw new ErroGitHub('lista: ' + r.status);
  const t = await r.json();
  return json({ ficheiros: (t.tree || []).filter((e) => e.type === 'blob').map((e) => ({ path: e.path, sha: e.sha })), incompleta: !!t.truncated }, 200, h);
}

async function ler(b, env, h) {
  const shas = Array.isArray(b?.shas) ? b.shas : null;
  if (!shas || shas.length > MAX_LER || !shas.every((s) => /^[0-9a-f]{40}$/.test(s))) return json({ erro: `shas: até ${MAX_LER}, em hexadecimal` }, 400, h);
  const conteudos = {};
  for (const sha of shas) {
    const f = await ghOk(env, 'GET', `/git/blobs/${sha}`);
    try { conteudos[sha] = JSON.parse(deB64(f.content || '')); } catch { conteudos[sha] = null; }
  }
  return json({ conteudos }, 200, h);
}

/** Cria o primeiro commit num repositório vazio (a API de árvores não funciona sem ele). */
async function iniciarRepositorio(env) {
  await ghOk(env, 'PUT', '/contents/README.md', { message: 'Início dos dados da Garagem', content: paraB64('# Dados da Garagem\n\nGerido pelo Worker. Não editar à mão.\n'), branch: ramo(env) });
}

async function gravar(b, env, h, quem) {
  const fs = Array.isArray(b?.ficheiros) ? b.ficheiros : null;
  if (!fs || !fs.length || fs.length > MAX_GRAVAR) return json({ erro: `ficheiros: 1 a ${MAX_GRAVAR}` }, 400, h);
  for (const f of fs) {
    if (!f || !CAMINHO_OK.test(f.path)) return json({ erro: 'caminho não permitido: ' + f?.path }, 400, h);
    if (f.conteudo === null && quem !== 'admin') return json({ erro: 'só a chave de administração apaga ficheiros' }, 403, h);
    if (f.conteudo !== null && typeof f.conteudo !== 'object') return json({ erro: 'conteudo tem de ser um objeto: ' + f.path }, 400, h);
  }
  const entradas = [];
  const shas = {};
  for (const f of fs) {
    if (f.conteudo === null) { entradas.push({ path: f.path, mode: '100644', type: 'blob', sha: null }); continue; }
    const t = texto(f.conteudo);
    entradas.push({ path: f.path, mode: '100644', type: 'blob', content: t });
    shas[f.path] = await shaBlob(t);
  }
  const sha = await commitar(env, entradas, `Garagem: ${fs.length} ficheiro${fs.length === 1 ? '' : 's'} (${quem})`);
  return sha ? json({ commit: sha, shas }, 200, h) : json({ erro: 'conflito' }, 409, h);
}

/** Um só commit com as entradas da árvore. Devolve o sha, ou null se outro aparelho gravou 3 vezes seguidas. */
async function commitar(env, entradas, mensagem) {
  const ref = `/git/refs/heads/${encodeURIComponent(ramo(env))}`;
  for (let tentativa = 0; tentativa < 3; tentativa++) {
    let r = await gh(env, 'GET', ref);
    if (r.status === 404 || r.status === 409) { await iniciarRepositorio(env); r = await gh(env, 'GET', ref); }
    if (!r.ok) throw new ErroGitHub('ref: ' + r.status);
    const pai = (await r.json()).object.sha;
    const commitPai = await ghOk(env, 'GET', `/git/commits/${pai}`);
    const arvore = await ghOk(env, 'POST', '/git/trees', { base_tree: commitPai.tree.sha, tree: entradas });
    const commit = await ghOk(env, 'POST', '/git/commits', { message: mensagem, tree: arvore.sha, parents: [pai] });
    const up = await gh(env, 'PATCH', ref, { sha: commit.sha, force: false });
    if (up.ok) return commit.sha;
    if (up.status !== 422) throw new ErroGitHub('atualizar ramo: ' + up.status);
    // 422: outro aparelho gravou entretanto. Como cada ficheiro é um item, basta refazer por cima.
  }
  return null;
}

// ---------- fotos: o Gemini descreve, o Claude aconselha ----------
const PEDIDO_GEMINI = (texto, area) => `Vais descrever fotos de uma avaria (em casa ou na oficina) para outra pessoa as usar a diagnosticar.
${area ? `Zona: ${area}.\n` : ''}${texto ? `O dono diz: "${texto}"\n` : ''}
Escreve em português de Portugal, em texto simples, no máximo 120 palavras:
- o que é o objeto e de que material parece ser;
- o estado que se vê (ferrugem, humidade, fugas, fissuras, folgas, desgaste, fios à vista);
- medidas ou posições que se percebam;
- o texto legível, copiado tal e qual (marca, modelo, potência, etiquetas).
Só descreves o que se vê. Não dês conselhos, não digas a causa, não inventes. Se algo não se percebe, escreve "não se vê".`;

class ErroGemini extends Error {
  constructor(msg, status, detalhe) { super(msg); this.status = status; this.detalhe = detalhe; }
}

/** Pergunta a cada modelo da lista, por ordem, até um responder. 429, 5xx, modelo inexistente (404/400) ou resposta vazia: passa ao seguinte. */
async function perguntarGemini(env, texto, area, fotos) {
  const modelos = String(env.GEMINI_MODELOS || MODELOS_GEMINI).split(',').map((m) => m.trim()).filter(Boolean);
  const partes = [{ text: PEDIDO_GEMINI(texto, area) }, ...fotos.map((data) => ({ inline_data: { mime_type: 'image/jpeg', data } }))];
  const corpo = JSON.stringify({ contents: [{ parts: partes }], generationConfig: { temperature: 0.2, maxOutputTokens: 1500 } });
  let ultimo = 'sem modelos';
  const falhas = []; // o que correu mal antes de um modelo responder, para diagnóstico
  for (const modelo of modelos) {
    let r;
    try {
      r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(modelo)}:generateContent`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', 'x-goog-api-key': env.GEMINI_API_KEY }, body: corpo,
      });
    } catch { ultimo = modelo + ': sem ligação'; falhas.push(ultimo); continue; }
    if (r.status === 401 || r.status === 403) throw new ErroGemini('A chave do Gemini não está a funcionar.', 502, `${modelo}: ${r.status}`);
    if (!r.ok) {
      const e = await r.json().catch(() => null);
      ultimo = `${modelo}: ${r.status}${e?.error?.message ? ' ' + String(e.error.message).slice(0, 140) : ''}`;
      falhas.push(ultimo);
      continue;
    }
    const d = await r.json().catch(() => null);
    const txt = (d?.candidates?.[0]?.content?.parts || []).map((p) => p.text || '').join('').trim();
    if (!txt) { ultimo = `${modelo}: resposta vazia`; falhas.push(ultimo); continue; }
    return { descricao: txt, modelo, falhas };
  }
  throw new ErroGemini('Hoje já não dá para descrever as fotos. Copia o pedido na mesma; o Claude vê as fotos se as juntares lá.', 503, ultimo);
}

async function descrever(b, env, h) {
  if (!env.GEMINI_API_KEY) return json({ erro: 'Worker sem GEMINI_API_KEY' }, 500, h);
  const fotos = Array.isArray(b?.fotos) ? b.fotos : null;
  if (!fotos || !fotos.length || fotos.length > MAX_FOTOS) return json({ erro: `fotos: 1 a ${MAX_FOTOS}` }, 400, h);
  // o base64 de um JPEG começa por "/9j/"
  const jpegOk = (f) => typeof f === 'string' && f.length <= MAX_FOTO_B64 && f.startsWith('/9j/') && /^[A-Za-z0-9+/]+={0,2}$/.test(f);
  if (!fotos.every(jpegOk)) return json({ erro: 'as fotos têm de ser JPEG (até ~1,3 MB cada)' }, 400, h);
  const id = typeof b.id === 'string' && ID_OK.test(b.id) ? b.id : null;
  const texto = String(b.texto || '').slice(0, 1000);
  const area = String(b.area || '').slice(0, 60);
  let r;
  try { r = await perguntarGemini(env, texto, area, fotos); } catch (e) {
    if (e instanceof ErroGemini) return json({ erro: e.message, detalhe: e.detalhe }, e.status, h);
    throw e;
  }
  // guardar as fotos no repositório (um só commit); se falhar, a descrição não se perde
  let guardadas = 0;
  if (id) {
    try {
      const entradas = [];
      for (let i = 0; i < fotos.length; i++) {
        const blob = await ghOk(env, 'POST', '/git/blobs', { content: fotos[i], encoding: 'base64' });
        entradas.push({ path: `fotos/${id}/${i + 1}.jpg`, mode: '100644', type: 'blob', sha: blob.sha });
      }
      if (await commitar(env, entradas, `Garagem: ${fotos.length} foto${fotos.length === 1 ? '' : 's'} (${id})`)) guardadas = fotos.length;
    } catch (e) { if (!(e instanceof ErroGitHub)) throw e; }
  }
  return json({ descricao: r.descricao, modelo: r.modelo, falhas: r.falhas, guardadas }, 200, h);
}

export default {
  async fetch(req, env) {
    const origem = origemPermitida(req, env);
    if (!origem) return new Response('Origem não permitida', { status: 403 });
    const h = cors(origem);
    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: h });

    if (env.LIMITE) {
      const ip = req.headers.get('CF-Connecting-IP') || 'desconhecido';
      const { success } = await env.LIMITE.limit({ key: ip });
      if (!success) return json({ erro: 'demasiados pedidos' }, 429, h);
    }
    const quem = papel(req, env);
    if (!quem) return json({ erro: 'chave errada' }, 401, h);
    if (!env.GITHUB_REPO || !env.GITHUB_TOKEN) return json({ erro: 'Worker sem GITHUB_REPO ou GITHUB_TOKEN' }, 500, h);

    const { pathname } = new URL(req.url);
    try {
      if (pathname === '/lista' && req.method === 'GET') return await lista(env, h);
      if ((pathname === '/ler' || pathname === '/gravar' || pathname === '/descrever') && req.method === 'POST') {
        const txt = await req.text();
        if (txt.length > (pathname === '/descrever' ? MAX_CORPO_FOTOS : MAX_CORPO)) return json({ erro: 'grande demais' }, 413, h);
        let b;
        try { b = JSON.parse(txt); } catch { return json({ erro: 'json inválido' }, 400, h); }
        if (pathname === '/descrever') return await descrever(b, env, h);
        return pathname === '/ler' ? await ler(b, env, h) : await gravar(b, env, h, quem);
      }
      return json({ erro: 'não existe' }, 404, h);
    } catch (e) {
      if (e instanceof ErroGitHub) return json({ erro: 'github: ' + e.message }, 502, h);
      throw e;
    }
  },
};
