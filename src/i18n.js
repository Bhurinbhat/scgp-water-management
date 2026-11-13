/* TH/EN switch. The UI is written in Thai; English is produced by phrase replacement
   (longest phrase first) over text nodes and a few attributes, so dynamically rendered
   cards, charts and tooltips are covered too. Original Thai is kept on each node so
   switching back is exact. Place names without a dictionary entry stay in Thai. */
(function () {
  var SKIP = /^(SCRIPT|STYLE|TEXTAREA|NOSCRIPT|style|script)$/;
  var EN = window.I18N_EN || {}, THAI = /[฀-๿]/, ATTRS = ['placeholder', 'title', 'aria-label', 'alt'];
  var keys = Object.keys(EN).sort(function (a, b) { return b.length - a.length; });
  var re = keys.length ? new RegExp(keys.map(function (k) { return k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }).join('|'), 'g') : null;
  var cache = new Map();
  var UNIT = [
    [/ลบ\.ม\.\/วิ\/ชม\.?/g, 'm³/s/h'], [/ม\.\/ชม\.?/g, 'm/h'], [/ม\.รทก\.?/g, 'm MSL'], [/มม\.?/g, 'mm'], [/ซม\.?/g, 'cm'], [/กม\.?/g, 'km'],
    [/(\d{1,2}[:.]\d{2})\s*น\./g, '$1'], [/ชม\.?/g, 'h'], [/(\d)\s*ม\.(?![a-zก-๙])/g, '$1 m'], [/(^|[\s(·])ม\.(?=\s|$|[,)·])/g, '$1m'],
    [/(^|[\s(·/])จ\.\s?/g, '$1'], [/(^|[\s(·/])อ\.\s?/g, '$1Dist. '], [/(\d)\s*วัน(?![ก-๙])/g, '$1 days'], [/พื้นที่/g, ' sites '], [/กรุงเทพฯ?/g, 'Bangkok']
  ];
  function tr(s) {
    if (!s || !THAI.test(s)) return s;
    var hit = cache.get(s); if (hit !== undefined) return hit;
    var lead = /^\s*/.exec(s)[0], trail = /\s*$/.exec(s)[0];
    var o = re ? s.replace(re, function (m) { return ' ' + EN[m] + ' '; }) : s;
    UNIT.forEach(function (u) { o = o.replace(u[0], u[1]); });
    o = o.replace(/[  ]{2,}/g, ' ').replace(/ +([,.:;)%\]])/g, '$1').replace(/([(\[]) +/g, '$1').trim();
    o = lead + o + trail;
    if (cache.size > 5000) cache.clear();
    cache.set(s, o); return o;
  }
  var lang = 'th', busy = false;
  try { lang = (new URLSearchParams(location.search).get('lang')) || localStorage.getItem('scgp-lang') || 'th'; } catch (e) {}
  if (lang !== 'en') lang = 'th';
  function walk(root, fn) {
    if (!root) return;
    if (root.nodeType === 3) { if (!root.parentNode || !SKIP.test(root.parentNode.nodeName)) fn(root); return; }
    if (root.nodeType !== 1 || root.tagName === 'SCRIPT' || root.tagName === 'STYLE') return;
    attrs(root);
    var w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT, { acceptNode: function (x) { return x.nodeType === 1 && SKIP.test(x.tagName) ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT; } }), n;
    while ((n = w.nextNode())) { if (n.nodeType === 3) fn(n); else if (n.tagName !== 'SCRIPT' && n.tagName !== 'STYLE') attrs(n); }
  }
  function attrs(el) {
    for (var i = 0; i < ATTRS.length; i++) {
      var a = ATTRS[i], v = el.getAttribute && el.getAttribute(a); if (v == null) continue;
      var store = el.__thA || (el.__thA = {});
      if (lang === 'en') { var done = el.__enA || (el.__enA = {}); if (THAI.test(v) && v !== done[a]) { store[a] = v; var t2 = tr(v); done[a] = t2; if (t2 !== v) el.setAttribute(a, t2); } }
      else if (store[a] != null) { el.setAttribute(a, store[a]); delete store[a]; if (el.__enA) delete el.__enA[a]; }
    }
  }
  function textNode(n) {
    if (lang === 'en') {
      var v = n.nodeValue;
      if (v === n.__en || !THAI.test(v)) return;             // already ours (may keep Thai place names)
      n.__th = v; var t2 = tr(v); n.__en = t2; if (t2 !== v) n.nodeValue = t2;
    } else if (n.__th != null) { n.nodeValue = n.__th; n.__th = null; n.__en = null; }
  }
  function apply(root) { busy = true; try { walk(root || document.body, textNode); } finally { busy = false; } }
  var mo = new MutationObserver(function (list) {
    if (busy || lang !== 'en') return;
    busy = true;
    try {
      list.forEach(function (m) {
        if (m.type === 'characterData') { var pn = m.target.parentNode; if (THAI.test(m.target.nodeValue) && !(pn && SKIP.test(pn.nodeName))) textNode(m.target); }
        else if (m.type === 'attributes') attrs(m.target);
        else m.addedNodes.forEach(function (n) { walk(n, textNode); });
      });
    } finally { busy = false; }
  });
  function setLang(l, save) {
    lang = l === 'en' ? 'en' : 'th';
    document.documentElement.lang = lang;
    if (save) try { localStorage.setItem('scgp-lang', lang); } catch (e) {}
    apply(document.body);
    if (document.title && !document.__thTitle) document.__thTitle = document.title;
    document.title = lang === 'en' ? tr(document.__thTitle || document.title) : (document.__thTitle || document.title);
    [].forEach.call(document.querySelectorAll('[data-lang]'), function (b) { b.setAttribute('aria-pressed', String(b.dataset.lang === lang)); });
    document.dispatchEvent(new CustomEvent('langchange', { detail: lang }));
  }
  window.I18N = { tr: tr, get lang() { return lang; }, set: function (l) { setLang(l, true); } };
  document.addEventListener('click', function (ev) { var b = ev.target.closest && ev.target.closest('[data-lang]'); if (b) { ev.preventDefault(); setLang(b.dataset.lang, true); } });
  function start() {
    mo.observe(document.body, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ATTRS });
    setLang(lang, false);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start); else start();
})();
