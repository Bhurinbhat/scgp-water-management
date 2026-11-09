(function () {
'use strict';

/* ---------- Criteria (ค่าตั้งต้น — ทีม BCM ปรับได้) ---------- */
var CRITERIA = {
  dam:     { bands: [80, 90, 100], urcMargin: 5, unit: '% ความจุปกติ' },   // with กฟผ. rule curve: ≥URC−5% watch, >URC warning, ≥100% critical
  release: { bands: [0.2, 0.5, 1.0], unit: '% ของความจุปกติ/วัน' },     // released ÷ normal storage
  river:   { bands: [1.0, 0.5, 0.0], unit: 'ม. ต่ำกว่าตลิ่ง/ระดับวิกฤต' }, // freeboard (lower = worse)
  bank:    { bands: [70, 85, 100], unit: '% ความจุลำน้ำ' },
  rain:    { bands: [35.1, 90.1, 150], unit: 'มม./24 ชม.' },
  drain:   { bands: [5, 10, 20], unit: 'ซม.' },
  tide:    { GLF001: [1.6, 1.9, 2.1], pct: [70, 85, 100] },
  flow:    { velocity: 1.0, sinuosity: 1.3 },   // m/s and river-length ÷ straight-line distance, for travel-time estimates
  staleHours: 24,
  radius: { river: 20, bank: 15, bankFallback: 30, rain: 10, drain: 3 }
};

var LV = [
  { k: 0, th: 'ปกติ' }, { k: 1, th: 'เฝ้าระวัง' }, { k: 2, th: 'เตือนภัย' }, { k: 3, th: 'วิกฤต' }
];
var ZONES = { up: 'ต้นน้ำ', mid: 'กลางน้ำ', down: 'ปลายน้ำ' };
var ZONE_TRIG = { up: [1, 2, 3], mid: [3, 4, 5], down: [5, 6, 7] };
var TRIGGERS = [
  { n: 1, key: 'dam', th: 'ระดับน้ำเขื่อน', src: 'กรมชลประทาน' },
  { n: 2, key: 'release', th: 'น้ำไหลออก (ฝาย/ระบายเขื่อน)', src: 'กรมชลประทาน' },
  { n: 3, key: 'river', th: 'ระดับท่าน้ำ (ม.รทก.)', src: 'สสน. / ชป. / กฟผ.' },
  { n: 4, key: 'bank', th: 'ระดับตลิ่ง (วัดจากบ้าน)', src: 'สสน. / ชป.' },
  { n: 5, key: 'rain', th: 'ปริมาณน้ำฝน', src: 'สสน. / กรมอุตุฯ / ทน.' },
  { n: 6, key: 'drain', th: 'ระดับท่อน้ำทิ้ง (ภายใน/นิคม)', src: 'สนน. กทม. / เซ็นเซอร์โรงงาน' },
  { n: 7, key: 'tide', th: 'น้ำทะเลหนุน', src: 'สสน. / กรมอุทกศาสตร์' }
];

var SITES = window.SITES, hv = window.WaterTransform.haversine;
var state = { zone: 'all', q: '', lvl: null, trig: null, sel: null, mode: 'load', data: null, evals: {}, range: '1D', sort: 'risk', hist: {}, hmode: 'bank', open: null, near: null, userPicked: false, climP: 1 };
/* DCCE climate projections (RegCM5, provincial means): RX1day = wettest day of the year (mm), R20mm = days/yr with ≥ 20 mm */
var CLIM = window.CLIMATE || { prov: {}, periods: [] };
function climOf(s) { return CLIM.prov[s.prov] || null; }
function dPct(v, base) { return base ? (v - base) / base * 100 : null; }
function dChip(v, base) {
  var d = dPct(v, base); if (d == null) return '';
  return '<span class="dchip ' + (d >= 25 ? 'up2' : d >= 5 ? 'up' : d <= -5 ? 'dn' : '') + '">' + (d > 0 ? '+' : '') + f(d, 0) + '%</span>';
}
function climateBox(s) {
  var c = climOf(s); if (!c) return '';
  var p = state.climP, per = CLIM.periods[p], r = c.RX1day, n = c.R20mm;
  return '<div class="climbox"><div class="row"><b>' + icon('rain') + 'ภาพฉายฝนตกหนัก จ.' + esc(s.prov) + '</b><span class="muted" style="font-size:12px">ช่วง ' + esc(per) + ' · DCCE RegCM5</span></div>' +
    '<div class="row"><span>ฝนสูงสุด 1 วัน (RX1day): อดีต <b class="num">' + f(r.hist, 0) + '</b> มม.</span><span>→ SSP2-4.5 <b class="num">' + f(r.ssp245[p], 0) + '</b> ' + dChip(r.ssp245[p], r.hist) + '</span><span>SSP5-8.5 <b class="num">' + f(r.ssp585[p], 0) + '</b> ' + dChip(r.ssp585[p], r.hist) + '</span></div>' +
    '<div class="row"><span>วันฝนตกหนัก ≥ 20 มม. (R20mm): อดีต <b class="num">' + f(n.hist, 0) + '</b> วัน/ปี</span><span>→ SSP2-4.5 <b class="num">' + f(n.ssp245[p], 0) + '</b> ' + dChip(n.ssp245[p], n.hist) + '</span><span>SSP5-8.5 <b class="num">' + f(n.ssp585[p], 0) + '</b> ' + dChip(n.ssp585[p], n.hist) + '</span></div></div>';
}
/* ---------- climate atlas: Thailand provinces, RX1day, Historical vs SSP2-4.5 vs SSP5-8.5, 4 periods, animated ---------- */
var ATLAS_P = ['2015–2040', '2041–2060', '2061–2080', '2081–2100'], atlasTimer = null;
function lerpColor(stops, v) {
  if (v == null || isNaN(v)) return null;
  if (v <= stops[0][0]) return stops[0][1];
  for (var i = 1; i < stops.length; i++) if (v <= stops[i][0]) {
    var a = stops[i - 1], b = stops[i], t = (v - a[0]) / (b[0] - a[0]);
    var pa = parseInt(a[1].slice(1), 16), pb = parseInt(b[1].slice(1), 16);
    var c = [16, 8, 0].map(function (sh) { var x = (pa >> sh) & 255, y = (pb >> sh) & 255; return Math.round(x + (y - x) * t); });
    return 'rgb(' + c.join(',') + ')';
  }
  return stops[stops.length - 1][1];
}
var CA_ABS = [[80, '#EAF5FB'], [140, '#A9D8F0'], [200, '#5AAEDF'], [300, '#2A6FB8'], [450, '#3A2E96'], [700, '#24124F']];
var CA_CHG = [[-30, '#B8792E'], [0, '#F3F0E8'], [25, '#A9D8F0'], [60, '#4A9AD6'], [110, '#2A4FA8'], [180, '#2A1466']];
function atlasVal(p, scen, i, m) {
  var M = CLIM.map && CLIM.map[p.en]; if (!M) return null;
  var h = M.h; if (h == null) return null;
  var v = scen === 'h' ? h : (M[scen] || [])[i];
  if (v == null) return null;
  return m === 'chg' ? (scen === 'h' ? 0 : (v - h) / h * 100) : v;
}
function renderAtlas() {
  var T = window.THMAP, box = document.getElementById('caMaps'); if (!T || !box || !CLIM.map) { var ca = document.getElementById('catlas'); if (ca) ca.hidden = true; return; }
  var i = state.atlasP == null ? 1 : state.atlasP, m = state.atlasM || 'abs', stops = m === 'chg' ? CA_CHG : CA_ABS;
  // timeline
  document.getElementById('caTime').innerHTML = '<span class="bar" style="width:' + (i / 3 * 75) + '%"></span>' + ATLAS_P.map(function (p, k) { return '<button type="button" data-ap="' + k + '" aria-pressed="' + (k === i) + '" class="' + (k < i ? 'past' : '') + '"><i></i><b>' + p + '</b></button>'; }).join('');
  var sitesXY = SITES.map(function (s) { return [(s.lng - T.x0) * T.k * T.S, (T.y1 - s.lat) * T.S]; });
  var scen = [['h', 'อดีต (Historical)', 'ค่าฐาน 1981–2014'], ['s245', 'SSP2-4.5', 'ปล่อยก๊าซปานกลาง · ' + ATLAS_P[i]], ['s585', 'SSP5-8.5', 'ปล่อยก๊าซสูง · ' + ATLAS_P[i]]];
  var first = !box.firstChild;
  if (first) {
    box.innerHTML = scen.map(function (sc0) {
      var o = '<figure class="ca-map" data-scen="' + sc0[0] + '"><h4>' + sc0[1] + '<small>' + sc0[2] + '</small></h4><svg viewBox="-4 -4 ' + (T.W + 8) + ' ' + (T.H + 8) + '" role="img" aria-label="แผนที่ ' + sc0[1] + '">';
      o += '<defs><pattern id="ca-hatch" width="4" height="4" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect width="4" height="4" fill="#E6EAEE"/><line x1="0" y1="0" x2="0" y2="4" stroke="#C3CBD3" stroke-width="1.5"/></pattern></defs>';
      o += T.p.map(function (p, k) { return '<path class="pv" data-k="' + k + '" d="' + p.d + '"/>'; }).join('');
      o += '<g class="drops"></g>';
      o += sitesXY.map(function (q) { return '<circle class="site-pulse" cx="' + q[0].toFixed(1) + '" cy="' + q[1].toFixed(1) + '" r="3"/><circle class="site" cx="' + q[0].toFixed(1) + '" cy="' + q[1].toFixed(1) + '" r="2.6"/>'; }).join('');
      return o + '</svg><figcaption class="stat"></figcaption></figure>';
    }).join('');
  }
  [].forEach.call(box.querySelectorAll('.ca-map'), function (fig, fi) {
    var sk = scen[fi][0];
    fig.querySelector('h4 small').textContent = scen[fi][2] + (sk === 'h' && m === 'chg' ? ' · แสดงเป็น มม.' : '');
    var paths = fig.querySelectorAll('.pv'), sum = 0, n = 0, sumS = 0, nS = 0, drops = '';
    T.p.forEach(function (p, k) {
      var v = atlasVal(p, sk, i, sk === 'h' ? 'abs' : m), c = lerpColor(sk === 'h' ? CA_ABS : stops, v), el = paths[k];
      el.classList.toggle('na', v == null); if (c) el.style.fill = c;
      var ch = atlasVal(p, sk, i, 'chg');
      if (ch != null) { sum += ch; n++; if (SITES.some(function (s) { return s.prov === p.th; })) { sumS += ch; nS++; } }
      // falling rain over provinces where the wettest day grows ≥ 50 %
      if (!REDUCED && ch != null && ch >= 50 && sk !== 'h') { var nd = ch >= 120 ? 3 : ch >= 80 ? 2 : 1; for (var d = 0; d < nd; d++) drops += '<line class="drop" style="animation-delay:-' + ((k * 0.37 + d * 0.43) % 1.3).toFixed(2) + 's" x1="' + (p.c[0] + d * 4 - 4) + '" y1="' + (p.c[1] - 4) + '" x2="' + (p.c[0] + d * 4 - 5.5) + '" y2="' + p.c[1] + '"/>'; }
    });
    fig.querySelector('.drops').innerHTML = drops;
    var avg = n ? sum / n : null, avgS = nS ? sumS / nS : null;
    fig.querySelector('.stat').innerHTML = sk === 'h' ? 'ค่าฐานเพื่อเทียบ' : 'เฉลี่ยทั้งประเทศ <b class="' + (avg > 0 ? 'up' : '') + '">' + (avg > 0 ? '+' : '') + f(avg, 0) + '%</b> · จังหวัด SCGP <b class="' + (avgS > 0 ? 'up' : '') + '">' + (avgS > 0 ? '+' : '') + f(avgS, 0) + '%</b>';
  });
  // legend
  var lo = stops[0][0], hi = stops[stops.length - 1][0];
  document.getElementById('caLegend').innerHTML = '<span>' + (m === 'chg' ? 'การเปลี่ยนแปลงของฝนสูงสุด 1 วัน เทียบอดีต' : 'ฝนสูงสุดใน 1 วันของปี (RX1day) · มม.') + '</span><div class="grad" style="background:linear-gradient(90deg,' + stops.map(function (q) { return q[1] + ' ' + ((q[0] - lo) / (hi - lo) * 100).toFixed(0) + '%'; }).join(',') + ')"></div><div class="ticks">' + stops.map(function (q) { return '<span>' + (m === 'chg' && q[0] > 0 ? '+' : '') + q[0] + (m === 'chg' ? '%' : '') + '</span>'; }).join('') + '</div><span>หมุดขาว = ที่ตั้ง SCGP · เส้นฝนตก = เพิ่มขึ้น ≥ 50%</span>';
  // insight
  var top = T.p.map(function (p) { return { p: p, v: atlasVal(p, 's585', i, 'chg') }; }).filter(function (x) { return x.v != null; }).sort(function (a, b) { return b.v - a.v; }).slice(0, 3);
  var scgp = T.p.filter(function (p) { return SITES.some(function (s) { return s.prov === p.th; }); }).map(function (p) { return { p: p, v: atlasVal(p, 's585', i, 'chg') }; }).filter(function (x) { return x.v != null; }).sort(function (a, b) { return b.v - a.v; })[0];
  document.getElementById('caInsight').innerHTML = '<b>ช่วง ' + ATLAS_P[i] + ' (SSP5-8.5)</b> ฝนที่ตกหนักที่สุดใน 1 วันเพิ่มขึ้นมากที่สุดที่ ' + top.map(function (x) { return 'จ.' + esc(x.p.th) + ' <b>+' + f(x.v, 0) + '%</b>'; }).join(', ') +
    (scgp ? ' · ในจังหวัดที่ตั้ง SCGP สูงสุดคือ <b>จ.' + esc(scgp.p.th) + ' +' + f(scgp.v, 0) + '%</b> → ควรทบทวนขนาดระบบระบายน้ำ/คันกั้นน้ำของโรงงานในพื้นที่นี้' : '');
  document.getElementById('caPlay').textContent = atlasTimer ? '❚❚ หยุด' : '▶ เล่นภาพเคลื่อนไหว 4 ช่วงเวลา';
  document.getElementById('caPlay').setAttribute('aria-pressed', String(!!atlasTimer));
}
function atlasPlay() {
  if (atlasTimer) { clearInterval(atlasTimer); atlasTimer = null; renderAtlas(); return; }
  state.atlasP = -1;
  var step = function () { state.atlasP = (state.atlasP + 1) % 4; renderAtlas(); if (state.atlasP === 3) { clearInterval(atlasTimer); atlasTimer = null; setTimeout(renderAtlas, 50); } };
  atlasTimer = setInterval(step, 1700); step();
}
(function () {
  var ca = document.getElementById('catlas'); if (!ca) return;
  ca.addEventListener('click', function (ev) {
    var b = ev.target.closest('[data-ap]'), mm = ev.target.closest('[data-m]');
    if (b) { if (atlasTimer) { clearInterval(atlasTimer); atlasTimer = null; } state.atlasP = +b.dataset.ap; renderAtlas(); }
    if (mm) { state.atlasM = mm.dataset.m; [].forEach.call(ca.querySelectorAll('[data-m]'), function (x) { x.setAttribute('aria-pressed', String(x === mm)); }); renderAtlas(); }
    if (ev.target.closest('#caPlay')) atlasPlay();
  });
  var tip = document.getElementById('caTip');
  ca.addEventListener('pointermove', function (ev) {
    var el = ev.target.closest('.pv'); if (!el) { tip.hidden = true; return; }
    var p = THMAP.p[+el.dataset.k], i = state.atlasP == null ? 1 : state.atlasP, M = CLIM.map[p.en];
    if (!M) { tip.hidden = true; return; }
    var r = function (lbl, v) { return '<div class="r"><span>' + lbl + '</span><span><b style="display:inline;font-size:12px">' + (v == null ? '–' : f(v, 0) + ' มม.') + '</b>' + (v != null && lbl !== 'อดีต' ? ' ' + dChip(v, M.h) : '') + '</span></div>'; };
    tip.innerHTML = '<b>จ.' + esc(p.th) + (SITES.some(function (s) { return s.prov === p.th; }) ? ' · มีพื้นที่ SCGP' : '') + '</b><div class="muted" style="margin-bottom:4px">ฝนสูงสุด 1 วัน · ' + ATLAS_P[i] + '</div>' + r('อดีต', M.h) + r('SSP2-4.5', (M.s245 || [])[i]) + r('SSP5-8.5', (M.s585 || [])[i]);
    tip.hidden = false;
    var br = ca.getBoundingClientRect(), w = tip.offsetWidth;
    tip.style.left = Math.min(br.width - w - 8, ev.clientX - br.left + 14) + 'px'; tip.style.top = (ev.clientY - br.top + 14) + 'px';
  });
  ca.addEventListener('pointerleave', function () { tip.hidden = true; });
  if ('IntersectionObserver' in window && !REDUCED) { var once = new IntersectionObserver(function (es) { if (es[0].isIntersecting) { once.disconnect(); setTimeout(function () { if (!atlasTimer) atlasPlay(); }, 500); } }, { threshold: 0.3 }); once.observe(ca); }
})();
function renderClimate() {
  var el = document.getElementById('climTable'); if (!el) return;
  var p = state.climP, provs = {};
  SITES.forEach(function (s) { if (CLIM.prov[s.prov]) (provs[s.prov] = provs[s.prov] || []).push(s); });
  var rows = Object.keys(provs).map(function (k) { var c = CLIM.prov[k]; return { k: k, c: c, d: dPct(c.RX1day.ssp585[p], c.RX1day.hist) }; }).sort(function (a, b) { return b.d - a.d; });
  var h = '<thead><tr><th rowspan="2">จังหวัด</th><th rowspan="2">พื้นที่ SCGP</th><th colspan="3" style="text-align:center">RX1day ฝนสูงสุด 1 วัน (มม.)</th><th colspan="3" style="text-align:center">R20mm วันฝน ≥ 20 มม. (วัน/ปี)</th></tr><tr><th>อดีต</th><th>SSP2-4.5</th><th>SSP5-8.5</th><th>อดีต</th><th>SSP2-4.5</th><th>SSP5-8.5</th></tr></thead><tbody>';
  rows.forEach(function (r) {
    var c = r.c, R = c.RX1day, N = c.R20mm;
    h += '<tr><td><b>' + esc(r.k) + '</b></td><td class="muted" style="white-space:normal;min-width:160px;font-size:12.5px">' + provs[r.k].map(function (s) { return esc(s.name); }).join(', ') + '</td>' +
      '<td class="num">' + f(R.hist, 0) + '</td><td class="num">' + f(R.ssp245[p], 0) + ' ' + dChip(R.ssp245[p], R.hist) + '</td><td class="num">' + f(R.ssp585[p], 0) + ' ' + dChip(R.ssp585[p], R.hist) + '</td>' +
      '<td class="num">' + f(N.hist, 0) + '</td><td class="num">' + f(N.ssp245[p], 0) + ' ' + dChip(N.ssp245[p], N.hist) + '</td><td class="num">' + f(N.ssp585[p], 0) + ' ' + dChip(N.ssp585[p], N.hist) + '</td></tr>';
  });
  el.innerHTML = h + '</tbody>';
}

/* ---------- helpers ---------- */
function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
function f(x, d) { return x == null || isNaN(x) ? '–' : (+x).toLocaleString('en-US', { minimumFractionDigits: d == null ? 2 : d, maximumFractionDigits: d == null ? 2 : d }); }
function lvlBy(v, bands) { if (v == null || isNaN(v)) return null; var l = 0; for (var i = 0; i < bands.length; i++) if (v >= bands[i]) l = i + 1; return l; }
function lvlLow(v, bands) { if (v == null || isNaN(v)) return null; var l = 0; for (var i = 0; i < bands.length; i++) if (v <= bands[i]) l = i + 1; return l; }
function sc(l) { return l == null ? 'sn' : 's' + l; }
function lname(l) { return l == null ? 'ไม่มีข้อมูล' : LV[l].th; }
function parseT(t, ref) {
  if (!t) return null;
  var m = /^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2}))?/.exec(t);
  if (!m) return null;
  return new Date(Date.UTC(+m[1], +m[2] - 1, +m[3], (+m[4] || 0) - 7, +m[5] || 0));
}
function fmtT(d, withDate) {
  if (!d) return '–';
  var o = { timeZone: 'Asia/Bangkok', hour: '2-digit', minute: '2-digit' };
  if (withDate !== false) { o.day = 'numeric'; o.month = 'short'; }
  return d.toLocaleString('th-TH', o) + ' น.';
}
function fresh(d) { return d && (refTime() - d) <= CRITERIA.staleHours * 3600e3; }
function refTime() { return new Date(state.data.fetchedAt).getTime(); }
function km(x) { return x < 1 ? '<1 กม.' : f(x, 1) + ' กม.'; }

/* ---------- Animated icons: each one acts out what it measures ---------- */
var ICONS = {
  drop: '<path d="M12 3c3.6 4.6 6 7.8 6 10.8a6 6 0 0 1-12 0C6 10.8 8.4 7.6 12 3z" fill="currentColor"/><circle class="ai-pulse" cx="12" cy="20" r="6" fill="none" stroke="currentColor" stroke-width="1.4"/>',
  river: '<g class="ai-wave"><path d="M0 9q3-3 6 0t6 0 6 0 6 0 6 0" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><path d="M-4 15q3-3 6 0t6 0 6 0 6 0 6 0" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" opacity=".6"/></g>',
  network: '<path d="M5 6l7 6 7-6M12 12v7" stroke="currentColor" stroke-width="1.6" fill="none"/><circle class="ai-node" cx="5" cy="6" r="2.6" fill="currentColor"/><circle class="ai-node" style="animation-delay:.35s" cx="19" cy="6" r="2.6" fill="currentColor"/><circle class="ai-node" style="animation-delay:.7s" cx="12" cy="12" r="2.6" fill="currentColor"/><circle class="ai-node" style="animation-delay:1.05s" cx="12" cy="19.5" r="2.6" fill="currentColor"/>',
  pin: '<ellipse class="ai-shadow" cx="12" cy="21" rx="4" ry="1.3" fill="currentColor" opacity=".35"/><g class="ai-bounce"><path d="M12 2a6 6 0 0 1 6 6c0 4.5-6 11-6 11S6 12.5 6 8a6 6 0 0 1 6-6z" fill="currentColor"/><circle cx="12" cy="8" r="2.2" fill="#fff"/></g>',
  list: '<rect x="3" y="4" width="18" height="16" rx="2.5" fill="none" stroke="currentColor" stroke-width="1.6"/><rect class="ai-scan" x="4.5" y="6" width="15" height="3" rx="1" fill="currentColor" opacity=".3"/><path d="M7 7.5h10M7 12.5h10M7 17h7" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/>',
  dam: '<path d="M3 21V9h4l3 12z" fill="currentColor"/><clipPath id="aiDamClip"><rect x="10" y="5" width="12" height="16"/></clipPath><g clip-path="url(#aiDamClip)"><g class="ai-level"><rect x="9" y="11" width="14" height="12" fill="currentColor" opacity=".45"/><path d="M9 11q2-1.5 4 0t4 0 4 0" fill="none" stroke="currentColor" stroke-width="1.4"/></g></g>',
  release: '<path d="M2 20V7h4l3 13z" fill="currentColor"/><g fill="currentColor"><path class="ai-right" d="M11 9l4 2.5-4 2.5z"/><path class="ai-right" style="animation-delay:.4s" d="M14 13l4 2.5-4 2.5z"/><path class="ai-right" style="animation-delay:.8s" d="M17 9l4 2.5-4 2.5z"/></g>',
  gauge: '<rect x="15" y="3" width="4" height="18" rx="1" fill="none" stroke="currentColor" stroke-width="1.5"/><path d="M15 7h2M15 11h2M15 15h2" stroke="currentColor" stroke-width="1.4"/><g class="ai-level"><path d="M1 14q2.5-2 5 0t5 0 5 0 5 0" fill="none" stroke="currentColor" stroke-width="2"/><rect x="1" y="15" width="22" height="7" fill="currentColor" opacity=".3"/></g>',
  bank: '<path d="M4 12l7-6 7 6v8H4z" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/><rect x="9" y="14" width="4" height="6" fill="currentColor" opacity=".5"/><clipPath id="aiBankClip"><rect x="0" y="12" width="24" height="12"/></clipPath><g clip-path="url(#aiBankClip)"><g class="ai-level"><path d="M0 18q3-2 6 0t6 0 6 0 6 0" fill="none" stroke="currentColor" stroke-width="1.8"/><rect x="0" y="19" width="24" height="6" fill="currentColor" opacity=".35"/></g></g>',
  rain: '<path d="M7 13a4 4 0 0 1 .6-8 5.5 5.5 0 0 1 10.5 1.6A3.3 3.3 0 0 1 17.5 13z" fill="currentColor"/><g fill="currentColor"><path class="ai-fall" d="M8 15.5q1 2 0 3-1-1 0-3z"/><path class="ai-fall" style="animation-delay:.45s" d="M12 15.5q1 2 0 3-1-1 0-3z"/><path class="ai-fall" style="animation-delay:.9s" d="M16 15.5q1 2 0 3-1-1 0-3z"/></g>',
  drain: '<path d="M2 6h11a4 4 0 0 1 4 4v3" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round"/><path d="M14 13h6" stroke="currentColor" stroke-width="3" stroke-linecap="round"/><path class="ai-drip" d="M17 15.5q1.6 2.6 0 3.6-1.6-1 0-3.6z" fill="currentColor"/><path d="M12 22h10" stroke="currentColor" stroke-width="1.4" opacity=".5"/>',
  tide: '<circle cx="18" cy="5.5" r="3" fill="currentColor" opacity=".55"/><g class="ai-tide"><path d="M1 13q2.5-2.5 5 0t5 0 5 0 5 0" fill="none" stroke="currentColor" stroke-width="2"/><path d="M1 17q2.5-2.5 5 0t5 0 5 0 5 0" fill="none" stroke="currentColor" stroke-width="2" opacity=".55"/></g><path d="M5 3v6M3 5l2-2 2 2" stroke="currentColor" stroke-width="1.5" fill="none" stroke-linecap="round"/>',
  factory: '<circle class="ai-puff" cx="18" cy="3" r="2.2" fill="currentColor"/><circle class="ai-puff" style="animation-delay:1.2s" cx="18" cy="3" r="2.2" fill="currentColor"/><rect x="16" y="5" width="3.5" height="8" fill="currentColor"/><path d="M2 21V12l5-3v3l5-3v3l5-3v3h4v9z" fill="currentColor"/>',
  antenna: '<path d="M12 11v10M8 21h8" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/><circle cx="12" cy="9" r="2.2" fill="currentColor"/><circle class="ai-pulse" cx="12" cy="9" r="7" fill="none" stroke="currentColor" stroke-width="1.5"/><circle class="ai-pulse" style="animation-delay:1s" cx="12" cy="9" r="7" fill="none" stroke="currentColor" stroke-width="1.5"/>',
  siren: '<path d="M7 18v-5a5 5 0 0 1 10 0v5z" fill="currentColor"/><rect x="5" y="18" width="14" height="3" rx="1" fill="currentColor"/><g class="ai-flash" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M12 2v3M4 6l2 2M20 6l-2 2M2 13h2M20 13h2"/></g>',
  alert: '<g class="ai-shake"><path d="M12 3l10 17H2z" fill="currentColor"/><path d="M12 9v5" stroke="#fff" stroke-width="2.2" stroke-linecap="round"/><circle cx="12" cy="17" r="1.3" fill="#fff"/></g>',
  eye: '<g class="ai-blink"><path d="M2 12s3.6-6 10-6 10 6 10 6-3.6 6-10 6S2 12 2 12z" fill="none" stroke="currentColor" stroke-width="1.8"/><circle cx="12" cy="12" r="3" fill="currentColor"/></g>',
  shield: '<g class="ai-glow"><path d="M12 2l8 3v6c0 5-3.4 9.3-8 11-4.6-1.7-8-6-8-11V5z" fill="currentColor"/><path d="M8 12l3 3 5-6" stroke="#fff" stroke-width="2.2" fill="none" stroke-linecap="round" stroke-linejoin="round"/></g>'
};
var TRIG_ICON = { 1: 'dam', 2: 'release', 3: 'gauge', 4: 'bank', 5: 'rain', 6: 'drain', 7: 'tide' };
var LVL_ICON = { 0: 'shield', 1: 'eye', 2: 'alert', 3: 'siren' };
function icon(name, cls, style) { return '<span class="ai ' + (cls || '') + '"' + (style ? ' style="' + style + '"' : '') + ' aria-hidden="true"><svg viewBox="0 0 24 24">' + (ICONS[name] || '') + '</svg></span>'; }
function paintIcons(root) { Array.prototype.forEach.call((root || document).querySelectorAll('.ai[data-ico]'), function (el) { if (!el.firstChild) el.innerHTML = '<svg viewBox="0 0 24 24">' + (ICONS[el.dataset.ico] || '') + '</svg>'; }); }

