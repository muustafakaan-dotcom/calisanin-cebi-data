// Updates docs/data.json for the Çalışanın Cebi app. No dependencies (Node 20+).
//
// Automatic: TCMB exchange rates, TÜFE (TCMB table), legal rent increase rate
// (12-month average TÜFE change, computed), World Bank monthly gold price,
// monthly history. Holidays, school breaks and law figures are edited BY HAND
// after checking official sources — this script never touches them.
//
// Every value is sanity-checked; a source that fails or looks wrong is skipped
// and the previous value is kept (the app shows the data date).

import { readFileSync, writeFileSync } from 'node:fs';
import { inflateRawSync } from 'node:zlib';

const FILE = new URL('../docs/data.json', import.meta.url);
const UA = { 'User-Agent': 'calisanin-cebi-data (+https://github.com/muustafakaan-dotcom/calisanin-cebi-data)' };
const pad = (n) => String(n).padStart(2, '0');
const log = (...a) => console.log('•', ...a);
const warn = (...a) => console.warn('⚠', ...a);

const data = JSON.parse(readFileSync(FILE, 'utf8'));
const before = JSON.stringify(data);
const history = data.history.items;

async function get(url, as = 'text') {
  const r = await fetch(url, { headers: UA, redirect: 'follow' });
  if (!r.ok) throw new Error(`${r.status} ${url}`);
  return as === 'buffer' ? Buffer.from(await r.arrayBuffer()) : r.text();
}

const near = (a, b, tol) => a != null && b != null && Math.abs(a / b - 1) <= tol;
const nextMonth = (m) => {
  let [y, mm] = m.split('-').map(Number);
  mm++;
  if (mm > 12) (mm = 1), y++;
  return `${y}-${pad(mm)}`;
};

function parseTcmb(xml) {
  const g = (k) => {
    const b = xml.split(`Kod="${k}"`)[1];
    const v = b?.match(/<ForexSelling>([\d.]+)<\/ForexSelling>/)?.[1];
    return v ? Number(v) : null;
  };
  const d = xml.match(/Tarih="(\d{2})\.(\d{2})\.(\d{4})"/);
  return { usd: g('USD'), eur: g('EUR'), date: d ? `${d[3]}-${d[2]}-${d[1]}` : null };
}

// 1) Today's rates -------------------------------------------------------
async function rates() {
  try {
    const r = parseTcmb(await get('https://www.tcmb.gov.tr/kurlar/today.xml'));
    if (!r.date || !near(r.usd, data.rates.usd, 0.3) || !near(r.eur, data.rates.eur, 0.3)) throw new Error(`implausible ${JSON.stringify(r)}`);
    if (r.date >= data.rates.date) Object.assign(data.rates, r);
    log('kur', data.rates.date, data.rates.usd, data.rates.eur);
  } catch (e) {
    warn('kur atlandı:', e.message);
  }
}

// 2) Mid-month history rates (15th, or the closest earlier business day) --
async function midMonth(m) {
  const [y, mm] = m.split('-');
  for (let d = 15; d >= 5; d--) {
    try {
      const r = parseTcmb(await get(`https://www.tcmb.gov.tr/kurlar/${y}${mm}/${pad(d)}${mm}${y}.xml`));
      if (r.usd) return r;
    } catch {
      // holiday/weekend → try the day before
    }
  }
  return null;
}

async function historyRates() {
  const now = new Date();
  const thisMonth = `${now.getUTCFullYear()}-${pad(now.getUTCMonth() + 1)}`;
  // add missing months up to this month (only once the 15th has passed)
  let last = history.at(-1).m;
  while (last < thisMonth) {
    last = nextMonth(last);
    if (last === thisMonth && now.getUTCDate() < 16) break;
    history.push({ m: last, usd: null, eur: null, ounce: null, cpi: null });
  }
  for (const p of history) {
    if (p.usd != null) continue;
    const r = await midMonth(p.m);
    if (r) {
      const prev = history[history.indexOf(p) - 1];
      if (prev?.usd && !near(r.usd, prev.usd, 0.5)) {
        warn('geçmiş kur şüpheli', p.m, r.usd);
        continue;
      }
      p.usd = r.usd;
      p.eur = r.eur;
      log('geçmiş kur', p.m, r.usd, r.eur);
    }
  }
}

