// Ícones de traço simples (24×24).
const P = {
  inicio: '<path d="M3 11l9-7 9 7"/><path d="M5 10v10h14V10"/><path d="M10 20v-6h4v6"/>',
  pedir: '<path d="M4 5h16v11H10l-6 4z"/><path d="M8 9h8M8 12h5"/>',
  projeto: '<rect x="2.5" y="6" width="19" height="2.5" rx=".5"/><path d="M5 8.5V19M19 8.5V19M5 13.5h14"/>',
  peca: '<path d="M12 3l8 4.5v9L12 21l-8-4.5v-9z"/><path d="M12 12l8-4.5M12 12v9M12 12L4 7.5"/>',
  cortes: '<path d="M3 16.5L16.5 3 21 7.5 7.5 21z"/><path d="M7 12.5l2 2M10 9.5l2 2M13 6.5l2 2"/>',
  ferramentas: '<rect x="2.5" y="8" width="19" height="8" rx="1"/><path d="M6.5 8v3M10.5 8v4.5M14.5 8v3M18.5 8v4.5"/>',
  equip: '<path d="M14.7 6.3a4 4 0 0 0-5.3 5.3L3 18l3 3 6.4-6.4a4 4 0 0 0 5.3-5.3l-2.6 2.6-2.4-.6-.6-2.4z"/>',
  novo: '<path d="M11 4l7 4v8l-7 4-7-4V8z"/><path d="M11 12l7-4M11 12v8M11 12L4 8"/><path d="M20 2v5M17.5 4.5h5"/>',
  alterar: '<path d="M4 20h4L19 9l-4-4L4 16z"/><path d="M13 7l4 4"/>',
  madeira: '<rect x="2.5" y="6" width="19" height="2.5" rx=".5"/><path d="M5 8.5V19M19 8.5V19M5 13.5h14"/>',
  plano: '<path d="M10 6h10M10 12h10M10 18h10"/><path d="M4 6l1.3 1.3L7.6 5M4 12l1.3 1.3L7.6 11M4 18l1.3 1.3L7.6 17"/>',
  outro: '<circle cx="12" cy="12" r="9"/><path d="M9.5 9.3a2.6 2.6 0 1 1 3.6 2.4c-.7.3-1.1.9-1.1 1.6v.4M12 17h.01"/>',
  copiar: '<rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V5a1 1 0 0 0-1-1H5a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h3"/>',
  abrir: '<path d="M14 4h6v6M20 4l-9 9"/><path d="M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5"/>',
  seta: '<path d="M5 12h14M13 6l6 6-6 6"/>',
  voltar: '<path d="M19 12H5M11 6l-6 6 6 6"/>',
  colar: '<rect x="5" y="4" width="14" height="17" rx="2"/><path d="M9 4V3h6v1M9 10h6M9 14h6"/>',
  imagem: '<rect x="3" y="5" width="18" height="14" rx="2"/><circle cx="9" cy="10" r="1.6"/><path d="M21 16l-5-5-8 8"/>',
  explodir: '<path d="M12 3v5M12 16v5M3 12h5M16 12h5M5.6 5.6l3 3M15.4 15.4l3 3M18.4 5.6l-3 3M8.6 15.4l-3 3"/>',
  desfazer: '<path d="M9 14L4 9l5-5"/><path d="M4 9h11a5 5 0 0 1 0 10h-3"/>',
  guardar: '<path d="M12 4v11M7 10l5 5 5-5"/><path d="M5 19h14"/>',
  enquadrar: '<path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/>',
  abrirficheiro: '<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>',
  imprimir: '<path d="M7 9V3h10v6"/><rect x="3" y="9" width="18" height="8" rx="2"/><path d="M7 14h10v7H7z"/>',
  historico: '<path d="M3.5 12a8.5 8.5 0 1 0 2.5-6"/><path d="M3 4v4h4"/><path d="M12 7.5V12l3 2"/>',
  apagar: '<path d="M4 7h16M10 11v6M14 11v6"/><path d="M6 7l1 13h10l1-13M9 7V4h6v3"/>',
  reparar: '<g transform="rotate(45 12 12)"><path d="M8 2h2.5v4h3V2H16v7.5l-2.5 2V19a1.5 1.5 0 0 1-3 0v-7.5l-2.5-2z"/><path d="M12 15.5v.01"/></g>',
  mais: '<circle cx="5" cy="12" r="1.3"/><circle cx="12" cy="12" r="1.3"/><circle cx="19" cy="12" r="1.3"/>',
  melhorpos: '<path d="M12 3l8 4.5v9L12 21l-8-4.5v-9z"/><path d="M8.5 12.5l2.5 2.5 4.5-5"/>',
  sol: '<circle cx="12" cy="12" r="4"/><path d="M12 2.5v2.5M12 19v2.5M2.5 12H5M19 12h2.5M5.3 5.3l1.8 1.8M16.9 16.9l1.8 1.8M18.7 5.3l-1.8 1.8M7.1 16.9l-1.8 1.8"/>',
  lua: '<path d="M20 14.5A8.5 8.5 0 0 1 9.5 4a8.5 8.5 0 1 0 10.5 10.5z"/>',
  oficina: '<path d="M4 20V9l8-5 8 5v11"/><path d="M9 20v-5h6v5M8.5 11.5h7"/>',
  certo:'<path d="M5 12.5l4.5 4.5L19 7.5"/>',
};
export function icon(name, cls = '') {
  return `<svg class="ic i-${name} ${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${P[name] || ''}</svg>`;
}
export function fillIcons(root = document) {
  root.querySelectorAll('[data-i]').forEach((el) => { el.innerHTML = icon(el.dataset.i) + el.innerHTML; el.removeAttribute('data-i'); });
}
