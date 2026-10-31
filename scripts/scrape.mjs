// CHANGELOG — scripts/scrape.mjs (newest first)
// 2026-10-31 · v2.0 · SECURITY strip the model before anything goes public.
//   WHAT: the card's embedded snapshot JSON is rebuilt from a whitelist (only what the card shows); edge, EV,
//   per-prop minutes, raw model flags, prop keys, player ids and pick extras are dropped. The key's recipe line
//   and every badge threshold are removed. A final check fails the run if any of it survives. The card's /exec
//   address comes from the NBA_CARD_EXEC repo secret, never from the code. No raw copy of Google's page is kept.
//   WHY: Lee 2026-10-30 — results can be public, the algorithm can't. The live card's page source carried edge,
//   EV, minutes and flags on every prop plus the projection recipe.
//   NOTE: fail-closed. If the data block is missing, unparseable or still dirty, the run exits non-zero and the
//   last good deploy stays up. Error messages never print page content (Actions logs are public).
// 2026-10-30 · v1.0 · ADD fetch the public NBA-BOIZ Apps Script web app anonymously and write plain static pages.
import fs from 'node:fs';
import vm from 'node:vm';

// ---------- Google wrapper → the app's own HTML ----------

/** Google wrapper page → the app's HTML. Throws a content-free message if the shape is unknown. */
export function extractUserHtml(wrapper) {
  const s = String(wrapper);
  const m = /goog\.script\.init\(\s*("(?:[^"\\]|\\[\s\S])*"|'(?:[^'\\]|\\[\s\S])*')/.exec(s);
  if (m) {
    // The argument is a JS string literal holding JSON. Evaluate the literal only, in an empty sandbox.
    const json = vm.runInNewContext(m[1], Object.create(null), { timeout: 2000 });
    const obj = JSON.parse(json);
    if (obj && typeof obj.userHtml === 'string' && obj.userHtml.length) return obj.userHtml;
    throw new Error('goog.script.init found but no userHtml');
  }
  if (/<html[\s>]/i.test(s) && !/goog\.script|sandboxFrame|script\.googleusercontent/i.test(s) && /cardData|trackData|NBA-BOIZ/i.test(s)) return s;
  if (/unable to open the file|Page Not Found/i.test(s)) throw new Error('Google returned its "unable to open the file" page');
  throw new Error('Unknown wrapper format (' + s.length + ' bytes)');
}

// ---------- the card: whitelist the snapshot, scrub the key ----------

const pick = (o, keys) => {
  const out = {};
  if (!o || typeof o !== 'object') return out;
  keys.forEach(k => { if (o[k] !== undefined) out[k] = o[k]; });
  return out;
};

// Only fields the card renders (NBACardsApp.html). Everything else stays home.
const TOP_KEYS = ['builtAt', 'build', 'slate'];
const GAME_KEYS = ['eventId', 'matchup', 'away', 'home', 'tip', 'tipISO', 'line', 'blowout', 'notes'];
const PLAYER_KEYS = ['name', 'team', 'minProj'];
const PROP_KEYS = ['code', 'line', 'over', 'under', 'proj', 'side', 'modelP', 'mktP', 'l10', 'l5', 'szn', 'jam', 'streak', 'suspect'];
const NEWS_KEYS = ['headline', 'src'];
const PICK_KEYS = ['tip', 'matchup', 'kind', 'title', 'bet', 'blurb', 'note', 'book', 'price', 'terms'];

// Badge legend without thresholds. A badge not listed here is dropped from the public card and its key.
export const PUBLIC_LEGEND = [
  ['💎', 'on our Edges list'],
  ['🔥', 'ON FIRE — cleared our side of this line 3+ games in a row'],
  ['🌡️', 'HEATING UP — cleared it 2 games in a row'],
  ['🧊', 'ICE COLD — missed our side 3+ games in a row'],
  ['🎯', 'soft matchup for this stat'],
  ['🧱', 'tough matchup for this stat'],
  ['🏹', 'opponent gives up 3s'],
  ['🧲', 'opponent gives up boards'],
  ['🏃', 'fast game expected'],
  ['🐢', 'slow game expected'],
  ['🧹', 'blowout risk — starters may sit the 4th quarter'],
  ['🟨', 'foul-prone — his minutes can swing'],
  ['🚑', 'teammate out — more minutes likely'],
  ['🆕', 'new team this season'],
  ['⚠️', 'day-to-day / questionable'],
  ['📰', 'fresh news today (headline under his name)'],
  ['🌱', 'early season — projection leans on last season'],
  ['🪑', 'BENCHED — a usual starter not in tonight’s listed five'],
  ['⬆️', 'listed starter — minutes bumped up']
];
const PUBLIC_BADGES = new Set(PUBLIC_LEGEND.map(b => b[0]));

/** Snapshot → public snapshot (whitelist copy; the input is not touched). */
export function publicSnapshot(snap) {
  const s = snap || {};
  const out = pick(s, TOP_KEYS);
  out.legend = PUBLIC_LEGEND.map(b => b.slice());
  out.games = (Array.isArray(s.games) ? s.games : []).map(g => {
    const pg = pick(g, GAME_KEYS);
    if (Array.isArray(pg.notes)) pg.notes = pg.notes.filter(n => typeof n === 'string');
    pg.players = (Array.isArray(g.players) ? g.players : []).map(p => {
      const pp = pick(p, PLAYER_KEYS);
      if (typeof pp.minProj === 'number') pp.minProj = Math.round(pp.minProj);
      pp.news = (Array.isArray(p.news) ? p.news : []).map(n => pick(n, NEWS_KEYS));
      pp.props = (Array.isArray(p.props) ? p.props : []).map(x => {
        const px = pick(x, PROP_KEYS);
        px.badges = (Array.isArray(x.badges) ? x.badges : []).filter(b => PUBLIC_BADGES.has(b));
        return px;
      });
      return pp;
    });
    return pg;
  });
  if (Array.isArray(s.picks)) out.picks = s.picks.map(p => pick(p, PICK_KEYS));
  return out;
}

