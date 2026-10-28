import * as F from './src/ferramentas.js';
import * as H from './src/historico.js';
import * as P from './src/project.js';
import { listasOficina, listaCompras, textoCompras, progresso } from './src/oficina.js';

let fails = 0;
const ok = (c, m) => { console.log((c ? '✓ ' : '✗ ') + m); if (!c) fails++; };
const mem = () => { const d = {}; return { getItem: (k) => d[k] ?? null, setItem: (k, v) => { d[k] = String(v); } }; };

// ---------- temporizador ----------
let T = F.iniciarTemp([], 'Cola', 30, 1000);
ok(T.length === 1 && T[0].fim === 1000 + 30 * 60000 && T[0].nome === 'Cola', 'temporizador: termina daqui a 30 min');
ok(F.iniciarTemp(T, 'x', 0).length === 1 && F.iniciarTemp(T, 'x', -5).length === 1 && F.iniciarTemp(T, 'x', 'abc').length === 1, 'temporizador: tempo inválido não cria nada');
ok(F.iniciarTemp([], '', 5, 0)[0].nome === 'Temporizador', 'temporizador: nome por omissão');
ok(F.terminados(T, 1000).length === 0 && F.terminados(T, T[0].fim).length === 1, 'temporizador: terminado quando chega a hora');
ok(F.pararTemp(T, T[0].id).length === 0, 'temporizador: parar');
const st = mem();
F.guardarTemp(st, T);
ok(F.carregarTemp(st).length === 1 && F.carregarTemp(mem()).length === 0, 'temporizador: guardar e carregar');
st.setItem(F.CHAVE_TEMP, '{lixo');
ok(F.carregarTemp(st).length === 0, 'temporizador: dados estragados dão lista vazia');
ok(F.restante(40000) === '40 s' && F.restante(12 * 60000 + 30000) === '12 min 30 s' && F.restante(125 * 60000) === '2 h 05 min' && F.restante(-5) === '0 s', 'restante: segundos, minutos, horas');
ok(F.restante(24 * 3600000) === '1 dia' && F.restante(50 * 3600000) === '2 dias 2 h', 'restante: dias');
ok(F.duracao(30) === '30 min' && F.duracao(360) === '6 h' && F.duracao(1440) === '1 dia' && F.duracao(90) === '1 h 30 min', 'duração: texto dos botões');

// ---------- caderno de medidas ----------
let M = F.guardarMedida([], { nome: ' Vão da porta ', medida: '810 × 2040 mm', nota: 'da cozinha' }, 5);
ok(M.length === 1 && M[0].nome === 'Vão da porta' && M[0].atualizado === 5, 'medidas: guarda e limpa o texto');
ok(F.guardarMedida(M, { nome: '', medida: '1' }).length === 1 && F.guardarMedida(M, { nome: 'a', medida: ' ' }).length === 1, 'medidas: sem nome ou sem medida não guarda');
M = F.guardarMedida(M, { id: M[0].id, nome: 'Vão da porta', medida: '815 × 2040 mm' }, 9);
ok(M.length === 1 && M[0].medida === '815 × 2040 mm' && M[0].nota === '' && M[0].atualizado === 9, 'medidas: corrigir não duplica');
ok(F.linhaMedida(M[0]) === 'Vão da porta: 815 × 2040 mm' && F.linhaMedida({ nome: 'A', medida: '1 m', nota: 'x' }) === 'A: 1 m (x)', 'medidas: linha para o pedido');
const s2 = mem();
F.guardarMedidas(s2, M);
ok(F.carregarMedidas(s2)[0].medida === '815 × 2040 mm', 'medidas: guardar e carregar');
ok(F.apagarMedida(M, M[0].id).length === 0, 'medidas: apagar');
const velha = { ...M[0], medida: '800', atualizado: 1 };
ok(F.juntarMedidas([velha], M)[0].medida === '815 × 2040 mm' && F.juntarMedidas([velha], M).length === 1, 'medidas: ao juntar ganha a mais recente');

// ---------- tinta, verniz e cola ----------
const verniz = F.PRODUTOS.find((p) => p.id === 'verniz'), cola = F.PRODUTOS.find((p) => p.id === 'cola');
ok(Math.abs(F.areaM2(100, 50, 2) - 1) < 1e-9, 'área: 100 × 50 cm, duas faces = 1 m²');
const q = F.quantidade(verniz, 6, 2);
ok(Math.abs(q.precisa - 1.1) < 1e-9 && q.embal.n === 1 && q.embal.tam === 2.5, 'verniz: 6 m² × 2 demãos = 1,1 L → uma lata de 2,5 L');
ok(F.quantidade(verniz, 1, 1).embal.tam === 0.25, 'verniz: pouco chega a 0,25 L');
const grande = F.quantidade(verniz, 100, 2);
ok(grande.embal.n === Math.ceil(grande.precisa / 2.5) && grande.embal.tam === 2.5, 'verniz: muita área = várias latas da maior');
ok(F.quantidade(verniz, 0, 2) === null && F.quantidade(verniz, 5, 0) === null && F.quantidade(verniz, 5, 2, 0) === null && F.quantidade(verniz, NaN, 2) === null, 'tinta: valores em falta dão null');
ok(F.quantidade(verniz, 6, 2, 24).precisa < q.precisa, 'verniz: rendimento maior gasta menos');
ok(F.textoQuantidade(0.55, 'L') === '0,55 L' && F.textoQuantidade(0.3, 'kg') === '300 g' && F.textoQuantidade(2.5, 'kg') === '2,5 kg' && F.textoQuantidade(12.34, 'L') === '12,3 L', 'texto das quantidades');
ok(F.quantidade(cola, 2).embal.tam === 0.5 || F.quantidade(cola, 2).embal.tam === 0.25, 'cola: uma camada por omissão');

