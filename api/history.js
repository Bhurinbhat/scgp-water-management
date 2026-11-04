// Vercel Serverless Function: GET /api/history?stations=709,2682&range=1D|1W|1M
// Water-level / discharge history from คลังข้อมูลน้ำแห่งชาติ (สสน.) for ThaiWater tele stations,
// downsampled for charts and returned with each station's bank level and channel capacity.
const BASE = 'https://api-v3.thaiwater.net/api/v1/thaiwater30/public/waterlevel_graph?station_type=tele_waterlevel&station_id=';
const HEADERS = { 'User-Agent': 'Mozilla/5.0 (SCGP BCM Water Dashboard)', Referer: 'https://www.thaiwater.net/', Accept: 'application/json' };
const RANGES = { '1D': { days: 1, stepMin: 60 }, '1W': { days: 7, stepMin: 120 }, '1M': { days: 30, stepMin: 360 } };

function bkkDate(ms) { return new Date(ms + 7 * 3600e3).toISOString().slice(0, 10); }
function num(x) { return x == null || x === '' || isNaN(+x) ? null : +x; }

async function one(id, range) {
  const now = Date.now();
  const url = BASE + encodeURIComponent(id) + '&start_date=' + bkkDate(now - (range.days + 1) * 864e5) + '&end_date=' + bkkDate(now);
  const r = await fetch(url, { headers: HEADERS, signal: AbortSignal.timeout(20000) });
  if (!r.ok) throw new Error('HTTP ' + r.status);
  const d = (await r.json()).data || {};
  const cutoff = now - range.days * 864e5;
  // keep the last reading in each step bucket (times are Bangkok local "YYYY-MM-DD HH:mm")
  const buckets = new Map();
  for (const p of d.graph_data || []) {
    const v = num(p.value), q = num(p.discharge);
    if (v == null && q == null) continue;
    const t = Date.parse(p.datetime.replace(' ', 'T') + ':00+07:00');
    if (!(t >= cutoff)) continue;
    const key = Math.floor(t / (range.stepMin * 60e3));
    const prev = buckets.get(key) || { t: t, v: null, q: null };
    prev.t = t; if (v != null) prev.v = v; if (q != null) prev.q = q;
    buckets.set(key, prev);
  }
  const points = [...buckets.values()].sort((a, b) => a.t - b.t).map((p) => [p.t, p.v, p.q == null ? null : Math.round(p.q * 10) / 10]);
  return { bank: num(d.min_bank), ground: num(d.ground_level), crit: num(d.critical_level), warn: num(d.warning_level), qmax: num(d.qmax), points };
}

module.exports = async (req, res) => {
  const range = RANGES[(req.query.range || '1D').toUpperCase()] || RANGES['1D'];
  const ids = String(req.query.stations || '').split(',').map((s) => s.trim()).filter((s) => /^\d{1,9}$/.test(s)).slice(0, 40);
  if (!ids.length) { res.status(400).json({ error: 'stations required' }); return; }
  const out = {};
  const results = await Promise.allSettled(ids.map((id) => one(id, range)));
  results.forEach((r, i) => { out[ids[i]] = r.status === 'fulfilled' ? r.value : { error: r.reason.message }; });
  res.setHeader('Cache-Control', 's-maxage=900, stale-while-revalidate=1800');
  res.status(200).json({ range: (req.query.range || '1D').toUpperCase(), fetchedAt: new Date().toISOString(), stations: out });
};
