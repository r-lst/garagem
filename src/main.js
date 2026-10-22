import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { STLLoader } from 'three/examples/jsm/loaders/STLLoader.js';
import { STLExporter } from 'three/examples/jsm/exporters/STLExporter.js';
import { CSS2DRenderer, CSS2DObject } from 'three/examples/jsm/renderers/CSS2DRenderer.js';
import * as G from './geo.js';
import * as PJ from './project.js';
import { GERADORES, buildSpec, extractJSON } from './shapes.js';
import { parseLines, planGroups } from './cuts.js';
import { buildPrompt, MODOS } from './prompts.js';
import { folhaCortes } from './folha.js';
import { icon, fillIcons } from './icons.js';
import * as H from './historico.js';
import { sincronizar, lerConfig, gravarConfig, chaveDoLink } from './sync.js';
import { WORKER_URL } from './config.js';

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const val = (el) => parseFloat(String(el.value).replace(',', '.'));
const fmt = (v, d = 1) => (Math.round(v * 10 ** d) / 10 ** d).toString().replace('.', ',');
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
fillIcons();

let toastT;
function toast(msg, bad = false) {
  const t = $('#toast');
  t.textContent = msg;
  t.className = 'toast show' + (bad ? ' bad' : '');
  clearTimeout(toastT);
  toastT = setTimeout(() => (t.className = 'toast'), bad ? 8000 : 3500);
}
function busy(on) { document.body.classList.toggle('busy', on); }
const later = (fn) => { busy(true); setTimeout(() => { try { fn(); } finally { busy(false); } }, 30); };

// ================= Perfil =================
const PERFIL_DEFAULT = { impressora: 'Creality K1', vx: 220, vy: 220, vz: 250, bico: '0.4', material: 'PLA', slicer: 'Cura ou Creality Print', ferramentas: '', madeiras: '', notas: '', corPLA: '#e8742a' };
function loadPerfil() {
  try { return { ...PERFIL_DEFAULT, ...JSON.parse(localStorage.getItem('oficina_perfil') || '{}') }; } catch { return { ...PERFIL_DEFAULT }; }
}
let aoGuardarPerfil = () => {}; // a cópia online liga-se aqui mais abaixo
function savePerfil() { try { localStorage.setItem('oficina_perfil', JSON.stringify(perfil)); } catch { /* sem armazenamento */ } aoGuardarPerfil(); }
const perfil = loadPerfil();
let guardadoT;
$$('[data-k]').forEach((el) => {
  el.value = perfil[el.dataset.k] ?? '';
  el.addEventListener('input', () => {
    perfil[el.dataset.k] = el.type === 'number' ? val(el) : el.value;
    savePerfil();
    $('#p-guardado').hidden = false;
    clearTimeout(guardadoT);
    guardadoT = setTimeout(() => ($('#p-guardado').hidden = true), 1500);
    if (['vx', 'vy', 'vz', 'impressora'].includes(el.dataset.k)) { drawBed(); updateInfo(); }
    equipBanner();
  });
});
const bed = () => ({ x: perfil.vx || 220, y: perfil.vy || 220, z: perfil.vz || 250 });
function equipBanner() {
  const f = (perfil.ferramentas || '').trim();
  $('#equip-banner').innerHTML = `${icon('equip')}<span><b>O teu equipamento:</b> ${esc(perfil.impressora || 'impressora por indicar')} · ${esc(perfil.material || '')} · ferramentas de madeira: ${f ? esc(f.length > 60 ? f.slice(0, 60) + '…' : f) : '<span class="warn">por preencher</span>'}</span>`;
}
equipBanner();

// ================= Navegação =================
const TABS = ['inicio', 'pedir', 'projeto', 'peca', 'cortes', 'historico', 'perfil'];
let tabAtual = '';
function showTab(name) {
  if (!TABS.includes(name)) name = 'inicio';
  tabAtual = name;
  $$('#tabs a').forEach((b) => b.classList.toggle('on', b.dataset.tab === name));
  $$('.tab').forEach((t) => t.classList.toggle('on', t.id === 'tab-' + name));
  requestAnimationFrame(() => {
    if (name === 'peca') { PV.resize(); if (geo && !fittedOnce) fitPeca(); }
    if (name === 'projeto') { JV.resize(); if (projItems && !projFitted) setView('3d'); }
    if (name === 'inicio') heroStart(); else heroStop();
  });
  if (name === 'historico') { renderHist(); agendarSync(100); }
  window.scrollTo(0, 0);
}
window.addEventListener('hashchange', () => showTab(location.hash.slice(1)));
const goto = (name) => { if (location.hash === '#' + name) showTab(name); else location.hash = name; };

// ================= Visualizador genérico =================
function toonGradient() {
  const d = new Uint8Array([120, 185, 235, 255]);
  const t = new THREE.DataTexture(d, 4, 1, THREE.RedFormat);
  t.minFilter = t.magFilter = THREE.NearestFilter;
  t.needsUpdate = true;
  return t;
}
const GRAD = toonGradient();

function makeViewer(el, { bg = 0xf7f0e3, labels = false } = {}) {
  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  el.prepend(renderer.domElement);
  let lr = null;
  if (labels) {
    lr = new CSS2DRenderer();
    Object.assign(lr.domElement.style, { position: 'absolute', inset: '0', pointerEvents: 'none', zIndex: 1 });
    el.appendChild(lr.domElement);
  }
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(bg);
  const camera = new THREE.PerspectiveCamera(35, 1, 1, 50000);
  camera.up.set(0, 0, 1);
  camera.position.set(300, -400, 300);
  const controls = new OrbitControls(camera, renderer.domElement);
  scene.add(new THREE.HemisphereLight(0xfff8ee, 0x8c7a62, 1.25));
  const sun = new THREE.DirectionalLight(0xffffff, 1.9);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.bias = -0.0004;
  sun.shadow.normalBias = 0.5;
  scene.add(sun, sun.target);
  const fill = new THREE.DirectionalLight(0xfff1e0, 0.55);
  fill.position.set(-1, 1.2, 0.6);
  scene.add(fill);
  let pending = false;
  const v = {
    renderer, scene, camera, controls, sun, el, lr,
    render() {
      if (pending) return;
      pending = true;
      requestAnimationFrame(() => { pending = false; v.renderNow(); });
    },
    renderNow() { renderer.render(scene, camera); lr?.render(scene, camera); },
    resize() {
      const w = el.clientWidth, h = el.clientHeight;
      if (!w || !h) return;
      renderer.setSize(w, h, false);
      lr?.setSize(w, h);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      v.render();
    },
    /** Enquadra a caixa vista na direção d (vetor da câmara para fora do centro). */
    fit(box, d = new THREE.Vector3(0.85, -1.2, 0.8), margin = 1.15) {
      const c = box.getCenter(new THREE.Vector3());
      const r = Math.max(box.getSize(new THREE.Vector3()).length() / 2, 15);
      const fov = THREE.MathUtils.degToRad(camera.fov / 2);
      const dist = (r / Math.sin(Math.min(fov, Math.atan(Math.tan(fov) * camera.aspect)))) * margin;
      controls.target.copy(c);
      camera.position.copy(c).add(d.clone().normalize().multiplyScalar(dist));
      camera.near = Math.max(0.5, dist / 100);
      camera.far = dist * 50;
      camera.updateProjectionMatrix();
      controls.update();
      v.shadowFor(box);
      v.render();
    },
    shadowFor(box) {
      const c = box.getCenter(new THREE.Vector3());
      const r = Math.max(box.getSize(new THREE.Vector3()).length() / 2, 15) * 1.6;
      sun.position.copy(c).add(new THREE.Vector3(0.45, -0.6, 1).normalize().multiplyScalar(r * 2.5));
      sun.target.position.copy(c);
      const sc = sun.shadow.camera;
      sc.left = -r; sc.right = r; sc.top = r; sc.bottom = -r; sc.near = 1; sc.far = r * 6;
      sc.updateProjectionMatrix();
    },
  };
  controls.addEventListener('change', v.render);
  new ResizeObserver(v.resize).observe(el);
  return v;
}

