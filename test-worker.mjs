import { createHash } from 'node:crypto';
import worker from './worker/index.js';
import { sincronizar } from './src/sync.js';
import { descreverFotos } from './src/descrever.js';
import * as H from './src/historico.js';

let fails = 0;
const ok = (c, m) => { console.log((c ? '✓ ' : '✗ ') + m); if (!c) fails++; };

// ---------- GitHub simulado (API de árvores, commits e refs; começa vazio) ----------
const gitSha = (txt) => { const b = Buffer.from(txt, 'utf8'); return createHash('sha1').update(`blob ${b.length}\0`).update(b).digest('hex'); };
const gh = { ref: null, commits: new Map(), arvores: new Map(), blobs: new Map(), n: 0, chamadas: 0, corrida: false };
const novoSha = () => createHash('sha1').update('x' + ++gh.n).digest('hex');
function novaArvore(base, entradas) {
  const t = new Map(base ? gh.arvores.get(base) : []);
  for (const e of entradas) {
    if (e.sha === null) t.delete(e.path);
    else if (e.content === undefined) t.set(e.path, e.sha); // blob já criado com POST /git/blobs
    else { const s = gitSha(e.content); gh.blobs.set(s, e.content); t.set(e.path, s); }
  }
  const sha = novoSha();
  gh.arvores.set(sha, t);
  return sha;
}
function novoCommit(arvore, pais) { const sha = novoSha(); gh.commits.set(sha, { arvore, pais }); return sha; }
const resp = (o, status = 200) => new Response(JSON.stringify(o), { status, headers: { 'Content-Type': 'application/json' } });
// ---------- Gemini simulado: cada modelo responde com o código que estiver em gemini.estado[modelo] ----------
const gemini = { estado: {}, pedidos: [], chaves: [] };
async function geminiSim(url, o) {
  const modelo = /models\/([^:]+):generateContent/.exec(url)[1];
  gemini.pedidos.push({ modelo, corpo: JSON.parse(o.body) });
  gemini.chaves.push(o.headers['x-goog-api-key']);
  if (url.includes('key=')) return resp({}, 400);
  const e = gemini.estado[modelo] ?? 404;
  if (e === 'vazio') return resp({ candidates: [{ finishReason: 'SAFETY' }] });
  if (e !== 200) return resp({ error: { message: 'x' } }, e);
  return resp({ candidates: [{ content: { parts: [{ text: 'Torneira de lavatório, metal cromado. Marca legível: "ACME 35".' }] } }] });
}
globalThis.fetch = async (url, o) => {
  if (new URL(url).hostname === 'generativelanguage.googleapis.com') return geminiSim(url, o);
  gh.chamadas++;
  if (o.headers.Authorization !== 'Bearer tok') return resp({}, 401);
  const p = new URL(url).pathname.replace('/repos/r-lst/garagem-dados', '');
  const b = o.body ? JSON.parse(o.body) : null;
  let m;
  if (o.method === 'GET' && p === '/git/trees/main') {
    if (!gh.ref) return resp({ message: 'Git Repository is empty.' }, 409);
    return resp({ tree: [...gh.arvores.get(gh.commits.get(gh.ref).arvore)].map(([path, sha]) => ({ path, sha, type: 'blob' })), truncated: false });
  }
  if (o.method === 'GET' && (m = /^\/git\/blobs\/(\w+)$/.exec(p))) return gh.blobs.has(m[1]) ? resp({ content: Buffer.from(gh.blobs.get(m[1])).toString('base64') }) : resp({}, 404);
  if (o.method === 'PUT' && p === '/contents/README.md') {
    if (gh.ref) return resp({}, 422);
    gh.ref = novoCommit(novaArvore(null, [{ path: 'README.md', content: Buffer.from(b.content, 'base64').toString() }]), []);
    return resp({}, 201);
  }
  if (o.method === 'GET' && p === '/git/refs/heads/main') return gh.ref ? resp({ object: { sha: gh.ref } }) : resp({}, 409);
  if (o.method === 'GET' && (m = /^\/git\/commits\/(\w+)$/.exec(p))) return resp({ tree: { sha: gh.commits.get(m[1]).arvore } });
  if (o.method === 'POST' && p === '/git/blobs') {
    const bin = Buffer.from(b.content, 'base64');
    const s = createHash('sha1').update(`blob ${bin.length}\0`).update(bin).digest('hex');
    gh.blobs.set(s, bin.toString('latin1'));
    return resp({ sha: s }, 201);
  }
  if (o.method === 'POST' && p === '/git/trees') return resp({ sha: novaArvore(b.base_tree, b.tree) }, 201);
  if (o.method === 'POST' && p === '/git/commits') return resp({ sha: novoCommit(b.tree, b.parents) }, 201);
  if (o.method === 'PATCH' && p === '/git/refs/heads/main') {
    if (gh.corrida) { gh.corrida = false; gh.ref = novoCommit(gh.commits.get(gh.ref).arvore, [gh.ref]); } // outro aparelho gravou
    if (gh.commits.get(b.sha).pais[0] !== gh.ref) return resp({ message: 'Update is not a fast forward' }, 422);
    gh.ref = b.sha;
    return resp({ object: { sha: b.sha } });
  }
  return resp({ message: 'não simulado: ' + o.method + ' ' + p }, 500);
};
const ficheirosGH = () => new Map(gh.ref ? gh.arvores.get(gh.commits.get(gh.ref).arvore) : []);

