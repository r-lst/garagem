import * as H from './src/historico.js';
import { sincronizar } from './src/sync.js';

let fails = 0;
const ok = (c, m) => { console.log((c ? '✓ ' : '✗ ') + m); if (!c) fails++; };

// pedido → projeto
let r = H.registarPedido([], { modo: 'madeira', texto: 'uma bancada para a oficina', pedido: 'P1' }, 1000);
let L = r.lista;
const id1 = r.id;
ok(L.length === 1 && L[0].estado === 'pedido', 'pedido registado');
r = H.registarPedido(L, { id: id1, modo: 'madeira', texto: 'uma bancada de 1,2 m', pedido: 'P1b' }, 1100);
L = r.lista;
ok(L.length === 1 && L[0].texto === 'uma bancada de 1,2 m' && r.id === id1, 'mudar o pedido atualiza o mesmo');
r = H.registarPedido(L, { modo: 'plano', texto: 'pintar cadeiras', pedido: 'P2' }, 1200);
L = r.lista;
const spec = { nome: 'Bancada', pecas: [{ tipo: 'tabua' }] };
r = H.registarProjeto(L, spec, 1300);
L = r.lista;
ok(r.id === id1 && L.find((e) => e.id === id1).estado === 'projeto', 'projeto liga ao pedido de madeira');
ok(H.titulo(L.find((e) => e.id === id1)) === 'Bancada', 'título passa a ser o nome do projeto');
r = H.registarProjeto(L, spec, 1400);
ok(r.lista.length === L.length && r.id === id1, 'desenhar outra vez não repete');
r = H.registarProjeto(L, { nome: 'Estante', pecas: [] }, 1500);
L = r.lista;
ok(r.novo && L.length === 3, 'projeto sem pedido à espera cria entrada nova');
ok(H.titulo({ texto: '', modo: 'plano' }, { plano: 'Plano de trabalho' }) === 'Plano de trabalho', 'título sem texto usa o tipo');
ok(H.titulo({ texto: 'a'.repeat(30) + ' ' + 'b'.repeat(40) }).endsWith('…'), 'título comprido é cortado');

// apagar e juntar
const A = H.apagar(L, id1, 2000);
ok(H.ordenados(A).length === 2 && A.find((e) => e.id === id1).apagado, 'apagar deixa marca');
const J = H.juntar(L, A);
ok(H.ordenados(J).length === 2, 'apagado não volta ao juntar');
ok(H.iguais(H.juntar(A, L), J), 'juntar não depende da ordem');

// limite
let M = [];
for (let i = 0; i < H.MAX + 5; i++) M = H.registarPedido(M, { modo: 'outro', texto: 'p' + i, pedido: '' }, 10 + i).lista;
ok(H.ordenados(M).length === H.MAX && H.ordenados(M)[0].texto === 'p' + (H.MAX + 4), `limite de ${H.MAX}, ficam os mais recentes`);

// guardar / carregar
const mem = { d: {}, getItem(k) { return this.d[k] ?? null; }, setItem(k, v) { this.d[k] = v; } };
H.guardar(mem, L);
ok(H.carregar(mem).length === L.length, 'guardar e carregar');
mem.d[H.CHAVE] = 'lixo{';
ok(H.carregar(mem).length === 0, 'dados estragados dão lista vazia');

// cópia em ficheiro
const copia = JSON.stringify(H.exportar({ perfil: { impressora: 'K1' }, historico: L }));
const imp = H.importar(copia);
ok(imp.perfil.impressora === 'K1' && imp.historico.length === L.length, 'exportar e importar');
let msg = '';
try { H.importar('{"x":1}'); } catch (e) { msg = e.message; }
ok(msg === 'Este ficheiro não é uma cópia da Garagem.', 'erro: ' + msg);

// sincronização contra um Worker simulado
function workerFalso() {
  const s = { conteudo: null, sha: null, n: 0, puts: 0 };
  s.fetch = async (url, o) => {
    if (o.headers.Authorization !== 'Bearer certo') return new Response('', { status: 401 });
    if (o.method === 'GET') return Response.json({ conteudo: s.conteudo, sha: s.sha });
    const b = JSON.parse(o.body);
    if (b.sha !== s.sha) return new Response('', { status: 409 });
    s.conteudo = b.conteudo; s.sha = 'v' + ++s.n; s.puts++;
    return Response.json({ sha: s.sha });
  };
  return s;
}
const W = workerFalso();
let S = await sincronizar('https://w.test/', 'certo', L, W.fetch);
ok(W.conteudo.historico.length === L.length && S.length === L.length, 'primeira sincronização grava tudo');
const outro = H.registarPedido([], { modo: 'outro', texto: 'noutro computador', pedido: '' }, 3000).lista;
S = await sincronizar('https://w.test', 'certo', outro, W.fetch);
ok(S.length === L.length + 1, 'junta o que está online com o local');
const puts = W.puts;
await sincronizar('https://w.test', 'certo', S, W.fetch);
ok(W.puts === puts, 'sem mudanças não grava');
msg = '';
try { await sincronizar('https://w.test', 'errado', L, W.fetch); } catch (e) { msg = e.message; }
ok(msg === 'O código de sincronização está errado.', 'erro: ' + msg);
msg = '';
try { await sincronizar('https://w.test', 'certo', L, async () => { throw new TypeError('x'); }); } catch (e) { msg = e.message; }
ok(msg === 'Sem ligação à internet.', 'erro: ' + msg);

console.log(fails ? `\n${fails} falha(s)` : '\nTudo OK');
process.exit(fails ? 1 : 0);