// ================= Pedir ao Claude =================
const MODO_INFO = {
  peca3d: { i: 'novo', d: 'Suportes, caixas, adaptadores, peças de substituição.' },
  alterar: { i: 'alterar', d: 'Mudar uma peça que já tens em STL: furos, abas, encaixes.' },
  madeira: { i: 'madeira', d: 'Móveis e construções. Vês em 3D e recebes a lista de cortes.' },
  plano: { i: 'plano', d: 'Organizar um trabalho: etapas, materiais e tempos.' },
  outro: { i: 'outro', d: 'Ainda não sabes bem. O Claude ajuda a descobrir.' },
};
let modo = null;
const DESTINO = { projeto: ['#projeto', 'Ir para Ver projeto'], peca: ['#peca', 'Ir para Peça 3D'] };
$('#modos').innerHTML = Object.entries(MODOS).map(([k, m]) => `<button class="tile" data-modo="${k}"><span class="ci">${icon(MODO_INFO[k].i)}</span><span><b>${m.nome}</b><span class="d">${MODO_INFO[k].d}</span></span></button>`).join('');
function setStep(n) {
  $$('#stepper li').forEach((li) => { const s = Number(li.dataset.s); li.className = s === n ? 'on' : s < n ? 'feito' : ''; });
  $$('.passo').forEach((p) => (p.hidden = Number(p.dataset.passo) !== n));
  window.scrollTo({ top: 0, behavior: 'smooth' });
}
function avisoPeca() {
  const av = $('#aviso-peca');
  if (modo === 'alterar') {
    av.className = 'aviso on';
    av.innerHTML = geo ? '<span class="ok">✓</span> Há uma peça aberta em <b>Peça 3D</b>. As medidas dela vão no pedido.' : '<span class="bad">✗</span> Ainda não abriste a peça. Abre-a primeiro em <a href="#peca">Peça 3D</a>, para o pedido levar as medidas. Se não, o Claude pergunta-te as medidas.';
  } else av.className = 'aviso';
}
$('#modos').addEventListener('click', (e) => {
  const b = e.target.closest('[data-modo]');
  if (!b) return;
  modo = b.dataset.modo;
  $('#escolhido').innerHTML = `<span class="ci">${icon(MODO_INFO[modo].i)}</span><b>${MODOS[modo].nome}</b><button class="sec" id="mudar-tipo">Mudar</button>`;
  $('#mudar-tipo').addEventListener('click', () => setStep(1));
  $('#pedido').placeholder = MODOS[modo].placeholder;
  avisoPeca();
  setStep(2);
  setTimeout(() => $('#pedido').focus(), 300);
});
$('#voltar1').addEventListener('click', () => setStep(1));
$('#voltar2').addEventListener('click', () => setStep(2));
$('#novo-pedido').addEventListener('click', () => { $('#pedido').value = ''; pedidoAtualId = null; setStep(1); });
$('#criar').addEventListener('click', () => {
  const texto = $('#pedido').value;
  if (!texto.trim() && !confirm('Não escreveste nada. Queres criar o pedido na mesma?')) return;
  $('#saida').value = buildPrompt({ modo, texto, perfil, peca: modo === 'alterar' ? partInfo() : null });
  $('#pos-passos').innerHTML = MODOS[modo].pos;
  const d = DESTINO[MODOS[modo].destino];
  const ir = $('#ir-destino');
  ir.hidden = !d;
  if (d) { ir.href = d[0]; ir.innerHTML = icon('seta') + d[1]; }
  $('#copiado').hidden = true;
  if (H.MODOS_HIST.includes(modo)) {
    const r = H.registarPedido(hist, { id: pedidoAtualId, modo, texto, pedido: $('#saida').value });
    pedidoAtualId = r.id;
    setHist(r.lista);
  }
  setStep(3);
});
$('#copiar').addEventListener('click', async () => {
  const txt = $('#saida').value;
  let done = false;
  try { await navigator.clipboard.writeText(txt); done = true; } catch { /* método antigo */ }
  if (!done) {
    const ta = $('#saida');
    ta.closest('details').open = true;
    ta.select();
    try { done = document.execCommand('copy'); } catch { /* nada */ }
  }
  const c = $('#copiado');
  c.hidden = false;
  c.textContent = done ? '✓ Copiado' : 'Não consegui copiar. Abre "Ver o pedido completo", carrega Ctrl+A e depois Ctrl+C.';
  c.className = done ? 'ok' : 'bad';
});

// ================= Peça 3D =================
const viewerEl = $('#viewer');
const PV = makeViewer(viewerEl, { bg: 0xe9e1d3 });
const CORES_PLA = { Laranja: '#e8742a', Branco: '#f2efe8', Preto: '#2f2f31', Cinzento: '#8d939a', Azul: '#2f6db5', Verde: '#3f8f4a', Vermelho: '#c8372d', Amarelo: '#e9c23a' };
$('#cores-pla').innerHTML = Object.entries(CORES_PLA).map(([n, c]) => `<button style="background:${c}" data-cor="${c}" title="${n}" aria-label="${n}"></button>`).join('');
const matPeca = new THREE.MeshStandardMaterial({ color: perfil.corPLA, roughness: 0.62, metalness: 0.02, flatShading: true });
function marcarCor() { $$('#cores-pla button').forEach((b) => b.classList.toggle('on', b.dataset.cor === perfil.corPLA)); }
marcarCor();
$('#cores-pla').addEventListener('click', (e) => {
  const b = e.target.closest('[data-cor]');
  if (!b) return;
  perfil.corPLA = b.dataset.cor;
  savePerfil();
  matPeca.color.set(perfil.corPLA);
  marcarCor();
  PV.render();
});

let bedGroup = null;
let volLines = null;
function drawBed() {
  if (bedGroup) { PV.scene.remove(bedGroup); bedGroup.traverse((o) => o.geometry?.dispose()); }
  const { x, y, z } = bed();
  bedGroup = new THREE.Group();
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(x * 6, y * 6), new THREE.ShadowMaterial({ opacity: 0.15 }));
  floor.position.z = -6;
  floor.receiveShadow = true;
  bedGroup.add(floor);
  const plate = new THREE.Mesh(new THREE.BoxGeometry(x + 16, y + 16, 5), new THREE.MeshStandardMaterial({ color: 0x2d3033, roughness: 0.8 }));
  plate.position.z = -2.55;
  plate.receiveShadow = true;
  bedGroup.add(plate);
  const pts = [];
  for (let i = -x / 2; i <= x / 2 + 0.01; i += 10) pts.push(i, -y / 2, 0.02, i, y / 2, 0.02);
  for (let j = -y / 2; j <= y / 2 + 0.01; j += 10) pts.push(-x / 2, j, 0.02, x / 2, j, 0.02);
  const gg = new THREE.BufferGeometry();
  gg.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
  bedGroup.add(new THREE.LineSegments(gg, new THREE.LineBasicMaterial({ color: 0x4a5056 })));
  volLines = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.BoxGeometry(x, y, z)), new THREE.LineBasicMaterial({ color: 0xc2561b, transparent: true, opacity: 0.45 }));
  volLines.position.z = z / 2;
  bedGroup.add(volLines);
  PV.scene.add(bedGroup);
  PV.render();
}

let geo = null;
let mesh = null;
let previewMesh = null;
let previewMode = null;
let fittedOnce = false;
const history = [];
const matPrev = new THREE.MeshBasicMaterial({ color: 0xe11d48, transparent: true, opacity: 0.42, depthWrite: false });

function fitPeca() {
  if (!geo) return;
  const b = new THREE.Box3().setFromBufferAttribute(geo.getAttribute('position'));
  PV.fit(b);
  const { x, y } = bed();
  PV.shadowFor(new THREE.Box3(new THREE.Vector3(-x / 2, -y / 2, 0), new THREE.Vector3(x / 2, y / 2, b.max.z)));
  fittedOnce = true;
}
$('#vista').addEventListener('click', fitPeca);