/* ---------- Sign-in guard (SCG SSO via Supabase Auth · Microsoft Entra ID) ---------- */
var auth = { cfg: null, client: null, user: null };
async function authGuard() {
  var chip = document.getElementById('userChip');
  try { var r = await fetchT('api/config', 6000); auth.cfg = r.ok && /json/.test(r.headers.get('content-type') || '') ? await r.json() : null; } catch (e) { auth.cfg = null; }
  if (!auth.cfg || !auth.cfg.ssoEnabled || !window.supabase) {
    chip.innerHTML = '<a class="demo-chip" href="./" title="SSO ยังไม่ได้เปิดใช้">โหมดทดลอง · ยังไม่เปิด SSO</a>';
    return true;
  }
  auth.client = window.supabase.createClient(auth.cfg.supabaseUrl, auth.cfg.supabaseAnonKey);
  var s = (await auth.client.auth.getSession()).data.session;
  if (!s) { location.replace('./'); return false; }
  var email = (s.user.email || '').toLowerCase(), dom = email.split('@')[1] || '';
  if (auth.cfg.allowedDomains && auth.cfg.allowedDomains.length && auth.cfg.allowedDomains.indexOf(dom) < 0) {
    await auth.client.auth.signOut(); location.replace('./?denied=' + encodeURIComponent(auth.cfg.allowedDomains.join(', '))); return false;
  }
  auth.user = s.user;
  var name = (s.user.user_metadata && (s.user.user_metadata.full_name || s.user.user_metadata.name)) || email;
  chip.innerHTML = '<span class="user-chip"><span class="av">' + esc(name.trim().charAt(0).toUpperCase()) + '</span><span>' + esc(name) + '</span><button type="button" id="logoutBtn">ออกจากระบบ</button></span>';
  document.getElementById('logoutBtn').addEventListener('click', async function () { await auth.client.auth.signOut(); location.replace('./'); });
  return true;
}

/* ---------- normalise compact data ---------- */
function normalise(raw) {
  var d = { fetchedAt: raw.fetchedAt };
  d.wl = raw.wl.map(function (a) { return { id: a[0], code: a[1], name: a[2], lat: a[3], lng: a[4], t: parseT(a[5]), msl: a[6], prev: a[7], pct: a[8], sit: a[9], minBank: a[10], crit: a[11], diff: a[12], over: a[13], river: a[14], ag: a[15], prov: a[16] }; });
  d.rain = raw.rain.map(function (a) { return { name: a[0], lat: a[1], lng: a[2], t: parseT(a[3]), v: a[4] }; });
  d.fr = raw.fr.map(function (a) { return { name: a[0], lat: a[1], lng: a[2], t: parseT(a[3]), v: a[4] }; });
  d.dam = raw.dam.map(function (a) { return { id: a[0], name: a[1], lat: a[2], lng: a[3], st: a[4], pct: a[5], inf: a[6], rel: a[7], spill: a[8], norm: a[9], t: a[10] ? parseT(a[10]) : null }; });
  d.damByName = {}; d.dam.forEach(function (x) { d.damByName[x.name] = x; });
  d.egat = normEgat(raw.egat);
  return d;
}

/* ---------- 7-trigger evaluation per site ---------- */
function near(list, s, r) {
  return list.map(function (x) { return { x: x, d: hv(s.lat, s.lng, x.lat, x.lng) }; })
    .filter(function (z) { return z.d <= r; }).sort(function (a, b) { return a.d - b.d; });
}
/* Trigger 1: use กฟผ. Rule Curve (URC) where published, otherwise % of normal storage */
function damLevel(x) {
  var g = state.data.egat && state.data.egat.byName[x.name];
  if (g && g.upper) {
    if (x.pct >= CRITERIA.dam.bands[2]) return 3;
    if (x.pct > g.upper) return 2;
    if (x.pct >= g.upper - CRITERIA.dam.urcMargin) return 1;
    return 0;
  }
  return lvlBy(x.pct, CRITERIA.dam.bands);
}
function evaluate(s) {
  var D = state.data, out = {};
  // 1 + 2 dams
  var dams = s.dams.map(function (n) { return D.damByName[n]; }).filter(Boolean);
  if (!dams.length) {
    out[1] = { l: null, na: s.dams.length ? 'ไม่พบข้อมูลเขื่อนในรอบนี้' : 'ไม่มีเขื่อนขนาดใหญ่เหนือพื้นที่' };
    out[2] = { l: null, na: out[1].na };
  } else {
    var r1 = dams.map(function (x) { return { x: x, l: damLevel(x) }; }).sort(function (a, b) { return (b.l - a.l) || (b.x.pct - a.x.pct); });
    var w1 = r1[0].x, rc1 = D.egat && D.egat.byName[w1.name];
    out[1] = { l: r1[0].l, mt: { x: w1.pct, b: CRITERIA.dam.bands, u: '% ความจุ' }, v: f(w1.pct, 1), u: '%', title: 'เขื่อน' + w1.name + (rc1 && rc1.rc ? ' · ' + RC[rc1.rc].th + ' (กฟผ.)' : ''),
      why: dams.map(function (x) { var g = D.egat && D.egat.byName[x.name]; return x.name + ' ' + f(x.pct, 1) + '%' + (g && g.upper ? ' (URC ' + f(g.upper, 1) + '%)' : ''); }).join(' · '),
      src: 'กรมชลประทาน · ปริมาตร ' + f(w1.st, 0) + ' / ' + f(w1.norm, 0) + ' ล้าน ลบ.ม.', geo: dams.map(function (x) { return { lat: x.lat, lng: x.lng, n: 'เขื่อน' + x.name }; }) };
    var rel = dams.map(function (x) { var p = x.norm ? x.rel / x.norm * 100 : null; var l = lvlBy(p, CRITERIA.release.bands); if (x.spill > 0) l = Math.max(l || 0, 2); return { x: x, p: p, l: l }; })
      .sort(function (a, b) { return (b.l - a.l) || (b.p - a.p); });
    var w2 = rel[0];
    out[2] = { l: w2.l, mt: { x: w2.p, b: CRITERIA.release.bands, u: '% ความจุ/วัน' }, v: f(w2.x.rel, 2), u: 'ล้าน ลบ.ม./วัน', title: 'ระบายจากเขื่อน' + w2.x.name,
      why: 'เท่ากับ ' + f(w2.p, 2) + '% ของความจุปกติต่อวัน · น้ำไหลเข้า ' + f(w2.x.inf, 2) + ' ล้าน ลบ.ม.' + (w2.x.spill > 0 ? ' · มีน้ำล้นทางระบายน้ำล้น' : ''),
      src: 'กรมชลประทาน · รายงานประจำวัน', dam: w2.x };
  }
  // 3 river stage at nearest main-river station
  var fw = D.wl.filter(function (x) { return fresh(x.t); });
  var cand = near(fw, s, CRITERIA.radius.river);
  var main = cand.filter(function (z) { return /แม่น้ำ|ลำน้ำ/.test(z.x.river); });
  var r3 = (main[0] || cand[0]);
  if (r3) {
    var x = r3.x, fb = x.diff == null ? null : (x.over ? -x.diff : x.diff), basis = 'ตลิ่งต่ำสุด ' + f(x.minBank) + ' ม.รทก.';
    if (x.crit != null && x.msl != null) { fb = x.crit - x.msl; basis = 'ระดับวิกฤต ' + f(x.crit) + ' ม.รทก.'; }
    var tr = x.prev == null || x.msl == null ? null : x.msl - x.prev;
    out[3] = { l: lvlLow(fb, CRITERIA.river.bands), mt: { x: fb, b: CRITERIA.river.bands, u: 'ม. ต่ำกว่าตลิ่ง', low: true }, v: f(x.msl), u: 'ม.รทก.', title: x.name + (x.river ? ' · ' + x.river : ''),
      why: (fb == null ? '' : (fb < 0 ? 'สูงกว่า' : 'ต่ำกว่า') + basis.replace(/ .*/, '') + ' ' + f(Math.abs(fb)) + ' ม. (' + basis + ')'), trend: tr,
      src: x.ag + ' ' + x.code + ' · ห่าง ' + km(r3.d) + ' · ' + fmtT(x.t), geo: [{ lat: x.lat, lng: x.lng, n: x.name }], st: x };
  } else out[3] = { l: null, na: 'ไม่มีสถานีวัดระดับน้ำในรัศมี ' + CRITERIA.radius.river + ' กม.' };
  // 4 bank-full % (worst nearby)
  var c4 = near(fw, s, CRITERIA.radius.bank); if (!c4.length) c4 = near(fw, s, CRITERIA.radius.bankFallback).slice(0, 1);
  if (c4.length) {
    var w4 = c4.slice().sort(function (a, b) { return b.x.pct - a.x.pct; })[0];
    out[4] = { l: lvlBy(w4.x.pct, CRITERIA.bank.bands), mt: { x: w4.x.pct, b: CRITERIA.bank.bands, u: '% ตลิ่ง' }, v: f(w4.x.pct, 1), u: '%', title: w4.x.name + (w4.x.river ? ' · ' + w4.x.river : ''),
      why: (w4.x.over ? 'ล้นตลิ่ง ' : 'ต่ำกว่าตลิ่ง ') + f(w4.x.diff) + ' ม. · พิจารณา ' + c4.length + ' สถานีใกล้พื้นที่',
      src: w4.x.ag + ' ' + w4.x.code + ' · ห่าง ' + km(w4.d) + ' · ' + fmtT(w4.x.t), geo: c4.map(function (z) { return { lat: z.x.lat, lng: z.x.lng, n: z.x.name }; }), st: w4.x };
  } else out[4] = { l: null, na: 'ไม่มีสถานีวัดระดับน้ำในรัศมี ' + CRITERIA.radius.bankFallback + ' กม.' };
  // 5 rain 24h
  var c5 = near(D.rain.filter(function (x) { return fresh(x.t); }), s, CRITERIA.radius.rain);
  if (c5.length) {
    var w5 = c5.slice().sort(function (a, b) { return b.x.v - a.x.v; })[0], cl5 = climOf(s);
    out[5] = { l: lvlBy(w5.x.v, CRITERIA.rain.bands), mt: { x: w5.x.v, b: CRITERIA.rain.bands, u: 'มม./24 ชม.' }, v: f(w5.x.v, 1), u: 'มม./24 ชม.', title: 'สูงสุดในรัศมี ' + CRITERIA.radius.rain + ' กม.: ' + w5.x.name,
      why: c5.length + ' สถานีฝน · ' + (w5.x.v > 90 ? 'ฝนตกหนักมาก' : w5.x.v > 35 ? 'ฝนตกหนัก' : w5.x.v > 10 ? 'ฝนปานกลาง' : 'ฝนเล็กน้อย/ไม่มีฝน') +
        (cl5 ? ' · เท่ากับ ' + f(w5.x.v / cl5.RX1day.hist * 100, 0) + '% ของฝนสูงสุด 1 วันเฉลี่ยในอดีตของ จ.' + s.prov + ' (RX1day ' + f(cl5.RX1day.hist, 0) + ' มม., DCCE)' : ''),
      src: 'คลังข้อมูลน้ำแห่งชาติ · ห่าง ' + km(w5.d) + ' · ' + fmtT(w5.x.t), geo: [{ lat: w5.x.lat, lng: w5.x.lng, n: w5.x.name }] };
  } else out[5] = { l: null, na: 'ไม่มีสถานีวัดฝนในรัศมี ' + CRITERIA.radius.rain + ' กม.' };
  // 6 drain / ponding
  var c6 = near(D.fr.filter(function (x) { return fresh(x.t); }), s, CRITERIA.radius.drain);
  if (c6.length) {
    var w6 = c6.slice().sort(function (a, b) { return b.x.v - a.x.v; })[0];
    out[6] = { l: lvlBy(w6.x.v, CRITERIA.drain.bands), mt: { x: w6.x.v, b: CRITERIA.drain.bands, u: 'ซม.' }, v: f(w6.x.v, 1), u: 'ซม.', title: 'น้ำท่วมขังถนนรอบพื้นที่: ' + w6.x.name,
      why: c6.length + ' จุดวัดในรัศมี ' + CRITERIA.radius.drain + ' กม. · ใช้แทนข้อมูลท่อภายในจนกว่าจะเชื่อมเซ็นเซอร์โรงงาน',
      src: 'สำนักการระบายน้ำ กทม. · ห่าง ' + km(w6.d) + ' · ' + fmtT(w6.x.t), geo: c6.map(function (z) { return { lat: z.x.lat, lng: z.x.lng, n: z.x.name }; }) };
  } else out[6] = { l: null, na: 'รอเชื่อมเซ็นเซอร์ระดับท่อ/บ่อพักภายในโรงงานหรือนิคม' };
  // 7 tide
  if (s.tide) {
    var ts = D.wl.filter(function (x) { return x.code === s.tide; })[0];
    if (ts && fresh(ts.t)) {
      var l7 = s.tide === 'GLF001' ? lvlBy(ts.msl, CRITERIA.tide.GLF001) : lvlBy(ts.pct, CRITERIA.tide.pct);
      out[7] = { l: l7, mt: s.tide === 'GLF001' ? { x: ts.msl, b: CRITERIA.tide.GLF001, u: 'ม.รทก.' } : { x: ts.pct, b: CRITERIA.tide.pct, u: '% ตลิ่ง' }, v: f(ts.msl), u: 'ม.รทก.', title: 'สถานี' + ts.name, trend: ts.prev == null ? null : ts.msl - ts.prev,
        why: s.tide === 'GLF001' ? 'เกณฑ์ปากแม่น้ำเจ้าพระยา: เฝ้าระวัง ' + CRITERIA.tide.GLF001[0] + ' / เตือนภัย ' + CRITERIA.tide.GLF001[1] + ' / วิกฤต ' + CRITERIA.tide.GLF001[2] + ' ม.รทก.' : f(ts.pct, 1) + '% ของตลิ่ง',
        src: ts.ag + ' ' + ts.code + ' · ห่าง ' + km(hv(s.lat, s.lng, ts.lat, ts.lng)) + ' · ' + fmtT(ts.t), geo: [{ lat: ts.lat, lng: ts.lng, n: ts.name }] };
    } else out[7] = { l: null, na: 'สถานีวัดน้ำทะเลไม่ส่งข้อมูลใน 24 ชม.' };
  } else out[7] = { l: null, na: s.zone === 'down' ? 'ไม่มีสถานีโทรมาตรในระบบ · ดูตารางน้ำขึ้นลง กรมอุทกศาสตร์' : 'อยู่นอกพื้นที่อิทธิพลน้ำทะเลหนุน' };

  var ls = [1, 2, 3, 4, 5, 6, 7].map(function (n) { return out[n].l; }).filter(function (l) { return l != null; });
  out.overall = ls.length ? Math.max.apply(null, ls) : null;
  return out;
}

/* ---------- rendering ---------- */
function visibleSites() {
  var q = state.q.trim().toLowerCase();
  var list = SITES.filter(function (s) {
    var e = state.evals[s.id], st = refStation(s);
    if (state.zone !== 'all' && s.zone !== state.zone) return false;
    if (state.lvl != null && e.overall !== state.lvl) return false;
    if (state.trig != null && e[state.trig].l == null) return false;
    if (q && (s.name + ' ' + s.prov + ' ' + s.amp + ' ' + s.basin + ' ' + s.cos.join(' ') + (st ? ' ' + st.code + ' ' + st.name : '')).toLowerCase().indexOf(q) < 0) return false;
    return true;
  });
  function key(s) {
    var e = state.evals[s.id], st = refStation(s);
    if (state.sort === 'bank') return st && st.pct != null ? st.pct : -1;
    if (state.sort === 'trend') { var t = st ? trendOf(st) : null; return t == null ? -99 : t; }
    var k = state.trig != null ? e[state.trig].l : e.overall; return k == null ? -1 : k;
  }
  return list.sort(function (a, b) { if (state.sort === 'name') return a.name.localeCompare(b.name, 'th'); return (key(b) - key(a)) || a.name.localeCompare(b.name, 'th'); });
}

function trigSummary(n) {
  var c = [0, 0, 0, 0], na = 0, worst = null;
  SITES.forEach(function (s) { var l = state.evals[s.id][n].l; if (l == null) na++; else { c[l]++; worst = Math.max(worst == null ? -1 : worst, l); } });
  return { c: c, na: na, worst: worst };
}

/* ---------- River profile: one site's water path, factory icon, animated inflow/outflow, travel-time estimates ---------- */
var flowAnim = null;
function topSite() { return SITES.slice().sort(function (a, b) { return ((state.evals[b.id].overall || 0) - (state.evals[a.id].overall || 0)) || ((state.evals[b.id][1].l || 0) - (state.evals[a.id][1].l || 0)); })[0]; }
function profileSite() { return SITES.filter(function (x) { return x.id === state.sel; })[0] || topSite(); }
function eta(h) { if (h == null) return null; return h < 1 ? '< 1 ชม.' : h < 36 ? '≈ ' + Math.round(h) + ' ชม.' : '≈ ' + f(h / 24, 1) + ' วัน'; }
function travelHours(a, b) { return hv(a.lat, a.lng, b.lat, b.lng) * CRITERIA.flow.sinuosity / (CRITERIA.flow.velocity * 3.6); }

function renderProfile() {
  var svg = document.getElementById('profile');
  var s = profileSite(); if (!s) return;
  var e = state.evals[s.id];
  var dam = e[2] && e[2].dam;
  // travel-time estimates from the releasing dam to each point downstream
  var T = {};
  if (dam) {
    T[1] = 0; T[2] = 0;
    T.f = travelHours(dam, s);
    [3, 4, 7].forEach(function (n) { var g = e[n].geo && e[n].geo[0]; if (g) T[n] = Math.max(travelHours(dam, g), n === 7 ? T.f : 0); });
    T[5] = T.f; T[6] = T.f;
  }
  var sel = document.getElementById('profileSite');
  if (sel && sel.value !== s.id) sel.value = s.id;
  document.getElementById('profileNote').textContent = dam
    ? 'น้ำระบายจากเขื่อน' + dam.name + ' ถึงโรงงานโดยประมาณ ' + eta(T.f) + ' (ความเร็วน้ำ ' + CRITERIA.flow.velocity + ' ม./วินาที, ระยะทางลำน้ำ ≈ ' + CRITERIA.flow.sinuosity + ' เท่าระยะตรง)'
    : 'พื้นที่นี้ไม่มีเขื่อนขนาดใหญ่ต้นน้ำ · ภาพแสดงน้ำท่าจากฝนในลุ่มน้ำ' + s.basin;

  var P = [[0, 118], [95, 118], [215, 168], [470, 178], [560, 192], [800, 198], [890, 206], [905, 206]];
  function yAt(x) { for (var i = 1; i < P.length; i++) if (x <= P[i][0]) { var a = P[i - 1], b = P[i]; return a[1] + (b[1] - a[1]) * (x - a[0]) / (b[0] - a[0]); } return 214; }
  var land = 'M0,300 L' + P.map(function (p) { return p.join(','); }).join(' L') + ' L905,300 Z';
  var X = { 1: 60, 2: 190, 3: 400, 4: 535, 5: 675, 6: 830, 7: 1030 }, FX = 295;
  var h = '';
  h += '<rect x="905" y="214" width="295" height="86" fill="var(--sea)"/>';
  h += '<path d="' + land + '" fill="var(--water)"/>';
  // river ribbon along the surface (dam outlet → sea)
  var river = 'M56,113 ' + P.slice(1).map(function (p) { return 'L' + p[0] + ',' + (p[1] - 4); }).join(' ') + ' L930,212 L1200,212';
  h += '<path id="riverPath" d="' + river + '" fill="none" stroke="var(--water-2)" stroke-width="7" stroke-linejoin="round" stroke-linecap="round"/>';
  h += '<path id="inflowPath" d="M-10,30 C 10,60 14,80 22,104" fill="none" stroke="var(--water-2)" stroke-width="5" stroke-linecap="round" opacity=".7"/>';
  h += '<clipPath id="seaClip"><rect x="905" y="190" width="295" height="110"/></clipPath>';
  h += '<g clip-path="url(#seaClip)"><path class="wave wave-back" d="M905 214 Q 935 208 965 214 T 1025 214 T 1085 214 T 1145 214 T 1205 214 T 1265 214 T 1325 214" fill="none" stroke="var(--surface)" stroke-width="2" opacity=".45"/></g>';
  // dam
  h += '<g class="hov" data-tip="dam" transform="translate(18,78)"><rect x="0" y="0" width="34" height="40" rx="3" fill="var(--deep)"/><path d="M34 6 Q 52 18 46 40 L34 40 Z" fill="var(--water-2)"/><rect x="5" y="6" width="5" height="28" fill="var(--surface)" opacity=".7"/><rect x="14" y="6" width="5" height="28" fill="var(--surface)" opacity=".7"/></g>';
  [[40, 'เขื่อน'], [470, 'แม่น้ำ'], [740, 'คลอง'], [1060, 'ทะเล']].forEach(function (t) {
    var y = t[0] > 900 ? 266 : yAt(t[0]) + 52;
    h += '<text x="' + t[0] + '" y="' + y + '" text-anchor="middle" font-size="14" font-weight="600" fill="#FFFFFF" opacity=".9">' + t[1] + '</text>';
  });
  [[18, 440, 'ต้นน้ำ', '1–3', 'up', 0], [330, 780, 'กลางน้ำ', '3–5', 'mid', -14], [640, 1182, 'ปลายน้ำ', '5–7', 'down', 0]].forEach(function (z) {
    var y = 288 + z[5], active = state.zone === z[4] || s.zone === z[4];
    h += '<g class="zone-band" data-zone="' + z[4] + '" style="cursor:pointer"><path d="M' + z[0] + ',' + (y - 8) + ' L' + z[0] + ',' + y + ' L' + z[1] + ',' + y + ' L' + z[1] + ',' + (y - 8) + '" fill="none" stroke="#FFFFFF" stroke-opacity="' + (active ? 1 : .55) + '" stroke-width="' + (active ? 2.5 : 1.5) + '"/>';
    h += '<text x="' + ((z[0] + z[1]) / 2) + '" y="' + (y - 4) + '" text-anchor="middle" font-size="12.5" font-weight="700" fill="#FFFFFF" opacity="' + (active ? 1 : .8) + '">' + z[2] + ' · Trigger ' + z[3] + (s.zone === z[4] ? ' · โซนของพื้นที่นี้' : '') + '</text></g>';
  });
  h += '<g transform="translate(1168,236)" fill="#FFFFFF" opacity=".85"><path d="M0 0 L8 -11 L16 0 Z"/><path d="M0 6 L8 17 L16 6 Z"/></g>';
  // cargo ship riding the waves at the river mouth
  h += '<g class="hov" data-tip="ship" transform="translate(1062,170)"><g class="ship">';
  h += '<rect x="58" y="10" width="14" height="22" rx="1.5" fill="#F4F7F7"/><rect x="60" y="13" width="10" height="3" fill="var(--deep)"/><rect x="66" y="4" width="4" height="7" fill="#C7452F"/>';
  [[8, '#D9822B'], [20, '#2F6FB0'], [32, '#D9822B'], [44, '#2E9B57']].forEach(function (c, i) { h += '<rect x="' + c[0] + '" y="22" width="11" height="10" rx="1" fill="' + c[1] + '"/>'; if (i % 2 === 0) h += '<rect x="' + c[0] + '" y="13" width="11" height="9" rx="1" fill="' + (i ? '#2F6FB0' : '#C7452F') + '"/>'; });
  h += '<path d="M0 32 L84 32 L78 46 L8 46 Z" fill="#B23A2A"/><path d="M2 32 L82 32 L81 35 L3 35 Z" fill="#F4F7F7"/>';
  h += '</g></g>';
  h += '<g clip-path="url(#seaClip)"><path class="wave wave-front" d="M905 217 Q 920 212 935 217 T 965 217 T 995 217 T 1025 217 T 1055 217 T 1085 217 T 1115 217 T 1145 217 T 1175 217 T 1205 217 T 1235 217 T 1265 217" fill="none" stroke="#FFFFFF" stroke-width="2.5" opacity=".75"/></g>';

  // factory between trigger 2 and 3
  var fy = yAt(FX);
  h += '<g class="hov factory ' + sc(e.overall) + '" data-tip="factory" tabindex="0" role="button" aria-label="โรงงาน ' + esc(s.name) + ' สถานะ ' + lname(e.overall) + '" transform="translate(' + (FX - 34) + ',' + (fy - 50) + ')">';
  h += '<rect x="-6" y="-8" width="80" height="62" rx="8" fill="var(--surface)" opacity=".001"/>';
  h += '<rect x="44" y="0" width="7" height="22" fill="var(--deep)"/>';
  h += '<path d="M0 46 L0 22 L14 14 L14 22 L28 14 L28 22 L42 14 L42 22 L64 22 L64 46 Z" fill="var(--deep)"/>';
  [6, 20, 34, 50].forEach(function (x) { h += '<rect x="' + x + '" y="30" width="7" height="7" rx="1" fill="#FFFFFF" opacity=".8"/>'; });
  h += '<rect x="-2" y="44" width="68" height="6" rx="3" fill="var(--c)"/>';
  h += '<circle cx="62" cy="10" r="9" fill="var(--c)" stroke="var(--surface)" stroke-width="2"/>';
  h += '<path d="M58 10 l3 3 l5 -6" stroke="#FFFFFF" stroke-width="2" fill="none" opacity="' + (e.overall === 0 ? 1 : 0) + '"/>';
  h += '<text x="62" y="14" text-anchor="middle" font-size="12" font-weight="700" fill="#FFFFFF" opacity="' + (e.overall > 0 ? 1 : 0) + '">!</text>';
  h += '</g>';
  h += '<text x="' + FX + '" y="' + (fy + 22) + '" text-anchor="middle" font-size="12" font-weight="600" fill="#FFFFFF">SCGP' + (T.f != null ? ' · น้ำถึง ' + eta(T.f) : '') + '</text>';

  // trigger nodes (selected site's status)
  TRIGGERS.forEach(function (t) {
    var x = X[t.n], ys = t.n === 7 ? 214 : yAt(x), yn = Math.min(ys - 48, 120), r = e[t.n], on = state.trig === t.n;
    h += '<g class="trig-node hov ' + sc(r.l) + '" data-trig="' + t.n + '" data-tip="t' + t.n + '" tabindex="0" role="button" aria-pressed="' + on + '" aria-label="Trigger ' + t.n + ' ' + esc(t.th) + ' ' + lname(r.l) + '">';
    h += '<line x1="' + x + '" y1="' + (yn + 18) + '" x2="' + x + '" y2="' + ys + '" stroke="var(--ink)" stroke-opacity=".35" stroke-width="1.5" stroke-dasharray="3 3"/>';
    h += '<circle cx="' + x + '" cy="' + ys + '" r="3.5" fill="var(--ink)" opacity=".6"/>';
    h += '<circle class="ring" cx="' + x + '" cy="' + yn + '" r="' + (on ? 24 : 21) + '" fill="var(--c)" stroke="var(--surface)" stroke-width="3"/>';
    h += '<text x="' + x + '" y="' + (yn + 6) + '" text-anchor="middle" font-size="17" font-weight="700" fill="#FFFFFF" font-family="var(--f-data)">' + t.n + '</text>';
    h += '<text x="' + x + '" y="' + (yn - 46) + '" text-anchor="middle" font-size="13.5" font-weight="600" fill="var(--ink)">' + esc(t.th.replace(/ \(.*\)/, '')) + '</text>';
    h += '<text x="' + x + '" y="' + (yn - 29) + '" text-anchor="middle" font-size="12.5" fill="var(--muted)" font-family="var(--f-data)">' + (r.l == null ? 'ไม่มีข้อมูล' : esc(r.v + ' ' + r.u.replace('ล้าน ลบ.ม./วัน', 'ลลบ.ม./วัน'))) + '</text>';
    if (T[t.n] != null && t.n !== 5 && t.n !== 6) h += '<text x="' + x + '" y="' + (ys + 20) + '" text-anchor="middle" font-size="11.5" font-weight="600" fill="#FFFFFF" font-family="var(--f-data)">' + (t.n <= 2 ? 'T+0' : 'T' + esc(eta(T[t.n]).replace('≈ ', '+'))) + '</text>';
    h += '</g>';
  });
  h += '<g id="particles"></g>';
  h = h.replace(/<(\w+)([^<>]*?)(\/?)>/g, function (m, tag, attrs, slash) {
    var st = [];
    attrs = attrs.replace(/\s(fill|stroke|font-family)="(var\([^)]*\))"/g, function (mm, k, v) { st.push(k + ':' + v); return ''; });
    return '<' + tag + attrs + (st.length ? ' style="' + st.join(';') + '"' : '') + slash + '>';
  });
  svg.innerHTML = h;
  startFlow(s, e, dam);
}