// ---------- Worker ----------
const env = { GITHUB_REPO: 'r-lst/garagem-dados', GITHUB_TOKEN: 'tok', PAI_KEY: 'chavepai', ADMIN_KEY: 'chaveadmin' };
const ORIG = 'https://r-lst.github.io';
const W = 'https://api-github-garagem-dados.rmleston.workers.dev';
const pedir = (metodo, caminho, { origem = ORIG, chave = 'chavepai', corpo, e = env } = {}) => {
  const headers = { Authorization: 'Bearer ' + chave, 'Content-Type': 'application/json' };
  if (origem) headers.Origin = origem;
  return worker.fetch(new Request(W + caminho, { method: metodo, headers, body: corpo === undefined ? undefined : JSON.stringify(corpo) }), e);
};
let usosLer = 0, usosGravar = 0;
const viaWorker = (url, o) => {
  if (url.endsWith('/ler')) usosLer++;
  if (url.endsWith('/gravar')) usosGravar++;
  return worker.fetch(new Request(url, { ...o, headers: { ...o.headers, Origin: ORIG } }), env);
};

let r = await pedir('GET', '/lista', { origem: 'https://mau.example' });
ok(r.status === 403, 'outra origem: 403');
r = await pedir('GET', '/lista', { origem: null });
ok(r.status === 403, 'sem origem: 403');
r = await pedir('OPTIONS', '/lista');
ok(r.status === 204 && r.headers.get('Access-Control-Allow-Origin') === ORIG, 'preflight CORS');
let antes = gh.chamadas;
r = await pedir('GET', '/lista', { chave: 'errada' });
ok(r.status === 401 && gh.chamadas === antes, 'chave errada: 401 e não toca no GitHub');
r = await pedir('GET', '/lista');
ok(r.status === 200 && (await r.json()).ficheiros.length === 0, 'repositório vazio: lista vazia');
r = await pedir('POST', '/gravar', { corpo: { ficheiros: [{ path: '../segredo.txt', conteudo: {} }] } });
ok(r.status === 400, 'caminho fora do permitido: 400');
r = await pedir('POST', '/gravar', { corpo: { ficheiros: [{ path: 'projetos/abcd.json', conteudo: null }] } });
ok(r.status === 403, 'chave do pai não apaga ficheiros: 403');
r = await pedir('POST', '/ler', { corpo: { shas: ['../x'] } });
ok(r.status === 400, 'ler com sha inválido: 400');
r = await pedir('GET', '/lista', { e: { ...env, LIMITE: { limit: async () => ({ success: false }) } } });
ok(r.status === 429, 'limite de pedidos: 429');

// ---------- computador do pai (já tinha equipamento) ----------
let pc = H.registarPedido([], { modo: 'madeira', texto: 'bancada', pedido: 'PEDIDO' }, 1000).lista;
pc = H.registarProjeto(pc, { nome: 'Bancada', pecas: [{ tipo: 'tabua', nome: 'tampo — ação' }] }, 1100).lista;
pc = H.registarPedido(pc, { modo: 'plano', texto: 'pintar cadeiras', pedido: 'P2' }, 1200).lista;
const perfilPC = { impressora: 'Creality K1', ferramentas: 'serra circular' };
antes = gh.chamadas;
let A = await sincronizar(W, 'chavepai', { hist: pc, perfil: perfilPC, perfilAtualizado: 1, conhecidos: {} }, viaWorker);
const fs1 = ficheirosGH();
ok(A.gravados === 4 && fs1.has('README.md') && fs1.has('perfil.json') && fs1.has(`historico/${pc[0].id}.json`) && fs1.has(`projetos/${pc[0].id}.json`), 'primeira vez: cria o repositório e grava 4 ficheiros');
ok(gh.chamadas - antes <= 8, `gravar num só commit (${gh.chamadas - antes} pedidos ao GitHub)`);
ok(Object.entries(A.conhecidos).every(([p, k]) => k.sha === fs1.get(p)), 'o Worker calcula os mesmos sha que o GitHub');
ok(!JSON.parse(gh.blobs.get(fs1.get(`historico/${pc[0].id}.json`))).projeto, 'histórico sem o projeto dentro');
usosLer = usosGravar = 0;
A = await sincronizar(W, 'chavepai', { hist: pc, perfil: perfilPC, perfilAtualizado: 1, conhecidos: A.conhecidos }, viaWorker);
ok(usosLer === 0 && usosGravar === 0 && A.gravados === 0, 'sem mudanças: não lê nem grava');

