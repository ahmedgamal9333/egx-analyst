// EGX AI Analyst v2 — Vercel serverless (/api/analyze?q=COMI) ويشتغل محلياً عبر server.js
const H = { 'User-Agent': 'Mozilla/5.0 (EGX-Analyst)' };
const get = async (u, o = {}) => { const r = await fetch(u, { headers: H, signal: AbortSignal.timeout(12000), cache: 'no-store', ...o }); if (!r.ok) throw Error(new URL(u).host + ' → ' + r.status); return r; };
const norm = s => s.replace(/[أإآ]/g, 'ا').replace(/ة/g, 'ه').replace(/ى/g, 'ي').replace(/\s+/g, '').toLowerCase();
const NAMES = Object.fromEntries(Object.entries({ 'التجاري الدولي': 'COMI', 'طلعت مصطفى': 'TMGH', 'السويدي': 'SWDY', 'حديد عز': 'ESRS', 'عز': 'ESRS', 'فوري': 'FWRY', 'ايفاينانس': 'EFIH', 'ابوقير للاسمدة': 'ABUK', 'موبكو': 'MFPC', 'الشرقية': 'EAST', 'بالم هيلز': 'PHDC', 'مصر الجديدة': 'HELI', 'القلعة': 'CCAP', 'جهينة': 'JUFO', 'ايديتا': 'EFID', 'اوراسكوم': 'ORAS', 'المصرية للاتصالات': 'ETEL' }).map(([k, v]) => [norm(k), v]));
const ago = ms => Math.max(0, Math.round((Date.now() - ms) / 864e5));

