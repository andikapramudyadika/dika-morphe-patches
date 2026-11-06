/* SPDX-License-Identifier: GPL-3.0-only */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.DikaScheduleCore = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  const ZONE = 'Asia/Makassar';
  const DEFAULT = { enabled: false, zone: ZONE, days: [1, 2, 3, 4, 5], inTime: '07:55', outTime: '21:55' };
  function validate(input) {
    if (!input || typeof input.enabled !== 'boolean') throw Error('Pengaturan tidak valid');
    const validTime = t => typeof t === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(t);
    if (!validTime(input.inTime) || !validTime(input.outTime) || input.inTime === input.outTime) throw Error('Pilih dua waktu yang berbeda');
    if (!Array.isArray(input.days) || !input.days.length || input.days.some(d => !Number.isInteger(d) || d < 1 || d > 7)) throw Error('Pilih hari kerja');
    return { enabled: input.enabled, zone: ZONE, days: [...new Set(input.days)].sort(), inTime: input.inTime, outTime: input.outTime };
  }
  function wall(now, zone) {
    const parts = Object.fromEntries(new Intl.DateTimeFormat('en-GB', {
      timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23'
    }).formatToParts(new Date(now)).filter(x => x.type !== 'literal').map(x => [x.type, x.value]));
    const date = `${parts.year}-${parts.month}-${parts.day}`;
    const day = new Date(`${date}T12:00:00Z`).getUTCDay() || 7;
    return { date, day, time: `${parts.hour}:${parts.minute}`, second: +parts.second };
  }
  function due(config, now, ledger) {
    if (!config.enabled) return [];
    const w = wall(now, ZONE);
    if (!config.days.includes(w.day)) return [];
    return ['in', 'out'].filter(slot => w.time === config[slot + 'Time'])
      .map(slot => ({ key: `${w.date}:${slot}`, slot, date: w.date, scheduled: config[slot + 'Time'], startedAt: now }))
      .filter(item => !Object.prototype.hasOwnProperty.call(ledger, item.key));
  }
  // The supported Indonesian time zones have fixed offsets and no DST.
  function notificationPlan(config, now) {
    if (!config.enabled) return [];
    const w = wall(now, ZONE), result = [];
    for (let day = 0; day < 14; day++) {
      const d = new Date(`${w.date}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + day);
      if (!config.days.includes(d.getUTCDay() || 7)) continue;
      for (const slot of ['in', 'out']) {
        const [h, m] = config[slot + 'Time'].split(':').map(Number);
        const at = d.getTime() + (h - 8) * 3600000 + m * 60000;
        if (at > now) result.push({ at, slot });
      }
    }
    return result;
  }
  class Engine {
    constructor({ load, save, now = Date.now, run, changed = () => {} }) {
      this.save = save; this.now = now; this.run = run; this.changed = changed; this.busy = false;
      const data = load() || {};
      this.config = validate({ ...DEFAULT, ...(data.config || {}) });
      this.ledger = data.ledger || {}; this.history = Array.isArray(data.history) ? data.history.slice(-150) : [];
      for (const item of Object.values(this.ledger)) {
        if (item.status === 'running') {
          item.status = 'interrupted';
          this.history.push({ at: this.now(), key: item.key, status: 'interrupted', message: 'Sesi sebelumnya terputus. Periksa daftar offline; tidak dicoba ulang otomatis.' });
        }
      }
      this.history = this.history.slice(-150);
    }
    persist() { this.save({ config: this.config, ledger: this.ledger, history: this.history }); this.changed(); }
    configure(config) { this.config = validate(config); this.persist(); }
    event(key, status, message) {
      if (this.ledger[key]) this.ledger[key].status = status;
      this.history.push({ at: this.now(), key, status, message }); this.history = this.history.slice(-150);
      this.persist();
    }
    async tick() {
      if (this.busy) return;
      const jobs = due(this.config, this.now(), this.ledger);
      if (!jobs.length) return;
      this.busy = true;
      try {
        const job = jobs[0];
        // Persist the reservation BEFORE any side effect. An interrupted attempt
        // is never retried automatically, even if the save result is unknown.
        this.ledger[job.key] = { ...job, status: 'running' };
        const keys = Object.keys(this.ledger).sort();
        while (keys.length > 180) delete this.ledger[keys.shift()];
        this.persist();
        try { await this.run(job); }
        catch (_) { this.event(job.key, 'needs-user', 'Percobaan berhenti; periksa catatan GreatDay sebelum mencoba manual.'); }
      } finally { this.busy = false; }
    }
  }
  return { ZONE, DEFAULT, validate, wall, due, notificationPlan, Engine };
});