/* animated inflow (into dam) and outflow (dam → sea); density and speed scale with the reported volumes */
function startFlow(s, e, dam) {
  if (flowAnim) cancelAnimationFrame(flowAnim);
  var g = document.getElementById('particles'), rp = document.getElementById('riverPath'), ip = document.getElementById('inflowPath');
  if (!g || !rp) return;
  var RL = rp.getTotalLength(), IL = ip.getTotalLength();
  var relPct = dam && dam.norm ? dam.rel / dam.norm * 100 : 0.05, infPct = dam && dam.norm ? dam.inf / dam.norm * 100 : 0;
  var k = function (p) { return Math.min(1, p / CRITERIA.release.bands[2]); };
  var out = { n: Math.round(10 + 34 * k(relPct)), v: 35 + 120 * k(relPct) }, inn = { n: dam ? Math.round(3 + 12 * k(infPct)) : 0, v: 25 + 70 * k(infPct) };
  var NS = 'http://www.w3.org/2000/svg', parts = [];
  function mk(path, L, cfg, cls) { for (var i = 0; i < cfg.n; i++) { var c = document.createElementNS(NS, 'circle'); c.setAttribute('r', cls === 'in' ? 2.6 : 2.8); c.setAttribute('class', 'pt-' + cls); g.appendChild(c); parts.push({ el: c, path: path, L: L, v: cfg.v * (0.85 + Math.random() * 0.3), d: (i / cfg.n) * L }); } }
  mk(rp, RL, out, 'out'); mk(ip, IL, inn, 'in');
  function place(p) { var pt = p.path.getPointAtLength(p.d); p.el.setAttribute('cx', pt.x.toFixed(1)); p.el.setAttribute('cy', pt.y.toFixed(1)); }
  parts.forEach(place);
  if (window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  var last = performance.now();
  function step(now) {
    var dt = Math.min(0.05, (now - last) / 1000); last = now;
    parts.forEach(function (p) { p.d += p.v * dt; if (p.d > p.L) p.d -= p.L; place(p); });
    flowAnim = requestAnimationFrame(step);
  }
  flowAnim = requestAnimationFrame(step);
}

/* hover / tap tooltip for the profile */
function tipHtml(key, site) {
  var s = site || profileSite(), e = state.evals[s.id], dam = e[2] && e[2].dam;
  function row(k, v) { return '<div class="tr"><span>' + k + '</span><b>' + v + '</b></div>'; }
  if (key === 'factory') {
    var h = '<div class="tt-h"><span class="spill ' + sc(e.overall) + '">' + lname(e.overall) + '</span> ' + esc(s.name) + '</div>';
    h += '<div class="tt-sub">จ.' + esc(s.prov) + ' อ.' + esc(s.amp) + ' · ' + ZONES[s.zone] + ' · ลุ่มน้ำ' + esc(s.basin) + '</div>';
    h += '<ul class="tt-cos">' + s.cos.map(function (c) { return '<li>' + esc(c) + '</li>'; }).join('') + '</ul>';
    if (dam) h += row('เขื่อนต้นน้ำ', 'เขื่อน' + esc(dam.name) + ' ' + f(dam.pct, 1) + '%') + row('น้ำระบายจากเขื่อน', f(dam.rel) + ' ล้าน ลบ.ม./วัน (' + f(dam.rel * 11.574, 0) + ' ลบ.ม./วิ)') + row('น้ำเดินทางถึงโรงงาน', eta(travelHours(dam, s)) + ' · ' + f(hv(dam.lat, dam.lng, s.lat, s.lng), 0) + ' กม.');
    if (e[3].l != null) h += row('ระดับน้ำแม่น้ำใกล้โรงงาน', e[3].v + ' ม.รทก.');
    if (e[5].l != null) h += row('ฝน 24 ชม. สูงสุด', e[5].v + ' มม.');
    h += '<div class="tt-cells">' + [1, 2, 3, 4, 5, 6, 7].map(function (n) { return '<span class="cell ' + sc(e[n].l) + '">' + (e[n].l == null ? '·' : n) + '</span>'; }).join('') + '</div>';
    if (s.coord) h += '<div class="tt-sub">BCM Coordinator: ' + esc(s.coord) + '</div>';
    return h + '<div class="tt-foot">กดที่โรงงานเพื่อดูรายละเอียดทั้ง 7 จุด</div>';
  }
  if (key === 'ship') {
    var td = state.data.wl.filter(function (x) { return x.code === (s.tide || 'GLF001'); })[0];
    var h3 = '<div class="tt-h">ท้ายน้ำ · การขนส่งทางทะเล</div><div class="tt-sub">เส้นทางขนส่งสินค้าออกทางท่าเรือปลายน้ำ</div>';
    if (td) h3 += row('ระดับน้ำทะเลหนุน (' + esc(td.name) + ')', f(td.msl) + ' ม.รทก.') + row('เวลาวัด', fmtT(td.t));
    if (e[7].l != null) h3 += row('สถานะ Trigger 7', '<span class="spill ' + sc(e[7].l) + '">' + lname(e[7].l) + '</span>');
    return h3 + '<div class="tt-foot">น้ำทะเลหนุนสูงทำให้น้ำจากต้นน้ำระบายออกทะเลได้ช้าลง</div>';
  }
  if (key === 'dam') {
    if (!dam) return '<div class="tt-h">ไม่มีเขื่อนขนาดใหญ่ต้นน้ำ</div><div class="tt-sub">' + esc(s.name) + '</div>';
    return '<div class="tt-h">เขื่อน' + esc(dam.name) + '</div>' + row('ปริมาตรน้ำ', f(dam.st, 0) + ' / ' + f(dam.norm, 0) + ' ล้าน ลบ.ม. (' + f(dam.pct, 1) + '%)') + row('น้ำไหลเข้า (inflow)', f(dam.inf) + ' ล้าน ลบ.ม./วัน') + row('น้ำระบาย (outflow)', f(dam.rel) + ' ล้าน ลบ.ม./วัน') + row('สุทธิ', (dam.inf - dam.rel >= 0 ? '+' : '') + f(dam.inf - dam.rel) + ' ล้าน ลบ.ม./วัน') + '<div class="tt-foot">กรมชลประทาน · รายงานประจำวัน</div>';
  }
  var n = +key.slice(1), t = TRIGGERS[n - 1], r = e[n];
  var h2 = '<div class="tt-h"><span class="spill ' + sc(r.l) + '">' + lname(r.l) + '</span> ' + n + '. ' + esc(t.th) + '</div>';
  if (r.l == null) return h2 + '<div class="tt-sub">' + esc(r.na || '') + '</div>';
  h2 += '<div class="tt-val num">' + r.v + ' <small>' + esc(r.u) + '</small></div><div class="tt-sub"><b>' + esc(r.title) + '</b></div><div class="tt-sub">' + esc(r.why) + '</div><div class="tt-foot">' + esc(r.src) + '</div>';
  if (dam && (n === 3 || n === 4 || n === 7) && r.geo && r.geo[0]) h2 += row('น้ำจากเขื่อนถึงจุดนี้', eta(travelHours(dam, r.geo[0])));
  return h2;
}
function initTip() {
  var tip = document.getElementById('ptip'), box = tip.parentElement;
  function show(el, x, y) {
    tip.innerHTML = tipHtml(el.getAttribute('data-tip')); tip.hidden = false;
    var bw = box.getBoundingClientRect(), w = tip.offsetWidth, hgt = tip.offsetHeight;
    var left = Math.min(Math.max(8, x - bw.left + 14), bw.width - w - 8), top = y - bw.top + 16;
    if (top + hgt > bw.height) top = y - bw.top - hgt - 12;
    tip.style.left = left + 'px'; tip.style.top = Math.max(4, top) + 'px';
  }
  var svg = document.getElementById('profile');
  svg.addEventListener('pointermove', function (ev) { var el = ev.target.closest('.hov'); if (el) show(el, ev.clientX, ev.clientY); else tip.hidden = true; });
  svg.addEventListener('pointerleave', function () { tip.hidden = true; });
  svg.addEventListener('focusin', function (ev) { var el = ev.target.closest('.hov'); if (el) { var b = el.getBoundingClientRect(); show(el, b.left + b.width / 2, b.bottom); } });
  svg.addEventListener('focusout', function () { tip.hidden = true; });
  svg.addEventListener('click', function (ev) { if (ev.target.closest('.factory')) { var s = profileSite(); select(s.id, true); document.getElementById('h-near').scrollIntoView({ behavior: 'smooth', block: 'start' }); } });
  var sel = document.getElementById('profileSite');
  sel.innerHTML = ['up', 'mid', 'down'].map(function (z) { return '<optgroup label="' + ZONES[z] + '">' + SITES.filter(function (s) { return s.zone === z; }).map(function (s) { return '<option value="' + s.id + '">' + esc(s.name) + '</option>'; }).join('') + '</optgroup>'; }).join('');
  sel.addEventListener('change', function () { select(sel.value, true); });
}

/* ---------- กฟผ. (EGAT) data: rule curves + Mae Klong telemetry ---------- */
var EGAT_NAMES = { BB: 'ภูมิพล', SK: 'สิริกิติ์', SNR: 'ศรีนครินทร์', VRK: 'วชิราลงกรณ', RPB: 'รัชชประภา', BLG: 'บางลาง', UR: 'อุบลรัตน์', SRD: 'สิรินธร', CLB: 'จุฬาภรณ์', NP: 'น้ำพุง', HK: 'ห้วยกุ่ม', abd: 'แม่กลอง', TN: 'ท่าทุ่งนา' };
var RC = { high: { th: 'น้ำมาก', note: 'สูงกว่า URC', c: 'var(--crit)' }, normal: { th: 'น้ำปกติ', note: 'ระหว่าง URC–LRC', c: 'var(--ok)' }, low: { th: 'น้ำน้อย', note: 'ต่ำกว่า LRC', c: 'var(--watch)' }, dead: { th: 'น้ำก้นอ่าง', note: 'Dead storage', c: 'var(--na)' } };
function rcStatus(x) {
  if (!x || !x.upper) return null;           // no rule curve published (e.g. เขื่อนแม่กลอง, ท่าทุ่งนา)
  if (x.pct <= x.dead) return 'dead';
  if (x.pct <= x.lower) return 'low';
  if (x.pct <= x.upper) return 'normal';
  return 'high';
}
function normEgat(e) {
  if (!e) return null;
  var o = { at: e.at ? parseT(e.at) : null, tele: {}, daily: {}, byName: {}, rain: {} };
  (e.tele || []).forEach(function (t) { o.tele[t[0]] = { code: t[0], ag: t[1] === 1 ? 'กฟผ.' : 'ชป.', wl: t[2], ds: t[3] }; });
  (e.daily || []).forEach(function (a) {
    var x = { code: a[0], name: EGAT_NAMES[a[0]] || a[0], eff: a[1], effPct: a[2], inf: a[3], rel: a[4], stor: a[5], pct: a[6], dead: a[7], lower: a[8], upper: a[9], relCms: a[10] };
    x.rc = rcStatus(x); o.daily[x.code] = x; o.byName[x.name] = x;
  });
  (e.rain || []).forEach(function (r) { o.rain[r[1]] = r[2]; });
  return o;
}

/* ---------- Mae Klong schematic (layout follows กฟผ. Schematic ลุ่มน้ำแม่กลอง) ---------- */
var MK = {
  rivers: [
    { id: 'kn', name: 'แม่น้ำแควน้อย', d: 'M250,118 L250,540 Q250,592 302,596 L560,606', q: ['VKD06', 'K.37', 'VKD05'] },
    { id: 'ky', name: 'แม่น้ำแควใหญ่', d: 'M900,118 L900,470 Q900,560 840,574 L640,606', q: ['SND02', 'K.35A'] },
    { id: 'mk', name: 'แม่น้ำแม่กลอง', d: 'M600,612 L600,660 Q600,705 652,705 L1255,705', q: ['__sum'] },
    { id: 't1', name: 'ห้วยแม่น้ำน้อย', d: 'M40,265 L250,265', q: ['K.31', 'VKD07'] },
    { id: 't2', name: 'ห้วยบ้องตี้', d: 'M40,335 L250,335', q: ['K.32A'] },
    { id: 't3', name: 'ลำภาชี', d: 'M40,495 L250,495', q: ['K.62', 'VKD09', 'VKD08'] },
    { id: 't4', name: 'ลำตะเพิน', d: 'M1160,400 L900,400', q: ['SND06', 'K.12', 'SND05'] }
  ],
  // [code, x, y, label side: r|l|a(above)|b(below)]
  st: [
    ['VKD01', 250, 150, 'r'], ['VKD02', 250, 195, 'r'], ['VKD03', 250, 232, 'r'], ['K.54', 250, 298, 'r'], ['VKD04', 250, 368, 'r'],
    ['K.58', 250, 404, 'r'], ['VKD05', 250, 438, 'r'], ['K.10', 250, 470, 'r'], ['VKD06', 250, 530, 'r'], ['K.37', 410, 600, 'b'],
    ['K.31', 85, 265, 'a'], ['VKD07', 175, 265, 'a'], ['K.32A', 130, 335, 'a'],
    ['VKD08', 62, 495, 'a'], ['K.62', 112, 495, 'b'], ['K.17', 162, 495, 'a'], ['VKD09', 212, 495, 'b'],
    ['SND02', 900, 300, 'l'], ['K.35A', 900, 450, 'l'], ['SND05', 1120, 400, 'a'], ['SND06', 1045, 400, 'a'], ['K.12', 970, 400, 'b'],
    ['K.3A', 600, 630, 'l'], ['SND03', 600, 660, 'l'], ['SND04', 690, 705, 'a'],
    ['K.11A', 840, 705, 'a'], ['RAJ002', 1040, 705, 'a'], ['K.55A', 1095, 705, 'a2'], ['RAJ001', 1170, 705, 'a'], ['MKG006', 1232, 705, 'a2']
  ],
  dams: [
    { code: 'VRK', x: 250, y: 88, card: [282, 14] },
    { code: 'SNR', x: 900, y: 88, card: [932, 14] },
    { code: 'TN', x: 900, y: 228, card: [932, 168] },
    { code: 'abd', x: 765, y: 705, card: [300, 722] }
  ],
  // SCGP sites in the Mae Klong basin, in downstream order
  fac: [['TRA-SCC', 800], ['TMG-TCP', 880], ['WSL-SKIC', 930], ['TRA-SFC', 980, 1], ['BPG-SCGP', 1020], ['BPG-TPC', 1065], ['BPG-SKIC', 1110], ['RBR-TCG', 1170]]
};
var MK_DAM_FOR = { kn: 'VRK', ky: 'SNR', mk: 'SNR' };

function mkStation(code) {
  var E = state.data.egat, t = E && E.tele[code];
  var tw = state.data.wl.filter(function (x) { return x.code === code; })[0];
  var o = { code: code, wl: t ? t.wl : (tw ? tw.msl : null), ds: t ? t.ds : null, ag: t ? t.ag : (tw ? tw.ag : ''), tw: tw, rain: E ? E.rain[code] : null };
  if (o.wl === 0) o.wl = null;
  o.lvl = tw && fresh(tw.t) ? lvlBy(tw.pct, CRITERIA.bank.bands) : null;
  return o;
}
function riverQ(r) {
  if (r.q[0] === '__sum') return (riverQ(MK.rivers[0]) || 0) + (riverQ(MK.rivers[1]) || 0);
  var E = state.data.egat; if (!E) return null;
  for (var i = 0; i < r.q.length; i++) { var t = E.tele[r.q[i]]; if (t && t.ds > 0) return t.ds; }
  return null;
}

function renderSchematic() {
  var svg = document.getElementById('mkSchem'); if (!svg) return; pinDefs();
  var E = state.data.egat, h = '';
  document.getElementById('mkAsof').textContent = E && E.at ? 'โทรมาตร กฟผ./ชป. ณ ' + fmtT(E.at) + (state.egatFromSnapshot ? ' (snapshot)' : '') : 'ยังไม่มีข้อมูลโทรมาตร กฟผ.';
  // dam rule-curve summary (all EGAT dams, like the กฟผ. page)
  var cnt = { high: 0, normal: 0, low: 0, dead: 0 };
  if (E) Object.keys(E.daily).forEach(function (k) { var r = E.daily[k].rc; if (r) cnt[r]++; });
  document.getElementById('rcSummary').innerHTML = ['high', 'normal', 'low', 'dead'].map(function (k) {
    return '<span class="rc-chip"><i style="background:' + RC[k].c + '"></i>' + RC[k].th + ' <b class="num">' + cnt[k] + '</b> เขื่อน <span class="muted">(' + RC[k].note + ')</span></span>';
  }).join('');

  // landscape: hills behind the dams, plain toward the sea
  h += '<defs><linearGradient id="mk-land" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#DCEBDD"/><stop offset=".55" stop-color="#EEF4EA"/><stop offset="1" stop-color="#F6F1E4"/></linearGradient>' +
    '<linearGradient id="mk-con" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#9AAEC0"/><stop offset="1" stop-color="#6C8194"/></linearGradient>' +
    '<radialGradient id="mk-glow"><stop offset="0" stop-color="#E6F6FF"/><stop offset=".5" stop-color="#7CC8F2"/><stop offset="1" stop-color="#2A8FD6" stop-opacity="0"/></radialGradient></defs>';
  h += '<rect x="0" y="0" width="1300" height="870" rx="14" fill="url(#mk-land)" opacity=".75"/>';
  h += '<path class="mk-mtn" d="M0 120 L60 60 L120 96 L190 30 L250 70 L330 22 L410 88 L470 50 L540 104 L620 64 L700 110 L780 46 L860 28 L930 74 L1010 34 L1090 90 L1170 52 L1240 98 L1300 70 L1300 140 L0 140 Z" fill="#9DBB8F"/>';
  h += '<path class="mk-mtn" d="M0 140 L90 100 L170 128 L260 92 L360 132 L460 104 L560 140 L700 112 L820 138 L960 100 L1080 132 L1200 108 L1300 128 L1300 160 L0 160 Z" fill="#B7CFA6"/>';
  // sea + land bands
  h += '<rect x="1255" y="640" width="45" height="130" fill="var(--sea)" rx="4"/><text x="1277" y="790" text-anchor="middle" font-size="12" font-weight="600" fill="var(--muted)">ทะเล</text>';
  // rivers with flow animation
  MK.rivers.forEach(function (r) {
    var q = riverQ(r), w = r.id.charAt(0) === 't' ? 7 : 16, dur = q ? Math.max(0.6, Math.min(6, 160 / Math.sqrt(q + 4))) : 5;
    h += '<path d="' + r.d + '" fill="none" stroke="var(--water)" stroke-width="' + w + '" stroke-linecap="round" stroke-linejoin="round" opacity=".55"/>';
    h += '<path d="' + r.d + '" fill="none" class="mk-flow" stroke-width="' + (w * 0.42) + '" style="animation-duration:' + dur.toFixed(2) + 's" stroke-linecap="round"/>';
    if (!REDUCED) {
      var np = r.id.charAt(0) === 't' ? 2 : Math.round(3 + Math.min(9, (q || 0) / 45)), md = (r.id === 'mk' ? 9 : r.id.charAt(0) === 't' ? 5 : 7) * Math.max(0.45, Math.min(1.6, dur / 2.4));
      for (var pi = 0; pi < np; pi++) h += '<circle class="mk-pt" r="' + (r.id.charAt(0) === 't' ? 1.8 : 2.8) + '"><animateMotion dur="' + md.toFixed(1) + 's" begin="-' + (pi * md / np).toFixed(2) + 's" repeatCount="indefinite" path="' + r.d + '"/></circle>';
    }
  });
  // river name labels
  [[236, 585, 'แควน้อย', 'end', 0], [888, 520, 'แควใหญ่', 'end', 0], [40, 282, 'ห้วยแม่น้ำน้อย', 'start', 0], [40, 356, 'ห้วยบ้องตี้', 'start', 0], [40, 560, 'ลำภาชี', 'start', 0], [1165, 430, 'ลำตะเพิน', 'end', 0], [636, 742, 'แม่น้ำแม่กลอง', 'start', 0]].forEach(function (l) {
    h += '<text x="' + l[0] + '" y="' + l[1] + '" text-anchor="' + l[3] + '" font-size="12.5" font-weight="700" fill="var(--water-2)">' + l[2] + '</text>';
  });
  h += '<g transform="translate(600,610)"><circle r="9" fill="var(--surface)" stroke="var(--water-2)" stroke-width="3"/></g><text x="600" y="584" text-anchor="middle" font-size="11.5" fill="var(--muted)">บรรจบ · เมืองกาญจนบุรี</text>';

  // dams + cards
  MK.dams.forEach(function (dm) {
    var x = E && E.daily[dm.code], st = x ? x.rc : null, col = st ? RC[st].c : 'var(--accent)';
    var pr = x ? Math.max(4, Math.min(100, x.pct)) : 50, big = dm.code !== 'abd', rw = big ? 64 : 40, rh = big ? 46 : 0;
    h += '<g class="hov mk-res" data-tip="mkdam:' + dm.code + '" transform="translate(' + dm.x + ',' + dm.y + ')">';
    if (big) {
      // reservoir behind the dam: water height = % storage, red dash = URC
      h += '<clipPath id="mkr-' + dm.code + '"><path d="M' + (-rw / 2) + ' ' + (-rh - 12) + ' L' + (rw / 2) + ' ' + (-rh - 12) + ' L' + (rw / 2 - 8) + ' -12 L' + (-rw / 2 + 8) + ' -12 Z"/></clipPath>';
      h += '<path d="M' + (-rw / 2) + ' ' + (-rh - 12) + ' L' + (rw / 2) + ' ' + (-rh - 12) + ' L' + (rw / 2 - 8) + ' -12 L' + (-rw / 2 + 8) + ' -12 Z" fill="#E6F0F6" stroke="#9AAEC0"/>';
      var wy = -12 - rh * pr / 100;
      h += '<g clip-path="url(#mkr-' + dm.code + ')"><rect class="res-fill" x="' + (-rw / 2) + '" y="' + wy + '" width="' + rw + '" height="' + (rh * pr / 100 + 1) + '" fill="url(#wd-g)"/><path class="res-wave" d="M' + (-rw / 2 - 12) + ' ' + wy + ' q3 -2 6 0 t6 0 t6 0 t6 0 t6 0 t6 0 t6 0 t6 0 t6 0 t6 0 t6 0 t6 0 t6 0" fill="none" stroke="#fff" stroke-width="1.2"/></g>';
      if (x && x.upper) h += '<line x1="' + (-rw / 2 + 2) + '" x2="' + (rw / 2 - 2) + '" y1="' + (-12 - rh * x.upper / 100) + '" y2="' + (-12 - rh * x.upper / 100) + '" stroke="var(--crit)" stroke-dasharray="3 2" stroke-width="1.3"/>';
      h += '<text x="0" y="' + (wy + 14) + '" text-anchor="middle" font-size="12" font-weight="700" fill="#fff">' + (x ? f(x.pct, 0) + '%' : '') + '</text>';
    }
    // dam wall (concrete) + gates + spill jet whose thickness follows release
    h += '<path d="M' + (-rw / 2 + 6) + ' -14 L' + (rw / 2 - 6) + ' -14 L' + (rw / 2) + ' 12 L' + (-rw / 2) + ' 12 Z" fill="url(#mk-con)" stroke="#5B7186"/>';
    for (var gi = -1; gi <= 1; gi++) h += '<rect x="' + (gi * 12 - 3) + '" y="-8" width="6" height="14" rx="1" fill="#46596B"/>';
    var relW = x && x.rel ? Math.max(1.6, Math.min(7, 1.2 + x.rel * 0.25)) : 1.6;
    h += '<path class="mk-jet" d="M-8 12 q-2 10 0 18 M0 12 q0 10 0 18 M8 12 q2 10 0 18" fill="none" stroke="#5FB4E8" stroke-width="' + relW.toFixed(1) + '" stroke-linecap="round"/>';
    h += '<circle cx="' + (rw / 2 + 2) + '" cy="-16" r="7" fill="' + col + '" stroke="var(--surface)" stroke-width="2"/>';
    h += '</g>';
    var cx = dm.card[0], cy = dm.card[1], W = 262, H = 118;
    if (dm.code === 'abd') h += '<path d="M' + (dm.x - 20) + ',' + (dm.y + 4) + ' L' + (cx + W) + ',' + (cy + 12) + '" stroke="var(--muted)" stroke-dasharray="3 3" fill="none"/>';
    h += '<g class="hov" data-tip="mkdam:' + dm.code + '" transform="translate(' + cx + ',' + cy + ')">';
    h += '<rect width="' + W + '" height="' + H + '" rx="10" fill="var(--surface)" stroke="var(--line)"/>';
    h += '<rect width="' + W + '" height="26" rx="10" fill="#F2C94C"/><rect y="16" width="' + W + '" height="10" fill="#F2C94C"/>';
    h += '<text x="' + (W / 2) + '" y="18" text-anchor="middle" font-size="13" font-weight="700" fill="#2A2A12">เขื่อน' + esc(EGAT_NAMES[dm.code]) + '</text>';
    if (x) {
      h += '<circle cx="12" cy="40" r="4.5" fill="#2C63AD"/><text x="22" y="44" font-size="11.5" fill="var(--ink)">ใช้งานได้ <tspan font-family="var(--f-data)">' + f(x.eff, 0) + '</tspan> ล้าน ลบ.ม. (' + Math.round(x.effPct) + '%)</text>';
      h += '<circle cx="12" cy="58" r="4.5" fill="#68A6D7"/><text x="22" y="62" font-size="11.5" fill="var(--ink)">ไหลเข้า <tspan font-family="var(--f-data)">' + f(x.inf) + '</tspan> · ระบาย <tspan font-family="var(--f-data)">' + f(x.rel) + '</tspan> ล้าน ลบ.ม.</text>';
      var bw = W - 24, pw = Math.max(0, Math.min(100, x.pct)) / 100 * bw;
      h += '<rect x="12" y="70" width="' + bw + '" height="10" rx="5" fill="var(--sunk)"/><rect x="12" y="70" width="' + pw + '" height="10" rx="5" fill="' + col + '"/>';
      if (x.upper) h += '<rect x="' + (12 + x.upper / 100 * bw - 1) + '" y="66" width="2" height="18" fill="var(--crit)"/><rect x="' + (12 + x.lower / 100 * bw - 1) + '" y="66" width="2" height="18" fill="var(--watch)"/>';
      h += '<text x="12" y="98" font-size="11.5" fill="var(--ink)">ปริมาณน้ำ <tspan font-family="var(--f-data)" font-weight="600">' + f(x.stor, 0) + '</tspan> ล้าน ลบ.ม. <tspan font-weight="700">' + f(x.pct, 1) + '%</tspan></text>';
      h += '<text x="12" y="112" font-size="11" fill="var(--muted)">' + (st ? RC[st].th + ' · URC ' + f(x.upper, 1) + '% · LRC ' + f(x.lower, 1) + '%' : 'ไม่มีเกณฑ์ Rule Curve (กฟผ.)') + '</text>';
    } else h += '<text x="12" y="50" font-size="12" fill="var(--muted)">ไม่มีข้อมูล</text>';
    h += '</g>';
  });

  // stations
  MK.st.forEach(function (s) {
    var o = mkStation(s[0]), x = s[1], y = s[2], side = s[3];
    var fill = o.ag === 'กฟผ.' ? '#F1A039' : o.ag === 'ชป.' ? '#3BB217' : 'var(--accent)';
    h += '<g class="hov mk-st" data-tip="mkst:' + s[0] + '">';
    if (o.lvl != null) h += '<circle cx="' + x + '" cy="' + y + '" r="10" fill="none" stroke="var(--c)" stroke-width="3" class="' + sc(o.lvl) + '"/>';
    h += '<circle cx="' + x + '" cy="' + y + '" r="6.5" fill="' + fill + '" stroke="var(--surface)" stroke-width="2"/>';
    var v1 = o.wl == null ? '–' : f(o.wl) + ' ม.', v2 = o.ds ? f(o.ds, o.ds >= 100 ? 0 : 1) + ' cms' : '';
    var name = o.tw && !/^K\.|^VKD|^SND/.test(s[0]) ? o.tw.name : s[0];
    var lines = [[name, 'b'], [v1, 'v']];
    if (v2) lines.push([v2, 'q']);
    if (o.rain > 0) lines.push(['ฝน ' + f(o.rain, 0) + ' มม.', 'r']);
    var tx = x, ty, anc = 'middle', lh = 13;
    if (side === 'r') { tx = x + 16; anc = 'start'; ty = y - 4; if (side === 'r' && lines.length > 2) { lines[1][0] = v1 + (v2 ? ' · ' + v2 : ''); lines.splice(2, v2 ? 1 : 0); } }
    else if (side === 'l') { tx = x - 16; anc = 'end'; ty = y - 4; if (v2) { lines[1][0] = v1 + ' · ' + v2; lines.splice(2, 1); } }
    else if (side === 'a') { ty = y - 14 - (lines.length - 1) * lh; }
    else if (side === 'a2') { ty = y - 40 - (lines.length - 1) * lh; }
    else { ty = y + 22; }
    lines.forEach(function (ln, i) {
      var st2 = ln[1] === 'b' ? 'font-size="11.5" font-weight="700" fill="var(--ink)"' : ln[1] === 'r' ? 'font-size="10.5" font-weight="600" fill="#3B82C4"' : 'font-size="10.5" fill="var(--muted)" font-family="var(--f-data)"';
      h += '<text x="' + tx + '" y="' + (ty + i * lh) + '" text-anchor="' + anc + '" ' + st2 + '>' + esc(ln[0]) + '</text>';
    });
    if (side === 'a2') h += '<line x1="' + x + '" y1="' + (y - 10) + '" x2="' + x + '" y2="' + (ty + (lines.length - 1) * lh + 4) + '" stroke="var(--muted)" stroke-dasharray="2 3"/>';
    h += '</g>';
  });

  // SCGP factories
  MK.fac.forEach(function (fa, i) {
    var s = SITES.filter(function (x) { return x.id === fa[0]; })[0]; if (!s) return;
    var e = state.evals[s.id], x = fa[1], y = 742, ly = i % 2 ? 806 : 786;
    h += '<line x1="' + x + '" y1="712" x2="' + x + '" y2="' + (y - 12) + '" stroke="var(--muted)" stroke-dasharray="' + (fa[2] ? '2 4' : '0') + '" stroke-width="1.2"/>';
    var dSNR = state.data.damByName['ศรีนครินทร์'], tFac = 5.6 + 3.6 * Math.max(0, Math.min(1, (x - 760) / 460));
    h += '<g class="hov mk-fac mk-fac3 ' + sc(e.overall) + (state.sel === s.id ? ' on' : '') + '" style="--d:' + tFac.toFixed(2) + 's" data-tip="fac:' + s.id + '" tabindex="0" role="button" aria-label="' + esc(s.name) + ' ' + lname(e.overall) + '" transform="translate(' + (x - 22) + ',' + (y - 22) + ')"><g>';
    h += '<ellipse cx="22" cy="44" rx="20" ry="4" fill="#000" opacity=".15"/>';
    h += '<rect x="0" y="0" width="44" height="44" rx="10" fill="var(--surface)" stroke="var(--c)" stroke-width="' + (state.sel === s.id ? 3.2 : 2) + '"/>';
    h += '<polygon points="7,36 23,36 23,25 18,28.5 18,25 12.5,28.5 12.5,25 7,28.5" fill="#1E3F66"/><polygon points="23,36 34,31 34,21 23,25" fill="#3E78B5"/>';
    h += '<polygon points="7,28.5 12.5,25 12.5,28.5 18,25 18,28.5 23,25 34,21 29,19.5 18,23.4 18,20.3 12.5,23.7 12.5,21.2 7,24.6" fill="#7FB0DD"/>';
    h += '<rect x="28" y="9" width="3.6" height="12" fill="#1E3F66"/><rect x="27.4" y="8" width="4.8" height="2" fill="#D03030"/>';
    h += '<rect x="9" y="31" width="3" height="3" fill="#F0B040"/><rect x="15" y="31" width="3" height="3" fill="#F0B040"/>';
    h += '<circle class="smoke" cx="30" cy="6" r="2.2"/><circle class="smoke s2" cx="30" cy="6" r="1.8"/>';
    h += '<circle cx="40" cy="4" r="5.5" fill="var(--c)" stroke="var(--surface)" stroke-width="1.6"/></g></g>';
    if (dSNR) h += '<g class="eta" style="--d:' + tFac.toFixed(2) + 's"><rect x="' + (x - 30) + '" y="' + (ly + 22) + '" width="60" height="18" rx="9" fill="#13507F"/><text x="' + x + '" y="' + (ly + 35) + '" text-anchor="middle" font-size="11" font-weight="700" fill="#fff">' + esc(eta(travelHours(dSNR, s))) + '</text></g>';
    var nm = s.name.replace('Thai Containers ', 'TC ').replace('Thai Cane Paper ', 'TCP ').replace('Siam Kraft ', 'SKIC ').replace('Siam Cellulose ', 'SCC ').replace('Siam Forestry ', 'SFC ').replace('Thai Paper ', 'TPC ');
    h += '<text x="' + x + '" y="' + ly + '" text-anchor="middle" font-size="11" font-weight="600" fill="var(--ink)">' + esc(nm.split(' ')[0]) + '</text>';
    h += '<text x="' + x + '" y="' + (ly + 13) + '" text-anchor="middle" font-size="10.5" fill="var(--muted)">' + esc(nm.split(' ').slice(1).join(' ').replace(/[()]/g, '')) + '</text>';
  });
  // story-mode pulses: Khwae Noi + Khwae Yai together, then Mae Klong to the sea
  [['kn', MK.rivers[0].d, 'indefinite', 4.2], ['ky', MK.rivers[1].d, 'indefinite', 4.2], ['mk', MK.rivers[2].d, 'amkn.end', 6]].forEach(function (p) {
    h += '<g class="pulse"><circle class="halo" r="8" fill="none" stroke="#7CC8F2" stroke-width="3"><animateMotion begin="' + p[2] + '" dur="' + p[3] + 's" fill="freeze" path="' + p[1] + '"/></circle>' +
      '<circle r="10" fill="url(#mk-glow)"><animateMotion id="am' + p[0] + '" begin="' + p[2] + '" dur="' + p[3] + 's" fill="freeze" path="' + p[1] + '"/></circle></g>';
  });
  h += '<text x="20" y="862" font-size="11.5" fill="var(--muted)">SCGP ในลุ่มแม่กลอง · กรอบสีตามสถานะ 7 Trigger · เส้นประ = ตั้งอยู่ห่างลำน้ำหลัก</text>';

  h = h.replace(/<(\w+)([^<>]*?)(\/?)>/g, function (m, tag, attrs, slash) {
    var st = [];
    attrs = attrs.replace(/\s(fill|stroke|font-family)="(var\([^)]*\))"/g, function (mm, k, v) { st.push(k + ':' + v); return ''; });
    return '<' + tag + attrs + (st.length ? ' style="' + st.join(';') + '"' : '') + slash + '>';
  });
  svg.innerHTML = h;
}

function mkTip(key) {
  var E = state.data.egat;
  function row(k, v) { return '<div class="tr"><span>' + k + '</span><b>' + v + '</b></div>'; }
  var kind = key.split(':')[0], id = key.split(':')[1];
  if (kind === 'fac') return tipHtml('factory', SITES.filter(function (x) { return x.id === id; })[0]);
  if (kind === 'mkdam') {
    var x = E && E.daily[id];
    if (!x) return '<div class="tt-h">เขื่อน' + esc(EGAT_NAMES[id]) + '</div><div class="tt-sub">ไม่มีข้อมูล</div>';
    var h = '<div class="tt-h">' + (x.rc ? '<span class="spill" style="background:' + RC[x.rc].c + ';color:#fff">' + RC[x.rc].th + '</span> ' : '') + 'เขื่อน' + esc(x.name) + '</div>';
    h += row('น้ำใช้งานได้', f(x.eff, 0) + ' ล้าน ลบ.ม. (' + Math.round(x.effPct) + '%)') + row('ปริมาณน้ำทั้งหมด', f(x.stor, 0) + ' ล้าน ลบ.ม. (' + f(x.pct, 1) + '%)');
    h += row('น้ำไหลเข้า (inflow)', f(x.inf) + ' ล้าน ลบ.ม./วัน') + row('น้ำระบาย (outflow)', f(x.rel) + ' ล้าน ลบ.ม./วัน' + (x.relCms ? ' · ' + f(x.relCms, 0) + ' cms' : ''));
    if (x.upper) h += row('Rule Curve', 'URC ' + f(x.upper, 1) + '% · LRC ' + f(x.lower, 1) + '% · ก้นอ่าง ' + f(x.dead, 1) + '%') + row('ห่างจาก URC', f(x.upper - x.pct, 2) + '%');
    var sitesHit = SITES.filter(function (s) { return s.dams.indexOf(x.name) >= 0; });
    if (sitesHit.length) h += '<div class="tt-sub">พื้นที่ SCGP ที่รับน้ำจากเขื่อนนี้: ' + sitesHit.map(function (s) { return esc(s.name); }).join(', ') + '</div>';
    return h + '<div class="tt-foot">กฟผ. · DailyInfographic</div>';
  }
  var o = mkStation(id), tw = o.tw;
  var h2 = '<div class="tt-h">' + (o.lvl != null ? '<span class="spill ' + sc(o.lvl) + '">' + lname(o.lvl) + '</span> ' : '') + 'สถานี ' + esc(id) + (tw ? ' ' + esc(tw.name) : '') + '</div>';
  h2 += '<div class="tt-sub">' + esc(o.ag ? 'สถานีโทรมาตร ' + o.ag : '') + (tw && tw.river ? ' · ' + esc(tw.river) : '') + '</div>';
  h2 += row('ระดับน้ำ', o.wl == null ? '–' : f(o.wl) + ' ม.รทก.') + (o.ds ? row('อัตราการไหล', f(o.ds) + ' ลบ.ม./วินาที (' + f(o.ds * 0.0864, 1) + ' ล้าน ลบ.ม./วัน)') : '');
  if (tw) h2 += row('ความจุลำน้ำ (สสน.)', f(tw.pct, 1) + '% · ' + (tw.over ? 'ล้นตลิ่ง ' : 'ต่ำกว่าตลิ่ง ') + f(tw.diff) + ' ม.') + row('เวลาวัด สสน.', fmtT(tw.t));
  if (o.rain != null) h2 += row('ฝนรายวัน (กฟผ.)', f(o.rain, 1) + ' มม.');
  if (tw) {
    var dk = /แควน้อย|ลำภาชี/.test(tw.river) ? 'VRK' : 'SNR', dn = EGAT_NAMES[dk], dd = state.data.damByName[dn];
    if (dd) h2 += row('น้ำจากเขื่อน' + dn + ' ถึงจุดนี้', eta(travelHours(dd, tw)));
  }
  return h2 + '<div class="tt-foot">' + (E && E.at ? 'กฟผ./ชป. ' + fmtT(E.at) : '') + '</div>';
}
function playMk() {
  var svg = document.getElementById('mkSchem'), story = document.getElementById('mkStory');
  [svg, story].forEach(function (el) { el.classList.remove('playing'); void el.getBoundingClientRect(); el.classList.add('playing'); });
  [].forEach.call(svg.querySelectorAll('animateMotion[begin="indefinite"]'), function (a) { try { a.beginElement(); } catch (e) {} });
  clearTimeout(playMk.t); playMk.t = setTimeout(function () { svg.classList.remove('playing'); story.classList.remove('playing'); }, 13000);
}
function initSchemTip() {
  document.getElementById('mkPlay').addEventListener('click', playMk);
  if ('IntersectionObserver' in window && !REDUCED) { var once = new IntersectionObserver(function (es) { if (es[0].isIntersecting) { once.disconnect(); setTimeout(playMk, 600); } }, { threshold: 0.35 }); once.observe(document.getElementById('mkSchem')); }
  var svg = document.getElementById('mkSchem'), tip = document.getElementById('mtip'), box = tip.parentElement;
  function show(el, x, y) {
    tip.innerHTML = mkTip(el.getAttribute('data-tip')); tip.hidden = false;
    var bw = box.getBoundingClientRect(), w = tip.offsetWidth, hgt = tip.offsetHeight;
    var left = Math.min(Math.max(8, x - bw.left + 14), bw.width - w - 8), top = y - bw.top + 16;
    if (top + hgt > bw.height) top = y - bw.top - hgt - 12;
    tip.style.left = left + 'px'; tip.style.top = Math.max(4, top) + 'px';
  }
  svg.addEventListener('pointermove', function (ev) { var el = ev.target.closest('.hov'); if (el) show(el, ev.clientX, ev.clientY); else tip.hidden = true; });
  svg.addEventListener('pointerleave', function () { tip.hidden = true; });
  svg.addEventListener('focusin', function (ev) { var el = ev.target.closest('.hov'); if (el) { var b = el.getBoundingClientRect(); show(el, b.left + b.width / 2, b.bottom); } });
  svg.addEventListener('focusout', function () { tip.hidden = true; });
  svg.addEventListener('click', function (ev) { var el = ev.target.closest('.mk-fac'); if (el) { select(el.getAttribute('data-tip').split(':')[1], true); document.getElementById('h-near').scrollIntoView({ behavior: 'smooth', block: 'start' }); } });
}

/* criteria in plain words, shared by the zone cards and the reference table */
function critRows() {
  var C = CRITERIA;
  return {
    1: { how: 'ปริมาณน้ำในเขื่อนเทียบเกณฑ์ควบคุม (Rule Curve) หรือ % ความจุ', s: ['URC−' + C.dam.urcMargin + '% / ' + C.dam.bands[0] + '%', 'เกิน URC / ' + C.dam.bands[1] + '%', C.dam.bands[2] + '% ความจุ'] },
    2: { how: 'น้ำที่เขื่อนปล่อยต่อวัน เทียบความจุ (มีน้ำล้นทางระบาย = เตือนภัย)', s: [C.release.bands[0] + '%/วัน', C.release.bands[1] + '%/วัน', C.release.bands[2] + '%/วัน'] },
    3: { how: 'ระยะเหลือก่อนน้ำถึงตลิ่ง/ระดับวิกฤต ของสถานีแม่น้ำใกล้โรงงาน (≤' + C.radius.river + ' กม.)', s: ['เหลือ ≤' + C.river.bands[0] + ' ม.', 'เหลือ ≤' + C.river.bands[1] + ' ม.', 'ถึง/ล้นตลิ่ง'] },
    4: { how: '% ความจุลำน้ำ (ระดับน้ำเทียบตลิ่ง) สูงสุดในรัศมี ' + C.radius.bank + ' กม.', s: [C.bank.bands[0] + '% ตลิ่ง', C.bank.bands[1] + '% ตลิ่ง', C.bank.bands[2] + '% (ล้น)'] },
    5: { how: 'ฝนสะสม 24 ชม. สูงสุดในรัศมี ' + C.radius.rain + ' กม. (เกณฑ์กรมอุตุฯ)', s: ['35 มม.', '90 มม.', C.rain.bands[2] + ' มม.'] },
    6: { how: 'น้ำท่วมขัง/ระดับท่อระบายในรัศมี ' + C.radius.drain + ' กม. หรือเซ็นเซอร์ในโรงงาน', s: [C.drain.bands[0] + ' ซม.', C.drain.bands[1] + ' ซม.', C.drain.bands[2] + ' ซม.'] },
    7: { how: 'ระดับน้ำทะเลหนุนที่ปากแม่น้ำ (ม.รทก.) หรือ % ตลิ่งสถานีน้ำขึ้นลง', s: [C.tide.GLF001[0] + ' ม.', C.tide.GLF001[1] + ' ม.', C.tide.GLF001[2] + ' ม.'] }
  };
}
var ZONE_INFO = {
  up: { th: 'ต้นน้ำ', rng: '1–3', lead: 'เตือนล่วงหน้า ~1–3 วัน', what: 'น้ำในเขื่อนและการระบาย — สัญญาณแรกก่อนน้ำเดินทางถึงโรงงาน', ic: 'dam' },
  mid: { th: 'กลางน้ำ', rng: '3–5', lead: 'เตรียมรับมือ ~6–24 ชม.', what: 'แม่น้ำ ตลิ่ง และฝนรอบโรงงาน — น้ำมาถึงพื้นที่แล้ว', ic: 'bank' },
  down: { th: 'ปลายน้ำ', rng: '5–7', lead: 'เกิดได้ทันที 0–6 ชม.', what: 'ฝน ท่อระบาย และน้ำทะเลหนุน — น้ำระบายออกไม่ทัน/ท่วมขัง', ic: 'tide' }
};
function zoneScene(z) {
  // tiny landscape per zone (mountain+dam / river+banks / city+sea)
  var o = '<svg class="zscene" viewBox="0 0 160 64" aria-hidden="true">';
  if (z === 'up') o += '<path d="M0 50 L30 18 L52 40 L78 10 L112 50 Z" fill="#7FA36A"/><path d="M78 10 L70 20 L86 20 Z" fill="#fff" opacity=".8"/><rect x="104" y="30" width="10" height="24" fill="#8FA3B5"/><rect x="88" y="36" width="16" height="18" fill="url(#wd-g)"/><path class="zs-flow" d="M114 46 q20 2 46 10" stroke="#5FB4E8" stroke-width="4" fill="none" stroke-dasharray="6 6"/>';
  else if (z === 'mid') o += '<path d="M0 30 L40 30 L56 58 L104 58 L120 30 L160 30 L160 64 L0 64 Z" fill="#B9A27E"/><rect x="40" y="40" width="80" height="18" fill="url(#wd-g)"/><path class="zs-wave" d="M30 40 q5 -3 10 0 t10 0 t10 0 t10 0 t10 0 t10 0 t10 0 t10 0 t10 0" stroke="#fff" fill="none" stroke-width="1.4"/><path d="M128 30 v-12 l6 -4 v4 l6 -4 v4 l6 -4 v16" fill="#1E3F66"/><line x1="0" x2="160" y1="30" y2="30" stroke="var(--crit)" stroke-dasharray="3 3"/>';
  else o += '<rect x="0" y="0" width="160" height="64" fill="color-mix(in srgb,#7CC8F2 12%,transparent)"/><g class="zs-rain">' + [20, 34, 48, 62].map(function (x) { return '<line x1="' + x + '" y1="4" x2="' + (x - 3) + '" y2="12" stroke="#3B8FD0" stroke-width="1.6"/>'; }).join('') + '</g><rect x="10" y="26" width="16" height="22" fill="#6E8396"/><rect x="30" y="18" width="14" height="30" fill="#8FA3B5"/><rect x="0" y="48" width="70" height="16" fill="#B9A27E"/><rect class="zs-sea" x="66" y="42" width="100" height="24" fill="url(#wd-g)"/><path class="zs-wave" d="M60 42 q5 -3 10 0 t10 0 t10 0 t10 0 t10 0 t10 0 t10 0 t10 0 t10 0 t10 0" stroke="#fff" fill="none" stroke-width="1.4"/>';
  return o + '</svg>';
}
function renderTrigCards() {
  pinDefs();
  var g = document.getElementById('trigGrid'), CR = critRows(), tot = SITES.length, h = '';
  ['up', 'mid', 'down'].forEach(function (z, zi) {
    var Z = ZONE_INFO[z], sites = SITES.filter(function (s) { return s.zone === z; });
    var worst = sites.reduce(function (m, s) { var l = state.evals[s.id].overall; return l == null ? m : Math.max(m, l); }, -1);
    h += '<article class="zcard ' + sc(worst < 0 ? null : worst) + (state.zone === z ? ' on' : '') + '">';
    h += '<header class="zc-h">' + zoneScene(z) + '<div class="zc-t"><span class="zc-k">โซน ' + (zi + 1) + ' · Trigger ' + Z.rng + '</span><h3>' + Z.th + '</h3><p>' + Z.what + '</p></div>' +
      '<div class="zc-lead">' + icon('siren') + Z.lead + '</div></header>';
    h += '<button type="button" class="zc-sites" data-zone="' + z + '" aria-pressed="' + (state.zone === z) + '"><span>พื้นที่ SCGP ในโซนนี้ <b>' + sites.length + '</b></span><span class="zc-dots">' + sites.map(function (s) { return '<i class="' + sc(state.evals[s.id].overall) + '" title="' + esc(s.name) + '"></i>'; }).join('') + '</span><span class="zc-go">' + (state.zone === z ? 'แสดงทุกโซน' : 'กรองรายการ') + ' →</span></button>';
    ZONE_TRIG[z].forEach(function (n) {
      var t = TRIGGERS[n - 1], sm = trigSummary(n), shared = ['up', 'mid', 'down'].filter(function (zz) { return zz !== z && ZONE_TRIG[zz].indexOf(n) >= 0; })[0];
      h += '<button type="button" class="ztrig ' + sc(sm.worst) + '" data-trig="' + n + '" aria-pressed="' + (state.trig === n) + '">';
      h += '<span class="zt-ic">' + icon(TRIG_ICON[n]) + '<em>' + n + '</em></span>';
      h += '<span class="zt-m"><span class="zt-n">' + esc(t.th) + (shared ? ' <small class="zt-sh">ใช้ร่วมกับ' + ZONE_INFO[shared].th + '</small>' : '') + '</span><span class="zt-how">' + esc(CR[n].how) + '</span>';
      h += '<span class="zt-ladder">' + [1, 2, 3].map(function (l) { return '<span class="st s' + l + '"><i style="height:' + (6 + l * 5) + 'px"></i><b>' + LV[l].th + '</b><small>' + esc(CR[n].s[l - 1]) + '</small></span>'; }).join('') + '</span>';
      h += '<span class="zt-dist" title="สถานะของทุกพื้นที่">' + [0, 1, 2, 3].map(function (l) { return sm.c[l] ? '<span class="s' + l + '" style="flex:' + sm.c[l] + '"></span>' : ''; }).join('') + (sm.na ? '<span class="sn" style="flex:' + sm.na + '"></span>' : '') + '</span>';
      h += '<span class="zt-cnt">' + [3, 2, 1, 0].filter(function (l) { return sm.c[l]; }).map(function (l) { return '<span class="s' + l + '">' + LV[l].th + ' ' + sm.c[l] + '</span>'; }).join('') + (sm.na ? '<span class="sn">ไม่มีข้อมูล ' + sm.na + '</span>' : '') + '</span></span>';
      h += '<span class="spill ' + sc(sm.worst) + '">' + (sm.worst == null ? 'ไม่มีข้อมูล' : 'สูงสุด ' + lname(sm.worst)) + '</span></button>';
    });
    h += '</article>';
    if (zi < 2) h += '<div class="zarrow" aria-hidden="true"><span></span><b>น้ำไหลลง</b></div>';
  });
  g.className = 'zone-grid'; g.innerHTML = h;
}

function renderKpis() {
  var c = [0, 0, 0, 0], na = 0;
  SITES.forEach(function (s) { var l = state.evals[s.id].overall; if (l == null) na++; else c[l]++; });
  var h = '';
  [3, 2, 1, 0].forEach(function (l) {
    h += '<button type="button" class="kpi s' + l + '" data-lvl="' + l + '" aria-pressed="' + (state.lvl === l) + '">' + icon(LVL_ICON[l], '', 'background:var(--cb);color:var(--c)') + '<span class="v">' + c[l] + '</span>' + LV[l].th + '</button>';
  });
  document.getElementById('kpis').innerHTML = h;
}

function renderFilters() {
  var h = '';
  if (state.trig != null) h += '<span class="chip-filter">Trigger ' + state.trig + ': ' + esc(TRIGGERS[state.trig - 1].th) + ' <button type="button" data-clear="trig" aria-label="ล้างตัวกรอง Trigger">×</button></span>';
  if (state.lvl != null) h += '<span class="chip-filter">สถานะ: ' + LV[state.lvl].th + ' <button type="button" data-clear="lvl" aria-label="ล้างตัวกรองสถานะ">×</button></span>';
  document.getElementById('activeFilters').innerHTML = h;
  Array.prototype.forEach.call(document.querySelectorAll('#zoneSeg button'), function (b) { b.setAttribute('aria-pressed', b.dataset.zone === state.zone); });
  Array.prototype.forEach.call(document.querySelectorAll('#rangeSeg button'), function (b) { b.setAttribute('aria-pressed', b.dataset.range === state.range); });
  Array.prototype.forEach.call(document.querySelectorAll('#hourMode button'), function (b) { b.setAttribute('aria-pressed', b.dataset.hmode === state.hmode); });
}

/* ---------- reference station + history helpers ---------- */
function refStation(s) { var e = state.evals[s.id]; return (e[3] && e[3].st) || (e[4] && e[4].st) || null; }
function histFor(st, range) { var H = state.hist[range || state.range]; return st && H && H.stations ? H.stations[st.id] : null; }
function pctOf(v, h) { if (v == null || !h || h.bank == null) return null; var g = h.ground != null && h.ground < h.bank ? h.ground : null; return g != null ? (v - g) / (h.bank - g) * 100 : null; }
function trendOf(st) {
  var h = histFor(st, '1D');
  if (h && h.points && h.points.length > 1) {
    var p = h.points.filter(function (x) { return x[1] != null; }); if (p.length > 1) { var a = p[p.length - 2], b = p[p.length - 1]; return (b[1] - a[1]) / ((b[0] - a[0]) / 3600e3); }
  }
  return st && st.msl != null && st.prev != null ? st.msl - st.prev : null;
}
function trendTxt(r, unit) {
  if (r == null) return '<span class="muted">–</span>';
  if (Math.abs(r) < 0.005) return '■ ทรงตัว';
  return (r > 0 ? '<span style="color:var(--warn)">▲ สูงขึ้น +' : '<span style="color:var(--ok)">▼ ลดลง −') + f(Math.abs(r)) + ' ' + (unit || 'ม./ชม.') + '</span>';
}
function projOf(points, idx) {
  var p = points.filter(function (x) { return x[idx] != null; }); if (p.length < 3) return null;
  var last = p[p.length - 1], win = p.filter(function (x) { return x[0] >= last[0] - 6 * 3600e3; }); if (win.length < 2) win = p.slice(-3);
  var n = win.length, mx = 0, my = 0; win.forEach(function (x) { mx += x[0]; my += x[idx]; }); mx /= n; my /= n;
  var sxy = 0, sxx = 0; win.forEach(function (x) { sxy += (x[0] - mx) * (x[idx] - my); sxx += (x[0] - mx) * (x[0] - mx); });
  var slope = sxx ? sxy / sxx : 0; var t = last[0] + 6 * 3600e3;
  return { t: t, v: last[idx] + slope * 6 * 3600e3, from: last };
}
function hhmm(t) { var d = new Date(t + 7 * 3600e3); var h = d.getUTCHours(), m = d.getUTCMinutes(); return (h === 0 && m === 0 ? '24' : String(h).padStart(2, '0')) + ':' + String(m).padStart(2, '0'); }
function ddmm(t) { var d = new Date(t + 7 * 3600e3); return d.getUTCDate() + '/' + (d.getUTCMonth() + 1); }

/* line chart in the Flood Watch style: area + line, dashed reference line, last-value dot, +6 h projection */
function lineChart(o) {
  var W = 660, H = 215, L = 46, R = 92, T = 14, B = 28, pw = W - L - R, ph = H - T - B;
  var pts = o.points.filter(function (p) { return p[1] != null; });
  if (pts.length < 2) return '<div class="chart-empty">' + esc(o.empty || 'ไม่มีข้อมูลในช่วงนี้') + '</div>';
  var t0 = pts[0][0], t1 = Math.max(pts[pts.length - 1][0], o.proj ? o.proj.t : 0) + (o.range === '1D' ? 2 * 3600e3 : o.range === '1W' ? 6 * 3600e3 : 24 * 3600e3);
  var vs = pts.map(function (p) { return p[1]; }); if (o.ref != null) vs.push(o.ref); if (o.proj) vs.push(o.proj.v);
  var lo = Math.min.apply(null, vs), hi = Math.max.apply(null, vs), pad = Math.max((hi - lo) * 0.12, o.minSpan || 0.5);
  lo = o.floor0 ? Math.max(0, lo - pad) : lo - pad; hi += pad;
  var step = niceStep((hi - lo) / 6); lo = Math.floor(lo / step) * step; hi = Math.ceil(hi / step) * step;
  function X(t) { return L + (t - t0) / (t1 - t0) * pw; } function Y(v) { return T + (1 - (v - lo) / (hi - lo)) * ph; }
  var s = '<svg class="chart" viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="' + esc(o.aria || '') + '">';
  for (var v = lo; v <= hi + 1e-9; v += step) { s += '<line x1="' + L + '" x2="' + (L + pw) + '" y1="' + Y(v) + '" y2="' + Y(v) + '" style="stroke:var(--line)" stroke-width="1"/><text x="' + (L - 6) + '" y="' + (Y(v) + 3.5) + '" text-anchor="end">' + f(v, step < 1 ? 2 : 0) + '</text>'; }
  // x ticks
  var tick = o.range === '1D' ? 3 * 3600e3 : o.range === '1W' ? 864e5 : 7 * 864e5;
  var first = Math.ceil((t0 + 7 * 3600e3) / tick) * tick - 7 * 3600e3;
  for (var tt = first; tt <= t1; tt += tick) { var lab = o.range === '1D' ? hhmm(tt) : ddmm(tt); s += '<line x1="' + X(tt) + '" x2="' + X(tt) + '" y1="' + (T + ph) + '" y2="' + (T + ph + 4) + '" style="stroke:var(--muted)"/><text x="' + X(tt) + '" y="' + (H - 8) + '" text-anchor="middle">' + lab + '</text>'; }
  if (o.range === '1D') { var mid = Math.floor((pts[pts.length - 1][0] + 7 * 3600e3) / 864e5) * 864e5 - 7 * 3600e3; if (mid > t0) s += '<line x1="' + X(mid) + '" x2="' + X(mid) + '" y1="' + T + '" y2="' + (T + ph) + '" style="stroke:var(--water)" stroke-dasharray="2 3"/><text x="' + (X(mid) - 4) + '" y="' + (T + 10) + '" text-anchor="end">เมื่อวาน</text><text x="' + (X(mid) + 4) + '" y="' + (T + 10) + '">วันนี้</text>'; }
  // area + line
  var d = pts.map(function (p, i) { return (i ? 'L' : 'M') + X(p[0]).toFixed(1) + ',' + Y(p[1]).toFixed(1); }).join(' ');
  s += '<path d="' + d + ' L' + X(pts[pts.length - 1][0]).toFixed(1) + ',' + (T + ph) + ' L' + X(pts[0][0]).toFixed(1) + ',' + (T + ph) + ' Z" style="fill:var(--water-soft)"/>';
  s += '<path class="ln" pathLength="1" d="' + d + '" fill="none" style="stroke:var(--river)" stroke-width="2" stroke-linejoin="round"/>';
  if (o.ref != null) s += '<line x1="' + L + '" x2="' + (L + pw) + '" y1="' + Y(o.ref) + '" y2="' + Y(o.ref) + '" style="stroke:var(--crit)" stroke-width="1.6" stroke-dasharray="6 4"/><text x="' + (L + 4) + '" y="' + (Y(o.ref) - 4) + '" style="fill:var(--crit)">' + esc(o.refLabel) + '</text>';
  var last = pts[pts.length - 1];
  if (o.proj) { s += '<line x1="' + X(last[0]) + '" y1="' + Y(last[1]) + '" x2="' + X(o.proj.t) + '" y2="' + Y(o.proj.v) + '" style="stroke:var(--river)" stroke-width="1.6" stroke-dasharray="4 4"/><text x="' + (X(o.proj.t) + 4) + '" y="' + (Y(o.proj.v) + 4) + '" class="lbl">+6 ชม. ≈ ' + f(o.proj.v, o.dec) + '</text>'; s += '<text x="' + (X(last[0]) + 4) + '" y="' + (T + ph - 4) + '">แนวโน้ม →</text>'; }
  s += '<circle cx="' + X(last[0]) + '" cy="' + Y(last[1]) + '" r="4.5" style="fill:var(--ink)"/><text x="' + (X(last[0]) - 6) + '" y="' + (Y(last[1]) - 9) + '" text-anchor="end" class="lbl">' + f(last[1], o.dec) + ' ' + esc(o.unit) + '</text>';
  return s + '</svg>';
}
function niceStep(x) { var p = Math.pow(10, Math.floor(Math.log10(x || 1))), n = x / p; return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 5 ? 5 : 10) * p; }

