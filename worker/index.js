// Worker da Garagem (Cloudflare). Fica entre a página pública e o repositório privado de dados.
// A chave do GitHub só existe aqui, como segredo. A página só conhece o CODIGO de sincronização.
//
// Rotas:
//   GET  /historico   → {conteudo, sha}   (conteudo = null se ainda não existir)
//   PUT  /historico   ← {conteudo, sha}   → {sha}   (409 se outro aparelho gravou entretanto)
//
// Variáveis (wrangler.toml): REPO ("dono/nome"), RAMO, FICHEIRO, ORIGENS (separadas por vírgula)
// Segredos (wrangler secret put): GITHUB_TOKEN, CODIGO
// Limite de pedidos (opcional): binding LIMITE

const MAX_CORPO = 2 * 1024 * 1024;

function origemPermitida(req, env) {
  const o = req.headers.get('Origin');
  const lista = String(env.ORIGENS || 'https://r-lst.github.io').split(',').map((s) => s.trim()).filter(Boolean);
  return o && lista.includes(o) ? o : null;
}
function cors(origem) {
  return {
    'Access-Control-Allow-Origin': origem,
    'Access-Control-Allow-Methods': 'GET, PUT, OPTIONS',
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

const paraB64 = (txt) => {
  const bytes = new TextEncoder().encode(txt);
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
};
const deB64 = (b64) => new TextDecoder().decode(Uint8Array.from(atob(b64.replace(/\s/g, '')), (c) => c.charCodeAt(0)));

function github(env, metodo, corpo) {
  const ficheiro = env.FICHEIRO || 'historico.json';
  const ramo = env.RAMO || 'main';
  const url = `https://api.github.com/repos/${env.REPO}/contents/${encodeURIComponent(ficheiro)}` + (metodo === 'GET' ? `?ref=${encodeURIComponent(ramo)}` : '');
  return fetch(url, {
    method: metodo,
    headers: {
      Authorization: 'Bearer ' + env.GITHUB_TOKEN,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'garagem-worker',
      ...(corpo ? { 'Content-Type': 'application/json' } : {}),
    },
    body: corpo ? JSON.stringify({ ...corpo, branch: ramo }) : undefined,
  });
}

async function lerHistorico(env, h) {
  const r = await github(env, 'GET');
  if (r.status === 404) return json({ conteudo: null, sha: null }, 200, h);
  if (!r.ok) return json({ erro: 'github ' + r.status }, 502, h);
  const f = await r.json();
  try {
    return json({ conteudo: JSON.parse(deB64(f.content || '')), sha: f.sha }, 200, h);
  } catch {
    return json({ erro: 'ficheiro ilegível' }, 502, h);
  }
}

async function gravarHistorico(req, env, h) {
  const txt = await req.text();
  if (txt.length > MAX_CORPO) return json({ erro: 'grande demais' }, 413, h);
  let b;
  try { b = JSON.parse(txt); } catch { return json({ erro: 'json inválido' }, 400, h); }
  if (!b || typeof b.conteudo !== 'object' || !Array.isArray(b.conteudo?.historico)) return json({ erro: 'falta conteudo.historico' }, 400, h);
  const corpo = { message: `Histórico: ${b.conteudo.historico.filter((e) => !e.apagado).length} entradas`, content: paraB64(JSON.stringify(b.conteudo, null, 1)) };
  if (b.sha) corpo.sha = b.sha;
  const r = await github(env, 'PUT', corpo);
  if (r.status === 409 || r.status === 422) return json({ erro: 'conflito' }, 409, h);
  if (!r.ok) return json({ erro: 'github ' + r.status }, 502, h);
  const f = await r.json();
  return json({ sha: f.content?.sha || null }, 200, h);
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
    const auth = req.headers.get('Authorization') || '';
    if (!env.CODIGO || !igualSeguro(auth, 'Bearer ' + env.CODIGO)) return json({ erro: 'código errado' }, 401, h);
    if (!env.REPO || !env.GITHUB_TOKEN) return json({ erro: 'Worker sem REPO ou GITHUB_TOKEN' }, 500, h);

    const { pathname } = new URL(req.url);
    if (pathname === '/historico' && req.method === 'GET') return lerHistorico(env, h);
    if (pathname === '/historico' && req.method === 'PUT') return gravarHistorico(req, env, h);
    return json({ erro: 'não existe' }, 404, h);
  },
};