// ---------- المصادر ----------
async function resolve(q) {
  q = q.trim(); if (/^[A-Za-z0-9.]{2,8}$/.test(q)) return q.toUpperCase().replace(/\.CA$/, '');
  if (NAMES[norm(q)]) return NAMES[norm(q)];
  const j = await (await get('https://query1.finance.yahoo.com/v1/finance/search?quotesCount=8&q=' + encodeURIComponent(q))).json();
  const hit = (j.quotes || []).find(x => /\.CA$/.test(x.symbol || ''));
  if (!hit) throw Error('مش لاقي السهم — جرّب الرمز (مثلاً COMI)'); return hit.symbol.replace(/\.CA$/, '');
}
async function prices(t) {                       // Yahoo Finance: شموع يومية سنتين + آخر سعر لحظي
  const j = await (await get(`https://query1.finance.yahoo.com/v8/finance/chart/${t}.CA?range=2y&interval=1d`)).json();
  const r = j.chart.result[0], q = r.indicators.quote[0], m = r.meta, bars = [];
  r.timestamp.forEach((ts, i) => { if (q.close[i] != null && q.high[i] != null) bars.push({ ts: ts * 1000, d: new Date(ts * 1000).toISOString().slice(0, 10), o: q.open[i], h: q.high[i], l: q.low[i], c: q.close[i], v: q.volume[i] || 0 }); });
  const live = m.regularMarketPrice, lt = (m.regularMarketTime || 0) * 1000, last = bars[bars.length - 1];
  if (live && last && new Date(lt).toISOString().slice(0, 10) === last.d) { last.c = live; last.h = Math.max(last.h, live); last.l = Math.min(last.l, live); }
  return { name: m.longName || m.shortName || t, bars, asOf: Math.max(lt, last ? last.ts : 0) };
}
const scan = (t, cols) => get('https://scanner.tradingview.com/egypt/scan', { method: 'POST', headers: { ...H, 'Content-Type': 'application/json' }, body: JSON.stringify({ symbols: { tickers: ['EGX:' + t] }, columns: cols }) }).then(r => r.json()).then(j => { const d = j.data && j.data[0] && j.data[0].d; if (!d) throw Error('TradingView: مفيش بيانات'); return Object.fromEntries(cols.map((c, i) => [c, d[i]])); });
const OPT = ['return_on_equity', 'return_on_assets', 'debt_to_equity', 'current_ratio', 'gross_margin', 'operating_margin', 'net_margin', 'total_revenue', 'net_income', 'earnings_per_share_diluted_yoy_growth_ttm'];
async function fundamentals(t) {                 // TradingView: أساسيات؛ كل حقل إضافي بطلب منفصل عشان حقل غلط ما يوقعش الباقي
  const o = await scan(t, ['description', 'sector', 'industry', 'close', 'market_cap_basic', 'price_earnings_ttm', 'earnings_per_share_basic_ttm', 'dividends_yield', 'price_book_fq']);
  const ex = {}; (await Promise.allSettled(OPT.map(c => scan(t, [c])))).forEach((r, i) => { if (r.status === 'fulfilled' && r.value[OPT[i]] != null) ex[OPT[i]] = r.value[OPT[i]]; });
  return { name: o.description, sector: o.sector, industry: o.industry, px: o.close, mcap: o.market_cap_basic, pe: o.price_earnings_ttm, eps: o.earnings_per_share_basic_ttm, dy: o.dividends_yield, pb: o.price_book_fq, bvps: o.price_book_fq ? o.close / o.price_book_fq : null, ex };
}
const tagOf = (s, n) => ((s.match(new RegExp(`<${n}[^>]*>([\\s\\S]*?)</${n}>`)) || [])[1] || '').replace(/<!\[CDATA\[|\]\]>/g, '').trim();
async function rss(url, nm) {
  const x = await (await get(url)).text();
  return [...x.matchAll(/<item>([\s\S]*?)<\/item>/g)].map(m => ({ title: tagOf(m[1], 'title').replace(/&amp;/g, '&').replace(/&quot;/g, '"'), url: tagOf(m[1], 'link'), ts: Date.parse(tagOf(m[1], 'pubDate')) || 0, src: tagOf(m[1], 'source') || tagOf(m[1], 'News:Source') || nm }));
}
async function yahooNews(sym) {
  const j = await (await get(`https://query1.finance.yahoo.com/v1/finance/search?quotesCount=0&newsCount=8&q=${sym}.CA`)).json();
  return (j.news || []).map(x => ({ title: x.title, url: x.link, ts: (x.providerPublishTime || 0) * 1000, src: x.publisher || 'Yahoo' }));
}
async function collect(kind, name, sym) {        // أخبار/إفصاحات من أكتر من مصدر، الأحدث أولاً، من غير تكرار
  const g = q => `https://news.google.com/rss/search?hl=ar&gl=EG&ceid=EG:ar&q=${encodeURIComponent(q)}`;
  const jobs = kind === 'news' ? [
    ['Google News', rss(g(`${name} OR ${sym} البورصة المصرية سهم when:30d`), 'Google News')],
    ['Bing News', rss(`https://www.bing.com/news/search?format=rss&setmkt=ar-EG&q=${encodeURIComponent(name + ' البورصة المصرية')}`, 'Bing')],
    ['Yahoo Finance', yahooNews(sym)]] : [
    ['Google', rss(g(`إفصاح ${name} البورصة المصرية when:90d`), 'Google News')],
    ['مباشر/أرقام/EGX', rss(g(`${name} إفصاح site:mubasher.info OR site:argaam.com OR site:egx.com.eg when:180d`), 'Google News')]];
  const res = await Promise.allSettled(jobs.map(j => j[1])), seen = new Set(), items = [], st = [];
  res.forEach((r, i) => { const n = (kind === 'news' ? 'أخبار: ' : 'إفصاحات: ') + jobs[i][0]; if (r.status === 'fulfilled') { st.push({ n, ok: true, c: r.value.length }); items.push(...r.value); } else st.push({ n, ok: false, e: r.reason.message }); });
  const lim = kind === 'news' ? 45 : 120;
  const out = items.filter(x => x.ts && ago(x.ts) <= lim).sort((a, b) => b.ts - a.ts).filter(x => { const k = norm(x.title).slice(0, 40); return seen.has(k) ? false : seen.add(k); }).slice(0, 10).map(x => ({ ...x, age: ago(x.ts) }));
  return { items: out, st };
}