// 2b) Daily rates for the last ~13 months (payday-to-payday summary) -----
// Each business day's TCMB selling rate. First run backfills; later runs only
// fetch days after the last saved one (weekends and full-day holidays skipped).
const DAILY_DAYS = 400;
const isoDay = (dt) => dt.toISOString().slice(0, 10);
async function dailyRates() {
  data.daily ??= { source: 'TCMB döviz satış (günlük)', items: [] };
  const items = data.daily.items;
  const holidays = new Set((data.holidays ?? []).filter((h) => h.kind === 'full').map((h) => h.date));
  const today = isoDay(new Date(Date.now() + 3 * 3600_000)); // TR date
  const start = isoDay(new Date(Date.parse(today) - DAILY_DAYS * 86400_000));
  const last = items.at(-1)?.d;
  let added = 0;
  for (let t = Date.parse(last ?? start) + (last ? 86400_000 : 0); isoDay(new Date(t)) <= today; t += 86400_000) {
    const dt = new Date(t);
    const d = isoDay(dt);
    const wd = dt.getUTCDay();
    if (wd === 0 || wd === 6 || holidays.has(d)) continue;
    const [y, m, dd] = d.split('-');
    try {
      // today's file appears at 15:30; an earlier run picks it up next time
      const r = parseTcmb(await get(`https://www.tcmb.gov.tr/kurlar/${y}${m}/${dd}${m}${y}.xml`));
      if (!r.usd || !r.eur || r.date !== d) continue;
      const prev = items.at(-1);
      if (prev && (!near(r.usd, prev.usd, 0.15) || !near(r.eur, prev.eur, 0.15))) {
        warn('günlük kur şüpheli', d, r.usd, r.eur);
        continue;
      }
      items.push({ d, usd: r.usd, eur: r.eur });
      added++;
    } catch {
      // not published (holiday) or not out yet
    }
  }
  data.daily.items = items.filter((x) => x.d >= start);
  log('günlük kur', added, 'gün eklendi, toplam', data.daily.items.length);
}

// 3) TÜFE from the TCMB table, chained onto the index --------------------
async function cpi() {
  try {
    const html = await get('https://www.tcmb.gov.tr/wps/wcm/connect/TR/TCMB+TR/Main+Menu/Istatistikler/Enflasyon+Verileri/Tuketici+Fiyatlari');
    const rows = [...html.matchAll(/<td[^>]*>\s*(\d{2})-(\d{4})\s*<\/td>\s*<td[^>]*>\s*(-?[\d.]+)\s*<\/td>\s*<td[^>]*>\s*(-?[\d.]+)\s*<\/td>/g)].map((x) => ({
      m: `${x[2]}-${x[1]}`,
      annual: Number(x[3]),
      monthly: Number(x[4]),
    }));
    if (rows.length < 12) throw new Error('tablo okunamadı');
    const byMonth = Object.fromEntries(rows.map((r) => [r.m, r]));
    const idx = (m) => history.find((p) => p.m === m);

    for (let i = 1; i < history.length; i++) {
      const p = history[i];
      const prev = history[i - 1];
      if (p.cpi != null || prev.cpi == null) continue;
      const r = byMonth[p.m];
      if (!r || Math.abs(r.monthly) > 25) break;
      p.cpi = Number((prev.cpi * (1 + r.monthly / 100)).toFixed(3));
      // cross-check against the published annual change
      const yearAgo = idx(`${Number(p.m.slice(0, 4)) - 1}${p.m.slice(4)}`);
      const annual = yearAgo?.cpi ? (p.cpi / yearAgo.cpi - 1) * 100 : null;
      if (annual != null && Math.abs(annual - r.annual) > 0.15) {
        warn('TÜFE zinciri tutmuyor', p.m, annual.toFixed(2), r.annual);
        p.cpi = null;
        break;
      }
      log('TÜFE', p.m, r.monthly, '→ yıllık', r.annual);
    }

    const latest = [...history].reverse().find((p) => p.cpi != null);
    data.inflation.month = latest.m;
    data.inflation.annual = byMonth[latest.m]?.annual ?? data.inflation.annual;

    // Legal rent cap: change of the 12-month average index (TBK md. 344)
    const k = history.indexOf(latest);
    const win = (a, b) => history.slice(a, b).map((p) => p.cpi);
    const cur = win(k - 11, k + 1);
    const prev = win(k - 23, k - 11);
    if (cur.length === 12 && prev.length === 12 && [...cur, ...prev].every((x) => x != null)) {
      const avg = (a) => a.reduce((s, x) => s + x, 0) / a.length;
      const month = nextMonth(latest.m);
      const rate = Number(((avg(cur) / avg(prev) - 1) * 100).toFixed(2));
      // A hand-verified official rate for the same month wins over our ±0,01 estimate
      if (data.inflation.rentMonth !== month) {
        data.inflation.rentRate = rate;
        data.inflation.rentMonth = month;
        data.inflation.rentVerified = false;
        log('kira oranı (hesaplandı)', month, rate);
      } else {
        log('kira oranı aynı ay, korunuyor', month, data.inflation.rentRate, '(hesap:', rate + ')');
      }
    }
  } catch (e) {
    warn('TÜFE atlandı:', e.message);
  }
}

