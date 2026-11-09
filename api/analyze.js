// Vercel serverless function: /api/analyze?q=COMI
const H = { 'User-Agent': 'Mozilla/5.0 (EGX-Analyst)' };
const get = async (u, o = {}) => { const r = await fetch(u, { headers: H, signal: AbortSignal.timeout(12000), ...o }); if (!r.ok) throw Error(new URL(u).host + ' → ' + r.status); return r; };
const norm = s => s.replace(/[أإآ]/g, 'ا').replace(/ة/g, 'ه').replace(/ى/g, 'ي').replace(/\s+/g, '').toLowerCase();
const NAMES = Object.fromEntries(Object.entries({ 'التجاري الدولي': 'COMI', 'طلعت مصطفى': 'TMGH', 'السويدي': 'SWDY', 'حديد عز': 'ESRS', 'عز': 'ESRS', 'فوري': 'FWRY', 'ايفاينانس': 'EFIH', 'ابوقير للاسمدة': 'ABUK', 'موبكو': 'MFPC', 'الشرقية': 'EAST', 'بالم هيلز': 'PHDC', 'مصر الجديدة': 'HELI', 'القلعة': 'CCAP', 'جهينة': 'JUFO', 'ايديتا': 'EFID', 'اوراسكوم': 'ORAS', 'المصرية للاتصالات': 'ETEL' }).map(([k, v]) => [norm(k), v]));

async function resolve(q) {
  q = q.trim(); if (/^[A-Za-z0-9.]{2,8}$/.test(q)) return q.toUpperCase().replace(/\.CA$/, '');
  if (NAMES[norm(q)]) return NAMES[norm(q)];
  const j = await (await get('https://query1.finance.yahoo.com/v1/finance/search?quotesCount=8&q=' + encodeURIComponent(q))).json();
  const hit = (j.quotes || []).find(x => /\.CA$/.test(x.symbol || ''));
  if (!hit) throw Error('مش لاقي السهم — جرّب الرمز (مثلاً COMI)'); return hit.symbol.replace(/\.CA$/, '');
}
async function prices(t) {
  const j = await (await get(`https://query1.finance.yahoo.com/v8/finance/chart/${t}.CA?range=2y&interval=1d`)).json();
  const r = j.chart.result[0], q = r.indicators.quote[0], out = [];
  r.timestamp.forEach((ts, i) => { if (q.close[i] != null) out.push({ d: new Date(ts * 1000).toISOString().slice(0, 10), o: q.open[i], h: q.high[i], l: q.low[i], c: q.close[i], v: q.volume[i] }); });
  return { name: r.meta.longName || r.meta.shortName || t, bars: out };
}
async function fundamentals(t) {
  const cols = ['description', 'sector', 'industry', 'close', 'market_cap_basic', 'price_earnings_ttm', 'earnings_per_share_basic_ttm', 'dividends_yield', 'price_book_fq'];
  const j = await (await get('https://scanner.tradingview.com/egypt/scan', { method: 'POST', headers: { ...H, 'Content-Type': 'application/json' }, body: JSON.stringify({ symbols: { tickers: ['EGX:' + t] }, columns: cols }) })).json();
  const d = j.data && j.data[0] && j.data[0].d; if (!d) throw Error('TradingView: مفيش بيانات');
  const o = Object.fromEntries(cols.map((c, i) => [c, d[i]]));
  return { name: o.description, sector: o.sector, industry: o.industry, mcap: o.market_cap_basic, pe: o.price_earnings_ttm, eps: o.earnings_per_share_basic_ttm, dy: o.dividends_yield, pb: o.price_book_fq, bvps: o.price_book_fq ? o.close / o.price_book_fq : null };
}
async function rss(query) {
  const x = await (await get(`https://news.google.com/rss/search?hl=ar&gl=EG&ceid=EG:ar&q=${encodeURIComponent(query)}`)).text();
  const tag = (s, n) => ((s.match(new RegExp(`<${n}[^>]*>([\\s\\S]*?)</${n}>`)) || [])[1] || '').replace(/<!\[CDATA\[|\]\]>/g, '').trim();
  return [...x.matchAll(/<item>([\s\S]*?)
