// Data quality gate for data/library.json. Exits 1 on errors (blocks deploy); prints warnings.
import { readFileSync } from 'node:fs';
const lib = JSON.parse(readFileSync('data/library.json', 'utf8'));
const errors = [], warns = [];
const E = m => errors.push(m), W = m => warns.push(m);
const TYPES = ['video','thread','site','repo','sheet','article','image','post','link'];
const ids = new Set(), urls = new Map();
if (!lib.updated || !/^\d{4}-\d{2}-\d{2}$/.test(lib.updated)) E('"updated" missing or not YYYY-MM-DD');
for (const [k, s] of Object.entries(lib.shelves || {})) for (const f of ['name','emoji','color']) if (!s[f]) E(`shelf ${k}: missing ${f}`);
for (const it of lib.items || []) {
  const tag = `item ${it.id} (${(it.ti || '').slice(0, 40)})`;
  if (!it.id) { E('item without id'); continue; }
  if (ids.has(it.id)) E(`${tag}: duplicate id`); ids.add(it.id);
  for (const f of ['ti','d','s','sh','ty']) if (!it[f]) E(`${tag}: missing "${f}"`);
  if (!it.u && !it.url) E(`${tag}: needs "u" (X post) or "url"`);
  if (it.sh && !lib.shelves[it.sh]) E(`${tag}: unknown shelf "${it.sh}"`);
  if (it.ty && !TYPES.includes(it.ty)) E(`${tag}: unknown type "${it.ty}"`);
  if (it.d && !/^\d{4}-\d{2}-\d{2}$/.test(it.d)) E(`${tag}: bad date "${it.d}"`);
  if (it.a && !/^\d{4}-\d{2}-\d{2}$/.test(it.a)) E(`${tag}: bad saved date "${it.a}"`);
  if (!it.su) W(`${tag}: no summary`);
  if (!it.m) W(`${tag}: no time estimate`);
  if (/f\*?u?c?king|insane|thank me later|steal this/i.test(it.ti || '')) E(`${tag}: clickbait title, rewrite it neutrally`);
  for (const [label, u] of it.ln || []) {
    if (!/^https?:\/\//.test(u)) E(`${tag}: bad link "${u}"`);
    if (/^https?:\/\/t\.co\//.test(u)) W(`${tag}: unresolved t.co link (${label})`);
  }
  const key = it.url || it.u;
  if (urls.has(key)) E(`${tag}: same post/url as ${urls.get(key)}`); else urls.set(key, it.id);
}
for (const [k, path] of Object.entries(lib.paths || {})) {
  if (!lib.shelves[k]) E(`path ${k}: no such shelf`);
  const seen = new Set();
  for (const id of path) { const it = lib.items.find(i => i.id === id);
    if (!it) E(`path ${k}: unknown item ${id}`); else if (it.sh !== k) E(`path ${k}: item ${id} is on shelf ${it.sh}`);
    if (seen.has(id)) E(`path ${k}: ${id} listed twice`); seen.add(id); }
}
const groups = {}; for (const it of lib.items) if (it.g) (groups[it.g] ||= []).push(it.id);
for (const [g, m] of Object.entries(groups)) if (m.length < 2) W(`group ${g} has only one item`);
warns.forEach(w => console.log('⚠️ ', w));
errors.forEach(e => console.log('❌', e));
console.log(`\n${lib.items.length} items · ${Object.keys(lib.shelves).length} shelves · ${errors.length} errors · ${warns.length} warnings`);
process.exit(errors.length ? 1 : 0);