// ---------- guia de madeiras ----------
ok(F.madeirasDe('todas').length === F.MADEIRAS.length && F.madeirasDe('placa').every((m) => m.grupo === 'placa') && F.madeirasDe('exterior').every((m) => m.exterior), 'madeiras: filtros');
ok(F.madeirasDe('xyz').length === F.MADEIRAS.length, 'madeiras: filtro desconhecido mostra todas');
ok(F.MADEIRAS.every((m) => m.nome && m.serve && m.cuidados && F.DUREZAS[m.dureza]), 'madeiras: todas completas');

// ---------- lista de compras ----------
const l = listasOficina(P.EXEMPLO_PROJETO);
let L = H.registarProjeto([], P.EXEMPLO_PROJETO, 1000).lista;
const id = L[0].id, k = l.comprar[0].chave;
ok(H.estadoCompra(L[0].oficina, k) === '', 'compras: começa por comprar');
L = H.ciclarCompra(L, id, k, 2000);
ok(H.estadoCompra(L[0].oficina, k) === 'tenho' && L[0].atualizado === 2000, 'compras: 1.º toque = já tenho');
L = H.ciclarCompra(L, id, k, 2100);
ok(H.estadoCompra(L[0].oficina, k) === 'comprado' && !L[0].oficina.tenho[k], 'compras: 2.º toque = comprado (e deixa de ser "tenho")');
L = H.ciclarCompra(L, id, k, 2200);
ok(H.estadoCompra(L[0].oficina, k) === '' && !L[0].oficina.comprar[k] && !L[0].oficina.tenho[k], 'compras: 3.º toque volta a por comprar');
ok(H.ciclarCompra(L, 'outro', k)[0] === L[0], 'compras: outro projeto não muda');

// projetos antigos (só tinham comprar) continuam a ler-se como comprado
const antigo = { cortar: {}, comprar: { [k]: true } };
ok(H.estadoCompra(antigo, k) === 'comprado' && H.estadoCompra(undefined, k) === '', 'compras: entradas antigas lidas como comprado');
L = H.marcarOficina(L, id, 'cortar', 'c|x', true, 2300);
ok(L[0].oficina.tenho && H.estadoCompra(L[0].oficina, k) === '', 'compras: riscar cortes não estraga o resto');

L = H.juntarExtra(L, id, '  Lixa  ', 3000);
const ch = Object.keys(L[0].oficina.extras)[0];
ok(L[0].oficina.extras[ch] === 'Lixa' && ch.startsWith('x|'), 'extras: junta "Lixa"');
ok(Object.keys(H.juntarExtra(L, id, 'lixa', 3100)[0].oficina.extras).length === 1 && H.juntarExtra(L, id, '   ', 3100) === L, 'extras: sem repetir nem vazios');
L = H.ciclarCompra(L, id, ch, 3200);
ok(H.estadoCompra(L[0].oficina, ch) === 'tenho', 'extras: também têm estados');
const lista = listaCompras(l, L[0].oficina, H.estadoCompra);
ok(lista.length === l.comprar.length + 1 && lista.at(-1).extra && lista.at(-1).estado === 'tenho', 'lista: calculadas + extras');
const txt = textoCompras(l.nome, lista);
ok(txt.startsWith('Compras para Mesa de centro:') && txt.includes(': 2 tábuas de 2400 mm') && !txt.includes('Lixa'), 'texto: só o que falta (a lixa já está tida)');
ok(textoCompras('x', lista.map((i) => ({ ...i, estado: 'comprado' }))) === '', 'texto: nada a comprar = vazio');
ok(progresso(lista, Object.fromEntries(lista.filter((i) => i.estado).map((i) => [i.chave, true]))).feitos === 1, 'progresso: conta o que está tratado');
L = H.tirarExtra(L, id, ch, 3300);
ok(!L[0].oficina.extras[ch] && !L[0].oficina.tenho[ch], 'extras: tirar limpa também o estado');
ok(H.tirarExtra(L, id, 'x|nao-existe', 3400)[0] === L[0], 'extras: tirar o que não existe não muda nada');
const apagada = H.apagar(L, id, 4000);
ok(H.ciclarCompra(apagada, id, k)[0].apagado === true && !H.ciclarCompra(apagada, id, k)[0].oficina, 'compras: entrada apagada não é mexida');

// ---------- cópia de segurança com medidas ----------
const copia = H.exportar({ perfil: {}, historico: L, medidas: M }, 0);
const imp = H.importar(JSON.stringify(copia));
ok(imp.medidas.length === 1 && imp.historico.length === 1, 'cópia: leva as medidas');
ok(H.importar(JSON.stringify(H.exportar({ perfil: {}, historico: [] }))).medidas.length === 0, 'cópia: sem medidas = lista vazia');
ok(H.importar(JSON.stringify({ app: 'garagem', historico: [] })).medidas.length === 0, 'cópia antiga (sem medidas) continua a abrir');

console.log(fails ? `\n${fails} FALHARAM` : '\nTudo OK');
process.exit(fails ? 1 : 0);
