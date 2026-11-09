// EGX AI Analyst — شغّل: node server.js  ثم افتح http://localhost:3000  (Node 18+ بدون أي مكتبات)
const http = require('http'), fs = require('fs'), path = require('path');
const H = { 'User-Agent': 'Mozilla/5.0 (EGX-Analyst)' };
const get = async (u, o = {}) => { const r = await fetch(u, { headers: H, signal: AbortSignal.timeout(12000), ...o }); if (!r.ok) throw Error(new URL(u).host + ' → ' + r.status); return r; };
const norm = s => s.replace(/[أإآ]/g, 'ا').replace(/ة/g, 'ه').replace(/ى/g, 'ي').replace(/\s+/g, '').toLowerCase();
const NAMES = Object.fromEntries(Object.entries({ 'التجاري الدولي': 'COMI', 'طلعت مصطفى': 'TMGH', 'السويدي': 'SWDY', 'حديد عز': 'ESRS', 'عز': 'ESRS', 'فوري': 'FWRY', 'ايفاينانس': 'EFIH', 'ابوقير للاسمدة': 'ABUK', 'موبكو': 'MFPC', 'الشرقية': 'EAST', 'بالم هيلز': 'PHDC', 'مصر الجديدة': 'HELI', 'القلعة': 'CCAP', 'جهينة': 'JUFO', 'ايديتا': 'EFID', 'اوراسكوم': 'ORAS', 'المصرية للاتصالات': 'ETEL' }).map(([k, v]) => [norm(k), v]));

// ---------- المصادر ----------
async function resolve(q) {                       // اسم أو رمز → رمز
  q = q.trim(); if (/^[A-Za-z0-9.]{2,8}$/.test(q)) return q.toUpperCase().replace(/\.CA$/, '');
  if (NAMES[norm(q)]) return NAMES[norm(q)];
  const j = await (await get('https://query1.finance.yahoo.com/v1/finance/search?quotesCount=8&q=' + encodeURIComponent(q))).json();
  const hit = (j.quotes || []).find(x => /\.CA$/.test(x.symbol || ''));
  if (!hit) throw Error('مش لاقي السهم — جرّب الرمز (مثلاً COMI)'); return hit.symbol.replace(/\.CA$/, '');
}
async function prices(t) {                        // المصدر 1: Yahoo Finance (يومي، سنتين)
  const j = await (await get(`https://query1.finance.yahoo.com/v8/finance/chart/${t}.CA?range=2y&interval=1d`)).json();
  const r = j.chart.result[0], q = r.indicators.quote[0], out = [];
  r.timestamp.forEach((ts, i) => { if (q.close[i] != null) out.push({ d: new Date(ts * 1000).toISOString().slice(0, 10), o: q.open[i], h: q.high[i], l: q.low[i], c: q.close[i], v: q.volume[i] }); });
  return { name: r.meta.longName || r.meta.shortName || t, bars: out };
}
async function fundamentals(t) {                  // المصدر 2: TradingView scanner (مضاعفات، ربحية، قيمة دفترية)
  const cols = ['description', 'sector', 'industry', 'close', 'market_cap_basic', 'price_earnings_ttm', 'earnings_per_share_basic_ttm', 'dividends_yield', 'price_book_fq'];
  const j = await (await get('https://scanner.tradingview.com/egypt/scan', { method: 'POST', headers: { ...H, 'Content-Type': 'application/json' }, body: JSON.stringify({ symbols: { tickers: ['EGX:' + t] }, columns: cols }) })).json();
  const d = j.data && j.data[0] && j.data[0].d; if (!d) throw Error('TradingView: مفيش بيانات');
  const o = Object.fromEntries(cols.map((c, i) => [c, d[i]]));
  return { name: o.description, sector: o.sector, industry: o.industry, mcap: o.market_cap_basic, pe: o.price_earnings_ttm, eps: o.earnings_per_share_basic_ttm, dy: o.dividends_yield, pb: o.price_book_fq, bvps: o.price_book_fq ? o.close / o.price_book_fq : null };
}
async function rss(query) {                       // المصدر 3: Google News (عربي) — أخبار وإفصاحات
  const x = await (await get(`https://news.google.com/rss/search?hl=ar&gl=EG&ceid=EG:ar&q=${encodeURIComponent(query)}`)).text();
  const tag = (s, n) => ((s.match(new RegExp(`<${n}[^>]*>([\\s\\S]*?)</${n}>`)) || [])[1] || '').replace(/<!\[CDATA\[|\]\]>/g, '').trim();
  return [...x.matchAll(/<item>([\s\S]*?)<\/item>/g)].slice(0, 8).map(m => ({ title: tag(m[1], 'title'), url: tag(m[1], 'link'), date: tag(m[1], 'pubDate'), src: tag(m[1], 'source') }));
}

