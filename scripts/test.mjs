// CHANGELOG — scripts/test.mjs (newest first)
// 2026-10-31 · v2.0 · ADD strip tests: a card built like the live one (full snapshot with edge/EV/minutes/flags,
//   recipe line, threshold legend) comes out with none of it; visible fields survive; a missing or broken data
//   block refuses to publish; the private /exec address never reaches a page.
//   WHY: Lee 2026-10-30 — results public, algorithm private. Runs before every publish (publish.yml).
// 2026-10-30 · v1.0 · ADD wrapper extraction + link rewrite tests.
import assert from 'node:assert';
import { extractUserHtml, finish, scrubCard, assertClean, publicSnapshot, PUBLIC_LEGEND } from './scrape.mjs';

const EXEC = 'https://script.google.com/macros/s/TESTDEPLOYMENTID_abc-123/exec';

// A snapshot shaped like NBACoreCard.js nbaBuildCardSnapshot_ output, with every hidden field filled.
const SNAP = {
  builtAt: '2026-10-30T23:34:00.000Z', build: 31, slate: '2026-10-30',
  legend: [['🎯', 'soft matchup — opponent allows ≥ 5% more of this stat than league average'],
    ['🪑', 'BENCHED — minutes projected halfway to 18'], ['⬆️', 'FLOOR28 — halfway to 28 minutes (build 21 minutes model)'],
    ['🚑', 'teammate out — ≥ 1 extra projected minute from the vacancy model'], ['🛸', 'some future badge with a 7% rule']],
  games: [{ eventId: '401', matchup: 'Brooklyn Nets @ Detroit Pistons', away: 'BKN', home: 'DET', tip: '7:00 PM', tipISO: '2026-10-30T23:00:00Z',
    line: 'DET -6.5 · O/U 221.5', blowout: false, notes: ['BKN: out Smith'],
    players: [{ name: 'Cade Cunningham', team: 'DET', pid: '4432166', best: 7.4, minProj: 34.6,
      news: [{ headline: 'Cleared to play', src: 'beat writer', url: 'https://example.com/x', secretish: 1 }],
      props: [{ key: 'DET|cade|PTS', code: 'PTS', line: 25.5, over: -115, under: -105, proj: 27.9, min: 34.6, side: 'OVER',
        modelP: 59, mktP: 51, edge: 7.4, ev: 9.1, l10: '7/10', l5: 28.2, szn: 26.1,
        badges: ['💎', '🎯', '🛸'], jam: 'ONFIRE', streak: 3, suspect: false, flags: 'FLOOR28|DTD' }] }] }],
  picks: [{ tip: '7:00 PM', matchup: 'BKN @ DET', kind: 'PLAY', title: 'Cade O 25.5 pts', bet: 'Cade O 25.5', blurb: '1u',
    book: 'FD', price: '-115', terms: '', edge: 7.4, ev: 9.1, modelInputs: { usage: 0.31 } }]
};

const esc = s => JSON.stringify(s).replace(/</g, '\\u003c');
const page = '<!DOCTYPE html>\n<html>\n<head>\n<base target="_top">\n<meta charset="utf-8"></head>\n<body data-build="31">' +
  '<ul class="kl"><li><b>proj</b> — our projected number for tonight (minutes × usage-driven rates × pace × opponent).</li></ul>' +
  '<div class="wrap" id="wrap"></div>' + 'x'.repeat(2500) +
  '<script type="application/json" id="cardData">' + esc(SNAP) + '</script>\n' +
  '<script>const TRACK_URL = "' + EXEC + '?view=track";</script>\n</body>\n</html>\n';

// Google's wrapper: a JS string literal (\x escapes) holding JSON with userHtml.
const wrap = html => {
  const json = JSON.stringify({ functionNames: [], userHtml: html, ncc: '{}' });
  const lit = '"' + json.replace(/\\/g, '\\\\').replace(/"/g, '\\x22').replace(/</g, '\\x3c').replace(/>/g, '\\x3e')
    .replace(/[\u0080-\uffff]/g, c => '\\u' + c.charCodeAt(0).toString(16).padStart(4, '0')) + '"';
  return '<html><head></head><body><iframe id="sandboxFrame"></iframe><script nonce="x">goog.script.init(' + lit + ', "", undefined, true, false, "0", "");</script></body></html>';
};

// 1 · wrapper extraction (double- and single-quoted literals), Google's error page, unknown shapes
assert.strictEqual(extractUserHtml(wrap(page)), page);
assert.throws(() => extractUserHtml('<html>Sorry, unable to open the file at this time.</html>'), /unable/);
assert.throws(() => extractUserHtml('<html>   </html>'), /Unknown wrapper/);
assert.throws(() => extractUserHtml('goog.script.init("" + process.exit(9))')); // a hostile literal can't reach Node

// 2 · the live-shaped card is dirty before, clean after
assert.throws(() => assertClean(page), /forbidden/);
const card = finish(scrubCard(extractUserHtml(wrap(page))), 'NBA-BOIZ Cards', true, EXEC, []);
assertClean(card);
for (const bad of ['usage-driven', '"edge"', '"ev"', '"flags"', '"pid"', '"best"', '"min"', '"key"', 'modelInputs', 'FLOOR28',
  'halfway', 'vacancy', '4432166', 'example.com', 'secretish', '🛸', EXEC]) assert.ok(!card.includes(bad), 'leaked: ' + bad);
assert.ok(card.includes('our projected number for tonight.</li>'), 'key line kept without the recipe');

// 3 · what the card shows survives
const out = JSON.parse(/id="cardData">([\s\S]*?)<\/script>/.exec(card)[1]);
const p = out.games[0].players[0], x = p.props[0];
assert.deepStrictEqual([out.slate, out.build, out.builtAt], [SNAP.slate, 31, SNAP.builtAt]);
assert.deepStrictEqual([p.name, p.team, p.minProj, p.news], ['Cade Cunningham', 'DET', 35, [{ headline: 'Cleared to play', src: 'beat writer' }]]);
assert.deepStrictEqual([x.code, x.line, x.over, x.proj, x.side, x.modelP, x.mktP, x.l10, x.l5, x.szn, x.jam, x.streak, x.suspect],
  ['PTS', 25.5, -115, 27.9, 'OVER', 59, 51, '7/10', 28.2, 26.1, 'ONFIRE', 3, false]);
assert.deepStrictEqual(x.badges, ['💎', '🎯']);
assert.deepStrictEqual(Object.keys(out.picks[0]).sort(), ['bet', 'blurb', 'book', 'kind', 'matchup', 'price', 'terms', 'tip', 'title']);
assert.deepStrictEqual(out.legend, PUBLIC_LEGEND);
assert.ok(card.includes('const TRACK_URL = "results.html"'));
assert.ok(/<head>\n<title>NBA-BOIZ Cards<\/title>\n<meta name="robots"/.test(card));

// 4 · fail closed: no data block, or a broken one, never publishes
assert.throws(() => scrubCard(page.replace('id="cardData"', 'id="other"')), /not found/);
assert.throws(() => scrubCard(page.replace(/id="cardData">\{/, 'id="cardData">{oops')), /not valid JSON/);

// 5 · publicSnapshot never touches the input
assert.strictEqual(SNAP.games[0].players[0].props[0].edge, 7.4);
assert.deepStrictEqual(publicSnapshot(null).games, []);

console.log('test.mjs: ALL PASS');