function partInfo() {
  if (!geo) return null;
  const b = G.bbox(geo);
  return { sx: b.size.x, sy: b.size.y, sz: b.size.z, minx: b.min.x, maxx: b.max.x, miny: b.min.y, maxy: b.max.y, minz: b.min.z, maxz: b.max.z };
}
function fitReport(size) {
  const lim = [bed().x, bed().y, bed().z];
  const dims = [size.x, size.y, size.z];
  const per = dims.map((d, i) => d <= lim[i] + 1e-6);
  const ok = per.every(Boolean);
  let tip = '';
  if (!ok) {
    const perms = [[0, 1, 2], [0, 2, 1], [1, 0, 2], [1, 2, 0], [2, 0, 1], [2, 1, 0]];
    tip = perms.find((p) => p.every((di, i) => dims[di] <= lim[i])) ? 'Cabe se rodares a peça (secção "Rodar").' : 'Não cabe em nenhuma posição. Corta-a em partes (secção "Cortar") ou reduz o tamanho.';
  }
  return { per, ok, tip, lim };
}
function updateInfo() {
  const el = $('#info');
  $('#vazio').style.display = geo ? 'none' : 'flex';
  if (!geo) { el.innerHTML = '<span class="muted">Sem peça aberta.</span>'; return; }
  const b = G.bbox(geo);
  const s = G.stats(geo);
  const f = fitReport(b.size);
  if (volLines) { volLines.material.color.set(f.ok ? 0xc2561b : 0xe11d48); volLines.material.opacity = f.ok ? 0.45 : 0.9; }
  const row = (nome, v, i) => `<tr><td>${nome}</td><td><b>${fmt(v)} mm</b></td><td class="muted">${fmt(f.lim[i], 0)} mm</td><td class="${f.per[i] ? 'ok' : 'bad'}">${f.per[i] ? '✓' : '✗'}</td></tr>`;
  el.innerHTML = `<table><tr><th>Eixo</th><th>Medida</th><th>Máx. ${esc(perfil.impressora || '')}</th><th></th></tr>
    ${row('Comprimento X', b.size.x, 0)}${row('Largura Y', b.size.y, 1)}${row('Altura Z', b.size.z, 2)}</table>
    ${f.ok ? '<div class="ok">✓ Cabe na impressora</div>' : `<div class="bad">✗ Não cabe. ${f.tip}</div>`}
    <div class="muted" style="margin-top:6px">Volume ${fmt(s.volume / 1000, 1)} cm³ (≈ ${fmt((s.volume / 1000) * 1.24 * 0.35, 0)} g de PLA com 20% de enchimento) · ${s.closed ? '✓ malha fechada' : '✗ malha com buracos: cortes e furos podem falhar'}</div>`;
  if (!$('#painel').contains(document.activeElement)) syncMedidas();
}
function syncMedidas() {
  if (!geo) return;
  const b = G.bbox(geo);
  $('#mx').value = Math.round(b.size.x * 100) / 100;
  $('#my').value = Math.round(b.size.y * 100) / 100;
  $('#mz').value = Math.round(b.size.z * 100) / 100;
}
function showMesh() {
  if (mesh) { PV.scene.remove(mesh); mesh.geometry.dispose(); }
  mesh = new THREE.Mesh(geo, matPeca);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  PV.scene.add(mesh);
}
function setGeo(g, msg, { fit = false, noHistory = false } = {}) {
  if (geo && !noHistory) { history.push(geo); if (history.length > 30) history.shift(); }
  geo = g;
  showMesh();
  previewMode = null;
  updatePreview();
  updateInfo();
  syncMedidas();
  if (fit || !fittedOnce) fitPeca();
  $('#desfazer').disabled = history.length === 0;
  avisoPeca();
  if (msg) toast(msg);
  PV.render();
}
$('#desfazer').addEventListener('click', () => {
  if (!history.length) return;
  geo = history.pop();
  showMesh();
  previewMode = null;
  updatePreview(); updateInfo(); syncMedidas();
  $('#desfazer').disabled = history.length === 0;
  toast('Desfeito.');
});
function run(msg, fn) {
  if (!geo) { toast('Abre ou cria uma peça primeiro.', true); return; }
  later(() => { try { setGeo(fn(geo), msg); } catch (e) { console.error(e); toast('Não foi possível: ' + (e.message || e), true); } });
}

function readHole() { return { axis: $('#f-eixo').value, d: val($('#f-d')), a: val($('#f-a')), b: val($('#f-b')), depth: val($('#f-prof')) || 0, from: $('#f-from').value }; }
function readCut() { return { axis: $('#c-eixo').value, pos: val($('#c-pos')), keep: $('#c-keep').value }; }
function updatePreview() {
  if (previewMesh) { PV.scene.remove(previewMesh); previewMesh.geometry.dispose(); previewMesh = null; }
  if (geo && previewMode) {
    try {
      const g = previewMode === 'furo' ? G.holeCutter(geo, readHole()) : G.cutterBox(geo, readCut());
      previewMesh = new THREE.Mesh(g, matPrev);
      PV.scene.add(previewMesh);
    } catch { /* valores incompletos */ }
  }
  PV.render();
}
$('#painel').addEventListener('focusin', (e) => {
  const sec = e.target.closest('#sec-furo, #sec-corte');
  const m = sec ? (sec.id === 'sec-furo' ? 'furo' : 'corte') : null;
  if (m !== previewMode) { previewMode = m; updatePreview(); }
});
$('#painel').addEventListener('input', (e) => {
  if (e.target.closest('#sec-furo')) { previewMode = 'furo'; updatePreview(); }
  if (e.target.closest('#sec-corte')) { previewMode = 'corte'; updatePreview(); }
});
$('#sec-furo').addEventListener('toggle', () => { if (!$('#sec-furo').open && previewMode === 'furo') { previewMode = null; updatePreview(); } });
$('#sec-corte').addEventListener('toggle', () => { if (!$('#sec-corte').open && previewMode === 'corte') { previewMode = null; updatePreview(); } });

const NOMES_EIXO = {
  furo: { z: ['Posição X (mm desde a esquerda)', 'Posição Y (mm desde a frente)'], x: ['Posição Y (mm desde a frente)', 'Posição Z (mm desde a base)'], y: ['Posição X (mm desde a esquerda)', 'Posição Z (mm desde a base)'] },
  keep: { z: ['a parte de baixo', 'a parte de cima'], x: ['a parte da esquerda', 'a parte da direita'], y: ['a parte da frente', 'a parte de trás'] },
};
function refreshAxisUI(resetValues) {
  const fa = $('#f-eixo').value;
  $('#f-a-l').textContent = NOMES_EIXO.furo[fa][0];
  $('#f-b-l').textContent = NOMES_EIXO.furo[fa][1];
  const ca = $('#c-eixo').value;
  const keep = $('#c-keep');
  const cur = keep.value || 'baixo';
  keep.innerHTML = `<option value="baixo">${NOMES_EIXO.keep[ca][0]}</option><option value="cima">${NOMES_EIXO.keep[ca][1]}</option>`;
  keep.value = cur;
  if (resetValues && geo) {
    const s = G.bbox(geo).size.toArray();
    const others = [0, 1, 2].filter((i) => i !== G.AXIS[fa]);
    $('#f-a').value = Math.round((s[others[0]] / 2) * 100) / 100;
    $('#f-b').value = Math.round((s[others[1]] / 2) * 100) / 100;
    $('#c-pos').value = Math.round((s[G.AXIS[ca]] / 2) * 100) / 100;
  }
}
$('#f-eixo').addEventListener('change', () => refreshAxisUI(true));
$('#c-eixo').addEventListener('change', () => refreshAxisUI(true));
refreshAxisUI(false);

async function loadFile(file) {
  if (!file) return;
  busy(true);
  try {
    const raw = new STLLoader().parse(await file.arrayBuffer());
    if (!raw.getAttribute('position') || raw.getAttribute('position').count < 3) throw new Error('O ficheiro não tem geometria.');
    const g = G.placeOnBed(G.clean(raw));
    history.length = 0;
    $('#nome-saida').value = file.name.replace(/\.stl$/i, '') + '_alterada.stl';
    setGeo(g, `Aberto: ${file.name}`, { fit: true, noHistory: true });
    refreshAxisUI(true);
    $('#desfazer').disabled = true;
  } catch (e) {
    console.error(e);
    toast('Não consegui abrir o ficheiro: ' + (e.message || e), true);
  }
  busy(false);
}
$('#ficheiro').addEventListener('change', (e) => { loadFile(e.target.files[0]); e.target.value = ''; });
['dragenter', 'dragover'].forEach((ev) => viewerEl.addEventListener(ev, (e) => { e.preventDefault(); viewerEl.classList.add('drag'); }));
['dragleave', 'drop'].forEach((ev) => viewerEl.addEventListener(ev, (e) => { e.preventDefault(); viewerEl.classList.remove('drag'); }));
viewerEl.addEventListener('drop', (e) => { const f = e.dataTransfer.files[0]; if (f) loadFile(f); });