// ---------- التحليل الفني + الشموع ----------
const sma = (a, n) => a.length >= n ? a.slice(-n).reduce((s, x) => s + x, 0) / n : null;
const ema = (a, n) => { const k = 2 / (n + 1); let e = a[0]; return a.map(x => e = x * k + e * (1 - k)); };
function rsi(c, n = 14) { let g = 0, l = 0; for (let i = 1; i <= n; i++) { const d = c[i] - c[i - 1]; d > 0 ? g += d : l -= d; } g /= n; l /= n;
  for (let i = n + 1; i < c.length; i++) { const d = c[i] - c[i - 1]; g = (g * (n - 1) + Math.max(d, 0)) / n; l = (l * (n - 1) + Math.max(-d, 0)) / n; } return l === 0 ? 100 : 100 - 100 / (1 + g / l); }
function atr(b, n = 14) { const tr = b.slice(1).map((x, i) => Math.max(x.h - x.l, Math.abs(x.h - b[i].c), Math.abs(x.l - b[i].c))); return sma(tr, n); }
function pivots(b, w = 5) { const hi = [], lo = [];
  for (let i = w; i < b.length - w; i++) { const s = b.slice(i - w, i + w + 1);
    if (b[i].h === Math.max(...s.map(x => x.h))) hi.push({ d: b[i].d, p: b[i].h });
    if (b[i].l === Math.min(...s.map(x => x.l))) lo.push({ d: b[i].d, p: b[i].l }); } return { hi, lo }; }