/** JSON → safe inside <script type="application/json"> (mirrors nbaCardJsonForScript_ in Apps Script). */
export function jsonForScript(obj) {
  return JSON.stringify(obj).replace(/</g, '\\u003c').split('\u2028').join('\\u2028').split('\u2029').join('\\u2029');
}

const DATA_BLOCK = /(<script\b[^>]*\bid=["']cardData["'][^>]*>)([\s\S]*?)(<\/script>)/i;

// Words and fields that must never reach the public card. Checked on the final HTML.
export const FORBIDDEN = [
  /usage-driven/i, /minutes\s*×/i, /"edge"\s*:/, /"ev"\s*:/, /"flags"\s*:/, /"key"\s*:/, /"pid"\s*:/,
  /"best"\s*:/, /"min"\s*:/, /projEdge|projEvFd|projFlags|projVac|projMean/, /vacancy model/i, /minutes model/i,
  /halfway to \d/i, /\d+(\.\d+)?\s*%\s*(more|less|above|below)/i, /≥\s*\d/, /top\s*\d+%\s*of the league/i
];

/** Card HTML → stripped card HTML. Throws (content-free) if the data block can't be found or parsed. */
export function scrubCard(html) {
  let h = String(html);
  const m = DATA_BLOCK.exec(h);
  if (!m) throw new Error('card data block not found — refusing to publish');
  let snap;
  try { snap = JSON.parse(m[2]); } catch (e) { throw new Error('card data block is not valid JSON — refusing to publish'); }
  h = h.slice(0, m.index) + m[1] + jsonForScript(publicSnapshot(snap)) + m[3] + h.slice(m.index + m[0].length);
  // Key: drop the projection recipe, keep "our projected number for tonight".
  h = h.replace(/\s*\(\s*minutes\s*×[^)]*\)/gi, '');
  return h;
}

/** Throws if anything on the forbidden list survives. */
export function assertClean(html) {
  const hit = FORBIDDEN.findIndex(re => re.test(html));
  if (hit >= 0) throw new Error('public card still carries forbidden item #' + hit + ' — refusing to publish');
}

// ---------- shared finishing ----------

/** Point links at the static copies, add title + noindex. exec = the private /exec address (may be ''). */
export function finish(html, title, isCard, exec, aliases) {
  let h = String(html);
  const swap = (from, to) => { if (from) h = h.split(from).join(to); };
  [exec].concat(aliases || []).forEach(u => {
    if (!u) return;
    swap(u + '?view=track', 'results.html');
    swap(u, './');
  });
  const esc = title.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  let inject = '\n<title>' + esc + '</title>\n<meta name="robots" content="noindex,nofollow">\n';
  if (isCard) inject += '<script>if (/[?&]view=track\\b/.test(location.search)) location.replace("results.html");</script>\n';
  const i = h.search(/<head[^>]*>/i);
  if (i < 0) return '<!DOCTYPE html><html><head>' + inject + '</head><body>' + h + '</body></html>';
  const end = h.indexOf('>', i) + 1;
  return h.slice(0, end) + inject + h.slice(end);
}

async function get(url) {
  let last;
  for (let a = 0; a < 3; a++) {
    try {
      const r = await fetch(url, { redirect: 'follow', headers: { 'User-Agent': 'Mozilla/5.0 (nba-boiz static mirror)', 'Accept-Language': 'en-US' } });
      const t = await r.text();
      if (r.ok) return t;
      last = new Error('HTTP ' + r.status); // no URL in the message: logs are public
    } catch (e) { last = new Error('fetch failed (' + (e && e.name) + ')'); }
    await new Promise(res => setTimeout(res, 3000 * (a + 1)));
  }
  throw last;
}

async function main() {
  const exec = String(process.env.NBA_CARD_EXEC || '').trim();
  if (!/^https:\/\/script\.google\.com\/macros\/s\/[\w-]+\/exec$/.test(exec)) throw new Error('NBA_CARD_EXEC secret missing or not an /exec address');
  const aliases = ['https://tinyurl.com/aiboiz-nba', 'https://tinyurl.com/aiboiz-results'];
  fs.mkdirSync('site', { recursive: true });
  // Card first: if it can't be cleaned, nothing is written and the last good deploy stays up.
  const cardRaw = extractUserHtml(await get(exec));
  const card = finish(scrubCard(cardRaw), 'NBA-BOIZ Cards', true, exec, aliases);
  assertClean(card);
  if (card.length < 2000) throw new Error('card looks empty (' + card.length + ' bytes)');
  const results = finish(extractUserHtml(await get(exec + '?view=track')), 'NBA-BOIZ Results', false, exec, aliases);
  if (results.length < 2000) throw new Error('results look empty (' + results.length + ' bytes)');
  if (results.includes(exec) || card.includes(exec)) throw new Error('private /exec address leaked into a page — refusing to publish');
  fs.writeFileSync('site/index.html', card);
  fs.writeFileSync('site/results.html', results);
  fs.writeFileSync('site/robots.txt', 'User-agent: *\nDisallow: /\n');
  fs.writeFileSync('site/.nojekyll', '');
  console.log('index.html: ' + Math.round(card.length / 1024) + ' KB · results.html: ' + Math.round(results.length / 1024) + ' KB');
}

if (import.meta.url === 'file://' + process.argv[1]) main().catch(e => { console.error('FAILED: ' + e.message); process.exit(1); });