const gerSel = $('#gerador');
gerSel.innerHTML = Object.entries(GERADORES).map(([k, g]) => `<option value="${k}">${g.nome}</option>`).join('');
function drawGerCampos() {
  const g = GERADORES[gerSel.value];
  $('#gerador-campos').innerHTML = g.campos.map((c) => `<div><label for="g-${c.k}">${c.l}</label><input type="number" id="g-${c.k}" data-gk="${c.k}" value="${c.v}" step="any" min="0"></div>`).join('');
}
gerSel.addEventListener('change', drawGerCampos);
drawGerCampos();
$('#gerar').addEventListener('click', () => later(() => {
  try {
    const p = {};
    $$('[data-gk]').forEach((el) => (p[el.dataset.gk] = val(el)));
    for (const v of Object.values(p)) if (!(v >= 0) || !isFinite(v)) throw new Error('Há um campo com valor inválido.');
    const out = G.placeOnBed(buildSpec(GERADORES[gerSel.value].gerar(p)));
    $('#nome-saida').value = gerSel.value + '.stl';
    setGeo(out, 'Peça criada.', { fit: true });
    refreshAxisUI(true);
  } catch (e) { toast(e.message || String(e), true); }
}));
$('#construir').addEventListener('click', () => {
  const erro = $('#json-erro');
  erro.className = 'erro';
  later(() => {
    try {
      const spec = extractJSON($('#json').value);
      if (spec.pecas && !spec.operacoes) throw new Error('Isto é um projeto de madeira. Cola-o em "Ver projeto".');
      const usarBase = $('#json-base').checked || String(spec.base || '').toLowerCase().startsWith('carreg');
      if (usarBase && !geo) throw new Error('Pediste para aplicar sobre a peça aberta, mas não há nenhuma peça aberta.');
      let out = buildSpec(spec, usarBase ? geo : null);
      if (!usarBase) {
        out = G.placeOnBed(out);
        $('#nome-saida').value = slug(spec.nome || 'peca') + '.stl';
      }
      setGeo(out, usarBase ? 'Alterações aplicadas.' : 'Peça construída.', { fit: !usarBase });
      refreshAxisUI(true);
    } catch (e) {
      erro.textContent = e.message || String(e);
      erro.className = 'erro on';
    }
  });
});
const slug = (s) => String(s).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '') || 'peca';

function onMedida(changed) {
  if (!$('#prop').checked || !geo) return;
  const b = G.bbox(geo).size;
  const base = { mx: b.x, my: b.y, mz: b.z };
  const v = val($('#' + changed));
  if (!(v > 0)) return;
  const k = v / base[changed];
  for (const id of ['mx', 'my', 'mz']) if (id !== changed) $('#' + id).value = Math.round(base[id] * k * 100) / 100;
}
['mx', 'my', 'mz'].forEach((id) => $('#' + id).addEventListener('input', () => onMedida(id)));
$('#aplicar-medidas').addEventListener('click', () => run('Medidas aplicadas.', (g) => {
  const b = G.bbox(g).size;
  const t = [val($('#mx')), val($('#my')), val($('#mz'))];
  if (t.some((x) => !(x > 0))) throw new Error('Medidas inválidas.');
  return G.scaleAxes(g, t[0] / b.x, t[1] / b.y, t[2] / b.z);
}));
$('#aplicar-pct').addEventListener('click', () => run('Escala aplicada.', (g) => {
  const k = val($('#pct')) / 100;
  if (!(k > 0)) throw new Error('Percentagem inválida.');
  return G.scaleAxes(g, k, k, k);
}));
$('#aplicar-furo').addEventListener('click', () => run('Furo feito.', (g) => G.addHole(g, readHole())));
$('#aplicar-corte').addEventListener('click', () => run('Corte feito.', (g) => G.cut(g, readCut())));
$('#aplicar-base').addEventListener('click', () => run('Base juntada.', (g) => G.addBase(g, { margin: val($('#b-m')), thick: val($('#b-t')) })));
$$('[data-rot]').forEach((b) => b.addEventListener('click', () => {
  const [ax, deg] = b.dataset.rot.split(',');
  run('Peça rodada.', (g) => G.placeOnBed(G.rotate(g, ax, Number(deg))));
}));
$$('[data-mir]').forEach((b) => b.addEventListener('click', () => run('Peça espelhada.', (g) => G.mirror(g, b.dataset.mir))));
$('#assentar').addEventListener('click', () => run('Peça assente na mesa.', (g) => G.placeOnBed(g)));