function patterns(b) {                           // نماذج الشموع اليابانية في آخر 8 جلسات
  const out = [], n = b.length;
  for (let i = Math.max(2, n - 8); i < n; i++) {
    const x = b[i], p = b[i - 1], a = b[i - 2], r = x.h - x.l || 1e-9, body = Math.abs(x.c - x.o), up = x.h - Math.max(x.c, x.o), lw = Math.min(x.c, x.o) - x.l;
    const ref = b[Math.max(0, i - 6)].c, dn = p.c < ref, upT = p.c > ref, green = x.c > x.o, pg = p.c > p.o, pb = Math.abs(p.c - p.o), pr = p.h - p.l || 1e-9, ab = Math.abs(a.c - a.o), ar = a.h - a.l || 1e-9;
    const add = (name, bias, note) => out.push({ d: x.d, name, bias, note });
    if (body / r < 0.1) add('دوجي', 0, 'تردد في السوق');
    else if (lw >= 2 * body && up <= 0.35 * body) { if (dn) add('مطرقة', 1, 'احتمال انعكاس صاعد'); else if (upT) add('رجل مشنوق', -1, 'احتمال انعكاس هابط'); }
    else if (up >= 2 * body && lw <= 0.35 * body) { if (upT) add('نجمة السقوط', -1, 'احتمال انعكاس هابط'); else if (dn) add('مطرقة مقلوبة', 1, 'احتمال انعكاس صاعد'); }
    else if (body / r >= 0.9) add(green ? 'ماروبوزو صاعد' : 'ماروبوزو هابط', green ? 1 : -1, green ? 'سيطرة المشترين' : 'سيطرة البائعين');
    if (green && !pg && x.c >= p.o && x.o <= p.c && body > pb) add('ابتلاع صاعد', 1, 'المشترون ابتلعوا شمعة البائعين');
    if (!green && pg && x.o >= p.c && x.c <= p.o && body > pb) add('ابتلاع هابط', -1, 'البائعون ابتلعوا شمعة المشترين');
    if (a.c < a.o && ab / ar > 0.5 && pb / pr < 0.3 && green && x.c > (a.o + a.c) / 2) add('نجمة الصباح', 1, 'انعكاس صاعد من 3 شموع');
    if (a.c > a.o && ab / ar > 0.5 && pb / pr < 0.3 && !green && x.c < (a.o + a.c) / 2) add('نجمة المساء', -1, 'انعكاس هابط من 3 شموع');
  } return out;
}
function analyze(bars, f, peTarget) {
  const c = bars.map(b => b.c), last = bars[bars.length - 1], px = last.c, y = bars.slice(-250);
  const m12 = ema(c, 12), m26 = ema(c, 26), macd = m12.map((x, i) => x - m26[i]), sig = ema(macd, 9), hist = macd.at(-1) - sig.at(-1);
  const t = { px, chg: (px / bars.at(-2).c - 1) * 100, sma20: sma(c, 20), sma50: sma(c, 50), sma200: sma(c, 200), rsi: rsi(c), macd: macd.at(-1), hist, atr: atr(bars), vol: last.v, volAvg: sma(bars.map(b => b.v), 20) };
  const hi52 = y.reduce((a, b) => b.h > a.p ? { p: b.h, d: b.d } : a, { p: -1 }), lo52 = y.reduce((a, b) => b.l < a.p ? { p: b.l, d: b.d } : a, { p: 1e12 });
  const pv = pivots(y), res = pv.hi.filter(x => x.p > px).sort((a, b) => a.p - b.p)[0], sup = pv.lo.filter(x => x.p < px).sort((a, b) => b.p - a.p)[0];
  let s = 0; const why = [];
  if (t.sma50) (px > t.sma50 ? (s++, why.push('فوق متوسط 50')) : (s--, why.push('تحت متوسط 50')));
  if (t.sma200) (px > t.sma200 ? (s++, why.push('فوق متوسط 200')) : (s--, why.push('تحت متوسط 200')));
  (hist > 0 ? (s++, why.push('MACD إيجابي')) : (s--, why.push('MACD سلبي')));
  if (t.rsi > 70) { s--; why.push('RSI تشبّع شرائي'); } else if (t.rsi < 30) { s++; why.push('RSI تشبّع بيعي'); } else why.push('RSI متوازن');
  const trend = s >= 2 ? 'صاعد' : s <= -2 ? 'هابط' : 'عرضي/محايد';
  const risk = t.atr ? { stop: +(px - 1.5 * t.atr).toFixed(2), t1: +(px + 1.5 * t.atr).toFixed(2), t2: +(px + 3 * t.atr).toFixed(2) } : null;
  const fv = [];
  if (f && f.eps > 0 && f.bvps > 0) fv.push({ m: 'جراهام: √(22.5 × ربحية السهم × القيمة الدفترية)', v: Math.sqrt(22.5 * f.eps * f.bvps) });
  if (f && f.eps > 0) fv.push({ m: `مضاعف ربحية عادل ${peTarget}× ربحية السهم`, v: f.eps * peTarget });
  const vs = fv.map(x => x.v), fair = vs.length ? { methods: fv, lo: Math.min(...vs), hi: Math.max(...vs), mid: vs.reduce((a, b) => a + b) / vs.length } : null;
  if (fair) fair.mos = (fair.mid / px - 1) * 100;
  return { t, trend, score: s, why, hi52, lo52, res, sup, risk, fair };
}