function sparkline(st) {
  var h = histFor(st, '1D'); if (!h || !h.points) return '<svg class="spark" viewBox="0 0 170 46"></svg>';
  var pts = h.points.filter(function (p) { return p[1] != null; }); if (pts.length < 2) return '<svg class="spark" viewBox="0 0 170 46"></svg>';
  var vs = pts.map(function (p) { return p[1]; }); if (h.bank != null) vs.push(h.bank);
  var lo = Math.min.apply(null, vs), hi = Math.max.apply(null, vs), pad = (hi - lo) * 0.1 || 0.3; lo -= pad; hi += pad;
  var t0 = pts[0][0], t1 = pts[pts.length - 1][0];
  function X(t) { return 2 + (t - t0) / (t1 - t0 || 1) * 166; } function Y(v) { return 4 + (1 - (v - lo) / (hi - lo)) * 38; }
  var d = pts.map(function (p, i) { return (i ? 'L' : 'M') + X(p[0]).toFixed(1) + ',' + Y(p[1]).toFixed(1); }).join(' ');
  var s = '<svg class="spark" viewBox="0 0 170 46" aria-hidden="true"><path d="' + d + ' L168,42 L2,42 Z" style="fill:var(--water-soft)"/><path class="ln" pathLength="1" d="' + d + '" fill="none" style="stroke:var(--river)" stroke-width="1.5"/>';
  if (h.bank != null) s += '<line x1="2" x2="168" y1="' + Y(h.bank) + '" y2="' + Y(h.bank) + '" style="stroke:var(--crit)" stroke-dasharray="3 3"/>';
  return s + '</svg>';
}

