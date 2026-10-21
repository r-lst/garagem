import worker from './worker/index.js';
import { sincronizar } from './src/sync.js';
import * as H from './src/historico.js';

let fails = 0;
const ok = (c, m) => { console.log((c ? '✓ ' : '✗ ') + m); if (!c) fails++; };

// GitHub simulado (API de conteúdos)
const gh = { ficheiro: null, sha: null, n: 0, pedidos: [] };
globalThis.fetch = async (url, o) => {
  gh.pedidos.push({ url, o });
  if (o.headers.Authorization !== 'Bearer tok') return new Response('', { status: 401 });
  if (o.method === 'GET') return gh.ficheiro ? Response.json({ content: gh.ficheiro, sha: gh.sha }) : new Response('', { status: 404 });
  const b = JSON.parse(o.body);
  if ((b.sha || null) !== gh.sha) return new Response('', { status: 409 });
  gh.ficheiro = b.content; gh.sha = 's' + ++gh.n;
  return Response.json({ content: { sha: gh.sha } });
};

const env = { REPO: 'r-lst/dados', GITHUB_TOKEN: 'tok', CODIGO: 'segredo', ORIGENS: 'https://r-lst.github.io' };
const ORIG = 'https://r-lst.github.io';
const pedir = (metodo, { origem = ORIG, codigo = 'segredo', corpo, caminho = '/historico', e = env } = {}) => {
  const headers = { Authorization: 'Bearer ' + codigo };
  if (origem) headers.Origin = origem;
  return worker.fetch(new Request('https://garagem.workers.dev' + caminho, { method: metodo, headers, body: corpo }), e);
};

let r = await pedir('GET', { origem: 'https://mau.example' });
ok(r.status === 403, 'outra origem: 403');
r = await pedir('GET', { origem: null });
ok(r.status === 403, 'sem origem: 403');
r = await pedir('OPTIONS');
ok(r.status === 204 && r.headers.get('Access-Control-Allow-Origin') === ORIG, 'preflight CORS');
const antes = gh.pedidos.length;
r = await pedir('GET', { codigo: 'errado' });
ok(r.status === 401 && gh.pedidos.length === antes, 'código errado: 401 e não toca no GitHub');
r = await pedir('GET');
let b = await r.json();
ok(r.status === 200 && b.conteudo === null && b.sha === null, 'ainda sem ficheiro');
const conteudo = { versao: 1, historico: [{ id: 'a', criado: 1, atualizado: 1, texto: 'Bancada de pinho, 1,2 m — ação' }] };
r = await pedir('PUT', { corpo: JSON.stringify({ sha: null, conteudo }) });
b = await r.json();
ok(r.status === 200 && b.sha === 's1', 'grava o ficheiro');
r = await pedir('GET');
b = await r.json();
ok(b.conteudo.historico[0].texto === conteudo.historico[0].texto && b.sha === 's1', 'lê com acentos intactos');
r = await pedir('PUT', { corpo: JSON.stringify({ sha: 'velho', conteudo }) });
ok(r.status === 409, 'sha desatualizado: 409');
r = await pedir('PUT', { corpo: '{"x":1}' });
ok(r.status === 400, 'corpo inválido: 400');
r = await pedir('GET', { caminho: '/outra' });
ok(r.status === 404, 'rota desconhecida: 404');
ok(JSON.parse(gh.pedidos.find((p) => p.o.method === 'PUT').o.body).branch === 'main', 'grava no ramo main');

// limite de pedidos
r = await pedir('GET', { e: { ...env, LIMITE: { limit: async () => ({ success: false }) } } });
ok(r.status === 429, 'limite de pedidos: 429');

// da página até ao GitHub
const W = 'https://garagem.workers.dev';
const viaWorker = (url, o) => worker.fetch(new Request(url, { ...o, headers: { ...o.headers, Origin: ORIG } }), env);
const local = H.registarPedido([], { modo: 'madeira', texto: 'estante', pedido: '' }, 5).lista;
const S = await sincronizar(W, 'segredo', local, viaWorker);
ok(S.length === 2, 'página ↔ Worker ↔ GitHub: junta as duas entradas');

console.log(fails ? `\n${fails} falha(s)` : '\nTudo OK');
process.exit(fails ? 1 : 0);