// ---------- telemóvel novo ----------
let B = await sincronizar(W, 'chavepai', { hist: [], perfil: { impressora: 'Creality K1' }, perfilAtualizado: 0, conhecidos: {} }, viaWorker);
ok(H.ordenados(B.hist).length === 2 && B.hist.find((e) => e.id === pc[0].id).projeto.pecas[0].nome === 'tampo — ação', 'telemóvel recebe o histórico e o projeto (acentos intactos)');
ok(B.perfil?.ferramentas === 'serra circular' && B.gravados === 0, 'telemóvel recebe o equipamento e não envia os valores de origem');
let tel = H.registarPedido(B.hist, { modo: 'outro', texto: 'no telemóvel', pedido: '' }, 2000).lista;
tel = H.apagar(tel, pc[1].id, 2100);
gh.corrida = true;
B = await sincronizar(W, 'chavepai', { hist: tel, perfil: B.perfil, perfilAtualizado: B.perfilAtualizado, conhecidos: B.conhecidos }, viaWorker);
ok(B.gravados === 2 && !gh.corrida, 'outro aparelho gravou ao mesmo tempo: o Worker refaz e grava');

// ---------- computador outra vez ----------
const perfilNovo = { ...perfilPC, ferramentas: 'serra circular, tupia' };
A = await sincronizar(W, 'chavepai', { hist: pc, perfil: perfilNovo, perfilAtualizado: 3000, conhecidos: A.conhecidos }, viaWorker);
const visA = H.ordenados(A.hist).map((e) => e.texto);
ok(visA.includes('no telemóvel') && !visA.includes('pintar cadeiras'), 'computador recebe o pedido novo e o apagado');
ok(JSON.parse(gh.blobs.get(ficheirosGH().get('perfil.json'))).perfil.ferramentas === 'serra circular, tupia', 'equipamento alterado no computador vai para o online');
B = await sincronizar(W, 'chavepai', { hist: B.hist, perfil: B.perfil, perfilAtualizado: B.perfilAtualizado, conhecidos: B.conhecidos }, viaWorker);
ok(B.perfil?.ferramentas === 'serra circular, tupia', 'e chega ao telemóvel');

// browser limpo, mas o registo da cópia online ficou
const L = await sincronizar(W, 'chavepai', { hist: [], perfil: perfilNovo, perfilAtualizado: 3000, conhecidos: A.conhecidos }, viaWorker);
ok(H.ordenados(L.hist).length === 2 && L.hist.some((e) => e.projeto), 'browser limpo: volta tudo do online');