/* vertical staff gauge (height above gauge datum), like the Flood Watch card */
function gaugeSVG(st, h) {
  var bank = h && h.bank != null ? h.bank : st.minBank;
  var g = h && h.ground != null && bank != null && h.ground < bank ? h.ground : null;
  if (g == null && bank != null && st.pct > 0 && st.pct < 100) { var p = st.pct / 100; g = (st.msl - p * bank) / (1 - p); } // from ThaiWater % = (wl − ground) ÷ (bank − ground)
  if (g == null || bank == null) return '<div style="width:70px"></div>';
  var val = st.msl - g, bk = bank - g, top = Math.ceil(Math.max(bk * 1.2, val + 1));
  var stepM = top > 24 ? 5 : top > 12 ? 2 : 1, Y0 = 322, Y1 = 10;
  function Y(m) { return Y0 - m / top * (Y0 - Y1); }
  var s = '<svg class="gauge" viewBox="0 0 70 330" style="width:70px" role="img" aria-label="ระดับน้ำ ' + f(val, 2) + ' ม. เหนือท้องน้ำ ตลิ่ง ' + f(bk, 2) + ' ม.">';
  s += '<rect x="20" y="' + Y1 + '" width="16" height="' + (Y0 - Y1) + '" rx="3" style="fill:var(--sunk);stroke:var(--line)"/>';
  s += '<rect x="20" y="' + Y(Math.max(0, val)) + '" width="16" height="' + (Y0 - Y(Math.max(0, val))) + '" rx="2" style="fill:var(--river)"/>';
  for (var m = 0; m <= top; m += stepM) s += '<line x1="36" x2="41" y1="' + Y(m) + '" y2="' + Y(m) + '" style="stroke:var(--muted)"/><text x="44" y="' + (Y(m) + 3.5) + '" style="font:500 10px var(--f-data);fill:var(--muted)">' + m + '</text>';
  s += '<line x1="2" x2="38" y1="' + Y(bk) + '" y2="' + Y(bk) + '" style="stroke:var(--crit)" stroke-width="1.5" stroke-dasharray="4 3"/><text x="2" y="' + (Y(bk) - 4) + '" style="font:500 9.5px var(--f-body);fill:var(--crit)">ตลิ่ง</text>';
  s += '<path d="M12 ' + Y(val) + ' l6 -4 v8 z" style="fill:var(--ink)"/>';
  return s + '</svg>';
}

/* per-trigger mini scene (112×76) — shows *what* is being measured, filled to the current reading */
function frac(mt) {
  if (!mt || mt.x == null || isNaN(mt.x)) return null;
  var b = mt.b;
  if (mt.low) return Math.max(0.05, Math.min(1.05, 1 - mt.x / (b[0] * 2)));          // freeboard: 0 m → full
  return Math.max(0.03, Math.min(1.12, mt.x / (b[2] * 1.05)));
}
var vizN = 0;
function vizSVG(n, r) {
  pinDefs(); var U = 'v' + (++vizN) + 'c';
  var F = frac(r.mt), lv = r.l, W = 112, H = 76, o = '<svg class="tviz tv' + n + '" viewBox="0 0 ' + W + ' ' + H + '" aria-hidden="true">';
  var fl = F == null ? 0.35 : F, crit = 'style="stroke:var(--crit)"', wave = function (y, x0, x1, cls) { var d = 'M' + x0 + ' ' + y; for (var x = x0; x < x1 + 24; x += 12) d += ' q3 -2.4 6 0 t6 0'; return '<path class="' + (cls || 'tw') + '" d="' + d + '" fill="none" stroke="#fff" stroke-width="1.3" opacity=".85"/>'; };
  if (n === 1 || n === 2) {
    // reservoir behind a dam wall; level = % capacity (T1) — T2 adds the release jet
    var top = 12, bot = 60, y = bot - (bot - top) * Math.min(1, n === 1 ? fl : 0.72);
    o += '<path d="M4 ' + top + ' L60 ' + top + ' L60 ' + bot + ' L4 ' + bot + ' Z" fill="var(--sunk)"/>';
    o += '<clipPath id="' + U + '"><rect x="4" y="' + top + '" width="56" height="' + (bot - top) + '"/></clipPath><g clip-path="url(#' + U + ')"><rect class="tv-fill" x="0" y="' + y + '" width="64" height="' + (bot - y + 2) + '" fill="url(#wd-g)"/>' + wave(y, -12, 60) + '</g>';
    if (n === 1) o += '<line x1="4" x2="60" y1="' + (bot - (bot - top) * (100 / 115)) + '" y2="' + (bot - (bot - top) * (100 / 115)) + '" ' + crit + ' stroke-dasharray="3 3" stroke-width="1.2"/><text x="6" y="' + (bot - (bot - top) * (100 / 115) - 3) + '" font-size="7" fill="var(--crit)">100%</text>';
    o += '<path d="M58 8 L70 8 L80 62 L58 62 Z" fill="#8FA3B5"/><path d="M58 8 L62 8 L62 62 L58 62 Z" fill="#6E8396"/>';
    if (n === 2) {
      var sp = F == null ? 1.6 : Math.max(0.35, 1.6 - F * 1.3), k = F == null ? 2 : 2 + Math.round(F * 5);
      for (var i = 0; i < k; i++) o += '<path class="tv-jet" style="animation-duration:' + sp.toFixed(2) + 's;animation-delay:-' + (i * sp / k).toFixed(2) + 's" d="M76 ' + (40 + i * 3) + ' q14 4 24 ' + (18 - i * 2) + '" fill="none" stroke="#5FB4E8" stroke-width="' + (2 + (F || 0) * 2.5).toFixed(1) + '" stroke-linecap="round" stroke-dasharray="5 6"/>';
      o += '<path d="M78 66 q8 -4 16 0 t16 0" fill="none" stroke="#5FB4E8" stroke-width="2" opacity=".6"/>';
    }
    o += '<rect x="0" y="62" width="' + W + '" height="4" rx="2" fill="#6E8396" opacity=".45"/>';
  } else if (n === 3 || n === 4) {
    // river cross-section: banks, bank-full line, water at current level
    var bankY = 18, bed = 66, wy = bed - (bed - bankY) * Math.min(1.08, fl);
    o += '<path d="M0 ' + (bankY - 2) + ' L18 ' + (bankY - 2) + ' L32 ' + bed + ' L80 ' + bed + ' L94 ' + (bankY - 2) + ' L112 ' + (bankY - 2) + ' L112 76 L0 76 Z" fill="#B9A27E"/>';
    o += '<path d="M0 ' + (bankY - 2) + ' L18 ' + (bankY - 2) + ' M94 ' + (bankY - 2) + ' L112 ' + (bankY - 2) + '" stroke="#6E9B4F" stroke-width="4"/>';
    o += '<clipPath id="' + U + '"><path d="M' + (fl > 1 ? 0 : 14) + ' 0 L' + (fl > 1 ? 112 : 98) + ' 0 L80 ' + bed + ' L32 ' + bed + ' Z"/></clipPath><g clip-path="url(#' + U + ')"><rect class="tv-fill" x="0" y="' + wy + '" width="112" height="' + (bed - wy + 2) + '" fill="url(#wd-g)"/>' + wave(wy, -12, 112) + '</g>';
    o += '<line x1="0" x2="112" y1="' + bankY + '" y2="' + bankY + '" ' + crit + ' stroke-dasharray="3 3" stroke-width="1.2"/><text x="108" y="' + (bankY - 4) + '" text-anchor="end" font-size="7" fill="var(--crit)">ตลิ่ง</text>';
    if (n === 3) o += '<g transform="translate(52,' + (bankY - 6) + ')"><rect x="0" y="0" width="3" height="' + (bed - bankY + 4) + '" fill="#fff" stroke="#6E8396" stroke-width=".6"/>' + [0, 1, 2, 3, 4, 5].map(function (i) { return '<line x1="0" x2="5" y1="' + (4 + i * 8) + '" y2="' + (4 + i * 8) + '" stroke="#6E8396" stroke-width=".8"/>'; }).join('') + '</g>';
    if (fl > 1) o += '<path class="tv-over" d="M14 ' + bankY + ' q-6 4 -12 2 M98 ' + bankY + ' q6 4 12 2" fill="none" stroke="#5FB4E8" stroke-width="2.4" stroke-linecap="round"/>';
  } else if (n === 5) {
    // cloud + falling rain (drop count ∝ mm) + rain gauge
    var mm = r.mt ? r.mt.x : 0, drops = Math.max(2, Math.min(18, Math.round(2 + mm / 6))), sp5 = Math.max(0.45, 1.2 - mm / 160);
    o += '<g class="tv-cloud"><ellipse cx="44" cy="20" rx="26" ry="11" fill="#C9D6E2"/><circle cx="34" cy="15" r="11" fill="#D9E3EC"/><circle cx="52" cy="12" r="13" fill="#E4ECF3"/></g>';
    for (var d = 0; d < drops; d++) { var x = 22 + (d * 37 % 46), del = (d * 0.13) % sp5; o += '<line class="tv-drop" style="animation-duration:' + sp5.toFixed(2) + 's;animation-delay:-' + del.toFixed(2) + 's" x1="' + x + '" y1="30" x2="' + (x - 2) + '" y2="37" stroke="#3B8FD0" stroke-width="1.8" stroke-linecap="round"/>'; }
    var gh = 50 * Math.min(1, fl);
    o += '<rect x="86" y="18" width="16" height="52" rx="3" fill="var(--sunk)" stroke="#8FA3B5"/><rect class="tv-fill" x="87" y="' + (69 - gh) + '" width="14" height="' + gh + '" fill="url(#wd-g)"/>';
    [35, 90, 150].forEach(function (b) { var yy = 69 - 50 * Math.min(1, b / 157.5); o += '<line x1="84" x2="104" y1="' + yy + '" y2="' + yy + '" stroke="var(--' + (b === 150 ? 'crit' : b === 90 ? 'warn' : 'watch') + ')" stroke-width="1"/>'; });
  } else if (n === 6) {
    // drain pipe cross-section filling up
    var py = 66 - 46 * Math.min(1, fl);
    o += '<rect x="0" y="66" width="112" height="10" fill="#B9A27E"/><circle cx="40" cy="43" r="25" fill="var(--sunk)" stroke="#8FA3B5" stroke-width="4"/>';
    o += '<clipPath id="' + U + '"><circle cx="40" cy="43" r="23"/></clipPath><g clip-path="url(#' + U + ')"><rect class="tv-fill" x="10" y="' + py + '" width="62" height="60" fill="url(#wd-g)"/>' + wave(py, 4, 72) + '</g>';
    o += '<path d="M66 43 H104 V60" fill="none" stroke="#8FA3B5" stroke-width="7"/><path class="tv-jet" d="M70 43 H100 V58" fill="none" stroke="#5FB4E8" stroke-width="2.5" stroke-dasharray="4 5" style="animation-duration:1.2s"/>';
    if (F == null) o += '<text x="40" y="47" text-anchor="middle" font-size="9" fill="var(--muted)">รอเซ็นเซอร์</text>';
  } else if (n === 7) {
    // coastline + rising sea; tide line vs threshold
    var sy = 64 - 44 * Math.min(1.05, fl);
    o += '<rect x="0" y="0" width="112" height="76" fill="color-mix(in srgb,#7CC8F2 14%,transparent)"/><circle cx="96" cy="14" r="7" fill="#F0C060" opacity=".85"/>';
    o += '<g class="tv-sea"><rect class="tv-fill" x="-20" y="' + sy + '" width="150" height="' + (76 - sy) + '" fill="url(#wd-g)"/>' + wave(sy, -24, 112, 'tw tw2') + '</g>';
    o += '<path d="M0 30 L22 30 L34 76 L0 76 Z" fill="#B9A27E"/><rect x="6" y="18" width="10" height="12" fill="#6E8396"/><path d="M5 18 l6 -6 l6 6 z" fill="#8FA3B5"/>';
    o += '<line x1="20" x2="112" y1="' + (64 - 44 * (1 / 1.05)) + '" y2="' + (64 - 44 * (1 / 1.05)) + '" ' + crit + ' stroke-dasharray="3 3" stroke-width="1.2"/>';
  }
  if (lv != null) o += '<circle class="tv-dot" cx="' + (W - 7) + '" cy="7" r="4.5" style="fill:var(--c)"/>';
  return o + '</svg>';
}
/* threshold meter: 4 coloured zones, safe → danger left to right (reversed for freeboard where lower is worse) */
function meterHTML(mt, big) {
  if (!mt || mt.x == null || isNaN(mt.x)) return '';
  var b = mt.b, sg = mt.low ? -1 : 1, x = sg * mt.x, B = b.map(function (v) { return sg * v; });
  var span = B[2] - B[0], lo = mt.low ? B[0] - span * 1.2 : Math.max(0, B[0] - span), hi = B[2] + span * 0.4;
  var P = function (v) { return Math.max(0, Math.min(100, (v - lo) / (hi - lo) * 100)); };
  var cuts = [P(B[0]), P(B[1]), P(B[2])], px = P(x);
  var z = [[0, cuts[0], 'ok'], [cuts[0], cuts[1], 'watch'], [cuts[1], cuts[2], 'warn'], [cuts[2], 100, 'crit']];
  var h = '<div class="meter' + (big ? ' big' : '') + '"><div class="mz">' + z.map(function (q) { return '<span style="left:' + q[0] + '%;width:' + (q[1] - q[0]) + '%;background:var(--' + q[2] + ')"></span>'; }).join('') + '</div>' +
    '<i class="mk" style="left:' + px + '%"><b>' + f(mt.x, Math.abs(mt.x) < 10 ? 2 : 1) + '</b></i>';
  if (big) h += '<div class="mt">' + b.map(function (v, k) { return '<span style="left:' + cuts[k] + '%">' + f(v, Math.abs(v) < 10 ? 1 : 0) + '</span>'; }).join('') + '</div>';
  return h + '</div>';
}
function bandRows(mt) {
  var b = mt.b, u = esc(mt.u), r;
  if (mt.low) r = [['ok', 'ปกติ', 'มากกว่า ' + f(b[0], 1)], ['watch', 'เฝ้าระวัง', f(b[1], 1) + ' – ' + f(b[0], 1)], ['warn', 'เตือนภัย', f(b[2], 1) + ' – ' + f(b[1], 1)], ['crit', 'วิกฤต', 'ต่ำกว่า/เท่ากับ ' + f(b[2], 1)]];
  else r = [['ok', 'ปกติ', 'ต่ำกว่า ' + f(b[0], 1)], ['watch', 'เฝ้าระวัง', f(b[0], 1) + ' – ' + f(b[1], 1)], ['warn', 'เตือนภัย', f(b[1], 1) + ' – ' + f(b[2], 1)], ['crit', 'วิกฤต', 'ตั้งแต่ ' + f(b[2], 1)]];
  return '<div class="bands">' + r.map(function (q, k) { return '<div class="band"><i style="background:var(--' + q[0] + ')"></i><b>' + q[1] + '</b><span>' + q[2] + ' ' + u + '</span></div>'; }).join('') + '</div>';
}
function triggerBoxes(s) {
  var e = state.evals[s.id], prim = ZONE_TRIG[s.zone], h = '<div class="tgrid">';
  TRIGGERS.forEach(function (t) {
    var r = e[t.n], isP = prim.indexOf(t.n) >= 0, key = s.id + ':' + t.n, open = state.tbOpen === key;
    h += '<div class="tbox ' + sc(r.l) + (isP ? ' prim' : ' irrelevant') + (open ? ' open' : '') + '" data-tb="' + key + '" data-stop="1" role="button" tabindex="0" aria-expanded="' + open + '">';
    h += '<span class="tb-shine" aria-hidden="true"></span>';
    h += '<div class="hd"><span class="tt"><span class="tb-ico">' + icon(TRIG_ICON[t.n]) + '<em>' + t.n + '</em></span><span><span class="tb-k">TRIGGER ' + t.n + (isP ? ' · จุดหลัก' : '') + '</span><span class="tb-t">' + esc(t.th) + '</span></span></span><span class="spill ' + sc(r.l) + '">' + (r.l == null ? '' : icon(LVL_ICON[r.l] || 'shield')) + lname(r.l) + '</span></div>';
    if (r.l == null && r.na) h += '<div class="tb-body"><div class="why muted tb-na">' + icon('eye') + esc(r.na) + '</div>' + vizSVG(t.n, r) + '</div>';
    else {
      h += '<div class="tb-body"><div class="tb-main"><div class="val">' + r.v + '<small>' + esc(r.u) + '</small>' + (r.trend != null ? ' <span class="trend" style="color:' + (r.trend > 0.005 ? 'var(--warn)' : r.trend < -0.005 ? 'var(--ok)' : 'var(--muted)') + '">' + (r.trend > 0.005 ? '▲' : r.trend < -0.005 ? '▼' : '■') + ' ' + f(Math.abs(r.trend)) + '</span>' : '') + '</div>';
      h += meterHTML(r.mt, false) + '</div>' + vizSVG(t.n, r) + '</div>';
      h += '<div class="why tb-title">' + esc(r.title) + '</div>';
      h += '<div class="tb-more"><div class="tb-more-in">';
      h += '<div class="why muted">' + esc(r.why) + '</div>';
      if (r.mt) h += '<div class="tb-lbl">ตำแหน่งเทียบเกณฑ์ (' + esc(r.mt.u) + ')</div>' + meterHTML(r.mt, true) + bandRows(r.mt);
      h += '<div class="src">' + icon('drop') + esc(r.src) + '</div>';
      if (r.geo && r.geo.length) h += '<div class="tb-act"><button type="button" class="btn" data-mapll="' + r.geo[0].lat + ',' + r.geo[0].lng + '">📍 ดูสถานีบนแผนที่</button></div>';
      h += '</div></div>';
    }
    h += '<div class="tb-foot"><span>แหล่งข้อมูล: ' + esc(t.src) + '</span>' + (r.l == null ? '' : '<span class="tb-hint">' + (open ? 'ย่อ' : 'ดูเกณฑ์') + ' <i>▾</i></span>') + '</div></div>';
  });
  return h + '</div>';
}