// ---------- التوصية (قواعد شفافة + نموذج لغوي اختياري) ----------
const POS = /ارتفاع|ارتفع|نمو|أرباح|ربح|توزيع|زيادة|صعود|قفز|توسع|استحواذ|ترسية/, NEG = /تراجع|انخفاض|هبوط|خسائر|خسارة|غرامة|إيقاف|تعثر|شطب|تحقيق/;
function recommend(a, f, recent, news) {
  const T = [], F = [], N = []; let ts = 0, fs = 0, known = 0; const t = a.t, ex = (f && f.ex) || {};
  ts += a.score; T.push(`الاتجاه ${a.trend} (${a.why.join('، ')})`);
  const pb = Math.max(-2, Math.min(2, recent.reduce((s, p) => s + p.bias, 0))); ts += pb;
  T.push(recent.length ? 'شموع حديثة: ' + recent.map(p => `${p.name} ${p.d}`).join('، ') : 'مفيش نماذج شموع واضحة في آخر 3 جلسات');
  if (t.volAvg && t.vol / t.volAvg > 1.5) { const d = t.chg >= 0 ? 1 : -1; ts += d; T.push(`حجم تداول ${(t.vol / t.volAvg).toFixed(1)}× المتوسط ${d > 0 ? 'يدعم الصعود' : 'يدعم الهبوط'}`); }
  if (a.res && a.res.p / t.px - 1 < 0.03) { ts--; T.push(`قريب من مقاومة ${a.res.p.toFixed(2)}`); }
  if (a.sup && 1 - a.sup.p / t.px < 0.03) { ts++; T.push(`قريب من دعم ${a.sup.p.toFixed(2)}`); }
  if (a.fair) { known++; const m = a.fair.mos; fs += m > 25 ? 2 : m > 10 ? 1 : m < -20 ? -2 : m < -10 ? -1 : 0; F.push(`السعر العادل ${a.fair.lo.toFixed(2)}–${a.fair.hi.toFixed(2)} (هامش أمان ${m.toFixed(1)}%)`); }
  if (f && f.eps < 0) { known++; fs -= 2; F.push('الشركة خاسرة (ربحية السهم سالبة)'); }
  if (f && f.pe > 0) { known++; const s = f.pe < 8 ? 1 : f.pe > 20 ? -1 : 0; fs += s; F.push(`P/E ${f.pe.toFixed(1)} ${s > 0 ? '✓ رخيص نسبياً' : s < 0 ? '✗ مرتفع' : '— معقول'}`); }
  const rule = (lab, v, hi, lo, u) => { if (v == null || isNaN(v)) return; known++; const s = v >= hi ? 1 : v <= lo ? -1 : 0; fs += s; F.push(`${lab}: ${(+v).toFixed(1)}${u} ${s > 0 ? '✓' : s < 0 ? '✗' : '—'}`); };
  rule('العائد على حقوق الملكية', ex.return_on_equity, 15, 5, '%'); rule('هامش صافي الربح', ex.net_margin, 10, 0, '%'); rule('نمو ربحية السهم', ex.earnings_per_share_diluted_yoy_growth_ttm, 10, -10, '%');
  if (ex.debt_to_equity != null) { known++; const s = ex.debt_to_equity > 2.5 ? -1 : ex.debt_to_equity < 1 ? 1 : 0; fs += s; F.push(`الدين/حقوق الملكية ${(+ex.debt_to_equity).toFixed(2)} ${s > 0 ? '✓' : s < 0 ? '✗' : '—'}`); }
  const rn = news.filter(x => x.age <= 30), pos = rn.filter(x => POS.test(x.title) && !NEG.test(x.title)).length, neg = rn.filter(x => NEG.test(x.title)).length, ns = Math.max(-1, Math.min(1, pos - neg));
  N.push(rn.length ? `${rn.length} خبر آخر 30 يوم: ${pos} إيجابي، ${neg} سلبي (تقدير بالكلمات المفتاحية)` : 'مفيش أخبار حديثة كفاية');
  if (known < 2) F.push('بيانات مالية قليلة — التوصية ماتعتمدش على التحليل المالي كفاية');
  const total = ts + fs + ns, rating = total >= 5 ? 'شراء قوي' : total >= 2 ? 'شراء' : total <= -5 ? 'بيع' : total <= -2 ? 'تقليل' : 'احتفاظ / انتظار';
  const conf = Math.max(25, Math.min(90, 40 + 10 * Math.min(known, 4) + (Math.sign(ts) === Math.sign(fs) && ts !== 0 ? 15 : 0) - (known < 2 ? 15 : 0)));
  return { rating, cls: total >= 2 ? 'up' : total <= -2 ? 'dn' : '', score: total, ts, fs, conf, tech: T, fund: F, news: N };
}
async function llm(sym, name, a, f, rec, pats) {
  const key = process.env.GEMINI_API_KEY; if (!key) return null;
  const brief = { symbol: sym, name, price: a.t.px, trend: a.trend, rsi: a.t.rsi, support: a.sup && a.sup.p, resistance: a.res && a.res.p, hi52: a.hi52.p, lo52: a.lo52.p, fair: a.fair && { lo: a.fair.lo, hi: a.fair.hi }, fundamentals: f && { pe: f.pe, eps: f.eps, pb: f.pb, dy: f.dy, ...f.ex }, candles: pats, rules: { rating: rec.rating, tech: rec.tech, fund: rec.fund } };
  const prompt = 'أنت محلل أسهم. اكتب بالعربي المبسط في 7 أسطر كحد أقصى: قراءة الشموع والرسم، ثم التحليل المالي، ثم التوصية مع وقف خسارة وهدف. اعتمد فقط على البيانات التالية ولا تخترع أرقاماً، وانبّه أنها ليست نصيحة استثمارية:\n' + JSON.stringify(brief);
  const j = await (await get(`https://generativelanguage.googleapis.com/v1beta/models/${process.env.GEMINI_MODEL || 'gemini-2.0-flash'}:generateContent?key=${key}`, { method: 'POST', headers: { ...H, 'Content-Type': 'application/json' }, body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] }) })).json();
  return (j.candidates && j.candidates[0] && j.candidates[0].content.parts[0].text) || null;
}

