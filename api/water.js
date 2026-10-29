// Vercel Serverless Function: GET /api/water
// Pulls public open data from คลังข้อมูลน้ำแห่งชาติ (สสน.) — which also relays กรมชลประทาน dam data
// and สำนักการระบายน้ำ กทม. road-flood sensors — then returns only what the SCGP sites need.
const { buildCompact } = require('./_lib/transform.js');
const sites = require('./_lib/sites.json');

const BASE = 'https://api-v3.thaiwater.net/api/v1/thaiwater30/public/';
const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (SCGP BCM Water Dashboard)',
  Referer: 'https://www.thaiwater.net/',
  Accept: 'application/json',
};

const EGAT = 'https://api-egatwater.egat.co.th/api';
async function getEgat(path) {
  const r = await fetch(EGAT + path, { headers: { 'User-Agent': HEADERS['User-Agent'], Referer: 'https://egatwater.egat.co.th/', Accept: 'application/json' }, signal: AbortSignal.timeout(20000) });
  if (!r.ok) throw new Error('EGAT ' + path + ' HTTP ' + r.status);
  return r.json();
}
// กฟผ. ศูนย์บริหารจัดการน้ำอัจฉริยะ (EGAT WIC): Mae Klong telemetry, daily dam infographic (rule curves), daily rain
async function egatBundle() {
  const d = new Date(Date.now() + 7 * 3600e3).toISOString().slice(0, 10); // Bangkok date
  const [tele, daily, rS, rV, hrs] = await Promise.all([
    getEgat('/Telemiter/Maeklong'),
    getEgat('/DailyInfographic?date=' + d),
    getEgat('/Telemiter/Maeklong/DailyRain?dam=SNR&date=' + d).catch(() => []),
    getEgat('/Telemiter/Maeklong/DailyRain?dam=VRK&date=' + d).catch(() => []),
    getEgat('/Telemiter/Maeklong/Hourly/DropdownList?date=' + d).catch(() => []),
  ]);
  return { at: hrs && hrs[0] ? d + ' ' + hrs[0].text : null, tele, daily, rain: (rS || []).concat(rV || []) };
}

// Supabase (project scg-bcm-monitor, schema "water"): keep a history of what this endpoint served,
// and fall back to the latest stored snapshot when the government APIs are unreachable.
const SB_URL = process.env.SUPABASE_URL;
const SB_KEY = process.env.SUPABASE_ANON_KEY;
const INGEST_KEY = process.env.WATER_INGEST_KEY;
async function sbRpc(fn, args) {
  if (!SB_URL || !SB_KEY || !INGEST_KEY) return null;
  const r = await fetch(SB_URL + '/rest/v1/rpc/' + fn, {
    method: 'POST',
    headers: { apikey: SB_KEY, Authorization: 'Bearer ' + SB_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify(Object.assign({ p_key: INGEST_KEY }, args)),
    signal: AbortSignal.timeout(8000),
  });
  if (!r.ok) throw new Error('Supabase ' + fn + ' HTTP ' + r.status);
  return r.json();
}

async function get(path) {
  const r = await fetch(BASE + path, { headers: HEADERS, signal: AbortSignal.timeout(25000) });
  if (!r.ok) throw new Error(path + ' HTTP ' + r.status);
  return r.json();
}

module.exports = async (req, res) => {
  const names = ['waterlevel_load', 'rain_24h', 'flood_road', 'thailand_main'];
  const [results, egat] = await Promise.all([Promise.allSettled(names.map(get)), egatBundle().catch((e) => ({ error: e.message }))]);
  const raw = {};
  const errors = [];
  ['wl', 'rain', 'fr', 'main'].forEach((k, i) => {
    if (results[i].status === 'fulfilled') raw[k] = results[i].value;
    else errors.push(names[i] + ': ' + results[i].reason.message);
  });
  if (errors.length === names.length) {
    const last = await sbRpc('water_latest_snapshot', {}).catch(() => null);
    if (last && last.wl) {
      last.source = 'supabase';
      last.errors = errors;
      res.setHeader('Cache-Control', 's-maxage=120');
      res.status(200).json(last);
      return;
    }
    res.status(502).json({ error: 'ThaiWater unreachable', errors });
    return;
  }
  if (!egat.error) raw.egat = egat; else errors.push(egat.error);
  const body = buildCompact(raw, sites);
  body.errors = errors;
  body.source = 'live';
  body.stored = await sbRpc('water_ingest_snapshot', { p_payload: body }).catch((e) => 'not stored: ' + e.message);
  // ThaiWater updates most telemetry every 10–15 minutes; cache at the edge for 10 minutes.
  res.setHeader('Cache-Control', 's-maxage=600, stale-while-revalidate=1200');
  res.status(200).json(body);
};