/* ---------- featured card ("ใกล้ฉัน" / selected site) ---------- */
function renderFeatured() {
  var s = SITES.filter(function (x) { return x.id === state.sel; })[0] || topSite(); if (!s) return;
  var e = state.evals[s.id], st = refStation(s), isNear = state.near && state.near.site && state.near.site.id === s.id;
  document.getElementById('nearTitle').textContent = isNear ? 'ใกล้ฉัน' : 'พื้นที่ที่เลือก';
  document.getElementById('nearSub').innerHTML = esc(s.prov + ' · อ.' + s.amp) + (isNear ? ' · ห่างจากคุณ ' + km(state.near.d) : '');
  var note = document.getElementById('geoNote');
  if (state.near && state.near.denied && !state.userPicked) { note.hidden = false; note.className = 'fw-note'; note.innerHTML = 'ไม่ได้รับอนุญาตให้ใช้ตำแหน่ง · เปิดสิทธิ์ตำแหน่งของเว็บนี้ในการตั้งค่าเบราว์เซอร์ · แสดง <b>' + esc(s.name) + '</b> ไปก่อน · <button type="button" id="geoRetry">ลองใหม่</button>'; }
  else if (state.near && state.near.site && !isNear) { note.hidden = false; note.className = 'fw-note'; note.innerHTML = 'กำลังดูพื้นที่ที่เลือก · <button type="button" id="geoBack">กลับไปพื้นที่ใกล้ฉัน (' + esc(state.near.site.name) + ')</button>'; }
  else note.hidden = true;
  var h = histFor(st), el = document.getElementById('featured'), o = '';
  document.getElementById('nearAsof').textContent = st && st.t ? 'ข้อมูลล่าสุดที่มี ' + fmtT(st.t, false) : '';
  o += '<div class="feat">';
  // left
  o += '<div class="feat-left">';
  o += st ? gaugeSVG(st, h) : '<div></div>';
  o += '<div style="display:grid;gap:4px;align-content:start;min-width:0">';
  o += '<div class="feat-meta">' + esc(s.name) + '</div>';
  if (st) {
    var tr = trendOf(st), lv = lvlBy(st.pct, CRITERIA.bank.bands), left = st.minBank != null ? st.minBank - st.msl : null;
    o += '<div class="feat-code">' + esc(st.code) + '</div><div class="feat-name">' + esc(st.name) + (st.river ? ' · ' + esc(st.river) : '') + '</div>';
    o += '<button type="button" class="pin-btn" data-mapto="' + s.id + '">📍 ดูบนแผนที่</button>';
    o += '<div class="feat-big">' + f(st.msl) + '<small>ม.รทก.</small></div>';
    o += '<div><span class="spill ' + sc(lv) + '">' + lname(lv) + ' · ' + (tr == null ? 'ไม่ทราบแนวโน้ม' : Math.abs(tr) < 0.005 ? 'ทรงตัว' : tr > 0 ? 'กำลังสูงขึ้น' : 'กำลังลดลง') + '</span></div>';
    o += '<dl class="kv"><dt>อัตราเปลี่ยน</dt><dd>' + (tr == null ? '–' : (tr > 0 ? '+' : '') + f(tr) + ' ม./ชม.') + '</dd><dt>ระดับตลิ่ง</dt><dd>' + f(st.minBank) + ' ม.</dd><dt>' + (left != null && left < 0 ? 'ล้นตลิ่ง' : 'ต่ำกว่าตลิ่ง') + '</dt><dd>' + f(left == null ? null : Math.abs(left)) + ' ม. (' + f(st.pct, 0) + '%)</dd></dl>';
    var q = h && h.points ? h.points.filter(function (p) { return p[2] != null; }) : [];
    if (q.length) {
      var ql = q[q.length - 1][2], qcap = h.qmax, qpct = qcap ? ql / qcap * 100 : null, qtr = q.length > 1 ? (q[q.length - 1][2] - q[q.length - 2][2]) / ((q[q.length - 1][0] - q[q.length - 2][0]) / 3600e3) : null;
      o += '<div class="sub-h">ปริมาณน้ำ · Discharge</div><div class="feat-big" style="font-size:30px">' + f(ql, 1) + '<small>ม³/วิ</small></div>';
      o += qpct != null ? '<div><span class="spill ' + sc(lvlBy(qpct, CRITERIA.bank.bands)) + '">' + lname(lvlBy(qpct, CRITERIA.bank.bands)) + ' · ' + f(qpct, 0) + '% ของความจุ</span></div>' : '';
      o += '<dl class="kv">' + (qcap ? '<dt>ความจุลำน้ำ</dt><dd>' + f(qcap, 0) + ' ม³/วิ</dd>' : '') + '<dt>แนวโน้ม</dt><dd>' + trendTxt(qtr, 'ม³/วิ/ชม.') + '</dd></dl>';
    }
  } else o += '<div class="muted">ไม่มีสถานีวัดระดับน้ำใกล้พื้นที่นี้</div>';
  o += '</div></div>';
  // right: charts
  o += '<div class="feat-right">';
  var rl = { '1D': 'ย้อนหลัง 24 ชม.', '1W': 'ย้อนหลัง 7 วัน', '1M': 'ย้อนหลัง 30 วัน' }[state.range];
  if (st) {
    var empty = state.histErr ? 'กราฟย้อนหลังแสดงเมื่อเปิดผ่านเว็บ scgp-water-management.vercel.app' : state.histLoading ? 'กำลังโหลดข้อมูลย้อนหลัง…' : 'สถานีนี้ไม่มีข้อมูลย้อนหลังใน สสน.';
    var pts = h && h.points ? h.points : [];
    o += '<div><div class="chart-h">ระดับน้ำ<small>' + rl + ' · ม.รทก. · เส้นแดง = ตลิ่ง</small></div>';
    o += lineChart({ points: pts.map(function (p) { return [p[0], p[1]]; }), ref: h && h.bank != null ? h.bank : st.minBank, refLabel: 'ตลิ่ง ' + f(h && h.bank != null ? h.bank : st.minBank), unit: 'ม.', dec: 2, range: state.range, proj: state.range === '1D' ? projOf(pts, 1) : null, empty: empty, aria: 'กราฟระดับน้ำ ' + st.code }) + '</div>';
    var qp = pts.filter(function (p) { return p[2] != null; });
    if (qp.length > 1) o += '<div><div class="chart-h">ปริมาณน้ำ<small>' + rl + ' · ม³/วิ' + (h.qmax ? ' · เส้นแดง = ความจุลำน้ำ' : '') + '</small></div>' + lineChart({ points: qp.map(function (p) { return [p[0], p[2]]; }), ref: h.qmax, refLabel: 'ความจุ ' + f(h.qmax, 0), unit: 'ม³/วิ', dec: 1, range: state.range, floor0: true, minSpan: 20, proj: state.range === '1D' ? projOf(qp.map(function (p) { return [p[0], p[2]]; }), 1) : null, aria: 'กราฟปริมาณน้ำ ' + st.code }) + '</div>';
  }
  o += '</div>';
  // SCGP context: 7 triggers + companies
  o += '<div class="feat-trig"><div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap;justify-content:space-between"><div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap"><b>' + icon('factory') + esc(s.name) + '</b><span class="spill ' + sc(e.overall) + '">ภาพรวม 7 Trigger: ' + lname(e.overall) + '</span><span class="muted" style="font-size:12.5px">' + ZONES[s.zone] + ' · ลุ่มน้ำ' + esc(s.basin) + '</span></div>';
  o += '<div class="cells">' + [1, 2, 3, 4, 5, 6, 7].map(function (n) { var l = e[n].l; return '<span class="cell ' + sc(l) + '" title="' + n + ' ' + esc(TRIGGERS[n - 1].th) + ': ' + lname(l) + '">' + (l == null ? '·' : n) + '</span>'; }).join('') + '</div></div>';
  o += '<ul class="cos">' + s.cos.map(function (c) { return '<li>' + esc(c) + '</li>'; }).join('') + '</ul>';
  o += climateBox(s);
  o += '<details class="more"><summary>ดูรายละเอียด 7 Trigger Point</summary>' + triggerBoxes(s) + '</details></div>';
  o += '</div>';
  el.innerHTML = o;
  if (state._featId !== s.id) { state._featId = s.id; replay(el, 'enter'); countUp(el.querySelectorAll('.feat-big')); }
}

/* ---------- all-sites list ---------- */
function renderList() {
  var list = visibleSites(), o = '';
  list.forEach(function (s) {
    var e = state.evals[s.id], st = refStation(s), open = state.open === s.id;
    var lv = st ? lvlBy(st.pct, CRITERIA.bank.bands) : null;
    o += '<div class="srow ' + sc(e.overall) + '" data-row="' + s.id + '" role="button" tabindex="0" aria-expanded="' + open + '">';
    o += '<span class="tl"><i></i></span>';
    o += '<div style="min-width:0"><div class="s-meta">' + esc(ZONES[s.zone] + ' · ' + s.prov + ' · อ.' + s.amp) + '</div><div class="s-name">' + esc(s.name) + ' <span class="muted" style="font-size:12px">▾</span></div><div class="s-sub">' + (st ? esc(st.code + ' ' + st.name) : 'ไม่มีสถานีอ้างอิง') + '</div></div>';
    if (st) {
      var w = st.minBank ? Math.min(100, Math.max(0, st.pct / 1.25)) : 0, tr = trendOf(st);
      o += '<div class="' + sc(lv) + '" style="min-width:0"><div class="lv-txt">' + f(st.msl) + ' ม. <small>/ ตลิ่ง ' + f(st.minBank) + '</small></div>';
      o += '<div class="lvbar"><span style="width:' + w + '%"></span><i style="left:80%"></i></div>';
      o += '<div class="lv-foot">' + fmtT(st.t, false) + ' · ' + f(st.pct, 0) + '% ของตลิ่ง · ' + trendTxt(tr) + '</div></div>';
    } else o += '<div class="muted" style="font-size:12.5px">–</div>';
    o += '<div class="cells-col"><div class="cells">' + [1, 2, 3, 4, 5, 6, 7].map(function (n) { var l = e[n].l; return '<span class="cell ' + sc(l) + '" title="' + n + ' ' + esc(TRIGGERS[n - 1].th) + ': ' + lname(l) + '"' + (state.trig === n ? ' style="outline:2px solid var(--ink);outline-offset:1px"' : '') + '>' + (l == null ? '·' : n) + '</span>'; }).join('') + '</div><div class="s-sub" style="margin-top:4px">7 Trigger · <b style="color:var(--c)">' + lname(e.overall) + '</b></div></div>';
    o += '<div class="spark-col" style="display:grid;gap:4px;min-width:0">';
    if (st && st.minBank != null) { var left = st.minBank - st.msl; o += '<span class="left-chip ' + sc(lv) + '">' + (left < 0 ? 'ล้น ' + f(-left) + ' ม.' : 'เหลือ ' + f(left) + ' ม.') + '</span>'; }
    o += st ? sparkline(st) : '';
    o += '</div>';
    if (open) o += '<div class="srow-detail' + (state.justOpened === s.id ? ' enter' : '') + '" data-stop="1">' + triggerBoxes(s) + climateBox(s) + '<div style="display:flex;gap:8px;margin-top:10px;flex-wrap:wrap"><button type="button" class="btn primary" data-feature="' + s.id + '">แสดงในการ์ดด้านบน</button><button type="button" class="btn" data-mapto="' + s.id + '">📍 ดูบนแผนที่</button></div></div>';
    o += '</div>';
  });
  document.getElementById('siteList').innerHTML = o || '<div class="empty">ไม่มีพื้นที่ตรงกับตัวกรอง</div>';
  document.getElementById('countLabel').textContent = list.length + '/' + SITES.length;
  var dd = document.querySelector('.srow-detail.enter'); if (dd) countUp(dd.querySelectorAll('.tbox .val'));
  if (map) updateMarkers(list);
}

/* ---------- hourly table (24 h) ---------- */
function renderHourTable() {
  var el = document.getElementById('hourTable'), H = state.hist['1D'];
  if (!H || !H.stations) { el.innerHTML = '<div class="chart-empty">' + (state.histErr ? 'ตารางรายชั่วโมงแสดงเมื่อเปิดผ่านเว็บ scgp-water-management.vercel.app' : 'กำลังโหลดข้อมูลรายชั่วโมง…') + '</div>'; return; }
  var now = Date.now(), endH = Math.floor((now + 7 * 3600e3) / 3600e3) * 3600e3 - 7 * 3600e3, hours = [];
  for (var i = 23; i >= 0; i--) hours.push(endH - i * 3600e3);
  var dayOf = function (t) { return Math.floor((t + 7 * 3600e3) / 864e5); }, today = dayOf(endH);
  var nY = hours.filter(function (t) { return dayOf(t) < today; }).length;
  var o = '<table class="htable"><thead><tr><th></th>' + (nY ? '<th class="day" colspan="' + nY + '">เมื่อวาน</th>' : '') + '<th class="day" colspan="' + (24 - nY) + '">วันนี้</th></tr><tr><th class="st">พื้นที่ · สถานี</th>' + hours.map(function (t) { var hh = new Date(t + 7 * 3600e3).getUTCHours(); return '<th>' + (hh === 0 ? 24 : hh) + '</th>'; }).join('') + '</tr></thead><tbody>';
  visibleSites().forEach(function (s) {
    var st = refStation(s), h = st ? H.stations[st.id] : null;
    o += '<tr><th class="st">' + esc(s.name) + (st ? '<small>' + esc(st.code) + '</small>' : '') + '</th>';
    hours.forEach(function (t) {
      var p = h && h.points ? h.points.filter(function (x) { return x[0] >= t && x[0] < t + 3600e3; }).pop() : null, v = null;
      if (p) v = state.hmode === 'cap' ? (p[2] != null && h.qmax ? p[2] / h.qmax * 100 : null) : pctOf(p[1], h);
      if (v == null) { o += '<td></td>'; return; }
      var l = lvlBy(v, CRITERIA.bank.bands), bg = l ? 'var(--' + ['ok', 'watch', 'warn', 'crit'][l] + '-bg)' : 'color-mix(in srgb,var(--water) ' + Math.round(8 + Math.min(70, v) / 70 * 30) + '%,transparent)';
      o += '<td style="background:' + bg + '" title="' + esc(s.name) + ' ' + hhmm(t) + ' · ' + f(v, 0) + '%">' + Math.round(v) + '</td>';
    });
    o += '</tr>';
  });
  o += '</tbody></table><p class="note">แหล่งข้อมูล: คลังข้อมูลน้ำแห่งชาติ (สสน.) ระดับน้ำรายชั่วโมงของสถานีอ้างอิงใกล้โรงงาน · % ของตลิ่ง = (ระดับน้ำ − ท้องน้ำ) ÷ (ตลิ่ง − ท้องน้ำ) · สีเหลือง/ส้ม/แดง = เกณฑ์ Trigger 4 (70/85/100%)</p>';
  el.innerHTML = o;
}

function renderDams() {
  var used = {}; SITES.forEach(function (s) { s.dams.forEach(function (d) { (used[d] = used[d] || []).push(s); }); });
  var rows = Object.keys(used).map(function (n) { return state.data.damByName[n]; }).filter(Boolean).sort(function (a, b) { return b.pct - a.pct; });
  var h = '<thead><tr><th>เขื่อน</th><th>ปริมาตรน้ำ (% ความจุปกติ)</th><th>ปริมาตร (ล้าน ลบ.ม.)</th><th>ไหลเข้า</th><th>ระบาย</th><th>ระบาย/ความจุ</th><th>Rule Curve (กฟผ.)</th><th>พื้นที่ SCGP ที่รับผล</th></tr></thead><tbody>';
  rows.forEach(function (d) {
    var g = state.data.egat && state.data.egat.byName[d.name], mark = g && g.upper ? g.upper : 80;
    var l1 = damLevel(d), p2 = d.norm ? d.rel / d.norm * 100 : null, l2 = lvlBy(p2, CRITERIA.release.bands);
    h += '<tr><td><b>' + esc(d.name) + '</b></td>';
    h += '<td><div style="display:flex;align-items:center;gap:10px"><div class="bar ' + sc(l1) + '"><span style="width:' + Math.min(100, d.pct / 1.1) + '%"></span><i style="left:' + (mark / 1.1) + '%"></i></div><span class="num">' + f(d.pct, 1) + '%</span><span class="spill ' + sc(l1) + '">' + lname(l1) + '</span></div></td>';
    h += '<td class="num">' + f(d.st, 0) + ' / ' + f(d.norm, 0) + '</td><td class="num">' + f(d.inf) + '</td><td class="num">' + f(d.rel) + '</td>';
    h += '<td><span class="spill ' + sc(l2) + '">' + f(p2, 2) + '%</span></td>';
    h += '<td>' + (g && g.rc ? '<span class="spill" style="background:' + RC[g.rc].c + ';color:#fff">' + RC[g.rc].th + '</span> <span class="num muted" style="font-size:12px">URC ' + f(g.upper, 1) + '% · LRC ' + f(g.lower, 1) + '%</span>' : '<span class="muted" style="font-size:12px">–</span>') + '</td>';
    h += '<td style="white-space:normal;min-width:220px;font-size:12.5px">' + used[d.name].map(function (s) { return esc(s.name); }).join(', ') + '</td></tr>';
  });
  h += '</tbody>';
  document.getElementById('damTable').innerHTML = h;
}

function renderCriteria() {
  var C = CRITERIA, rows = [
    [1, 'ระดับน้ำเขื่อน', 'เขื่อน กฟผ.: เทียบเกณฑ์ควบคุม Rule Curve (URC) · เขื่อนอื่น: % ความจุปกติ', 'URC−' + C.dam.urcMargin + '% / ≥ ' + C.dam.bands[0] + '%', 'เกิน URC / ≥ ' + C.dam.bands[1] + '%', '≥ ' + C.dam.bands[2] + '%'],
    [2, 'น้ำไหลออก', 'น้ำระบาย ÷ ความจุปกติ ต่อวัน (มีน้ำล้นทางระบาย = เตือนภัยขึ้นไป)', '≥ ' + C.release.bands[0] + '%', '≥ ' + C.release.bands[1] + '%', '≥ ' + C.release.bands[2] + '%'],
    [3, 'ระดับท่าน้ำ (ม.รทก.)', 'ระยะจากระดับน้ำถึงระดับวิกฤตของสถานี (หรือตลิ่งต่ำสุด) สถานีแม่น้ำใกล้สุดในรัศมี ' + C.radius.river + ' กม.', '≤ ' + C.river.bands[0] + ' ม.', '≤ ' + C.river.bands[1] + ' ม.', 'ถึง/ล้น'],
    [4, 'ระดับตลิ่ง', '% ความจุลำน้ำ สูงสุดของสถานีในรัศมี ' + C.radius.bank + ' กม.', '≥ ' + C.bank.bands[0] + '%', '≥ ' + C.bank.bands[1] + '%', '≥ ' + C.bank.bands[2] + '% (ล้นตลิ่ง)'],
    [5, 'ปริมาณน้ำฝน', 'ฝนสะสม 24 ชม. สูงสุดในรัศมี ' + C.radius.rain + ' กม. (เกณฑ์กรมอุตุนิยมวิทยา)', '≥ 35.1 มม. (หนัก)', '≥ 90.1 มม. (หนักมาก)', '≥ ' + C.rain.bands[2] + ' มม.'],
    [6, 'ระดับท่อ/น้ำท่วมขัง', 'น้ำท่วมขังสูงสุดในรัศมี ' + C.radius.drain + ' กม. (กทม.) / เซ็นเซอร์ภายในเมื่อเชื่อมต่อ', '≥ ' + C.drain.bands[0] + ' ซม.', '≥ ' + C.drain.bands[1] + ' ซม.', '≥ ' + C.drain.bands[2] + ' ซม.'],
    [7, 'น้ำทะเลหนุน', 'ป้อมพระจุลจอมเกล้า (ม.รทก.) / สถานีอื่นใช้ % ตลิ่ง', '≥ ' + C.tide.GLF001[0] + ' ม.', '≥ ' + C.tide.GLF001[1] + ' ม.', '≥ ' + C.tide.GLF001[2] + ' ม.']
  ];
  var h = '<thead><tr><th>#</th><th>Trigger</th><th>วิธีวัด</th><th><span class="spill s1">เฝ้าระวัง</span></th><th><span class="spill s2">เตือนภัย</span></th><th><span class="spill s3">วิกฤต</span></th></tr></thead><tbody>';
  rows.forEach(function (r) { h += '<tr><td class="num">' + r[0] + '</td><td><b>' + r[1] + '</b></td><td>' + r[2] + '</td><td class="num">' + r[3] + '</td><td class="num">' + r[4] + '</td><td class="num">' + r[5] + '</td></tr>'; });
  document.getElementById('critTable').innerHTML = h + '</tbody>';
}

/* ---------- motion helpers ---------- */
var REDUCED = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
function replay(el, cls) { if (REDUCED) return; el.classList.remove(cls); void el.offsetWidth; el.classList.add(cls); }
function countUp(nodes) {
  if (REDUCED || document.hidden) return;
  [].forEach.call(nodes, function (n) {
    var tn = n.firstChild; if (!tn || tn.nodeType !== 3 || n._cu) return; // never stack two count-ups on one number
    var txt = tn.nodeValue; n._cu = 1;
    var m = /^(-?)([\d,]+)(?:\.(\d+))?$/.exec(txt.trim());
    if (!m) { n._cu = 0; return; }
    var dec = m[3] ? m[3].length : 0, target = parseFloat((m[1] + m[2]).replace(/,/g, '') + (m[3] ? '.' + m[3] : '')), t0 = performance.now(), dur = 900;
    setTimeout(function () { if (n._cu) { tn.nodeValue = txt; n._cu = 0; } }, dur + 400); // safety: frames can pause in background tabs
    (function step(now) { var k = Math.min(1, (now - t0) / dur), e = 1 - Math.pow(1 - k, 3); tn.nodeValue = f(target * e, dec); if (k < 1) requestAnimationFrame(step); else { tn.nodeValue = txt; n._cu = 0; } })(t0);
  });
}
function initReveal() {
  if (REDUCED || !('IntersectionObserver' in window)) return;
  var io = new IntersectionObserver(function (es) { es.forEach(function (e) { if (e.isIntersecting) { e.target.classList.add('vis'); io.unobserve(e.target); } }); }, { rootMargin: '0px 0px -8% 0px', threshold: 0.06 });
  [].forEach.call(document.querySelectorAll('main > section, main > .fw-sec'), function (el, i) { if (i < 2) return; el.classList.add('reveal'); io.observe(el); });
}

