// Modo oficina: listas de um projeto de madeira para usar na garagem (sem DOM).
// Cortar (peças por tipo de tábua, e placas) e Comprar (tábuas, placas, ferragens), cada linha com uma chave
// estável para guardar o que já foi riscado (não depende do comprimento da tábua).
import * as PJ from './project.js';
import { parseLines, planGroups } from './cuts.js';

const num = (v) => String(Math.round(v * 10) / 10).replace('.', ',');
const ehVarao = (s) => /^var[aã]o/i.test(s || '');

/**
 * @param spec  o JSON do projeto (como está guardado no histórico)
 * @param opts  {board, kerf, trim} em mm, como no separador Cortes
 * @returns {nome, madeira, medidas:[x,y,z], cortar:[{grupo, itens:[{chave, nome, medida, qty, recorte}]}], comprar:[{chave, texto, qtd}]}
 */
export function listasOficina(spec, { board = 2400, kerf = 3, trim = 0 } = {}) {
  const proj = PJ.parseProject(spec);
  const box = PJ.assemblyBox(PJ.buildItems(proj));
  const s = box.getSize(box.min.clone());
  const cl = PJ.cutList(proj);

  const cortar = cl.grupos.map((g) => ({
    grupo: g.seccao,
    itens: g.pecas.map((p) => ({ chave: `c|${g.seccao}|${p.nome}|${p.comprimento}|${p.recorte ? 1 : 0}`, nome: p.nome, medida: `${num(p.comprimento)} mm`, qty: p.qty, recorte: !!p.recorte })),
  }));
  if (cl.placas.length) {
    cortar.push({
      grupo: 'Placas',
      itens: cl.placas.map((p) => ({ chave: `p|${p.nome}|${p.comprimento}x${p.largura}x${p.espessura}`, nome: p.nome, medida: `${num(p.comprimento)} × ${num(p.largura)} × ${num(p.espessura)} mm`, qty: p.qty, recorte: !!p.recorte })),
    });
  }

  const comprar = [];
  const { groups } = parseLines(PJ.cutListText(cl), 1);
  const plans = groups.length ? planGroups(groups, { board, kerf, trim }) : [];
  for (const p of plans) {
    if (!p.count) continue;
    const n = p.count;
    const unid = ehVarao(p.nome) ? (n === 1 ? 'varão' : 'varões') : n === 1 ? 'tábua' : 'tábuas';
    comprar.push({ chave: `b|${p.nome}`, texto: p.nome, qtd: `${n} ${unid} de ${num(p.board)} mm` });
  }
  for (const p of cl.placas) comprar.push({ chave: `b|placa|${p.nome}|${p.comprimento}x${p.largura}x${p.espessura}`, texto: `Placa ${num(p.espessura)} mm: ${p.nome}`, qtd: `${num(p.comprimento)} × ${num(p.largura)} mm${p.qty > 1 ? ` × ${p.qty}` : ''}` });
  for (const f of cl.ferragens) comprar.push({ chave: `b|f|${f.nome}`, texto: f.nome, qtd: String(f.qty) });

  return { nome: proj.nome, madeira: proj.madeira || '', medidas: [s.x, s.y, s.z], cortar, comprar };
}

/** A lista de compras do projeto (linhas calculadas + extras que o pai juntou), cada uma com o seu estado. */
export function listaCompras(l, oficina = {}, estadoDe) {
  const extras = Object.entries(oficina.extras || {}).map(([chave, texto]) => ({ chave, texto, qtd: '', extra: true }));
  return [...l.comprar, ...extras].map((i) => ({ ...i, estado: estadoDe(oficina, i.chave) }));
}

/** Texto para mandar a alguém ou levar para a loja: só o que falta comprar. */
export function textoCompras(nome, itens) {
  const falta = itens.filter((i) => !i.estado);
  if (!falta.length) return '';
  return [`Compras para ${nome}:`, ...falta.map((i) => `- ${i.texto}${i.qtd ? `: ${i.qtd}` : ''}`)].join('\n');
}

/** Quantas linhas de uma lista estão riscadas: {feitos, total}. `riscado` = {chave: true}. */
export function progresso(itens, riscado = {}) {
  return { feitos: itens.filter((i) => riscado[i.chave]).length, total: itens.length };
}
