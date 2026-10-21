// Worker da Garagem (Cloudflare): api-github-garagem-dados.
// Fica entre a página pública e o repositório privado de dados. O token do GitHub só existe aqui.
//
// Rotas (todas com Authorization: Bearer <PAI_KEY ou ADMIN_KEY>):
//   GET  /lista    → {ficheiros:[{path, sha}]}             todos os ficheiros do repositório (1 pedido ao GitHub)
//   POST /ler      ← {shas:[...]}  (até 40)  → {conteudos:{sha: objeto}}
//   POST /gravar   ← {ficheiros:[{path, conteudo}]} (até 100) → {commit, shas:{path: sha}}
//                    tudo num só commit; conteudo null apaga o ficheiro (só ADMIN_KEY)
//
// Organização do repositório: perfil.json, historico/<id>.json, projetos/<id>.json (fotos/ mais tarde)
//
// Segredos: GITHUB_TOKEN, GITHUB_REPO ("dono/nome"), PAI_KEY, ADMIN_KEY
// Opcionais: GITHUB_RAMO (main), ORIGENS (separadas por vírgula; por omissão https://r-lst.github.io)
// Limite de pedidos: binding LIMITE (wrangler.toml)
//
// Limite do plano grátis: 50 pedidos ao GitHub por pedido recebido. Por isso: lista numa só chamada,
// leitura em lotes de 40, gravação com 5 chamadas (ref, commit, tree, commit, ref) seja qual for o nº de ficheiros.

const MAX_CORPO = 4 * 1024 * 1024;
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
  const ref = `/git/refs/heads/${encodeURIComponent(ramo(env))}`;
  for (let tentativa = 0; tentativa < 3; tentativa++) {
    let r = await gh(env, 'GET', ref);
    if (r.status === 404 || r.status === 409) { await iniciarRepositorio(env); r = await gh(env, 'GET', ref); }
    if (!r.ok) throw new ErroGitHub('ref: ' + r.status);
    const pai = (await r.json()).object.sha;
    const commitPai = await ghOk(env, 'GET', `/git/commits/${pai}`);
    const arvore = await ghOk(env, 'POST', '/git/trees', { base_tree: commitPai.tree.sha, tree: entradas });
    const n = fs.length;
    const commit = await ghOk(env, 'POST', '/git/commits', { message: `Garagem: ${n} ficheiro${n === 1 ? '' : 's'} (${quem})`, tree: arvore.sha, parents: [pai] });
    const up = await gh(env, 'PATCH', ref, { sha: commit.sha, force: false });
    if (up.ok) return json({ commit: commit.sha, shas }, 200, h);
    if (up.status !== 422) throw new ErroGitHub('atualizar ramo: ' + up.status);
    // 422: outro aparelho gravou entretanto. Como cada ficheiro é um item, basta refazer por cima.
  }
  return json({ erro: 'conflito' }, 409, h);
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
      if ((pathname === '/ler' || pathname === '/gravar') && req.method === 'POST') {
        const txt = await req.text();
        if (txt.length > MAX_CORPO) return json({ erro: 'grande demais' }, 413, h);
        let b;
        try { b = JSON.parse(txt); } catch { return json({ erro: 'json inválido' }, 400, h); }
        return pathname === '/ler' ? await ler(b, env, h) : await gravar(b, env, h, quem);
      }
      return json({ erro: 'não existe' }, 404, h);
    } catch (e) {
      if (e instanceof ErroGitHub) return json({ erro: 'github: ' + e.message }, 502, h);
      throw e;
    }
  },
};