/* ---------- map ---------- */
var map = null, siteLayer, refLayer, markers = {};
function initMap() {
  if (!window.L) { document.getElementById('map').innerHTML = '<div class="empty">โหลดแผนที่ไม่สำเร็จ</div>'; return; }
  map = L.map('map', { zoomControl: true, attributionControl: true, scrollWheelZoom: false }).setView([13.9, 100.6], 6);
  var layerCtl = L.control.layers(null, null, { position: 'topright', collapsed: true }).addTo(map);
  L.geoJSON(window.REGION_GEO, { style: function (ft) { return { className: ft.properties.th ? 'geo-th' : 'geo-nb', weight: ft.properties.th ? 1.2 : .6 }; }, interactive: false }).addTo(map);
  // base maps (road / satellite / terrain) where the host allows map tiles; the outline map stays underneath otherwise
  var probe = new Image();
  probe.onload = function () {
    var esriA = 'Tiles &copy; Esri — Esri, HERE, Garmin, &copy; OpenStreetMap contributors';
    var clean = L.layerGroup([L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Light_Gray_Base/MapServer/tile/{z}/{y}/{x}', { maxZoom: 16, attribution: esriA }),
      L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Light_Gray_Reference/MapServer/tile/{z}/{y}/{x}', { maxZoom: 16, pane: 'shadowPane', opacity: .9 })]);
    var road = L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 18, attribution: '&copy; OpenStreetMap contributors' });
    var sat = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', { maxZoom: 18, attribution: 'Imagery &copy; Esri' });
    var topo = L.tileLayer('https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png', { maxZoom: 17, attribution: '&copy; OpenTopoMap (CC-BY-SA)' });
    clean.addTo(map);
    layerCtl.addBaseLayer(clean, 'แผนที่สีอ่อน'); layerCtl.addBaseLayer(road, 'แผนที่ถนน'); layerCtl.addBaseLayer(sat, 'ดาวเทียม'); layerCtl.addBaseLayer(topo, 'ภูมิประเทศ');
    document.documentElement.classList.add('has-tiles');
  };
  probe.src = 'https://tile.openstreetmap.org/6/50/29.png';
  map.attributionControl.addAttribution('ข้อมูลน้ำ: สสน. · กรมชลประทาน · กฟผ. · DCCE');
  pinDefs(); map.createPane('rainPane').style.zIndex = 390;
  var rainLayer = L.layerGroup().addTo(map), stnLayer = L.layerGroup().addTo(map);
  refLayer = L.layerGroup().addTo(map);
  var damLayer = L.layerGroup().addTo(map);
  // overlays only near SCGP sites so the map reads as "what surrounds our factories"
  function nearAny(x, r) { return SITES.some(function (s) { return hv(s.lat, s.lng, x.lat, x.lng) <= r; }); }
  state.data.rain.filter(function (x) { return fresh(x.t) && x.v >= 1 && nearAny(x, 30); }).forEach(function (x) {
    var l = lvlBy(x.v, CRITERIA.rain.bands);
    L.circleMarker([x.lat, x.lng], { pane: 'rainPane', radius: Math.min(26, 4 + Math.sqrt(x.v) * 2.2), className: 'rain-mk r' + (l || 0), weight: 0 })
      .addTo(rainLayer).on('add', function () {}); hoverCard(rainLayer.getLayers()[rainLayer.getLayers().length - 1], function () { return rainCard(x); }, [x.lat, x.lng]);
  });
  state.data.wl.filter(function (x) { return fresh(x.t) && x.pct != null && nearAny(x, 25); }).forEach(function (x) {
    var l = lvlBy(x.pct, CRITERIA.bank.bands);
    L.marker([x.lat, x.lng], { icon: L.divIcon({ className: '', html: dropHTML(l), iconSize: [18, 24], iconAnchor: [9, 22] }), keyboard: false })
      .addTo(stnLayer); hoverCard(stnLayer.getLayers()[stnLayer.getLayers().length - 1], function () { return stationCard(x); }, [x.lat, x.lng]);
  });
  var used = {}; SITES.forEach(function (s) { s.dams.forEach(function (d) { used[d] = 1; }); });
  state.data.dam.filter(function (d) { return used[d.name]; }).forEach(function (d) {
    var l = damLevel(d), p = Math.max(0, Math.min(100, d.pct || 0));
    L.marker([d.lat, d.lng], { icon: L.divIcon({ className: '', html: damHTML(l, p, d.pct), iconSize: [44, 40], iconAnchor: [22, 34] }), keyboard: false })
      .addTo(damLayer); hoverCard(damLayer.getLayers()[damLayer.getLayers().length - 1], function () { return damCard(d); }, [d.lat, d.lng]);
  });
  siteLayer = L.layerGroup().addTo(map);
  [['พื้นที่ SCGP', siteLayer], ['เขื่อน (% ความจุ)', damLayer], ['สถานีระดับน้ำ (% ตลิ่ง)', stnLayer], ['ฝนสะสม 24 ชม.', rainLayer]].forEach(function (x) { layerCtl.addOverlay(x[1], x[0]); });
  var all = L.control({ position: 'bottomleft' });
  all.onAdd = function () { var b = L.DomUtil.create('button', 'btn map-btn'); b.type = 'button'; b.textContent = '⤢ ดูทุกพื้นที่'; L.DomEvent.on(b, 'click', function (ev) { L.DomEvent.stop(ev); fitAll(); }); return b; };
  all.addTo(map);
  var leg = L.control({ position: 'bottomright' });
  leg.onAdd = function () {
    var d = L.DomUtil.create('div', 'map-legend'); L.DomEvent.disableClickPropagation(d);
    d.innerHTML = '<details' + (window.matchMedia('(max-width:640px)').matches ? '' : ' open') + '><summary>คำอธิบายแผนที่</summary>' +
      '<div class="lg-sub">โรงงาน</div><div class="lg-row"><span class="lg-ic lg-fac">' + siteIcon({ id: '_lg', name: '', prov: '', zone: 'up' }, true) + '</span><span><b>หมุดโรงงาน SCGP</b><br>สีหมุด = สถานะรวม · วงแหวน 7 ช่อง = Trigger 1–7</span></div>' +
      '<div class="lg-sub">แหล่งน้ำ (สีน้ำเงิน)</div>' +
      '<div class="lg-row"><span class="lg-ic">' + damHTML(1, 70, 70) + '</span><span><b>เขื่อน</b> · ระดับน้ำในอ่าง = % ความจุ</span></div>' +
      '<div class="lg-row"><span class="lg-ic">' + dropHTML(0) + '</span><span><b>สถานีวัดระดับน้ำ</b> · ขอบสี = % ตลิ่ง</span></div>' +
      '<div class="lg-row"><i class="lg-rain"></i><span><b>ฝน 24 ชม.</b> · ขนาดตามปริมาณ</span></div>' +
      '<div class="lg-scale"><span class="spill s0">ปกติ</span><span class="spill s1">เฝ้าระวัง</span><span class="spill s2">เตือนภัย</span><span class="spill s3">วิกฤต</span></div></details>';
    return d;
  };
  leg.addTo(map);
  map.on('zoomend', function () { var z = map.getZoom(), el = document.getElementById('map'); el.classList.toggle('show-labels', z >= 9); el.classList.toggle('zoom-lo', z <= 6); if (lastMarkerList) layoutPins(); });
  fitAll();
}
var cardEl = null, cardHide = null, cardFor = null;
function cardBox() {
  if (cardEl) return cardEl;
  var host = document.getElementById('map').parentNode; host.style.position = 'relative';
  cardEl = document.createElement('div'); cardEl.className = 'mfloat'; cardEl.setAttribute('role', 'tooltip'); host.appendChild(cardEl);
  cardEl.addEventListener('mouseenter', function () { clearTimeout(cardHide); });
  cardEl.addEventListener('mouseleave', function () { hideCard(); });
  map.on('movestart zoomstart', function () { hideCard(true); });
  return cardEl;
}
function showCard(html, latlng, owner, onClick) {
  var el = cardBox(); clearTimeout(cardHide);
  el.innerHTML = html; el.onclick = onClick || null; el.style.cursor = onClick ? 'pointer' : '';
  cardFor = owner;
  var mapEl = document.getElementById('map'), mr = mapEl.getBoundingClientRect(), hr = el.parentNode.getBoundingClientRect();
  var pt = map.latLngToContainerPoint(latlng), ox = mr.left - hr.left, oy = mr.top - hr.top;
  el.style.maxHeight = (mr.height - 16) + 'px';
  el.classList.add('on');
  var w = el.offsetWidth, h = el.offsetHeight, gap = 26;
  var left = pt.x + gap + w <= mr.width - 8 ? pt.x + gap : pt.x - gap - w;
  if (left < 8) left = Math.max(8, Math.min(mr.width - w - 8, pt.x - w / 2));
  var top = Math.max(8, Math.min(mr.height - h - 8, pt.y - h * 0.35));
  el.style.left = (ox + left) + 'px'; el.style.top = (oy + top) + 'px';
  el.classList.toggle('from-left', left < pt.x);
  replay(el, 'enter');
  countUp(el.querySelectorAll('.mc-big b'));
}
function hideCard(now) { clearTimeout(cardHide); var go = function () { if (cardEl) cardEl.classList.remove('on'); cardFor = null; }; if (now) go(); else cardHide = setTimeout(go, 160); }
function hoverCard(m, fn, ll, onClick) {
  var touch = window.matchMedia('(hover: none)').matches;
  m.on('mouseover', function () { showCard(fn(), ll, m, onClick); }).on('mouseout', function () { hideCard(); });
  if (touch) m.on('click', function () { if (cardFor === m && onClick) return; showCard(fn(), ll, m, onClick); });
  return m;
}
/* water-family symbols: always blue so they read apart from factory pins */
function dropHTML(l) {
  return '<svg class="drop-mk ' + sc(l) + '" width="18" height="24" viewBox="0 0 18 24"><path d="M9 1.5C9 1.5 2 10 2 14.5a7 7 0 0 0 14 0C16 10 9 1.5 9 1.5z" fill="url(#wd-g)" stroke-width="2.2" style="stroke:var(--c)"/><path d="M6 14.5a3 3 0 0 0 2 2.8" fill="none" stroke="#fff" stroke-width="1.4" stroke-linecap="round" opacity=".8"/></svg>';
}
function damHTML(l, p, pct) {
  var h = Math.max(2, Math.min(18, p / 100 * 18));
  return '<div class="damx ' + sc(l) + '"><svg width="44" height="40" viewBox="0 0 44 40">' +
    '<path d="M2 8 H26 V30 H2 Z" fill="#DCEBF5"/><rect class="dam-water" x="2" y="' + (30 - h) + '" width="24" height="' + h + '" fill="url(#wd-g)"/>' +
    '<path d="M2 ' + (30 - h) + ' q3 -1.5 6 0 t6 0 t6 0 t6 0" fill="none" stroke="#fff" stroke-width="1" opacity=".8"/>' +
    '<path d="M24 6 L32 6 L38 32 L24 32 Z" fill="#7C93A8"/><path d="M24 6 L27 6 L27 32 L24 32 Z" fill="#5B7186"/>' +
    '<path class="spill-jet" d="M36 26 q4 3 5 9" fill="none" stroke="#5FB4E8" stroke-width="2.4" stroke-linecap="round"/>' +
    '<rect x="0" y="32" width="44" height="3" rx="1.5" fill="#5B7186" opacity=".5"/>' +
    '<circle cx="36" cy="6" r="5" style="fill:var(--c)" stroke="#fff" stroke-width="1.6"/></svg>' +
    '<span class="damx-l">' + f(pct, 0) + '%</span></div>';
}
/* keep factory pins from overlapping: group pins closer than ~44 px and fan them out round their centre with leader lines */
var lastMarkerList = null, leaderLayer = null;
function layoutPins() {
  if (!map || !lastMarkerList) return;
  if (!leaderLayer) leaderLayer = L.layerGroup().addTo(map);
  leaderLayer.clearLayers();
  var lo = map.getZoom() <= 6, D = lo ? 34 : 44;
  var pts = lastMarkerList.map(function (s) { return { s: s, p: map.latLngToLayerPoint([s.lat, s.lng]) }; });
  var used = {}, groups = [];
  pts.forEach(function (a, i) {
    if (used[i]) return; var g = [a]; used[i] = 1;
    for (var grow = true; grow;) { grow = false; pts.forEach(function (b, j) { if (used[j]) return; if (g.some(function (c) { return c.p.distanceTo(b.p) < D; })) { g.push(b); used[j] = 1; grow = true; } }); }
    groups.push(g);
  });
  groups.forEach(function (g) {
    var m0 = markers[g[0].s.id];
    g.forEach(function (a) { var mm = markers[a.s.id], el = mm && mm.getElement(); if (el) el.style.display = ''; });
    if (g.length === 1) { if (m0) m0.setLatLng([g[0].s.lat, g[0].s.lng]); return; }
    if (g.length > 6) {
      // too many to fan out legibly: one cluster bubble with a status donut; click zooms in
      var c = [0, 0, 0, 0, 0], lat = 0, lng = 0;
      g.forEach(function (a) { var l = state.evals[a.s.id].overall; c[l == null ? 4 : l]++; lat += a.s.lat; lng += a.s.lng; var mm = markers[a.s.id], el = mm && mm.getElement(); if (el) el.style.display = 'none'; mm.setLatLng([a.s.lat, a.s.lng]); });
      var tot = g.length, acc = 0, cols = ['var(--ok)', 'var(--watch)', 'var(--warn)', 'var(--crit)', 'var(--na)'], seg = '';
      [3, 2, 1, 0, 4].forEach(function (k) { if (!c[k]) return; var a0 = acc / tot * 2 * Math.PI - Math.PI / 2, a1 = (acc + c[k]) / tot * 2 * Math.PI - Math.PI / 2; acc += c[k];
        var big = a1 - a0 > Math.PI ? 1 : 0; seg += c[k] === tot ? '<circle cx="28" cy="28" r="23" fill="none" stroke-width="7" style="stroke:' + cols[k] + '"/>' : '<path d="M' + (28 + 23 * Math.cos(a0)).toFixed(2) + ',' + (28 + 23 * Math.sin(a0)).toFixed(2) + ' A23,23 0 ' + big + ' 1 ' + (28 + 23 * Math.cos(a1)).toFixed(2) + ',' + (28 + 23 * Math.sin(a1)).toFixed(2) + '" fill="none" stroke-width="7" style="stroke:' + cols[k] + '"/>'; });
      var worst = [3, 2, 1, 0].filter(function (k) { return c[k]; })[0];
      var html = '<div class="clu s' + (worst == null ? 'n' : worst) + '"><svg width="56" height="56" viewBox="0 0 56 56">' + seg + '<circle cx="28" cy="28" r="18" fill="url(#pg-' + (worst == null ? 'sn' : 's' + worst) + ')" stroke="#fff" stroke-width="2"/><text x="28" y="31" text-anchor="middle" class="clu-n">' + tot + '</text><text x="28" y="40.5" text-anchor="middle" class="clu-t">พื้นที่</text></svg></div>';
      var ll = L.latLng(lat / tot, lng / tot), bnds = L.latLngBounds(g.map(function (a) { return [a.s.lat, a.s.lng]; }));
      var cm = L.marker(ll, { icon: L.divIcon({ className: '', html: html, iconSize: [56, 56], iconAnchor: [28, 28] }), zIndexOffset: 2000, keyboard: true, alt: tot + ' พื้นที่ SCGP' }).addTo(leaderLayer);
      cm.on('click', function () { hideCard(true); map.fitBounds(bnds.pad(0.25), { maxZoom: 11 }); });
      cm.on('mouseover', function () { showCard('<div class="mc"><div class="mc-h"><div><div class="mc-eyebrow">กลุ่มพื้นที่ใกล้กัน · คลิกเพื่อซูมเข้า</div><div class="mc-title">' + tot + ' พื้นที่ SCGP</div></div></div><div class="mc-sec clu-list">' + g.slice().sort(function (a, b) { return (state.evals[b.s.id].overall || 0) - (state.evals[a.s.id].overall || 0); }).map(function (a) { var l = state.evals[a.s.id].overall; return '<div class="' + sc(l) + '"><i></i><span>' + esc(a.s.name) + '</span><b>' + lname(l) + '</b></div>'; }).join('') + '</div></div>', ll, cm, function () { hideCard(true); map.fitBounds(bnds.pad(0.25), { maxZoom: 11 }); }); })
        .on('mouseout', function () { hideCard(); });
      return;
    }
    var cx = 0, cy = 0; g.forEach(function (a) { cx += a.p.x; cy += a.p.y; }); cx /= g.length; cy /= g.length;
    var R = Math.max(D * 0.95, D * g.length / (2 * Math.PI) * 1.15);
    g.sort(function (a, b) { return Math.atan2(a.p.y - cy, a.p.x - cx) - Math.atan2(b.p.y - cy, b.p.x - cx); });
    L.circleMarker(map.layerPointToLatLng([cx, cy]), { radius: 4, className: 'hub-mk', interactive: false }).addTo(leaderLayer);
    g.forEach(function (a, k) {
      var ang = -Math.PI / 2 + k * 2 * Math.PI / g.length, np = L.point(cx + R * Math.cos(ang), cy + R * Math.sin(ang) + (lo ? 12 : 16));
      var ll = map.layerPointToLatLng(np), m = markers[a.s.id];
      if (m) m.setLatLng(ll);
      L.polyline([[a.s.lat, a.s.lng], ll], { className: 'leader-line', weight: 1.4, interactive: false }).addTo(leaderLayer);
      L.circleMarker([a.s.lat, a.s.lng], { radius: 3, className: 'true-mk ' + sc(state.evals[a.s.id].overall), interactive: false }).addTo(leaderLayer);
    });
  });
}
function fitAll() { if (map) map.invalidateSize(), map.fitBounds(L.latLngBounds(SITES.map(function (s) { return [s.lat, s.lng]; })).pad(0.15)); }

/* 7-segment trigger ring: one arc per Trigger, coloured by its level */
function ringPaths(e, cx, cy, r, w) {
  var o = '', gap = 0.09, seg = Math.PI * 2 / 7;
  for (var n = 1; n <= 7; n++) {
    var a0 = -Math.PI / 2 + (n - 1) * seg + gap / 2, a1 = a0 + seg - gap;
    var x0 = cx + r * Math.cos(a0), y0 = cy + r * Math.sin(a0), x1 = cx + r * Math.cos(a1), y1 = cy + r * Math.sin(a1);
    var l = e[n] ? e[n].l : null;
    o += '<path d="M' + x0.toFixed(2) + ',' + y0.toFixed(2) + ' A' + r + ',' + r + ' 0 0 1 ' + x1.toFixed(2) + ',' + y1.toFixed(2) + '" fill="none" stroke-width="' + w + '" stroke-linecap="butt" style="stroke:' + (l == null ? 'var(--line)' : 'var(--' + ['ok', 'watch', 'warn', 'crit'][l] + ')') + '"/>';
  }
  return o;
}
/* 3-D map pin: glossy teardrop in the status colour, trigger ring round the head, isometric factory with smoke, soft ground shadow */
function pinDefs() {
  if (document.getElementById('pinDefs')) return;
  var lv = [['s0', 'ok'], ['s1', 'watch'], ['s2', 'warn'], ['s3', 'crit'], ['sn', 'muted']];
  var d = '<svg id="pinDefs" width="0" height="0" style="position:absolute" aria-hidden="true"><defs>' + lv.map(function (q) {
    return '<linearGradient id="pg-' + q[0] + '" x1="0" y1="0" x2=".35" y2="1"><stop offset="0" style="stop-color:color-mix(in srgb,var(--' + q[1] + ') 62%,#fff)"/><stop offset=".55" style="stop-color:var(--' + q[1] + ')"/><stop offset="1" style="stop-color:color-mix(in srgb,var(--' + q[1] + ') 70%,#000)"/></linearGradient>';
  }).join('') + '<radialGradient id="pg-face" cx=".4" cy=".35" r=".75"><stop offset="0" stop-color="#fff"/><stop offset="1" stop-color="#DCE6EC"/></radialGradient>' +
    '<linearGradient id="wd-g" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#7CC8F2"/><stop offset="1" stop-color="#1F6FB2"/></linearGradient>' +
    '<radialGradient id="pg-shadow"><stop offset="0" stop-color="#000" stop-opacity=".45"/><stop offset="1" stop-color="#000" stop-opacity="0"/></radialGradient></defs></svg>';
  document.body.insertAdjacentHTML('afterbegin', d);
}
function siteIcon(s, legendOnly) {
  pinDefs();
  var e = legendOnly ? { overall: 1, 1: { l: 0 }, 2: { l: 0 }, 3: { l: 1 }, 4: { l: 2 }, 5: { l: 0 }, 6: { l: null }, 7: { l: 3 } } : state.evals[s.id], sel = state.sel === s.id, k = sc(e.overall), W = 60, H = 76, cx = 30, cy = 28;
  var short = s.name.replace(/^(SCGP|TCG|TBSP|Siam|Thai)\s+/, '').slice(0, 22);
  var svg = '<svg class="pin3d" width="' + W + '" height="' + H + '" viewBox="0 0 ' + W + ' ' + H + '">' +
    '<ellipse class="pin-shadow" cx="30" cy="70" rx="13" ry="4" fill="url(#pg-shadow)"/>' +
    (e.overall >= 2 ? '<ellipse class="pin-ripple" cx="30" cy="70" rx="13" ry="4" fill="none" style="stroke:var(--c)" stroke-width="2"/>' : '') +
    '<g class="pin-body">' +
    ringPaths(e, cx, cy, 26, 4) +
    '<path d="M30 68 C24 55 9 46 9 28 A21 21 0 1 1 51 28 C51 46 36 55 30 68Z" fill="url(#pg-' + k + ')" stroke="#fff" stroke-width="1.6"/>' +
    '<ellipse cx="22" cy="16" rx="9" ry="5" fill="#fff" opacity=".38" transform="rotate(-28 22 16)"/>' +
    '<circle cx="30" cy="28" r="14.5" fill="url(#pg-face)" stroke="rgba(0,0,0,.12)" stroke-width=".8"/>' +
    // isometric factory: front (sawtooth), side, chimney with smoke
    '<g class="fac">' +
    '<polygon points="20,36 31,36 31,28.5 27.3,31 27.3,28.5 23.6,31 23.6,28.5 20,31" fill="#1E3F66"/>' +
    '<polygon points="31,36 38.5,32.5 38.5,25.5 31,28.5" fill="#3E78B5"/>' +
    '<polygon points="20,31 23.6,28.5 23.6,31 27.3,28.5 27.3,31 31,28.5 38.5,25.5 34.9,24.5 27.3,27.2 27.3,25 23.6,27.4 23.6,25.6 20,28" fill="#7FB0DD"/>' +
    '<rect x="33.4" y="18" width="2.6" height="8.6" fill="#1E3F66"/><rect x="33" y="17.3" width="3.4" height="1.4" rx=".4" fill="#D03030"/>' +
    '<rect x="21.4" y="32.4" width="2" height="2" fill="#F0B040"/><rect x="25" y="32.4" width="2" height="2" fill="#F0B040"/><rect x="28.4" y="32.4" width="1.6" height="2" fill="#F0B040"/>' +
    '<circle class="smoke s1" cx="34.7" cy="15.2" r="1.7"/><circle class="smoke s2" cx="34.7" cy="15.2" r="1.4"/></g>' +
    '</g></svg>';
  if (legendOnly) return '<span class="site-pin s1" style="width:30px;height:38px"><svg viewBox="0 0 60 76" width="30" height="38">' + svg.replace(/^<svg[^>]*>/, '').replace(/<\/svg>$/, '') + '</svg></span>';
  var h = '<div class="site-pin ' + k + (sel ? ' sel' : '') + (e.overall >= 2 ? ' alarm' : '') + '">' + svg + '<span class="pin-lbl">' + esc(short) + '</span></div>';
  return L.divIcon({ className: '', html: h, iconSize: [W, H], iconAnchor: [30, 70] });
}
function updateMarkers(list) {
  siteLayer.clearLayers(); markers = {};
  var touch = window.matchMedia('(hover: none)').matches;
  list.forEach(function (s) {
    var open = function () { select(s.id, true); hideCard(true); document.getElementById('h-near').scrollIntoView({ behavior: 'smooth', block: 'start' }); };
    var m = L.marker([s.lat, s.lng], { icon: siteIcon(s), riseOnHover: true, zIndexOffset: state.sel === s.id ? 1000 : (state.evals[s.id].overall || 0) * 100, keyboard: true, alt: s.name })
      .on('mouseover', function () { showRefs(s); showCard(siteCard(s), m.getLatLng(), m, open); })
      .on('mouseout', function () { hideCard(); var cur = SITES.filter(function (x) { return x.id === state.sel; })[0]; if (cur) showRefs(cur); })
      .on('click', function () {
        if (touch && cardFor !== m) { showRefs(s); showCard(siteCard(s), m.getLatLng(), m, open); return; } // first tap previews, second tap opens
        open();
      });
    m.addTo(siteLayer); markers[s.id] = m;
  });
  lastMarkerList = list; layoutPins();
}
function showRefs(s) {
  if (!refLayer) return;
  refLayer.clearLayers();
  var e = state.evals[s.id];
  [3, 4, 5, 6, 7].forEach(function (n) { (e[n].geo || []).forEach(function (g) {
    L.polyline([[s.lat, s.lng], [g.lat, g.lng]], { className: 'ref-line', weight: 1.5, dashArray: '4 5', interactive: false }).addTo(refLayer);
    L.marker([g.lat, g.lng], { icon: L.divIcon({ className: '', html: '<span class="ref-tag ' + sc(e[n].l) + '">T' + n + '</span>', iconSize: [24, 16], iconAnchor: [12, 8] }), interactive: false }).addTo(refLayer);
  }); });
}

/* ---------- hover cards ---------- */
function barHTML(pct, mark) {
  var p = pct == null ? 0 : Math.max(0, Math.min(125, pct)) / 1.25;
  return '<div class="mc-bar ' + sc(lvlBy(pct, CRITERIA.bank.bands)) + '"><span style="width:' + p + '%"></span>' + (mark != null ? '<i style="left:' + mark / 1.25 + '%"></i>' : '') + '<em style="left:80%"></em></div>';
}
function driverOf(s) {
  var e = state.evals[s.id], prim = ZONE_TRIG[s.zone], best = null;
  for (var n = 1; n <= 7; n++) { var l = e[n].l; if (l == null) continue; var k = l * 10 + (prim.indexOf(n) >= 0 ? 1 : 0); if (!best || k > best.k) best = { n: n, k: k, r: e[n] }; }
  return best;
}
function siteCard(s) {
  var e = state.evals[s.id], st = refStation(s), c = climOf(s), dr = driverOf(s), o = '';
  o += '<div class="mc-h ' + sc(e.overall) + '"><div><div class="mc-eyebrow">' + esc(ZONES[s.zone] + ' · จ.' + s.prov + ' อ.' + s.amp) + '</div><div class="mc-title">' + esc(s.name) + '</div></div><span class="spill ' + sc(e.overall) + '">' + icon(LVL_ICON[e.overall] || 'shield') + lname(e.overall) + '</span></div>';
  if (st) {
    var tr = trendOf(st), left = st.minBank != null ? st.minBank - st.msl : null;
    o += '<div class="mc-sec"><div class="mc-lbl">ระดับน้ำอ้างอิง · ' + esc(st.code + ' ' + st.name) + '</div>' +
      '<div class="mc-big"><b class="num">' + f(st.msl) + '</b><small>ม.รทก.</small><span class="mc-tr">' + trendTxt(tr) + '</span></div>' +
      barHTML(st.pct) + '<div class="mc-foot"><span>' + f(st.pct, 0) + '% ของตลิ่ง</span><span>' + (left == null ? '' : left < 0 ? 'ล้นตลิ่ง ' + f(-left) + ' ม.' : 'เหลือ ' + f(left) + ' ม. ถึงตลิ่ง') + '</span></div>' +
      '<div class="mc-spark">' + sparkline(st) + '<span>24 ชม.</span></div></div>';
  }
  o += '<div class="mc-sec"><div class="mc-lbl">7 Risk Trigger Point</div><div class="mc-trig">' + TRIGGERS.map(function (t) {
    var r = e[t.n]; return '<span class="mc-t ' + sc(r.l) + (ZONE_TRIG[s.zone].indexOf(t.n) >= 0 ? ' prim' : '') + '" title="' + esc(t.th) + '">' + icon(TRIG_ICON[t.n]) + '<b>' + t.n + '</b></span>';
  }).join('') + '</div>';
  if (dr && dr.r.l > 0) o += '<div class="mc-drv">สาเหตุหลัก: <b>T' + dr.n + ' ' + esc(TRIGGERS[dr.n - 1].th) + '</b> · ' + dr.r.v + ' ' + esc(dr.r.u) + '</div>';
  else o += '<div class="mc-drv muted">ทุก Trigger ที่มีข้อมูลอยู่ในเกณฑ์ปกติ</div>';
  o += '</div>';
  var r5 = e[5];
  o += '<div class="mc-sec mc-grid">';
  o += '<div>' + icon('rain') + '<span><small>ฝน 24 ชม. ใกล้สุด</small><b class="num">' + (r5.l == null ? '–' : r5.v + ' มม.') + '</b>' + (c && r5.l != null ? '<small>' + f(parseFloat(String(r5.v).replace(/,/g, '')) / c.RX1day.hist * 100, 0) + '% ของ RX1day จังหวัด</small>' : '') + '</span></div>';
  if (c) { var p = state.climP; o += '<div>' + icon('tide') + '<span><small>ฝนสูงสุด 1 วัน ' + esc(CLIM.periods[p]) + '</small><b class="num">' + f(c.RX1day.ssp585[p], 0) + ' มม.</b><small>SSP5-8.5 ' + dChip(c.RX1day.ssp585[p], c.RX1day.hist) + '</small></span></div>'; }
  o += '</div>';
  o += '<div class="mc-cos">' + icon('factory') + '<span>' + s.cos.slice(0, 3).map(esc).join(' · ') + (s.cos.length > 3 ? ' +' + (s.cos.length - 3) : '') + '</span></div>';
  o += '<div class="mc-cta">' + (window.matchMedia('(hover: none)').matches ? 'แตะอีกครั้ง' : 'คลิก') + 'เพื่อดูรายละเอียดเต็ม' + (st && st.t ? ' · ข้อมูล ' + fmtT(st.t) : '') + '</div>';
  return '<div class="mc">' + o + '</div>';
}
function damCard(d) {
  var l = damLevel(d), g = state.data.egat && state.data.egat.byName[d.name];
  var o = '<div class="mc-h ' + sc(l) + '"><div><div class="mc-eyebrow">เขื่อน · Trigger 1–2</div><div class="mc-title">เขื่อน' + esc(d.name) + '</div></div><span class="spill ' + sc(l) + '">' + lname(l) + '</span></div>';
  o += '<div class="mc-sec"><div class="mc-lbl">ปริมาตรน้ำ (% ความจุปกติ)</div><div class="mc-big"><b class="num">' + f(d.pct, 1) + '</b><small>%</small><span class="mc-tr">' + f(d.st, 0) + ' / ' + f(d.norm, 0) + ' ล้าน ลบ.ม.</span></div>' + barHTML(d.pct, g && g.upper ? g.upper : null) +
    '<div class="mc-foot"><span>' + (g && g.upper ? '▮ เส้นดำ = เกณฑ์ควบคุมบน (URC) ' + f(g.upper, 1) + '%' : 'เส้นประ = 80% เฝ้าระวัง') + '</span></div></div>';
  o += '<div class="mc-sec mc-grid"><div>' + icon('drop') + '<span><small>น้ำไหลเข้า</small><b class="num">' + f(d.inf, 2) + '</b><small>ล้าน ลบ.ม./วัน</small></span></div><div>' + icon('release') + '<span><small>น้ำระบาย</small><b class="num">' + f(d.rel, 2) + '</b><small>ล้าน ลบ.ม./วัน' + (d.spill > 0 ? ' · มีน้ำล้นทางระบาย' : '') + '</small></span></div></div>';
  var sites = SITES.filter(function (s) { return s.dams.indexOf(d.name) >= 0; });
  o += '<div class="mc-cos">' + icon('factory') + '<span>ส่งผลต่อ ' + sites.length + ' พื้นที่: ' + sites.slice(0, 3).map(function (s) { return esc(s.name); }).join(', ') + (sites.length > 3 ? ' …' : '') + '</span></div>';
  o += '<div class="mc-cta">กรมชลประทาน' + (g ? ' · กฟผ.' : '') + ' · ' + esc(d.date || '') + '</div>';
  return '<div class="mc">' + o + '</div>';
}
function stationCard(x) {
  var l = lvlBy(x.pct, CRITERIA.bank.bands), left = x.minBank != null ? x.minBank - x.msl : null, tr = x.prev == null ? null : x.msl - x.prev;
  var o = '<div class="mc-h ' + sc(l) + '"><div><div class="mc-eyebrow">สถานีวัดระดับน้ำ · ' + esc(x.ag + ' ' + x.code) + '</div><div class="mc-title">' + esc(x.name) + '</div></div><span class="spill ' + sc(l) + '">' + lname(l) + '</span></div>';
  o += '<div class="mc-sec"><div class="mc-lbl">' + esc((x.river || '') + (x.prov ? ' · จ.' + x.prov : '')) + '</div><div class="mc-big"><b class="num">' + f(x.msl) + '</b><small>ม.รทก.</small><span class="mc-tr">' + trendTxt(tr, 'ม.') + '</span></div>' + barHTML(x.pct) +
    '<div class="mc-foot"><span>' + f(x.pct, 0) + '% ของตลิ่ง (' + f(x.minBank) + ' ม.)</span><span>' + (left == null ? '' : left < 0 ? 'ล้น ' + f(-left) + ' ม.' : 'เหลือ ' + f(left) + ' ม.') + '</span></div></div>';
  var near1 = SITES.map(function (s) { return { s: s, d: hv(s.lat, s.lng, x.lat, x.lng) }; }).sort(function (a, b) { return a.d - b.d; })[0];
  o += '<div class="mc-cos">' + icon('factory') + '<span>ใกล้ ' + esc(near1.s.name) + ' · ' + km(near1.d) + '</span></div><div class="mc-cta">' + fmtT(x.t) + '</div>';
  return '<div class="mc">' + o + '</div>';
}
function rainCard(x) {
  var l = lvlBy(x.v, CRITERIA.rain.bands);
  var o = '<div class="mc-h ' + sc(l) + '"><div><div class="mc-eyebrow">สถานีวัดฝน · Trigger 5</div><div class="mc-title">' + esc(x.name) + '</div></div><span class="spill ' + sc(l) + '">' + (x.v > 90 ? 'หนักมาก' : x.v > 35 ? 'หนัก' : x.v > 10 ? 'ปานกลาง' : 'เล็กน้อย') + '</span></div>';
  o += '<div class="mc-sec"><div class="mc-big"><b class="num">' + f(x.v, 1) + '</b><small>มม. / 24 ชม.</small></div>' + barHTML(x.v / 150 * 100) + '<div class="mc-foot"><span>35 หนัก · 90 หนักมาก · 150 วิกฤต</span></div></div><div class="mc-cta">คลังข้อมูลน้ำแห่งชาติ · ' + fmtT(x.t) + '</div>';
  return '<div class="mc">' + o + '</div>';
}
function mapTo(id) {
  var s = SITES.filter(function (x) { return x.id === id; })[0]; if (!s || !map) return;
  document.getElementById('mapSec').scrollIntoView({ behavior: 'smooth', block: 'start' });
  showRefs(s); map.setView([s.lat, s.lng], 11); setTimeout(function () { showCard(siteCard(s), [s.lat, s.lng], markers[s.id], null); }, 450);
}

