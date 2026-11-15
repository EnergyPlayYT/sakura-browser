// Download-Verwaltung
const fs = require('fs');
const path = require('path');
const { EventEmitter } = require('events');

function uniquePath(dir, name) {
  const safe = String(name || 'download').replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').slice(0, 180) || 'download';
  const ext = path.extname(safe);
  const stem = safe.slice(0, safe.length - ext.length);
  let p = path.join(dir, safe), n = 1;
  while (fs.existsSync(p) || fs.existsSync(p + '.crdownload')) p = path.join(dir, `${stem} (${n++})${ext}`);
  return p;
}

class Downloads extends EventEmitter {
  constructor({ store, dir, shell }) {
    super();
    this.store = store;
    this.dir = dir;
    this.shell = shell;
    this.items = new Map(); // id → { info, item }
    this.counter = 0;
    this._t = null;
    // Alte Einträge (nicht laufend) aus der Datei
    for (const d of store.data.downloads || []) this.items.set(d.id, { info: d, item: null });
  }

  attach(ses, isPrivate) {
    ses.on('will-download', (e, item) => {
      const id = 'dl' + Date.now().toString(36) + (++this.counter);
      if (!this.store.prefs().downloadAsk) item.setSavePath(uniquePath(this.dir, item.getFilename()));
      const info = {
        id, url: item.getURL(), filename: item.getFilename(), path: item.getSavePath(),
        received: 0, total: item.getTotalBytes(), state: 'progressing', paused: false,
        startedAt: Date.now(), private: !!isPrivate
      };
      this.items.set(id, { info, item });
      item.on('updated', (ev, state) => {
        info.received = item.getReceivedBytes();
        info.total = item.getTotalBytes();
        info.paused = item.isPaused();
        info.state = state === 'interrupted' ? 'interrupted' : 'progressing';
        info.path = item.getSavePath() || info.path;
        info.filename = path.basename(info.path || info.filename);
        this.changed();
      });
      item.once('done', (ev, state) => {
        info.state = state; // completed | cancelled | interrupted
        info.received = item.getReceivedBytes();
        info.path = item.getSavePath() || info.path;
        info.filename = path.basename(info.path || info.filename);
        info.doneAt = Date.now();
        const entry = this.items.get(id);
        if (entry) entry.item = null;
        this.persist();
        this.changed(true);
        if (state === 'completed') this.emit('completed', info);
      });
      this.changed(true);
      this.emit('started', info);
    });
  }

  persist() {
    this.store.data.downloads = [...this.items.values()]
      .map(x => x.info)
      .filter(i => !i.private && i.state !== 'progressing')
      .sort((a, b) => b.startedAt - a.startedAt)
      .slice(0, 100);
    this.store.save();
  }

  changed(now) {
    clearTimeout(this._t);
    if (now) this.emit('change');
    else this._t = setTimeout(() => this.emit('change'), 200);
  }

  list() {
    return [...this.items.values()].map(x => ({ ...x.info, exists: x.info.state === 'completed' ? fs.existsSync(x.info.path) : undefined }))
      .sort((a, b) => b.startedAt - a.startedAt);
  }

  summary() {
    const active = [...this.items.values()].map(x => x.info).filter(i => i.state === 'progressing');
    const total = active.reduce((s, i) => s + (i.total || 0), 0);
    const received = active.reduce((s, i) => s + (i.received || 0), 0);
    return {
      any: this.items.size > 0,
      active: active.length,
      progress: active.length && total ? received / total : null
    };
  }

  _get(id) { return this.items.get(id); }
  open(id) { const x = this._get(id); if (x && x.info.state === 'completed') this.shell.openPath(x.info.path); }
  show(id) { const x = this._get(id); if (x && x.info.path) this.shell.showItemInFolder(x.info.path); }
  cancel(id) { const x = this._get(id); if (x && x.item) x.item.cancel(); }
  pause(id) { const x = this._get(id); if (x && x.item) { if (x.item.isPaused()) x.item.resume(); else x.item.pause(); } }
  remove(id) {
    const x = this._get(id);
    if (!x) return;
    if (x.item) x.item.cancel();
    this.items.delete(id);
    this.persist();
    this.changed(true);
  }
  clear() {
    for (const [id, x] of this.items) if (x.info.state !== 'progressing') this.items.delete(id);
    this.persist();
    this.changed(true);
  }
}

module.exports = { Downloads, uniquePath };