// ---------- API ----------
async function handle(q, pe) {
  const sym = await resolve(q), errors = [], srcs = [];
  const [p, f] = await Promise.allSettled([prices(sym), fundamentals(sym)]);
  if (p.status !== 'fulfilled') throw Error('تعذّر جلب الأسعار: ' + p.reason.message);
  const P = p.value, fund = f.value || null, name = (fund && fund.name) || P.name, age = ago(P.asOf), lastC = P.bars.at(-1).c;
  srcs.push({ n: 'أسعار وشموع: Yahoo Finance', ok: true, t: P.asOf }, f.status === 'fulfilled' ? { n: 'أساسيات: TradingView', ok: true } : { n: 'أساسيات: TradingView', ok: false, e: f.reason.message });
  const fresh = { asOf: P.asOf, ageDays: age, stale: age > 4, warnings: [] };
  if (fund && fund.px && Math.abs(fund.px / lastC - 1) > 0.02) fresh.warnings.push(`اختلاف أكتر من 2% بين Yahoo (${lastC.toFixed(2)}) وTradingView (${fund.px.toFixed(2)}) — راجع السعر من منصة التداول`);
  if (fresh.stale) fresh.warnings.push(`آخر بيانات سعرية عمرها ${age} يوم — المصدر متأخر أو السهم موقوف`);
  const [n, d] = await Promise.all([collect('news', name, sym), collect('disc', name, sym)]); srcs.push(...n.st, ...d.st);
  const a = analyze(P.bars, fund, pe), pats = patterns(P.bars), recent = pats.filter(x => x.d >= P.bars.at(-3).d), rec = recommend(a, fund, recent, n.items);
  let ai = null; try { ai = await llm(sym, name, a, fund, rec, pats); } catch (e) { errors.push('الذكاء الاصطناعي: ' + e.message); }
  const enc = encodeURIComponent(name);
  return { symbol: sym, name, fund, a, rec, ai, pats, news: n.items, disclosures: d.items, srcs, fresh, errors, bars: P.bars.slice(-520).map(b => [b.d, b.o, b.h, b.l, b.c, b.v]),
    links: [['القوائم المالية (TradingView)', `https://www.tradingview.com/symbols/EGX-${sym}/financials-overview/`], ['إفصاحات البورصة المصرية (الموقع الرسمي)', 'https://www.egx.com.eg/ar/homepage.aspx'], ['بحث عن القوائم المالية', `https://www.google.com/search?q=${enc}+القوائم+المالية+${sym}`]] };
}
module.exports = async (req, res) => {
  try { const out = await handle(String(req.query.q || ''), +req.query.pe || 9); res.setHeader('Cache-Control', 'no-store'); res.status(200).json(out); }
  catch (e) { res.status(400).json({ error: e.message }); }
};
module.exports.handle = handle;
        
