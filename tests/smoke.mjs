// End-to-end smoke test of the app (preview build with real data). Blocks deploy on failure.
import { chromium } from 'playwright';
const file = 'file://' + process.cwd() + '/Stash-preview.html';
const fails = []; const ok = (c, m) => { if (!c) fails.push(m); console.log((c ? '✅ ' : '❌ ') + m); };
const browser = await chromium.launch(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {});
for (const [name, vp] of [['desktop', { width:1280, height:900 }], ['phone', { width:390, height:844 }]]) {
  const pg = await browser.newPage({ viewport: vp }); const errs = [];
  pg.on('pageerror', e => errs.push(String(e)));
  await pg.route(/^https?:\/\//, r => r.abort()); // offline: no external calls in CI
  await pg.goto(file); await pg.waitForTimeout(800);
  const n = await pg.evaluate(() => document.querySelectorAll('.card').length);
  ok(n > 20, `${name}: home renders cards (${n})`);
  ok(await pg.evaluate(() => document.querySelectorAll('#today .card').length) === 3, `${name}: Today's 3 shows 3 picks`);
  const homeIds = await pg.evaluate(() => [...document.querySelectorAll('#v-home .card')].map(c => c.dataset.id));
  ok(new Set(homeIds).size === homeIds.length, `${name}: no item repeated across Home sections`);
  ok(await pg.evaluate(() => document.querySelectorAll('.path-card').length) > 0, `${name}: learning paths render`);
  await pg.click('#today .card h3'); await pg.waitForTimeout(200);
  ok(await pg.isVisible('#sheet-card'), `${name}: detail sheet opens`);
  await pg.click('#sheet-card [data-close].close');
  await pg.evaluate(() => stash.open(document.querySelector('#today .card').dataset.id)); await pg.waitForTimeout(200);
  ok(await pg.isVisible('#viewer'), `${name}: in-app viewer opens`);
  await pg.click('#vw-back'); await pg.waitForTimeout(200);
  ok(!(await pg.isVisible('#viewer')), `${name}: viewer closes`);
  await pg.click('[data-nav=library] >> visible=true'); await pg.waitForTimeout(200);
  ok(await pg.evaluate(() => document.querySelectorAll('.shelf').length) > 5, `${name}: shelves render`);
  await pg.click('[data-nav=ask] >> visible=true');
  for (const [q, min] of [['list everything on llm or kubernetes', 5], ['only videos', 1], ['what can I read on system design', 1], ['zzzz-nothing-here', 0]]) {
    await pg.fill('#q-ask', q); await pg.press('#q-ask', 'Enter'); await pg.waitForTimeout(150);
    const rows = await pg.evaluate(() => [...document.querySelectorAll('.bubble.bot')].pop().querySelectorAll('.ans-row').length);
    ok(min ? rows >= min : rows === 0, `${name}: chat "${q}" → ${rows} results`);
  }
  await pg.click('[data-nav=me] >> visible=true'); await pg.click('#theme [data-t=light]');
  ok(await pg.evaluate(() => document.documentElement.dataset.theme) === 'light', `${name}: light mode switches`);
  if (name === 'phone') ok(await pg.isVisible('#bottom'), 'phone: bottom navigation visible');
  ok(!errs.length, `${name}: no JavaScript errors${errs.length ? ' → ' + errs.join(' | ') : ''}`);
  await pg.close();
}
await browser.close();
console.log(fails.length ? `\n${fails.length} check(s) failed` : '\nAll checks passed');
process.exit(fails.length ? 1 : 0);
