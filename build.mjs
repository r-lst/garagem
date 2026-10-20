import * as esbuild from 'esbuild';
import fs from 'fs';

const r = await esbuild.build({ entryPoints: ['src/main.js'], bundle: true, minify: true, format: 'iife', target: 'es2020', write: false, legalComments: 'none' });
const js = r.outputFiles[0].text.replace(/<\/script/gi, '<\\/script');
const font = (fam, file, w) => {
  const b64 = fs.readFileSync(`node_modules/@fontsource/${file}`).toString('base64');
  return `@font-face{font-family:"${fam}";font-style:normal;font-weight:${w};font-display:swap;src:url(data:font/woff2;base64,${b64}) format("woff2");}`;
};
const fonts = [
  font('Atkinson Hyperlegible', 'atkinson-hyperlegible/files/atkinson-hyperlegible-latin-400-normal.woff2', 400),
  font('Atkinson Hyperlegible', 'atkinson-hyperlegible/files/atkinson-hyperlegible-latin-700-normal.woff2', 700),
  font('Zilla Slab', 'zilla-slab/files/zilla-slab-latin-600-normal.woff2', 600),
  font('Zilla Slab', 'zilla-slab/files/zilla-slab-latin-700-normal.woff2', 700),
].join('\n');
const tpl = fs.readFileSync('src/template.html', 'utf8');
const css = fs.readFileSync('src/style.css', 'utf8');
fs.mkdirSync('dist', { recursive: true });
fs.writeFileSync('dist/index.html', tpl.replace('/*FONTS*/', () => fonts).replace('/*CSS*/', () => css).replace('/*JS*/', () => js));
console.log('dist/index.html', (fs.statSync('dist/index.html').size / 1024).toFixed(0) + ' KB');
