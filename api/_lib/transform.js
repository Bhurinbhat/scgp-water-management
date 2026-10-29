/* Shared: turns raw ThaiWater (สสน.) API responses into the compact shape the dashboard reads.
   Used by the browser (direct mode) and by the Vercel function /api/water. */
(function (root) {
  function hv(a, b, c, d) {
    var R = 6371, t = function (x) { return x * Math.PI / 180; };
    var dl = t(c - a), dg = t(d - b);
    var h = Math.sin(dl / 2) * Math.sin(dl / 2) + Math.cos(t(a)) * Math.cos(t(c)) * Math.sin(dg / 2) * Math.sin(dg / 2);
    return 2 * R * Math.asin(Math.sqrt(h));
  }
  function num(x) { return x == null || x === '' ? null : +x; }
  function r5(x) { return x == null ? null : Math.round(x * 1e5) / 1e5; }
  function r2(x) { return x == null ? null : Math.round(x * 100) / 100; }
  var TIDE = /^(GLF001|SLA005|MKG006|RAJ001|RAJ002|KRN001|K\.3A|K\.11A|K\.35A|K\.37|K\.12|K\.55A)$/; // tide gauges + Mae Klong schematic stations

  function buildCompact(raw, sites) {
    var S = sites.map(function (s) { return [s.lat, s.lng]; });
    function md(la, ln) { var m = 1e9; for (var i = 0; i < S.length; i++) { var d = hv(S[i][0], S[i][1], la, ln); if (d < m) m = d; } return m; }

    var wlRows = ((raw.wl && raw.wl.waterlevel_data && raw.wl.waterlevel_data.data) || []).filter(function (x) {
      return x.station && x.station.tele_station_lat && x.station.tele_station_long;
    });
    var keep = {};
    S.forEach(function (s) {
      wlRows.map(function (w) { return [w, hv(s[0], s[1], w.station.tele_station_lat, w.station.tele_station_long)]; })
        .filter(function (z) { return z[1] <= 30; })
        .sort(function (a, b) { return a[1] - b[1]; })
        .slice(0, 4).forEach(function (z) { keep[z[0].station.id] = 1; });
    });
    var wl = wlRows.filter(function (x) { return keep[x.station.id] || TIDE.test(x.station.tele_station_oldcode || ''); }).map(function (x) {
      var st = x.station;
      return [st.id, st.tele_station_oldcode, (st.tele_station_name && st.tele_station_name.th) || ('สถานี ' + st.id), r5(st.tele_station_lat), r5(st.tele_station_long),
        x.waterlevel_datetime, num(x.waterlevel_msl), num(x.waterlevel_msl_previous), r2(num(x.storage_percent)), x.situation_level,
        r2(st.min_bank), st.critical_level_msl, num(x.diff_wl_bank), /^ล้น/.test(x.diff_wl_bank_text || '') ? 1 : 0,
        x.river_name || '', x.agency && x.agency.agency_shortname ? x.agency.agency_shortname.th : '', x.geocode && x.geocode.province_name ? x.geocode.province_name.th : ''];
    });

    var rain = ((raw.rain && raw.rain.data) || []).filter(function (x) {
      return x.station && x.station.tele_station_lat && md(x.station.tele_station_lat, x.station.tele_station_long) <= 10;
    }).map(function (x) {
      return [(x.station.tele_station_name && x.station.tele_station_name.th) || '', r5(x.station.tele_station_lat), r5(x.station.tele_station_long), x.rainfall_datetime, x.rain_24h];
    });

    var fr = ((raw.fr && raw.fr.data) || []).filter(function (x) {
      return x.station && x.station.floodroad_lat && md(x.station.floodroad_lat, x.station.floodroad_long) <= 3;
    }).map(function (x) {
      return [((x.station.floodroad_name && x.station.floodroad_name.th) || '').replace(/\s*\*$/, '').trim(), r5(x.station.floodroad_lat), r5(x.station.floodroad_long), x.floodroad_datetime, x.floodroad_value];
    });

    var damRows = (raw.main && raw.main.dam && raw.main.dam.data && raw.main.dam.data.data) || [];
    var dam = damRows.map(function (x) {
      var d = x.dam || {};
      return [d.id, d.dam_name && d.dam_name.th, d.dam_lat, d.dam_long, x.dam_storage, x.dam_storage_percent, x.dam_inflow, x.dam_released, x.dam_spilled, d.normal_storage, x.dam_date];
    });

    var out = { fetchedAt: new Date().toISOString(), wl: wl, rain: rain, fr: fr, dam: dam };
    if (raw.egat) out.egat = compactEgat(raw.egat);
    return out;
  }

  /* กฟผ. (EGAT Water Intelligence Center) — Mae Klong telemetry + daily dam infographic with rule curves */
  function compactEgat(e) {
    return {
      at: e.at || null,
      tele: (e.tele || []).map(function (t) { return [t.code, t.legendId, t.wl, t.ds]; }),
      daily: (e.daily || []).map(function (x) { var c = x.cockpitData || {}; return [x.dam, x.eff, x.effPercent, x.inflAll, x.relAll, c.stor, c.percent, c.dead, c.lower, c.upper, c.release]; }),
      rain: (e.rain || []).map(function (r) { return [r.damId, r.stationCode, r.rainValue]; })
    };
  }
  var api = { buildCompact: buildCompact, compactEgat: compactEgat, haversine: hv };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.WaterTransform = api;
})(typeof window !== 'undefined' ? window : globalThis);