/* ---------- history (สสน. waterlevel_graph via /api/history) ---------- */
async function loadHistory(range) {
  var ids = []; SITES.forEach(function (s) { var st = refStation(s); if (st && ids.indexOf(st.id) < 0) ids.push(st.id); });
  if (!ids.length || state.hist[range]) return;
  state.histLoading = true;
  try {
    var r = await fetchT('api/history?range=' + range + '&stations=' + ids.join(','), 30000);
    if (!r.ok || !/json/.test(r.headers.get('content-type') || '')) throw new Error('history ' + r.status);
    state.hist[range] = await r.json(); state.histErr = false;
  } catch (e) { state.histErr = true; }
  state.histLoading = false;
}
async function refreshHistory() {
  await loadHistory(state.range); if (state.range !== '1D') await loadHistory('1D');
  renderFeatured(); renderList(); renderHourTable();
}

/* ---------- near me (geolocation) ---------- */
function locate() {
  if (!navigator.geolocation) { state.near = { denied: true }; renderFeatured(); return; }
  navigator.geolocation.getCurrentPosition(function (p) {
    var best = null; SITES.forEach(function (s) { var d = hv(p.coords.latitude, p.coords.longitude, s.lat, s.lng); if (!best || d < best.d) best = { site: s, d: d }; });
    state.near = best; if (!state.userPicked) { state.sel = best.site.id; renderAllForSel(); }
    else renderFeatured();
  }, function () { state.near = { denied: true }; renderFeatured(); }, { timeout: 8000, maximumAge: 600000 });
}

/* ---------- interactions ---------- */
function renderAllForSel() {
  renderProfile(); renderSchematic(); renderFeatured(); renderList();
  var s = SITES.filter(function (x) { return x.id === state.sel; })[0]; if (s) showRefs(s);
}
function select(id, user) {
  state.sel = id; if (user) state.userPicked = true;
  renderAllForSel();
}
function rerender() { renderSidebar(); renderProfile(); renderSchematic(); renderTrigCards(); renderKpis(); renderFilters(); renderFeatured(); renderList(); renderHourTable(); }

/* trigger cards: pointer tilt + spotlight, click/Enter to expand thresholds */
document.addEventListener('pointermove', function (ev) {
  var c = ev.target.closest && ev.target.closest('.tbox'); if (!c || REDUCED || ev.pointerType !== 'mouse') return;
  var r = c.getBoundingClientRect(), x = (ev.clientX - r.left) / r.width, y = (ev.clientY - r.top) / r.height;
  c.style.setProperty('--mx', (x * 100).toFixed(1) + '%'); c.style.setProperty('--my', (y * 100).toFixed(1) + '%');
  if (!c.classList.contains('open')) c.style.transform = 'perspective(900px) rotateX(' + ((0.5 - y) * 5).toFixed(2) + 'deg) rotateY(' + ((x - 0.5) * 6).toFixed(2) + 'deg) translateY(-3px)';
});
document.addEventListener('pointerout', function (ev) { var c = ev.target.closest && ev.target.closest('.tbox'); if (c && !c.contains(ev.relatedTarget)) c.style.transform = ''; });
function toggleTb(c) {
  var key = c.dataset.tb; if (c.querySelector('.tb-na')) return;
  var wasOpen = state.tbOpen === key; state.tbOpen = wasOpen ? null : key;
  var grid = c.parentNode;
  [].forEach.call(grid.querySelectorAll('.tbox.open'), function (o) { if (o !== c) { o.classList.remove('open'); o.setAttribute('aria-expanded', 'false'); var hh = o.querySelector('.tb-hint'); if (hh) hh.firstChild.nodeValue = 'ดูเกณฑ์ '; } });
  c.classList.toggle('open', !wasOpen); c.setAttribute('aria-expanded', String(!wasOpen)); c.style.transform = '';
  var hint = c.querySelector('.tb-hint'); if (hint) hint.firstChild.nodeValue = (wasOpen ? 'ดูเกณฑ์' : 'ย่อ') + ' ';
  if (!wasOpen) { countUp(c.querySelectorAll('.val')); setTimeout(function () { c.scrollIntoView({ behavior: REDUCED ? 'auto' : 'smooth', block: 'nearest' }); }, 120); }
}
document.addEventListener('click', function (ev) {
  var ll = ev.target.closest('[data-mapll]');
  if (ll && map) { var a = ll.dataset.mapll.split(','); document.getElementById('mapSec').scrollIntoView({ behavior: 'smooth', block: 'start' }); map.setView([+a[0], +a[1]], 12); L.popup({ closeButton: false, className: 'pop-mini' }).setLatLng([+a[0], +a[1]]).setContent('สถานีอ้างอิง').openOn(map); return; }
  var tb = ev.target.closest('[data-tb]'); if (tb && !ev.target.closest('a,button')) toggleTb(tb);
}, true);
document.addEventListener('keydown', function (ev) { if ((ev.key === 'Enter' || ev.key === ' ') && ev.target.matches && ev.target.matches('[data-tb]')) { ev.preventDefault(); toggleTb(ev.target); } });
document.addEventListener('click', function (ev) {
  var t = ev.target.closest('[data-trig],[data-lvl],[data-zone],[data-clear],[data-range],[data-hmode],[data-feature],[data-mapto],[data-row],#geoRetry,#geoBack,#fabMap,#fabTop');
  if (!t || !state.data) return;
  if (t.id === 'fabTop') { window.scrollTo({ top: 0, behavior: 'smooth' }); return; }
  if (t.id === 'fabMap') { document.getElementById('mapSec').scrollIntoView({ behavior: 'smooth', block: 'start' }); return; }
  if (t.id === 'geoRetry') { locate(); return; }
  if (t.id === 'geoBack') { state.userPicked = false; select(state.near.site.id, false); return; }
  if (t.dataset.mapto) { mapTo(t.dataset.mapto); return; }
  if (t.dataset.feature) { select(t.dataset.feature, true); document.getElementById('h-near').scrollIntoView({ behavior: 'smooth', block: 'start' }); return; }
  if (t.dataset.row) {
    if (ev.target.closest('[data-stop]')) return;
    var id = t.dataset.row, prev = state.open, old = prev && document.querySelector('.srow[data-row="' + prev + '"] .srow-detail');
    var go = function () { state.open = prev === id ? null : id; state.justOpened = state.open; renderList(); state.justOpened = null; };
    if (old && !REDUCED) { old.classList.add('leaving'); setTimeout(go, 230); } else go();
    return;
  }
  if (t.dataset.range) { state.range = t.dataset.range; renderFilters(); renderFeatured(); refreshHistory(); return; }
  if (t.dataset.hmode) { state.hmode = t.dataset.hmode; renderFilters(); renderHourTable(); return; }
  if (t.dataset.trig) { var n = +t.dataset.trig; state.trig = state.trig === n ? null : n; }
  else if (t.dataset.lvl) { var l = +t.dataset.lvl; state.lvl = state.lvl === l ? null : l; }
  else if (t.dataset.zone) { state.zone = state.zone === t.dataset.zone && t.dataset.zone !== 'all' ? 'all' : t.dataset.zone; }
  else if (t.dataset.clear) { state[t.dataset.clear] = null; }
  rerender();
});
document.addEventListener('keydown', function (ev) {
  if (ev.key === '/' && !/INPUT|TEXTAREA|SELECT/.test((document.activeElement || {}).tagName || '')) { ev.preventDefault(); document.getElementById('q').focus(); return; }
  if (ev.key !== 'Enter' && ev.key !== ' ') return;
  var t = ev.target.closest && ev.target.closest('.trig-node,.srow');
  if (t && ev.target === t) { ev.preventDefault(); t.dispatchEvent(new MouseEvent('click', { bubbles: true })); }
});
/* ---------- hover-reveal sidebar: section links, scroll-spy, live status, sites to watch ---------- */
function renderSidebar() {
  var c = [0, 0, 0, 0], na = 0;
  SITES.forEach(function (s) { var l = state.evals[s.id].overall; if (l == null) na++; else c[l]++; });
  document.getElementById('sbStatus').innerHTML = [3, 2, 1, 0].map(function (l) { return '<span class="st s' + l + '"><b>' + c[l] + '</b>' + LV[l].th + '</span>'; }).join('');
  document.getElementById('sbCrit').textContent = c[3] ? c[3] : '';
  var watch = SITES.filter(function (s) { return state.evals[s.id].overall >= 2; }).sort(function (a, b) { return state.evals[b.id].overall - state.evals[a.id].overall; }).slice(0, 8);
  document.getElementById('sbWatch').innerHTML = watch.length ? watch.map(function (s) { var l = state.evals[s.id].overall; return '<button type="button" class="sb-site s' + l + '" data-sb-site="' + s.id + '"><i></i><span>' + esc(s.name) + '</span><small>' + lname(l) + '</small></button>'; }).join('') : '<div class="muted" style="font-size:12px;padding:4px 10px">ไม่มีพื้นที่ระดับเตือนภัยขึ้นไป</div>';
}
(function () {
  var sb = document.getElementById('sidebar'), tab = document.getElementById('sbTab');
  tab.addEventListener('click', function () { var o = !sb.classList.contains('open'); sb.classList.toggle('open', o); tab.setAttribute('aria-expanded', String(o)); });
  sb.addEventListener('click', function (ev) {
    var a = ev.target.closest('a[href^="#"]'), b = ev.target.closest('[data-sb-site]');
    if (a) { ev.preventDefault(); var el = document.getElementById(a.getAttribute('href').slice(1)); if (el) el.scrollIntoView({ behavior: REDUCED ? 'auto' : 'smooth', block: 'start' }); }
    if (b) { select(b.dataset.sbSite, true); document.getElementById('h-near').scrollIntoView({ behavior: 'smooth', block: 'start' }); }
    if (a || b) { sb.classList.remove('open'); tab.setAttribute('aria-expanded', 'false'); }
  });
  document.addEventListener('click', function (ev) { if (sb.classList.contains('open') && !sb.contains(ev.target)) { sb.classList.remove('open'); tab.setAttribute('aria-expanded', 'false'); } });
  if ('IntersectionObserver' in window) {
    var links = [].slice.call(sb.querySelectorAll('a[data-spy]')), vis = {};
    var io = new IntersectionObserver(function (es) {
      es.forEach(function (e) { vis[e.target.id] = e.isIntersecting ? e.boundingClientRect.top : null; });
      var best = null; Object.keys(vis).forEach(function (k) { if (vis[k] != null && (best == null || Math.abs(vis[k]) < Math.abs(vis[best]))) best = k; });
      if (best) links.forEach(function (l) { l.classList.toggle('on', l.dataset.spy === best); });
    }, { rootMargin: '-15% 0px -60% 0px' });
    links.forEach(function (l) { var el = document.getElementById(l.dataset.spy); if (el) io.observe(el); });
  }
})();

/* ---------- search: suggestions dropdown + Search button ---------- */
(function () {
  var inp = document.getElementById('q'), drop = document.getElementById('qList'), form = document.getElementById('qForm'), items = [], cur = -1;
  function hi(txt, q) { var t = esc(txt); if (!q) return t; var i = txt.toLowerCase().indexOf(q); return i < 0 ? t : esc(txt.slice(0, i)) + '<mark>' + esc(txt.slice(i, i + q.length)) + '</mark>' + esc(txt.slice(i + q.length)); }
  function build(qraw) {
    var q = qraw.trim().toLowerCase(), out = [];
    if (!q) return out;
    SITES.forEach(function (s) {
      var e = state.evals[s.id], st = refStation(s);
      var hay = [s.name, s.prov, s.amp, s.id, s.basin].concat(s.cos).join(' ').toLowerCase();
      if (hay.indexOf(q) >= 0) {
        var hitCo = s.cos.filter(function (c) { return c.toLowerCase().indexOf(q) >= 0; })[0];
        out.push({ g: 'พื้นที่ SCGP', k: 'site', id: s.id, l: e.overall, ic: 'factory', t: hi(s.name, q), d: hitCo ? hi(hitCo, q) : esc(ZONES[s.zone] + ' · จ.' + s.prov + ' อ.' + s.amp), r: lname(e.overall) });
      } else if (st && (st.code + ' ' + st.name).toLowerCase().indexOf(q) >= 0) {
        var prev = out.filter(function (o) { return o.k === 'site' && o.code === st.code; })[0];
        if (prev) { prev.n.push(s.name); prev.d = 'สถานีอ้างอิงของ ' + esc(prev.n[0]) + ' +' + (prev.n.length - 1) + ' พื้นที่'; }
        else out.push({ g: 'สถานีวัดน้ำ', k: 'site', id: s.id, code: st.code, n: [s.name], l: lvlBy(st.pct, CRITERIA.bank.bands), ic: 'gauge', t: hi(st.code + ' ' + st.name, q), d: 'สถานีอ้างอิงของ ' + esc(s.name), r: f(st.pct, 0) + '% ตลิ่ง' });
      }
    });
    var seen = {};
    (state.data.dam || []).forEach(function (d) {
      if (seen[d.name] || ('เขื่อน' + d.name).toLowerCase().indexOf(q) < 0) return; seen[d.name] = 1;
      var hit = SITES.filter(function (s) { return s.dams.indexOf(d.name) >= 0; });
      if (hit.length) out.push({ g: 'เขื่อน', k: 'dam', id: d.name, ll: [d.lat, d.lng], l: damLevel(d), ic: 'dam', t: hi('เขื่อน' + d.name, q), d: 'ส่งผลต่อ ' + hit.length + ' พื้นที่', r: f(d.pct, 1) + '%' });
    });
    var provs = {};
    SITES.forEach(function (s) { if (s.prov.toLowerCase().indexOf(q) >= 0) (provs[s.prov] = provs[s.prov] || []).push(s); });
    Object.keys(provs).forEach(function (p) { out.push({ g: 'จังหวัด', k: 'filter', id: p, l: null, ic: 'map', t: hi('จ.' + p, q), d: provs[p].length + ' พื้นที่ SCGP · กดเพื่อกรองรายการ', r: '' }); });
    return out.slice(0, 12);
  }
  function render() {
    var q = inp.value.trim();
    items = build(q); cur = items.length ? 0 : -1;
    if (!q) { close(); return; }
    var h = '', lastG = '';
    if (!items.length) h = '<div class="qempty">ไม่พบ “' + esc(q) + '” · ลองชื่อจังหวัด อำเภอ บริษัท หรือรหัสสถานี</div>';
    items.forEach(function (it, i) {
      if (it.g !== lastG) { h += '<div class="qg">' + it.g + '</div>'; lastG = it.g; }
      h += '<div class="qi ' + sc(it.l) + '" role="option" id="qi' + i + '" data-i="' + i + '" aria-selected="' + (i === cur) + '"><span class="qic">' + icon(it.ic) + '</span><span><b>' + it.t + '</b><small>' + it.d + '</small></span>' + (it.r ? '<span class="spill ' + sc(it.l) + '">' + esc(it.r) + '</span>' : '') + '</div>';
    });
    h += '<div class="qfoot"><span>↑↓ เลือก · Enter เปิด</span><span>กด “ค้นหา” เพื่อกรองรายการทั้งหมด</span></div>';
    drop.innerHTML = h; drop.hidden = false; inp.setAttribute('aria-expanded', 'true'); mark();
  }
  function mark() { [].forEach.call(drop.querySelectorAll('.qi'), function (el) { el.setAttribute('aria-selected', String(+el.dataset.i === cur)); }); inp.setAttribute('aria-activedescendant', cur >= 0 ? 'qi' + cur : ''); var a = document.getElementById('qi' + cur); if (a) a.scrollIntoView({ block: 'nearest' }); }
  function close() { drop.hidden = true; inp.setAttribute('aria-expanded', 'false'); }
  function applyFilter(text) {
    state.q = text; renderList(); renderHourTable(); close();
    var chip = document.getElementById('qActive');
    if (!chip) { chip = document.createElement('div'); chip.id = 'qActive'; form.parentNode.insertBefore(chip, form.nextSibling); }
    if (text.trim()) { var n = visibleSites().length; chip.className = 'q-active'; chip.innerHTML = 'กรองด้วย “<b>' + esc(text) + '</b>” · พบ ' + n + ' พื้นที่ <button type="button" aria-label="ล้างการค้นหา">✕</button>'; chip.hidden = false; }
    else chip.hidden = true;
    document.getElementById('listSec').scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
  function pick(it) {
    if (!it) return;
    close();
    if (it.k === 'site') { select(it.id, true); document.getElementById('h-near').scrollIntoView({ behavior: 'smooth', block: 'start' }); }
    else if (it.k === 'dam') { document.getElementById('mapSec').scrollIntoView({ behavior: 'smooth', block: 'start' }); if (map) map.setView(it.ll, 10); }
    else applyFilter(it.id);
  }
  inp.addEventListener('input', render);
  inp.addEventListener('focus', function () { if (inp.value.trim()) render(); });
  inp.addEventListener('keydown', function (ev) {
    if (drop.hidden) return;
    if (ev.key === 'ArrowDown') { ev.preventDefault(); cur = Math.min(items.length - 1, cur + 1); mark(); }
    else if (ev.key === 'ArrowUp') { ev.preventDefault(); cur = Math.max(0, cur - 1); mark(); }
    else if (ev.key === 'Escape') close();
    else if (ev.key === 'Enter' && cur >= 0 && items[cur]) { ev.preventDefault(); pick(items[cur]); }
  });
  drop.addEventListener('mousedown', function (ev) { ev.preventDefault(); });
  drop.addEventListener('click', function (ev) { var el = ev.target.closest('.qi'); if (el) pick(items[+el.dataset.i]); });
  form.addEventListener('submit', function (ev) { ev.preventDefault(); applyFilter(inp.value); });
  inp.addEventListener('search', function () { if (!inp.value) applyFilter(''); });
  document.addEventListener('click', function (ev) {
    if (!form.contains(ev.target)) close();
    if (ev.target.closest('#qActive button')) { inp.value = ''; applyFilter(''); }
  });
})();
document.getElementById('sortSel').addEventListener('change', function (e) { state.sort = e.target.value; renderList(); renderHourTable(); });
document.getElementById('refreshBtn').addEventListener('click', function () { state.hist = {}; load(); });
paintIcons();

/* ---------- data loading: Vercel API → direct open-data API → saved snapshot ---------- */
function fetchT(url, ms) {
  var c = new AbortController(); var id = setTimeout(function () { c.abort(); }, ms);
  return fetch(url, { signal: c.signal, cache: 'no-store' }).finally(function () { clearTimeout(id); });
}
async function getLive() {
  try {
    var r = await fetchT('api/water', 40000);
    if (r.ok && /json/.test(r.headers.get('content-type') || '')) { var j = await r.json(); if (j.wl && j.wl.length) return { d: j, via: 'Vercel API' }; }
  } catch (e) {}
  try {
    var B = 'https://api-v3.thaiwater.net/api/v1/thaiwater30/public/';
    var res = await Promise.all(['waterlevel_load', 'rain_24h', 'flood_road', 'thailand_main'].map(function (p) { return fetchT(B + p, 20000).then(function (r) { if (!r.ok) throw new Error(p); return r.json(); }); }));
    var c = window.WaterTransform.buildCompact({ wl: res[0], rain: res[1], fr: res[2], main: res[3] }, SITES);
    if (c.wl.length) return { d: c, via: 'ThaiWater API' };
  } catch (e) {}
  return null;
}
async function getEgatDirect() {
  try {
    var A = 'https://api-egatwater.egat.co.th/api', d = new Date(Date.now() + 7 * 3600e3).toISOString().slice(0, 10);
    var g = function (u) { return fetchT(A + u, 15000).then(function (r) { if (!r.ok) throw new Error(u); return r.json(); }); };
    var r = await Promise.all([g('/Telemiter/Maeklong'), g('/DailyInfographic?date=' + d), g('/Telemiter/Maeklong/DailyRain?dam=SNR&date=' + d).catch(function () { return []; }), g('/Telemiter/Maeklong/DailyRain?dam=VRK&date=' + d).catch(function () { return []; }), g('/Telemiter/Maeklong/Hourly/DropdownList?date=' + d).catch(function () { return []; })]);
    return window.WaterTransform.compactEgat({ at: r[4][0] ? d + ' ' + r[4][0].text : null, tele: r[0], daily: r[1], rain: r[2].concat(r[3]) });
  } catch (e) { return null; }
}
function setMode(mode, via) {
  state.mode = mode;
  var p = document.getElementById('modePill'), t = document.getElementById('modeText');
  p.className = 'fw-status ' + (mode === 'live' ? 'live' : mode === 'snap' ? 'snap' : 'load');
  t.textContent = mode === 'live' ? 'ข้อมูลสด · ' + via + ' · ' + SITES.length + ' พื้นที่' : mode === 'snap' ? 'ข้อมูลที่บันทึกไว้ (snapshot) · ' + SITES.length + ' พื้นที่' : 'กำลังโหลดข้อมูล…';
  document.getElementById('asof').textContent = state.data ? ' · อัปเดต ' + new Date(state.data.fetchedAt).toLocaleTimeString('th-TH', { timeZone: 'Asia/Bangkok', hour12: false }) : '';
}
var timer = null;
async function load() {
  setMode('load');
  var rb = document.getElementById('refreshBtn'); rb.classList.add('spin');
  var live = await getLive();
  var raw = live ? live.d : window.SNAPSHOT;
  if (live && !raw.egat) { var eg = await getEgatDirect(); raw.egat = eg || window.SNAPSHOT.egat; state.egatFromSnapshot = !eg; } else state.egatFromSnapshot = !live;
  state.data = normalise(raw);
  SITES.forEach(function (s) { state.evals[s.id] = evaluate(s); });
  setMode(live ? 'live' : 'snap', live && live.via);
  rb.classList.remove('spin');
  if (!state.sel) state.sel = topSite().id;
  var first = !map;
  if (!map) { initMap(); initTip(); initSchemTip(); initReveal(); }
  rerender(); renderDams(); renderCriteria(); renderClimate(); renderAtlas();
  if (first) document.getElementById('climSeg').addEventListener('click', function (ev) {
    var b = ev.target.closest('button[data-p]'); if (!b) return;
    state.climP = +b.dataset.p;
    [].forEach.call(this.querySelectorAll('button'), function (x) { x.setAttribute('aria-pressed', String(x === b)); });
    renderClimate(); rerender();
  });
  if (state.sel) { var s = SITES.filter(function (x) { return x.id === state.sel; })[0]; if (s && map) showRefs(s); }
  refreshHistory();
  if (first) locate();
  document.getElementById('mapNote').textContent = SITES.length + ' พื้นที่ · ' + SITES.reduce(function (a, s) { return a + s.cos.length; }, 0) + ' บริษัท';
  clearTimeout(timer);
  if (live) timer = setTimeout(load, 10 * 60 * 1000);
}

// Start with the most at-risk site selected so the detail panel opens on something useful.
authGuard().then(function (ok) { if (!ok) return; return load(); });
})();