// ---------- التحليل الفني ----------
const sma = (a, n) => a.length >= n ? a.slice(-n).reduce((s, x) => s + x, 0) / n : null;
const ema = (a, n) => { const k = 2 / (n + 1); let e = a[0]; return a.map(x => e = x * k + e * (1 - k)); };
function rsi(c, n = 14) { let g = 0, l = 0; for (let i = 1; i <= n; i++) { const d = c[i] - c[i - 1]; d > 0 ? g += d : l -= d; } g /= n; l /= n;
  for (let i = n + 1; i < c.length; i++) { const d = c[i] - c[i - 1]; g = (g * (n - 1) + Math.max(d, 0)) / n; l = (l * (n - 1) + Math.max(-d, 0)) / n; } return l === 0 ? 100 : 100 - 100 / (1 + g / l); }
function atr(b, n = 14) { const tr = b.slice(1).map((x, i) => Math.max(x.h - x.l, Math.abs(x.h - b[i].c), Math.abs(x.l - b[i].c))); return sma(tr, n); }
function pivots(b, w = 5) { const hi = [], lo = [];
  for (let i = w; i < b.length - w; i++) { const s = b.slice(i - w, i + w + 1);
    if (b[i].h === Math.max(...s.map(x => x.h))) hi.push({ d: b[i].d, p: b[i].h });
    if (b[i].l === Math.min(...s.map(x => x.l))) lo.push({ d: b[i].d, p: b[i].l }); } return { hi, lo }; }
