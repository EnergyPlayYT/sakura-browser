/* Sakura – Textmarker: markiert Text farbig (CSS Custom Highlight API – die Seite selbst wird nicht verändert).
 * Gespeichert wird nur der Text mit etwas Umgebung (prefix/suffix), damit er beim nächsten Besuch wiedergefunden wird. */
(function () {
  if (window.__sakuraHL) return;
  const COLORS = ['gelb', 'rosa', 'gruen', 'blau'];
  const sets = {};
  function registry() {
    if (!window.CSS || !CSS.highlights || typeof Highlight === 'undefined') return null;
    for (const c of COLORS) if (!sets[c]) { sets[c] = new Highlight(); CSS.highlights.set('sakura-' + c, sets[c]); }
    return sets;
  }
  // Alle sichtbaren Textknoten zu einem langen Text verbinden (mit Rückweg zu den Knoten)
  function textIndex() {
    const nodes = [], starts = [];
    let all = '';
    const w = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, {
      acceptNode: n => n.parentElement && !/^(SCRIPT|STYLE|NOSCRIPT|TEXTAREA)$/.test(n.parentElement.tagName) ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT
    });
    for (let n = w.nextNode(); n; n = w.nextNode()) { starts.push(all.length); nodes.push(n); all += n.data; }
    return { all, nodes, starts };
  }
  function rangeAt(idx, from, len) {
    const pos = p => { let lo = 0, hi = idx.starts.length - 1; while (lo < hi) { const m = (lo + hi + 1) >> 1; if (idx.starts[m] <= p) lo = m; else hi = m - 1; } return { node: idx.nodes[lo], off: p - idx.starts[lo] }; };
    const a = pos(from), b = pos(from + len);
    const r = document.createRange();
    r.setStart(a.node, Math.min(a.off, a.node.data.length));
    r.setEnd(b.node, Math.min(b.off, b.node.data.length));
    return r;
  }
  window.__sakuraHL = {
    /** aktuelle Auswahl markieren → { text, prefix, suffix } zum Speichern */
    addSelection(color) {
      const reg = registry(), sel = getSelection();
      if (!reg || !sel || sel.isCollapsed || !sel.rangeCount) return null;
      const range = sel.getRangeAt(0).cloneRange();
      const text = range.toString();
      if (!text.trim() || text.length > 5000) return null;
      const idx = textIndex();
      // Position der Auswahl im Gesamttext bestimmen
      const pre = document.createRange();
      pre.setStart(document.body, 0); pre.setEnd(range.startContainer, range.startOffset);
      let start = -1;
      for (let i = 0; i < idx.nodes.length; i++) if (idx.nodes[i] === range.startContainer) { start = idx.starts[i] + range.startOffset; break; }
      if (start < 0) start = idx.all.indexOf(text);
      reg[COLORS.includes(color) ? color : 'gelb'].add(range);
      sel.removeAllRanges();
      return { text, prefix: idx.all.slice(Math.max(0, start - 32), start), suffix: idx.all.slice(start + text.length, start + text.length + 32) };
    },
    /** gespeicherte Markierungen wieder einfärben; liefert, wie viele gefunden wurden */
    paint(list) {
      const reg = registry();
      if (!reg) return 0;
      for (const c of COLORS) reg[c].clear();
      const idx = textIndex();
      let found = 0;
      for (const h of list || []) {
        let at = idx.all.indexOf((h.prefix || '') + h.text + (h.suffix || ''));
        if (at >= 0) at += (h.prefix || '').length; else at = idx.all.indexOf(h.text);
        if (at < 0) continue;
        try { reg[COLORS.includes(h.color) ? h.color : 'gelb'].add(rangeAt(idx, at, h.text.length)); found++; } catch (e) {}
      }
      return found;
    }
  };
})();