// 4) World Bank monthly gold (xlsx, read with a tiny zip reader) ---------
function unzip(buf, name) {
  const eocd = buf.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  let off = buf.readUInt32LE(eocd + 16);
  const count = buf.readUInt16LE(eocd + 10);
  for (let i = 0; i < count; i++) {
    const method = buf.readUInt16LE(off + 10);
    const size = buf.readUInt32LE(off + 20);
    const nlen = buf.readUInt16LE(off + 28);
    const elen = buf.readUInt16LE(off + 30);
    const clen = buf.readUInt16LE(off + 32);
    const local = buf.readUInt32LE(off + 42);
    const fname = buf.subarray(off + 46, off + 46 + nlen).toString();
    if (fname === name) {
      const start = local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28);
      const raw = buf.subarray(start, start + size);
      return (method === 8 ? inflateRawSync(raw) : raw).toString('utf8');
    }
    off += 46 + nlen + elen + clen;
  }
  throw new Error(`${name} yok`);
}

async function gold() {
  try {
    const page = await get('https://www.worldbank.org/en/research/commodity-markets');
    const url = page.match(/https:\/\/[^"']*CMO-Historical-Data-Monthly\.xlsx/)?.[0];
    if (!url) throw new Error('xlsx linki yok');
    const buf = await get(url, 'buffer');
    const ss = [...unzip(buf, 'xl/sharedStrings.xml').matchAll(/<si>([\s\S]*?)<\/si>/g)].map((m) =>
      [...m[1].matchAll(/<t[^>]*>([^<]*)<\/t>/g)].map((x) => x[1]).join(''),
    );
    const wb = unzip(buf, 'xl/workbook.xml');
    const names = [...wb.matchAll(/<sheet [^>]*name="([^"]+)"/g)].map((m) => m[1]);
    const sheetNo = names.indexOf('Monthly Prices') + 1;
    if (!sheetNo) throw new Error('Monthly Prices sayfası yok');
    const sheet = unzip(buf, `xl/worksheets/sheet${sheetNo}.xml`);
    const rows = [...sheet.matchAll(/<row[^>]*>([\s\S]*?)<\/row>/g)].map((r) => {
      const o = {};
      for (const c of r[1].matchAll(/<c r="([A-Z]+)\d+"([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
        const v = (c[3] || '').match(/<v>([^<]*)<\/v>/);
        if (v) o[c[1]] = /t="s"/.test(c[2]) ? ss[Number(v[1])] : v[1];
      }
      return o;
    });
    let col;
    for (const r of rows) {
      col = Object.keys(r).find((k) => r[k] === 'Gold');
      if (col) break;
    }
    if (!col) throw new Error('Gold sütunu yok');
    const series = Object.fromEntries(
      rows.filter((r) => /^\d{4}M\d{2}$/.test(r.A ?? '') && r[col]).map((r) => [r.A.replace('M', '-'), Number(r[col])]),
    );
    let latest = null;
    for (const p of history) {
      const v = series[p.m];
      if (v == null) continue;
      if (p.ounce != null && !near(v, p.ounce, 0.02)) warn('altın revize', p.m, p.ounce, '→', v);
      p.ounce = v;
      latest = p.m;
    }
    if (latest) {
      const v = series[latest];
      if (data.rates.goldOunceUsd && !near(v, data.rates.goldOunceUsd, 0.4)) throw new Error(`altın şüpheli ${v}`);
      data.rates.goldOunceUsd = v;
      data.rates.goldMonth = latest;
      log('altın', latest, v);
    }
  } catch (e) {
    warn('altın atlandı:', e.message);
  }
}

// 5) Validate (same rules as the app) and write --------------------------
function valid(d) {
  return (
    typeof d.version === 'string' &&
    Array.isArray(d.holidays) &&
    d.holidays.every((h) => typeof h.date === 'string' && typeof h.name === 'string') &&
    Array.isArray(d.schoolBreaks) &&
    d.rates && typeof d.rates.date === 'string' &&
    d.law && Array.isArray(d.law.wageTaxBrackets) &&
    d.inflation && d.coverage
  );
}

await rates();
await historyRates();
await dailyRates();
await cpi();
await gold();

if (JSON.stringify(data) === before) {
  log('değişiklik yok');
} else {
  // Turkey time (UTC+3); never lower than the previous version
  const tr = new Date(Date.now() + 3 * 3600_000).toISOString().slice(0, 16);
  data.version = tr > data.version ? tr : data.version + '.1';
  if (!valid(data)) {
    console.error('Geçersiz veri, yazılmadı');
    process.exit(1);
  }
  writeFileSync(FILE, JSON.stringify(data, null, 1) + '\n');
  log('yazıldı', data.version);
}