function analyze(bars, f, peTarget) {
  const c = bars.map(b => b.c), last = bars[bars.length - 1], px = last.c, y = bars.slice(-250);
  const m12 = ema(c, 12), m26 = ema(c, 26), macd = m12.map((x, i) => x - m26[i]), sig = ema(macd, 9), hist = macd.at(-1) - sig.at(-1);
  const t = { px, chg: (px / bars.at(-2).c - 1) * 100, sma20: sma(c, 20), sma50: sma(c, 50), sma200: sma(c, 200), rsi: rsi(c), macd: macd.at(-1), hist, atr: atr(bars), vol: last.v, volAvg: sma(bars.map(b => b.v), 20) };
  const hi52 = y.reduce((a, b) => b.h > a.p ? { p: b.h, d: b.d } : a, { p: -1 }), lo52 = y.reduce((a, b) => b.l < a.p ? { p: b.l, d: b.d } : a, { p: 1e12 });
  const pv = pivots(y), res = pv.hi.filter(x => x.p > px).sort((a, b) => a.p - b.p)[0], sup = pv.lo.filter(x => x.p < px).sort((a, b) => b.p - a.p)[0];
  let s = 0; const why = [];
  if (t.sma50) (px > t.sma50 ? (s++, why.push('السعر فوق متوسط 50 يوم')) : (s--, why.push('السعر تحت متوسط 50 يوم')));
  if (t.sma200) (px > t.sma200 ? (s++, why.push('السعر فوق متوسط 200 يوم')) : (s--, why.push('السعر تحت متوسط 200 يوم')));
  (hist > 0 ? (s++, why.push('MACD إيجابي')) : (s--, why.push('MACD سلبي')));
  if (t.rsi > 70) { s--; why.push('RSI فوق 70 (تشبّع شرائي)'); } else if (t.rsi < 30) { s++; why.push('RSI تحت 30 (تشبّع بيعي)'); } else why.push('RSI متوازن');
  const trend = s >= 2 ? 'صاعد' : s <= -2 ? 'هابط' : 'عرضي/محايد';
  const risk = t.atr ? { stop: +(px - 1.5 * t.atr).toFixed(2), t1: +(px + 1.5 * t.atr).toFixed(2), t2: +(px + 3 * t.atr).toFixed(2) } : null;
  const fv = []; // السعر العادل — تقديرات مش ضمان
  if (f && f.eps > 0 && f.bvps > 0) fv.push({ m: 'جراهام: √(22.5 × ربحية السهم × القيمة الدفترية)', v: Math.sqrt(22.5 * f.eps * f.bvps) });
  if (f && f.eps > 0) fv.push({ m: `مضاعف ربحية عادل ${peTarget}× ربحية السهم`, v: f.eps * peTarget });
  const vs = fv.map(x => x.v), fair = vs.length ? { methods: fv, lo: Math.min(...vs), hi: Math.max(...vs), mid: vs.reduce((a, b) => a + b) / vs.length } : null;
  if (fair) fair.mos = (fair.mid / px - 1) * 100;
  return { t, trend, score: s, why, hi52, lo52, res, sup, pv: { hi: pv.hi.slice(-4), lo: pv.lo.slice(-4) }, risk, fair, series: bars.slice(-130).map(b => ({ d: b.d, c: b.c })), sma50s: bars.slice(-130).map((_, i, a) => sma(c.slice(0, c.length - a.length + i + 1), 50)) };
}

// ---------- API ----------
async function handle(q, pe) {
  const sym = await resolve(q), errors = [];
  const [p, f] = await Promise.allSettled([prices(sym), fundamentals(sym)]);
  if (p.status !== 'fulfilled') throw Error('تعذّر جلب الأسعار: ' + p.reason.message);
  if (f.status !== 'fulfilled') errors.push('الأساسيات: ' + f.reason.message);
  const fund = f.value || null, name = (fund && fund.name) || p.value.name;
  const [n, d] = await Promise.allSettled([rss(`${name} OR ${sym} البورصة المصرية سهم`), rss(`إفصاح ${name} البورصة المصرية`)]);
  [['الأخبار', n], ['الإفصاحات', d]].forEach(([k, r]) => r.status !== 'fulfilled' && errors.push(k + ': ' + r.reason.message));
  const enc = encodeURIComponent(name);
  return { symbol: sym, name, fund, a: analyze(p.value.bars, fund, pe), news: n.value || [], disclosures: d.value || [], errors,
    links: [['القوائم المالية (TradingView)', `https://www.tradingview.com/symbols/EGX-${sym}/financials-overview/`], ['إفصاحات البورصة المصرية (الموقع الرسمي)', 'https://www.egx.com.eg/ar/homepage.aspx'], ['بحث عن القوائم المالية', `https://www.google.com/search?q=${enc}+القوائم+المالية+${sym}`]] };
}
http.createServer(async (req, res) => {
  const u = new URL(req.url, 'http://x');
  if (u.pathname === '/api/analyze') { try { const out = await handle(u.searchParams.get('q') || '', +u.searchParams.get('pe') || 9);
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' }); res.end(JSON.stringify(out)); }
    catch (e) { res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' }); res.end(JSON.stringify({ error: e.message })); } return; }
  fs.readFile(path.join(__dirname, 'public', 'index.html'), (e, b) => { res.writeHead(e ? 404 : 200, { 'Content-Type': 'text/html; charset=utf-8' }); res.end(b); });
}).listen(process.env.PORT || 3000, () => console.log('EGX Analyst → http://localhost:' + (process.env.PORT || 3000)));