function download(data, filename, type = 'model/stl') {
  const blob = data instanceof Blob ? data : new Blob([data], { type });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
}
const stlData = (g) => new STLExporter().parse(new THREE.Mesh(g), { binary: true });
function nomeFicheiro() {
  const n = ($('#nome-saida').value.trim() || 'peca.stl').replace(/[\\/:*?"<>|]+/g, '_');
  return /\.stl$/i.test(n) ? n : n + '.stl';
}
$('#guardar').addEventListener('click', () => {
  if (!geo) { toast('Não há peça para guardar.', true); return; }
  download(stlData(geo), nomeFicheiro());
  toast('Guardado: ' + nomeFicheiro());
});
$('#guardar-duas').addEventListener('click', () => {
  if (!geo) { toast('Abre ou cria uma peça primeiro.', true); return; }
  later(() => {
    try {
      const c = readCut();
      const base = nomeFicheiro().replace(/\.stl$/i, '');
      const p1 = G.cut(geo, { ...c, keep: 'baixo' });
      const p2 = G.cut(geo, { ...c, keep: 'cima' });
      download(stlData(G.placeOnBed(p1)), base + '_parte1.stl');
      setTimeout(() => download(stlData(G.placeOnBed(p2)), base + '_parte2.stl'), 400);
      toast('Guardadas as duas partes. Se o navegador perguntar, permite vários downloads.');
    } catch (e) { toast('Não foi possível: ' + (e.message || e), true); }
  });
});

// ================= Ver projeto =================
const projEl = $('#proj-viewer');
const JV = makeViewer(projEl, { bg: 0xf7f0e3, labels: true });
let projRoot = null;
let projItems = null;
let projData = null;
let projBox = null;
let projFitted = false;
let projSel = null;
let projCortes = null;
const EDGE_COLOR = 0x3b2a1e;

function addGround(v, box) {
  const s = box.getSize(new THREE.Vector3());
  const R = Math.max(s.x, s.y, 300) * 3;
  const g = new THREE.Group();
  const sh = new THREE.Mesh(new THREE.PlaneGeometry(R * 2, R * 2), new THREE.ShadowMaterial({ opacity: 0.16 }));
  sh.receiveShadow = true;
  sh.position.set(box.getCenter(new THREE.Vector3()).x, box.getCenter(new THREE.Vector3()).y, box.min.z - 0.5);
  g.add(sh);
  const step = R > 4000 ? 200 : 100;
  const pts = [];
  const cx = Math.round(sh.position.x / step) * step, cy = Math.round(sh.position.y / step) * step;
  for (let i = -R; i <= R; i += step) { pts.push(cx + i, cy - R, 0, cx + i, cy + R, 0, cx - R, cy + i, 0, cx + R, cy + i, 0); }
  const gg = new THREE.BufferGeometry();
  gg.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
  const grid = new THREE.LineSegments(gg, new THREE.LineBasicMaterial({ color: 0xc9b493, transparent: true, opacity: 0.35 }));
  grid.position.z = box.min.z - 0.4;
  g.add(grid);
  return g;
}

function woodMaterial(cor) {
  return new THREE.MeshToonMaterial({ color: cor, gradientMap: GRAD });
}
const matMetal = new THREE.MeshStandardMaterial({ color: 0x9aa1a8, metalness: 0.75, roughness: 0.35 });

/** Monta um grupo 3D para um projeto. Devolve {root, items(com group), box}. */
function buildProjectScene(proj, { labels = true } = {}) {
  const items = PJ.buildItems(proj);
  const box = PJ.assemblyBox(items);
  const center = box.getCenter(new THREE.Vector3());
  const root = new THREE.Group();
  const mats = new Map();
  const wood = items.filter((it) => !it.ferragem);
  for (const it of items) {
    const g = new THREE.Group();
    let m;
    if (it.ferragem) m = new THREE.Mesh(it.geometry, matMetal);
    else {
      const cor = PJ.corMadeira(it.peca.madeira);
      if (!mats.has(cor)) mats.set(cor, woodMaterial(cor));
      m = new THREE.Mesh(it.geometry, mats.get(cor).clone());
      const e = new THREE.LineSegments(new THREE.EdgesGeometry(it.geometry, 28), new THREE.LineBasicMaterial({ color: EDGE_COLOR, transparent: true, opacity: 0.85 }));
      g.add(e);
      it.edges = e;
    }
    m.castShadow = true;
    m.receiveShadow = true;
    g.add(m);
    it.mesh = m;
    it.group = g;
    it.center = it.geometry.boundingBox.getCenter(new THREE.Vector3());
    it.key = rowKey(it.peca);
    m.userData.item = it;
    root.add(g);
  }
  // ferragens acompanham a peça de madeira mais próxima ao separar
  for (const it of items) {
    if (!it.ferragem) continue;
    let best = null, bd = Infinity;
    const p = it.center;
    for (const w of wood) { const d = w.geometry.boundingBox.distanceToPoint(p); if (d < bd) { bd = d; best = w; } }
    it.dono = best;
  }
  for (const it of wood) it.dir = it.center.clone().sub(center);
  if (labels) {
    const seen = new Set();
    for (const it of wood) {
      if (seen.has(it.key)) continue;
      seen.add(it.key);
      const n = wood.filter((w) => w.key === it.key).length;
      const div = document.createElement('div');
      div.className = 'lbl';
      div.textContent = it.peca.nome + (n > 1 ? ` ×${n}` : '');
      const o = new CSS2DObject(div);
      o.position.set(it.center.x, it.center.y, it.geometry.boundingBox.max.z + 8);
      o.userData.nome = true;
      it.group.add(o);
    }
  }
  return { root, items, box };
}

function dimsTxt(p) {
  const f0 = (v) => fmt(v, 0);
  if (p.tipo === 'tabua') return [...p.medidas].sort((a, b) => b - a).map(f0).join(' × ');
  if (p.tipo === 'varao') return `Ø${f0(p.diametro)} × ${f0(p.comprimento)}`;
  if (p.tipo === 'perfil') {
    const xs = p.pts.map((v) => v[0]), ys = p.pts.map((v) => v[1]);
    const a = Math.max(...xs) - Math.min(...xs), b = Math.max(...ys) - Math.min(...ys);
    return `${f0(Math.max(a, b))} × ${f0(Math.min(a, b))} × ${f0(p.espessura)}`;
  }
  return '';
}
const rowKey = (p) => p.nome + '|' + dimsTxt(p) + '|' + p.tipo;

function makeDims(box) {
  const g = new THREE.Group();
  const s = box.getSize(new THREE.Vector3());
  const off = Math.max(s.x, s.y, s.z) * 0.09 + 20;
  const mat = new THREE.LineBasicMaterial({ color: 0x9b4211 });
  const tick = off * 0.25;
  const seg = (a, b, axisTick) => {
    const pts = [a, b];
    for (const p of [a, b]) pts.push(p.clone().addScaledVector(axisTick, -tick), p.clone().addScaledVector(axisTick, tick));
    const geom = new THREE.BufferGeometry().setFromPoints([pts[0], pts[1], pts[2], pts[3], pts[4], pts[5]]);
    g.add(new THREE.LineSegments(geom, mat));
    const div = document.createElement('div');
    div.className = 'lbl cota';
    div.textContent = fmt(a.distanceTo(b), 0) + ' mm';
    const o = new CSS2DObject(div);
    o.position.copy(a).add(b).multiplyScalar(0.5);
    g.add(o);
  };
  const { min, max } = box;
  const z0 = min.z + 0.5;
  seg(new THREE.Vector3(min.x, min.y - off, z0), new THREE.Vector3(max.x, min.y - off, z0), new THREE.Vector3(0, 1, 0));
  seg(new THREE.Vector3(max.x + off, min.y, z0), new THREE.Vector3(max.x + off, max.y, z0), new THREE.Vector3(1, 0, 0));
  seg(new THREE.Vector3(min.x - off, min.y - off * 0.3, min.z), new THREE.Vector3(min.x - off, min.y - off * 0.3, max.z), new THREE.Vector3(1, 0, 0));
  return g;
}

let projDims = null;
let projGround = null;
function showProject(spec) {
  const proj = PJ.parseProject(spec);
  if (projRoot) {
    JV.scene.remove(projRoot);
    projRoot.traverse((o) => { if (o.isCSS2DObject) o.element.remove(); o.geometry?.dispose?.(); });
  }
  if (projGround) JV.scene.remove(projGround);
  const built = buildProjectScene(proj);
  projRoot = built.root;
  projItems = built.items;
  projBox = built.box;
  projData = proj;
  projDims = makeDims(projBox);
  projGround = addGround(JV, projBox);
  JV.scene.add(projGround);
  projRoot.add(projDims);
  JV.scene.add(projRoot);
  projSel = null;
  $('#proj-sel').hidden = true;
  $('#proj-explodir').value = 0;
  applyProjToggles();
  $('#proj-vazio').style.display = 'none';
  projFitted = false;
  setView('3d');
  renderProjInfo(proj);
}

function renderProjInfo(proj) {
  const s = projBox.getSize(new THREE.Vector3());
  $('#proj-nome').textContent = proj.nome;
  $('#proj-medidas').innerHTML = `<div><b>${fmt(s.x, 0)}</b><span>largura (mm)</span></div><div><b>${fmt(s.y, 0)}</b><span>profundidade (mm)</span></div><div><b>${fmt(s.z, 0)}</b><span>altura (mm)</span></div>`;
  const avisos = [...proj.avisos];
  const soltas = [...new Set(PJ.floatingPieces(projItems).map((it) => it.peca.nome))];
  if (soltas.length) avisos.push(`Parece${soltas.length > 1 ? 'm' : ''} solta${soltas.length > 1 ? 's' : ''} (não toca${soltas.length > 1 ? 'm' : ''} em nenhuma outra peça): ${soltas.join(', ')}. Pede ao Claude para confirmar as posições.`);
  $('#proj-avisos').innerHTML = avisos.length ? avisos.map((a) => `<li>${esc(a)}</li>`).join('') : '<li class="ok">✓ Todas as peças estão ligadas.</li>';
  // peças agrupadas
  const rows = new Map();
  for (const it of projItems) {
    if (it.ferragem) continue;
    const r = rows.get(it.key) || { nome: it.peca.nome, dims: dimsTxt(it.peca), n: 0, cor: PJ.corMadeira(it.peca.madeira), madeira: it.peca.madeira, perfil: it.peca.tipo === 'perfil' };
    r.n++;
    rows.set(it.key, r);
  }
  $('#proj-pecas').innerHTML = '<tr><th>Peça</th><th>Medidas (mm)</th><th>Qtd</th></tr>' + [...rows.entries()].map(([k, r]) => `<tr data-k="${esc(k)}"><td><span class="sw" style="background:${r.cor}"></span>${esc(r.nome)}${r.perfil ? ' <span class="muted">(recortada)</span>' : ''}</td><td>${r.dims}</td><td>${r.n}</td></tr>`).join('');
  projCortes = PJ.cutList(proj);
  const pl = projCortes.placas;
  $('#proj-placas-b').hidden = !pl.length;
  $('#proj-placas').innerHTML = '<tr><th>Peça</th><th>Medidas (mm)</th><th>Qtd</th></tr>' + pl.map((p) => `<tr><td>${esc(p.nome)}${p.recorte ? ' <span class="muted">(recortar)</span>' : ''}</td><td>${fmt(p.comprimento, 0)} × ${fmt(p.largura, 0)} × ${fmt(p.espessura, 0)}</td><td>${p.qty}</td></tr>`).join('');
  const fe = projCortes.ferragens;
  $('#proj-ferr-b').hidden = !fe.length;
  $('#proj-ferr').innerHTML = fe.map((f) => `<tr><td>${esc(f.nome)}</td><td>${f.qty}</td></tr>`).join('');
  $('#proj-cortes').disabled = !projCortes.grupos.length;
  $('#proj-info').hidden = false;
}

function applyExplode() {
  if (!projItems) return;
  const k = Number($('#proj-explodir').value) / 100;
  for (const it of projItems) {
    const src = it.ferragem ? it.dono : it;
    if (!src) continue;
    it.group.position.copy(src.dir).multiplyScalar(k * 0.9);
  }
  projDims.visible = $('#proj-cotas').checked && k < 0.04;
  JV.render();
}
function applyProjToggles() {
  if (!projRoot) return;
  const nomes = $('#proj-nomes').checked, fer = $('#proj-ferragens').checked;
  projRoot.traverse((o) => { if (o.isCSS2DObject && o.userData.nome) o.visible = nomes; });
  for (const it of projItems) if (it.ferragem) it.group.visible = fer;
  applyExplode();
}
$('#proj-explodir').addEventListener('input', applyExplode);
['#proj-cotas', '#proj-nomes', '#proj-ferragens'].forEach((s) => $(s).addEventListener('change', applyProjToggles));

const VISTAS = { '3d': [0.85, -1.2, 0.8], frente: [0, -1, 0.02], lado: [1, 0, 0.02], cima: [0, -0.02, 1] };
function setView(v) {
  if (!projBox) return;
  $$('#proj-vistas button').forEach((b) => b.classList.toggle('on', b.dataset.v === v));
  const b = projBox.clone().expandByScalar(Math.max(...projBox.getSize(new THREE.Vector3()).toArray()) * 0.12);
  JV.fit(b, new THREE.Vector3(...VISTAS[v]), v === '3d' ? 1.0 : 0.95);
  JV.shadowFor(projBox);
  projFitted = true;
}
$('#proj-vistas').addEventListener('click', (e) => { const b = e.target.closest('[data-v]'); if (b) setView(b.dataset.v); });

function selectKey(k) {
  projSel = projSel === k ? null : k;
  for (const it of projItems || []) {
    if (it.ferragem) continue;
    const on = it.key === projSel;
    it.mesh.material.emissive?.set(on ? 0x7a2e00 : 0x000000);
    it.mesh.material.transparent = !!projSel && !on;
    it.mesh.material.opacity = projSel && !on ? 0.3 : 1;
    it.mesh.material.depthWrite = !(projSel && !on);
    it.mesh.material.needsUpdate = true;
    it.edges.material.color.set(on ? 0xc2561b : EDGE_COLOR);
    it.edges.material.opacity = projSel && !on ? 0.3 : 0.85;
  }
  $$('#proj-pecas tr[data-k]').forEach((tr) => tr.classList.toggle('sel', tr.dataset.k === projSel));
  const chip = $('#proj-sel');
  if (projSel) {
    const it = projItems.find((x) => x.key === projSel);
    const n = projItems.filter((x) => x.key === projSel).length;
    chip.innerHTML = `${esc(it.peca.nome)} <span>· ${dimsTxt(it.peca)} mm · ${n > 1 ? `×${n} · ` : ''}${esc(it.peca.madeira)}</span>`;
    chip.hidden = false;
  } else chip.hidden = true;
  JV.render();
}
$('#proj-pecas').addEventListener('click', (e) => { const tr = e.target.closest('tr[data-k]'); if (tr) selectKey(tr.dataset.k); });
let downAt = null;
JV.renderer.domElement.addEventListener('pointerdown', (e) => { downAt = [e.clientX, e.clientY]; });
JV.renderer.domElement.addEventListener('pointerup', (e) => {
  if (!downAt || !projItems || Math.hypot(e.clientX - downAt[0], e.clientY - downAt[1]) > 5) return;
  const r = JV.renderer.domElement.getBoundingClientRect();
  const ray = new THREE.Raycaster();
  ray.setFromCamera(new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1), JV.camera);
  const hit = ray.intersectObjects(projItems.filter((x) => !x.ferragem).map((x) => x.mesh))[0];
  if (hit) selectKey(hit.object.userData.item.key);
  else if (projSel) selectKey(projSel);
});

function readProj(registar = true) {
  const erro = $('#proj-erro');
  erro.className = 'erro';
  try {
    const spec = extractJSON($('#proj-json').value);
    if (spec.operacoes && !spec.pecas) throw new Error('Isto é uma peça para impressão 3D. Cola-a em "Peça 3D" → "Importar do Claude".');
    showProject(spec);
    if (registar) {
      const r = H.registarProjeto(hist, spec);
      if (r.lista !== hist) setHist(r.lista);
      toast('Projeto desenhado. Ficou guardado no Histórico.');
    } else toast('Projeto desenhado.');
  } catch (e) {
    console.error(e);
    erro.textContent = e.message || String(e);
    erro.className = 'erro on';
  }
}
$('#proj-desenhar').addEventListener('click', () => later(() => readProj(true)));
const verExemplo = () => { $('#proj-json').value = JSON.stringify(PJ.EXEMPLO_PROJETO, null, 1); later(() => readProj(false)); };
$('#proj-exemplo').addEventListener('click', verExemplo);
$('#proj-exemplo2').addEventListener('click', verExemplo);

$('#proj-cortes').addEventListener('click', () => {
  if (!projCortes) return;
  $('#t-unid').value = '1';
  $('#t-lista').value = PJ.cutListText(projCortes);
  cortesExtra = extraDoProjeto();
  goto('cortes');
  setTimeout(() => $('#calcular').click(), 60);
});
function extraDoProjeto() {
  const s = projBox.getSize(new THREE.Vector3());
  return { placas: projCortes.placas, ferragens: projCortes.ferragens, nome: projData.nome, madeira: projData.madeira || '', medidas: [s.x, s.y, s.z] };
}
$('#proj-folha').addEventListener('click', () => {
  if (!projCortes) { toast('Desenha um projeto primeiro.', true); return; }
  try {
    // comprimento da tábua, serra e aparo: os do separador Cortes
    const { groups } = parseLines(PJ.cutListText(projCortes), 1);
    const plans = planGroups(groups, { board: val($('#t-comp')) * Number($('#t-unid').value), kerf: val($('#t-serra')) || 0, trim: val($('#t-aparo')) || 0 });
    imprimirFolha(plans, 1, extraDoProjeto());
  } catch (e) { toast(e.message || String(e), true); }
});

$('#proj-imagem').addEventListener('click', () => {
  if (!projItems) { toast('Desenha um projeto primeiro.', true); return; }
  JV.renderNow();
  const src = JV.renderer.domElement;
  const c = document.createElement('canvas');
  c.width = src.width; c.height = src.height;
  const x = c.getContext('2d');
  x.drawImage(src, 0, 0);
  const k = src.width / src.clientWidth;
  const v = new THREE.Vector3();
  projRoot.traverse((o) => {
    if (!o.isCSS2DObject || !o.visible || (o.parent && !o.parent.visible)) return;
    o.getWorldPosition(v).project(JV.camera);
    if (v.z > 1) return;
    const px = ((v.x + 1) / 2) * src.width, py = ((1 - v.y) / 2) * src.height;
    const cota = o.element.classList.contains('cota');
    x.font = `700 ${(cota ? 14 : 13) * k}px "Atkinson Hyperlegible", sans-serif`;
    const t = o.element.textContent;
    const w = x.measureText(t).width + 16 * k, h = 22 * k;
    x.fillStyle = cota ? '#33241a' : 'rgba(255,250,241,.95)';
    x.beginPath(); x.roundRect(px - w / 2, py - h / 2, w, h, 6 * k); x.fill();
    x.fillStyle = cota ? '#fff' : '#33241a';
    x.textAlign = 'center'; x.textBaseline = 'middle';
    x.fillText(t, px, py + 1 * k);
  });
  x.font = `700 ${22 * k}px "Zilla Slab", serif`;
  x.fillStyle = '#33241a'; x.textAlign = 'left'; x.textBaseline = 'top';
  x.fillText(projData.nome, 18 * k, 16 * k);
  c.toBlob((b) => download(b, slug(projData.nome) + '.png', 'image/png'));
});

// ================= Início (mesa a rodar) =================
let HV = null;
let heroOn = false;
function heroStart() {
  if (!HV) {
    HV = makeViewer($('#hero3d'), { bg: 0xf6eee1 });
    HV.controls.enableZoom = false;
    HV.controls.enablePan = false;
    HV.controls.autoRotate = true;
    HV.controls.autoRotateSpeed = 1.2;
    const b = buildProjectScene(PJ.parseProject(PJ.EXEMPLO_PROJETO), { labels: false });
    HV.scene.add(b.root, addGround(HV, b.box));
    HV.scene.background = null;
    HV.renderer.setClearAlpha(0);
    HV.resize();
    HV.fit(b.box.clone().expandByScalar(20), new THREE.Vector3(0.9, -1.25, 0.75), 0.95);
  }
  if (heroOn) return;
  heroOn = true;
  const loop = () => { if (!heroOn) return; HV.controls.update(); HV.renderNow(); requestAnimationFrame(loop); };
  loop();
}
function heroStop() { heroOn = false; }

// ================= Cortes =================
let cortesExtra = null;
$('#t-lista').addEventListener('input', () => { cortesExtra = null; });
$('#exemplo').addEventListener('click', () => { $('#t-lista').value = 'tampo; 1200; 2\nperna; 700; 4\ntravessa curta; 500; 3\ntravessa longa; 900; 2'; cortesExtra = null; });
let cores = new Map();
function cor(nome) {
  if (!cores.has(nome)) cores.set(nome, `hsl(${(cores.size * 67 + 25) % 360} 58% 80%)`);
  return cores.get(nome);
}
$('#calcular').addEventListener('click', () => {
  const erro = $('#t-erro');
  erro.className = 'erro';
  try {
    const f = Number($('#t-unid').value);
    const { groups, errors } = parseLines($('#t-lista').value, f);
    if (errors.length) throw new Error(errors.join('\n'));
    if (!groups.length) throw new Error('Escreve pelo menos uma peça.');
    const board = val($('#t-comp')) * f;
    const plans = planGroups(groups, { board, kerf: val($('#t-serra')) || 0, trim: val($('#t-aparo')) || 0 });
    renderPlans(plans, f);
  } catch (e) {
    erro.textContent = e.message || String(e);
    erro.className = 'erro on';
  }
});
function imprimirFolha(plans, f, extra) {
  $('#folha').innerHTML = folhaCortes({ titulo: extra?.nome || '', medidas: extra?.medidas || null, madeira: extra?.madeira || '', plans, f, extra });
  document.body.classList.add('a-imprimir');
  window.print();
}
window.addEventListener('afterprint', () => document.body.classList.remove('a-imprimir'));
function renderPlans(plans, f) {
  const u = f === 10 ? 'cm' : 'mm';
  const show = (mm) => fmt(mm / f, f === 10 ? 1 : 0);
  cores = new Map();
  const tot = plans.reduce((a, p) => ({ t: a.t + p.count, n: a.n + p.pecas, used: a.used + (p.count * p.board - p.sobra), all: a.all + p.count * p.board }), { t: 0, n: 0, used: 0, all: 0 });
  let h = `<h2>${cortesExtra ? esc(cortesExtra.nome) + ': ' : ''}tábuas a comprar</h2>`;
  h += `<div class="resumo"><div><b>${tot.t}</b>tábuas de ${show(plans[0].board)} ${u}</div><div><b>${tot.n}</b>peças a cortar</div><div><b>${fmt(tot.all ? (tot.used / tot.all) * 100 : 0, 0)}%</b>de aproveitamento</div></div>`;
  for (const plan of plans) {
    h += '<div class="grupo-cortes">';
    if (plan.nome) h += `<h3>${esc(plan.nome)} — ${plan.count} tábua${plan.count === 1 ? '' : 's'}</h3>`;
    if (plan.oversize.length) {
      const nomes = [...new Set(plan.oversize.map((i) => `${i.nome} (${show(i.len)} ${u})`))].join(', ');
      h += `<div class="erro on">✗ Maiores que a tábua, ficaram de fora: ${esc(nomes)}</div>`;
    }
    plan.boards.forEach((b, i) => {
      const segs = b.items.map((it) => `<div class="peca" style="width:${(it.len / plan.board) * 100}%;background-color:${cor(it.nome)}" title="${esc(it.nome)} ${show(it.len)} ${u}">${esc(it.nome)}<br>${show(it.len)}</div>`).join('');
      h += `<div class="tabua"><div class="tit">Tábua ${i + 1} · sobra ${show(b.resto + (plan.board - plan.cap))} ${u}</div><div class="barra">${segs}</div></div>`;
    });
    const grupos = new Map();
    plan.boards.forEach((b, i) => b.items.forEach((it) => {
      const k = it.nome + '|' + it.len;
      if (!grupos.has(k)) grupos.set(k, { nome: it.nome, len: it.len, n: 0, tabuas: new Set() });
      const g = grupos.get(k); g.n++; g.tabuas.add(i + 1);
    }));
    h += `<table class="lista"><tr><th>Peça</th><th>Medida</th><th>Qtd</th><th>Tábua nº</th></tr>${[...grupos.values()].map((g) => `<tr><td><span class="sw" style="background:${cor(g.nome)}"></span>${esc(g.nome)}</td><td>${show(g.len)} ${u}</td><td>${g.n}</td><td>${[...g.tabuas].join(', ')}</td></tr>`).join('')}</table></div>`;
  }
  if (plans[0].kerf > 0) h += `<p class="muted">Contado o corte da serra (${fmt(plans[0].kerf, 1)} mm) entre peças.</p>`;
  if (cortesExtra?.placas?.length) h += `<h3>Também precisas (placas e peças largas)</h3><table class="lista"><tr><th>Peça</th><th>Medidas</th><th>Qtd</th></tr>${cortesExtra.placas.map((p) => `<tr><td>${esc(p.nome)}${p.recorte ? ' (recortar)' : ''}</td><td>${fmt(p.comprimento, 0)} × ${fmt(p.largura, 0)} × ${fmt(p.espessura, 0)} mm</td><td>${p.qty}</td></tr>`).join('')}</table>`;
  if (cortesExtra?.ferragens?.length) h += `<h3>Ferragens</h3><table class="lista">${cortesExtra.ferragens.map((p) => `<tr><td>${esc(p.nome)}</td><td>${p.qty}</td></tr>`).join('')}</table><p class="muted">Só as ferragens que o Claude desenhou. Confirma na lista de materiais dele.</p>`;
  h += `<div class="row no-print"><button id="imprimir" class="sec">${icon('imprimir')}Imprimir folha de cortes</button></div>`;
  const out = $('#t-saida');
  out.innerHTML = h;
  out.hidden = false;
  const extra = cortesExtra;
  $('#imprimir').addEventListener('click', () => imprimirFolha(plans, f, extra));
  out.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

// ================= Histórico =================
const LS = { getItem(k) { try { return localStorage.getItem(k); } catch { return null; } }, setItem(k, v) { localStorage.setItem(k, v); } };
let hist = H.carregar(LS);
let pedidoAtualId = null;
const NOMES_MODO = Object.fromEntries(Object.entries(MODOS).map(([k, m]) => [k, m.nome]));
const MESES = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];
const quando = (t) => { const d = new Date(t), p = (n) => String(n).padStart(2, '0'); return `${d.getDate()} ${MESES[d.getMonth()]} ${d.getFullYear()}, ${p(d.getHours())}:${p(d.getMinutes())}`; };

function setHist(lista) {
  hist = lista;
  if (!H.guardar(LS, hist)) toast('Não consegui guardar o histórico neste browser.', true);
  renderHist();
  agendarSync();
}
function renderHist() {
  const lista = H.ordenados(hist);
  if (!lista.length) {
    $('#hist-lista').innerHTML = `<div class="bloco hist-vazio"><span class="ci">${icon('historico')}</span><div><p>Ainda não há pedidos. Quando fizeres um pedido de madeira, um plano de trabalho ou "outra coisa", aparece aqui.</p><a class="btn" href="#pedir">${icon('pedir')}Fazer um pedido</a></div></div>`;
    return;
  }
  $('#hist-lista').innerHTML = lista.map((e) => {
    const pronto = e.estado === 'projeto';
    const texto = String(e.texto || '').trim();
    return `<article class="hist-item" data-id="${esc(e.id)}">
      <div class="hist-top"><span class="ci">${icon(MODO_INFO[e.modo]?.i || 'outro')}</span>
        <div class="hist-tit"><h3>${esc(H.titulo(e, NOMES_MODO))}</h3><p class="muted">${esc(quando(e.criado))} · ${esc(NOMES_MODO[e.modo] || '')}</p></div>
        <span class="estado ${pronto ? 'pronto' : ''}">${pronto ? icon('certo') + 'Projeto pronto' : 'Pedido feito'}</span></div>
      ${texto && (pronto || texto.length > 60) ? `<p class="hist-texto">«${esc(texto)}»</p>` : ''}
      <div class="row">
        ${pronto ? `<button data-acao="ver">${icon('projeto')}Ver em 3D</button>` : ''}
        ${e.pedido ? `<button class="sec" data-acao="copiar">${icon('copiar')}Copiar o pedido</button>` : ''}
        <button class="sec" data-acao="apagar">${icon('apagar')}Apagar</button>
      </div></article>`;
  }).join('');
}
async function copiarTexto(txt) {
  try { await navigator.clipboard.writeText(txt); return true; } catch { /* método antigo */ }
  const ta = document.createElement('textarea');
  ta.value = txt;
  ta.style.position = 'fixed'; ta.style.opacity = '0';
  document.body.appendChild(ta);
  ta.select();
  let done = false;
  try { done = document.execCommand('copy'); } catch { /* nada */ }
  ta.remove();
  return done;
}
$('#hist-lista').addEventListener('click', async (ev) => {
  const b = ev.target.closest('[data-acao]');
  if (!b) return;
  const e = hist.find((x) => x.id === b.closest('[data-id]').dataset.id);
  if (!e) return;
  if (b.dataset.acao === 'ver') {
    $('#proj-json').value = JSON.stringify(e.projeto, null, 1);
    goto('projeto');
    later(() => readProj(false));
  } else if (b.dataset.acao === 'copiar') {
    if (await copiarTexto(e.pedido)) toast('Pedido copiado. Cola-o no Claude com Ctrl + V.');
    else toast('Não consegui copiar. Faz o pedido outra vez em "Pedir ao Claude".', true);
  } else if (b.dataset.acao === 'apagar') {
    if (!confirm(`Apagar "${H.titulo(e, NOMES_MODO)}" do histórico?`)) return;
    if (pedidoAtualId === e.id) pedidoAtualId = null;
    setHist(H.apagar(hist, e.id));
    toast('Apagado.');
  }
});

$('#hist-exportar').addEventListener('click', () => {
  const dia = new Date().toISOString().slice(0, 10);
  download(JSON.stringify(H.exportar({ perfil, historico: hist }), null, 1), `garagem-copia-${dia}.json`, 'application/json');
  toast('Cópia guardada na pasta Transferências.');
});
$('#hist-importar').addEventListener('change', async (ev) => {
  const f = ev.target.files[0];
  ev.target.value = '';
  if (!f) return;
  try {
    const imp = H.importar(await f.text());
    if (!confirm('Recuperar esta cópia? O equipamento passa a ser o da cópia, e os pedidos da cópia juntam-se aos que já estão aqui.')) return;
    if (imp.perfil) { aplicarPerfil(imp.perfil); savePerfil(); }
    setHist(H.juntar(hist, imp.historico));
    toast('Cópia recuperada.');
  } catch (e) { toast(e.message || String(e), true); }
});

function aplicarPerfil(p) {
  for (const k of Object.keys(perfil)) delete perfil[k];
  Object.assign(perfil, PERFIL_DEFAULT, p);
  $$('[data-k]').forEach((el) => (el.value = perfil[el.dataset.k] ?? ''));
  matPeca.color.set(perfil.corPLA);
  marcarCor(); drawBed(); updateInfo(); equipBanner();
}

// ---------- cópia online (Worker) ----------
const syncCfg = lerConfig(LS);
// 0 = este aparelho nunca guardou equipamento (só recebe o online); 1 = já tinha antes da cópia online existir
if (syncCfg.perfilAtualizado == null) { syncCfg.perfilAtualizado = LS.getItem('oficina_perfil') ? 1 : 0; gravarConfig(LS, syncCfg); }
// link do telemóvel: .../garagem/#k=<chave>. Guarda a chave e tira-a do endereço.
const doLink = chaveDoLink(location.hash);
if (doLink) {
  syncCfg.codigo = doLink.chave;
  gravarConfig(LS, syncCfg);
  window.history.replaceState(null, '', location.pathname + location.search + (doLink.resto ? '#' + doLink.resto : ''));
  if (WORKER_URL) setTimeout(() => toast('Cópia online ligada.'), 400);
}
aoGuardarPerfil = () => { syncCfg.perfilAtualizado = Date.now(); gravarConfig(LS, syncCfg); agendarSync(); };
let syncT = null, syncA = false, syncEstado = null;
const syncLigado = () => !!(WORKER_URL && syncCfg.codigo);
function agendarSync(ms = 1500) {
  if (!syncLigado()) return;
  clearTimeout(syncT);
  syncT = setTimeout(fazerSync, ms);
}
async function fazerSync() {
  if (!syncLigado()) return;
  if (syncA) { agendarSync(); return; }
  syncA = true;
  mostrarSync();
  try {
    const perfilAntes = syncCfg.perfilAtualizado;
    const r = await sincronizar(WORKER_URL, syncCfg.codigo, { hist, perfil: { ...perfil }, perfilAtualizado: perfilAntes, conhecidos: syncCfg.conhecidos });
    const novo = H.juntar(r.hist, hist); // o pai pode ter mudado algo durante o pedido
    if (JSON.stringify(novo) !== JSON.stringify(hist)) { hist = novo; H.guardar(LS, hist); renderHist(); }
    if (!H.iguais(novo, r.hist)) agendarSync();
    syncCfg.conhecidos = r.conhecidos;
    if (r.perfil && syncCfg.perfilAtualizado === perfilAntes) {
      aplicarPerfil(r.perfil);
      try { localStorage.setItem('oficina_perfil', JSON.stringify(perfil)); } catch { /* sem armazenamento */ }
      syncCfg.perfilAtualizado = r.perfilAtualizado;
    } else if (syncCfg.perfilAtualizado !== perfilAntes) agendarSync();
    syncCfg.ultima = Date.now();
    gravarConfig(LS, syncCfg);
    syncEstado = { ok: true };
  } catch (e) { syncEstado = { ok: false, msg: e.message || String(e) }; }
  syncA = false;
  mostrarSync();
}
function mostrarSync() {
  $('#sync-bloco').hidden = !WORKER_URL;
  const el = $('#hist-sync');
  const est = $('#sync-estado');
  let h = '', cls = '';
  if (!syncLigado()) { el.hidden = true; est.className = 'muted'; est.textContent = 'Desligada. O histórico fica só neste aparelho.'; return; }
  if (syncA) h = 'A guardar a cópia online…';
  else if (syncEstado?.ok) { h = `✓ Cópia online em dia${syncCfg.ultima ? ' (' + quando(syncCfg.ultima) + ')' : ''}.`; cls = 'ok'; }
  else if (syncEstado) { h = `✗ Cópia online: ${syncEstado.msg} O histórico continua guardado neste aparelho.`; cls = 'bad'; }
  else h = 'Cópia online ligada.';
  el.hidden = false;
  el.className = 'hist-sync ' + cls;
  el.textContent = h;
  est.className = cls;
  est.textContent = h;
}
$('#sync-ligar').addEventListener('click', () => {
  const c = $('#sync-codigo').value.trim();
  if (!c) { toast('Escreve o código de sincronização.', true); return; }
  syncCfg.codigo = c;
  gravarConfig(LS, syncCfg);
  $('#sync-codigo').value = '';
  syncEstado = null;
  fazerSync();
});
$('#sync-desligar').addEventListener('click', () => {
  if (!syncCfg.codigo || !confirm('Desligar a cópia online neste aparelho? O que já lá está não é apagado.')) return;
  delete syncCfg.codigo;
  gravarConfig(LS, syncCfg);
  syncEstado = null;
  mostrarSync();
});
mostrarSync();
agendarSync(500);

// ================= Arranque =================
drawBed();
setStep(1);
showTab(location.hash.slice(1) || 'inicio');