// ---------- fotos: o Gemini descreve ----------
const foto = (n) => Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.from('foto' + n)]).toString('base64'); // começa por /9j/
const envG = { ...env, GEMINI_API_KEY: 'chavegemini' };
const descrever = (corpo, e = envG) => pedir('POST', '/descrever', { corpo, e });
const idFoto = pc[0].id;
gemini.estado = { 'gemini-3.8-flash': 200, 'gemini-3.6-flash': 200, 'gemini-3.1-flash-lite': 200 };
r = await descrever({ id: idFoto, texto: 'pinga', area: 'Cozinha', fotos: [foto(1), foto(2)] });
let d = await r.json();
ok(r.status === 200 && d.modelo === 'gemini-3.8-flash' && /ACME 35/.test(d.descricao) && d.guardadas === 2, 'descrever: usa o primeiro modelo e guarda as fotos');
ok(gemini.chaves.every((c) => c === 'chavegemini'), 'a chave do Gemini vai no cabeçalho, nunca no endereço');
const pa = gemini.pedidos.at(-1).corpo.contents[0].parts;
ok(pa[0].text.includes('Cozinha') && pa[0].text.includes('pinga') && pa.length === 3 && pa[1].inline_data.data === foto(1), 'o pedido leva a zona, o texto e as fotos tal como vieram');
ok(ficheirosGH().has(`fotos/${idFoto}/1.jpg`) && ficheirosGH().has(`fotos/${idFoto}/2.jpg`) && Buffer.from(gh.blobs.get(ficheirosGH().get(`fotos/${idFoto}/2.jpg`)), 'latin1').equals(Buffer.from(foto(2), 'base64')), 'as fotos ficam em fotos/<id>/<n>.jpg com os bytes certos');
const sy = await sincronizar(W, 'chavepai', { hist: pc, perfil: perfilNovo, perfilAtualizado: 3000, conhecidos: A.conhecidos }, viaWorker);
ok(Object.keys(sy.conhecidos).every((p) => !p.startsWith('fotos/')), 'a sincronização ignora as fotos');
antes = gh.chamadas;
gemini.estado['gemini-3.8-flash'] = 429;
r = await descrever({ id: idFoto, fotos: [foto(3)] });
d = await r.json();
ok(r.status === 200 && d.modelo === 'gemini-3.6-flash', '429 no primeiro: passa ao segundo');
ok(gh.chamadas - antes <= 7, `fotos num só commit (${gh.chamadas - antes} pedidos ao GitHub)`);
gemini.estado['gemini-3.6-flash'] = 404;
r = await descrever({ fotos: [foto(1)] });
d = await r.json();
ok(r.status === 200 && d.modelo === 'gemini-3.1-flash-lite' && d.guardadas === 0, 'modelo inexistente (404): passa ao seguinte; sem id não guarda fotos');
gemini.estado['gemini-3.1-flash-lite'] = 'vazio';
r = await descrever({ fotos: [foto(1)] });
d = await r.json();
ok(r.status === 503 && /não dá para descrever/.test(d.erro) && /vazia/.test(d.detalhe), 'todos falham: erro em português');
gemini.estado['gemini-3.1-flash-lite'] = 403;
r = await descrever({ fotos: [foto(1)] });
ok(r.status === 502 && /chave do Gemini/.test((await r.json()).erro), 'chave do Gemini recusada: avisa');
gemini.estado = { 'modelo-novo': 200 };
r = await descrever({ fotos: [foto(1)] }, { ...envG, GEMINI_MODELOS: 'modelo-novo' });
ok(r.status === 200 && (await r.json()).modelo === 'modelo-novo', 'GEMINI_MODELOS muda a lista sem alterar o código');
r = await descrever({ fotos: [foto(1), foto(1), foto(1), foto(1)] });
ok(r.status === 400, 'mais de 3 fotos: 400');
r = await descrever({ fotos: ['aGVsbG8='] });
ok(r.status === 400, 'não-JPEG: 400');
r = await descrever({ fotos: [] });
ok(r.status === 400, 'sem fotos: 400');
r = await descrever({ fotos: [foto(1)] }, env);
ok(r.status === 500, 'sem GEMINI_API_KEY: 500');
r = await pedir('POST', '/descrever', { chave: 'errada', corpo: { fotos: [foto(1)] }, e: envG });
ok(r.status === 401, 'descrever com chave errada: 401');

// o cliente da página contra o Worker
gemini.estado = { 'gemini-3.8-flash': 200 };
const viaWorkerG = (url, o) => worker.fetch(new Request(url, { ...o, headers: { ...o.headers, Origin: ORIG } }), envG);
let cl = await descreverFotos(W, 'chavepai', { id: idFoto, texto: 'pinga', area: '', fotos: [foto(1)] }, viaWorkerG);
ok(/ACME 35/.test(cl.descricao) && cl.guardadas === 1, 'cliente: devolve a descrição');
gemini.estado = {};
let msg = '';
try { await descreverFotos(W, 'chavepai', { id: idFoto, fotos: [foto(1)] }, viaWorkerG); } catch (e) { msg = e.message; }
ok(/não dá para descrever/.test(msg), 'cliente: mostra o erro em português do Worker');
msg = '';
try { await descreverFotos(W, 'errada', { fotos: [foto(1)] }, viaWorkerG); } catch (e) { msg = e.message; }
ok(/chave/.test(msg), 'cliente: chave errada');
msg = '';
try { await descreverFotos(W, 'chavepai', { fotos: [foto(1)] }, async () => { throw new Error('sem rede'); }); } catch (e) { msg = e.message; }
ok(/Verifica a internet/.test(msg), 'cliente: sem rede');

// administração
r = await pedir('POST', '/gravar', { chave: 'chaveadmin', corpo: { ficheiros: [{ path: `projetos/${pc[0].id}.json`, conteudo: null }] } });
ok(r.status === 200 && !ficheirosGH().has(`projetos/${pc[0].id}.json`), 'chave de administração apaga ficheiros');

console.log(fails ? `\n${fails} falha(s)` : '\nTudo OK');
process.exit(fails ? 1 : 0);
