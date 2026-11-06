/* SPDX-License-Identifier: GPL-3.0-only */
(function (root) {
  'use strict';
  const Core = typeof module === 'object' && module.exports ? require('./core.js') : root.DikaScheduleCore;
  const PREFIX = 'dika.offline.v1.';
  const NOTIFICATION_BASE = 1734100000;
  class Integration {
    constructor(env = {}) {
      this.root = env.root || root; this.doc = env.document || root.document;
      this.storage = env.storage || root.localStorage; this.now = env.now || Date.now;
      this.controller = null; this.engine = null; this.identity = null;
      this.active = null; this.preview = null; this.starting = false;
      this.observed = new WeakSet(); this.notice = ''; this.notificationRevision = 0;
      this.render = () => {};
      this.notificationQueue = Promise.resolve();
    }
    account(controller = this.controller) {
      const auth = controller?.attendanceMachineService?.auth?.gdAuth;
      if (!auth || !auth.id || !(auth.userId || auth.empId)) return null;
      return JSON.stringify([String(auth.id), String(auth.userId || auth.empId)]);
    }
    attachOffline(controller) {
      this.controller = controller;
      this.ensureAccount();
    }
    ensureAccount() {
      const identity = this.account();
      if (identity === this.identity) return;
      if (this.active) this.stop('needs-user', 'Akun berubah; periksa catatan GreatDay.');
      this.identity = identity; this.engine = null; this.preview = null;
      this.refreshNotifications(false).catch(() => {});
      if (!identity) { this.render(); return; }
      const key = PREFIX + encodeURIComponent(identity);
      try {
        this.engine = new Core.Engine({
          load: () => JSON.parse(this.storage.getItem(key) || 'null'),
          save: value => this.storage.setItem(key, JSON.stringify(value)),
          now: this.now, run: job => this.start(job), changed: () => this.render()
        });
        // Validate that local state is writable BEFORE permitting any recording.
        this.engine.persist(); this.notice = '';
      } catch (_) { this.engine = null; this.notice = 'Penyimpanan jadwal tidak tersedia. Otomatisasi dinonaktifkan.'; }
      if (this.engine?.config.enabled) this.refreshNotifications(false).catch(() => {});
      this.render();
    }
    ticketFor(controller) {
      return this.starting && this.active?.controller === controller ? this.active.ticket : null;
    }
    captured(ticket, params) {
      const active = this.active;
      if (!active || ticket !== active.ticket || this.account() !== active.identity) return;
      if (!params || !params.id || params.attOn !== 'offline' || params.isForceValidation) {
        this.stop('needs-user', 'Hasil pencatatan tidak sesuai alur offline yang didukung.'); return;
      }
      active.recordId = params.id;
    }
    attachPreview(preview) {
      this.preview = preview;
      const service = preview?.attendanceSyncService;
      if (!service || this.observed.has(service) || typeof service.saveAttendanceToStorage !== 'function') return;
      const original = service.saveAttendanceToStorage, integration = this;
      service.saveAttendanceToStorage = async function (...args) {
        let result;
        try { result = await original.apply(this, args); }
        catch (error) {
          try { integration.storageFailed(args[0]); } catch (_) { /* Preserve the original error. */ }
          throw error;
        }
        try { integration.persisted(args[0], result); } catch (_) { /* Never change the host result. */ }
        return result;
      };
      this.observed.add(service);
    }
    storageFailed(params) {
      if (this.active?.recordId === params?.id) this.stop('needs-user', 'GreatDay gagal menyimpan. Periksa daftar offline sebelum mencoba lagi.');
    }
    persisted(params, records) {
      const active = this.active;
      if (!active || this.account() !== active.identity || params?.id !== active.recordId) return;
      if (!Array.isArray(records) || !records.some(x => x?.id === active.recordId)) {
        this.stop('needs-user', 'Hasil penyimpanan tidak dapat dikonfirmasi. Periksa daftar offline.'); return;
      }
      this.stop('stored-offline', 'Tersimpan melalui antrean offline GreatDay. Belum berarti diterima server.');
    }
    visible(selector) {
      return Array.from(this.doc.querySelectorAll(selector)).some(el =>
        el.getClientRects().length > 0 && !el.closest('.ion-page-hidden,[hidden],[aria-hidden="true"]'));
    }
    async start(job) {
      if (!this.engine || !this.identity || this.doc.visibilityState !== 'visible') {
        this.engine?.event(job.key, 'needs-user', 'Aplikasi tidak aktif. Buka GreatDay dan periksa absensi.'); return;
      }
      const c = this.controller, machine = c?.attendanceMachineService;
      if (!c || this.account(c) !== this.identity || typeof c.recordAttendance !== 'function' ||
          machine?.auth?.companySetting?.offlineMode !== true) {
        this.engine.event(job.key, 'needs-user', 'Alur offline belum siap atau belum diizinkan pengaturan perusahaan.'); return;
      }
      if (this.active || this.visible('ion-alert,ion-loading') || this.visible('app-time-attendance-preview')) {
        this.engine.event(job.key, 'needs-user', 'Ada proses lain yang sedang berjalan. Periksa absensi secara manual.'); return;
      }
      this.active = { ticket: `${job.key}:${this.now()}`, job, controller: c, identity: this.identity,
        expires: this.now() + 90000, recordId: null, attempted: false };
      this.preview = null;
      this.engine.event(job.key, 'running', 'Menjalankan Absensi Offline bawaan. Selesaikan kamera atau konfirmasi jika diminta.');
      this.starting = true;
      let result;
      try { result = c.recordAttendance(false); } finally { this.starting = false; }
      await result;
      // The host catches its own errors; only its successful persistence is
      // evidence of success. A resolved controller promise is NOT sufficient.
    }
    stop(status, message) {
      const active = this.active; this.active = null; this.starting = false;
      if (active) this.engine?.event(active.job.key, status, message);
    }
    async advance() {
      const active = this.active, p = this.preview;
      if (!active) return;
      if (this.account() !== active.identity || this.now() > active.expires) {
        this.stop('needs-user', 'Batas percobaan berakhir. Periksa daftar offline; tidak ada percobaan ulang otomatis.'); return;
      }
      if (this.doc.visibilityState !== 'visible' || active.attempted || !p || !active.recordId) return;
      if (!this.visible('app-time-attendance-preview') || this.visible('ion-alert,ion-loading')) return;
      if (p.params?.id !== active.recordId || p.params.attOn !== 'offline' || p.params.isForceValidation) return;
      if (p.attendanceMachineService !== active.controller.attendanceMachineService) return;
      // Mirror all host button guards, plus fail closed while asynchronous
      // face processing or uploads are still in progress. Never skip a gate.
      if (p.loadingGetBtn || p.disableBtnSaveAttendance !== false || p.showSaveAttendance !== true || p.btnSave !== true) return;
      if (p.attendancePreviewService?.checkingFaceDetection || p.attendancePreviewService?.isUploading ||
          p.attendancePreviewService?.resultFaceDetection?.reject || p.isSetFirstBP || p.showBtnRetake) return;
      if (p.isValidTime !== true || typeof p.saveAttendance !== 'function') return;
      const settings = p.attendanceMachineService.getAttendanceSetting();
      if (!settings || (settings.takePhoto !== false && !(p.params.imageBase64 || p.params.imageLocal || p.params.imageServer))) return;
      // Persist the intent before invoking the unmodified host save handler.
      active.attempted = true;
      this.engine.event(active.job.key, 'running', 'Meminta GreatDay menyimpan catatan offline.');
      try { await p.saveAttendance(0); }
      catch (_) { this.stop('needs-user', 'Penyimpanan berhenti. Periksa daftar offline GreatDay.'); }
    }
    async poll() {
      try {
        this.ensureAccount();
        if (!this.engine) return;
        if (this.doc.visibilityState === 'visible') await this.engine.tick();
        await this.advance();
      } catch (_) {
        // Disable this session on persistence failures; no untracked side effects.
        this.active = null; this.engine = null;
        this.notice = 'Otomatisasi berhenti karena kesalahan lokal. Periksa catatan GreatDay.'; this.render();
      }
    }
    async native(method, options = {}) {
      const cap = this.root.Capacitor;
      if (typeof cap?.nativePromise !== 'function') throw Error('Native notifications unavailable');
      return cap.nativePromise('LocalNotifications', method, options);
    }
    refreshNotifications(requestPermission) {
      const revision = ++this.notificationRevision;
      const work = this.notificationQueue.catch(() => {}).then(() => this.updateNotifications(requestPermission, revision));
      this.notificationQueue = work;
      return work;
    }
    async updateNotifications(requestPermission, revision) {
      if (revision !== this.notificationRevision) return;
      const pending = await this.native('getPending');
      if (revision !== this.notificationRevision) return;
      const ours = (pending.notifications || []).filter(n => n.id >= NOTIFICATION_BASE && n.id < NOTIFICATION_BASE + 28);
      if (ours.length) await this.native('cancel', { notifications: ours.map(n => ({ id: n.id })) });
      if (revision !== this.notificationRevision || !this.engine?.config.enabled) return;
      const permission = await this.native(requestPermission ? 'requestPermissions' : 'checkPermissions');
      if (revision !== this.notificationRevision) return;
      if (permission.display !== 'granted') { this.notice = 'Notifikasi belum diizinkan. Jadwal latar belakang tidak akan mengingatkan Anda.'; this.render(); return; }
      const plan = Core.notificationPlan(this.engine.config, this.now());
      const notifications = plan.map((item, i) => ({ id: NOTIFICATION_BASE + i,
        title: `Jadwal absen ${item.slot === 'in' ? 'masuk' : 'pulang'}`,
        body: 'Buka GreatDay. Pengingat ini bukan bukti absensi tersimpan.',
        schedule: { at: new Date(item.at), allowWhileIdle: true }, extra: { dikaOffline: true } }));
      if (notifications.length) await this.native('schedule', { notifications });
      // A newer disable/account switch may have happened during native work.
      if (revision !== this.notificationRevision) {
        await this.native('cancel', { notifications: notifications.map(n => ({ id: n.id })) });
        return;
      }
      this.notice = 'Pengingat disiapkan untuk 14 hari ke depan. Buka GreatDay untuk memperbaruinya.'; this.render();
    }
    async configure(config) {
      if (!this.engine) throw Error('Buka menu Absensi Offline setelah login terlebih dahulu.');
      if (this.active) this.stop('needs-user', 'Jadwal diubah; periksa proses absensi yang sedang berjalan.');
      this.engine.configure(config);
      try { await this.refreshNotifications(true); }
      catch (_) { this.notice = 'Jadwal tersimpan. Pengingat Android belum tersedia; jangan mengandalkan pencatatan saat aplikasi ditutup.'; this.render(); }
    }
  }
  if (typeof module === 'object' && module.exports) { module.exports = { Integration, NOTIFICATION_BASE }; return; }
  const integration = root.DikaOffline = new Integration();
  function mount() {
    const style = document.createElement('style');
    style.textContent = '#dika-open{position:fixed;right:12px;top:calc(env(safe-area-inset-top,0px) + 54px);z-index:100000;border:1px solid #cbd5e1;border-radius:20px;padding:8px 13px;background:#fff;color:#152238;font:600 13px system-ui;box-shadow:0 2px 12px #0002}#dika-panel{position:fixed;inset:0;z-index:100001;background:#07132180;padding:20px 12px;overflow:auto;font:14px system-ui;color:#152238}#dika-panel[hidden]{display:none}#dika-card{max-width:430px;margin:16px auto;padding:22px;border-radius:20px;background:#f8fafc;box-shadow:0 18px 60px #0003}#dika-card h2{font-size:22px;margin:0 0 12px}#dika-card p{line-height:1.5}#dika-card label{display:block;margin:12px 0}#dika-card input[type=time],#dika-card select{display:block;width:100%;box-sizing:border-box;padding:10px;border:1px solid #cbd5e1;border-radius:9px;background:white;color:#152238}#dika-card button{padding:10px 15px;border:0;border-radius:9px;background:#132b45;color:white}#dika-days{display:flex;flex-wrap:wrap;gap:9px}#dika-days label{margin:0}#dika-close{float:right}#dika-log{max-height:210px;overflow:auto;padding-left:20px;font-size:12px;line-height:1.5}#dika-message{color:#7c3500}';
    document.head.appendChild(style);
    const button = document.createElement('button'); button.id = 'dika-open'; button.textContent = 'Jadwal'; button.type = 'button';
    button.setAttribute('aria-label', 'Pengaturan jadwal absensi offline'); document.body.appendChild(button);
    const panel = document.createElement('div'); panel.id = 'dika-panel'; panel.hidden = true;
    panel.innerHTML = '<section id="dika-card" role="dialog" aria-modal="true" aria-labelledby="dika-title"><button id="dika-close" type="button" aria-label="Tutup pengaturan">Tutup</button><h2 id="dika-title">Jadwal offline</h2><p id="dika-ready"></p><p>Otomatis saat GreatDay aktif. Kamera dan validasi tetap berlaku. Saat aplikasi ditangguhkan, hanya pengingat Android yang tersedia.</p><form id="dika-form"><label><input id="dika-enabled" type="checkbox"> Aktifkan percobaan terjadwal</label><label>Zona waktu<select id="dika-zone"><option>Asia/Makassar</option><option>Asia/Jakarta</option><option>Asia/Jayapura</option></select></label><label>Masuk<input id="dika-in" type="time" required></label><label>Pulang<input id="dika-out" type="time" required></label><p>Hari kerja</p><div id="dika-days"></div><p>Jadwal yang terlewat tidak diisi mundur. Hasil masuk/pulang mengikuti klasifikasi GreatDay, bukan label jadwal ini.</p><button id="dika-save" type="submit">Simpan jadwal</button></form><p id="dika-message" role="status"></p><h3>Riwayat percobaan</h3><ol id="dika-log"></ol></section>';
    document.body.appendChild(panel);
    const byId = id => document.getElementById('dika-' + id);
    const names = ['Sen', 'Sel', 'Rab', 'Kam', 'Jum', 'Sab', 'Min'];
    names.forEach((name, i) => { const label = document.createElement('label'), check = document.createElement('input'); check.type = 'checkbox'; check.value = String(i + 1); label.append(check, document.createTextNode(' ' + name)); byId('days').appendChild(label); });
    function populate() {
      const c = integration.engine?.config || Core.DEFAULT;
      byId('enabled').checked = c.enabled; byId('zone').value = c.zone;
      byId('in').value = c.inTime; byId('out').value = c.outTime;
      byId('days').querySelectorAll('input').forEach(el => { el.checked = c.days.includes(+el.value); });
    }
    const statusLabels = { running: 'Berjalan', 'needs-user': 'Perlu diperiksa', 'stored-offline': 'Tersimpan offline', interrupted: 'Terputus' };
    integration.render = () => {
      byId('ready').textContent = integration.engine ? 'Alur offline terhubung untuk akun saat ini.' : 'Login, lalu buka menu Absensi Offline GreatDay sekali pada sesi ini agar alurnya terhubung.';
      byId('save').disabled = !integration.engine;
      byId('message').textContent = integration.notice;
      const list = byId('log'); list.textContent = '';
      for (const item of (integration.engine?.history || []).slice(-20).reverse()) {
        const row = document.createElement('li');
        row.textContent = `${new Date(item.at).toLocaleString('id-ID', { timeZone: integration.engine.config.zone })} — ${statusLabels[item.status] || item.status}: ${item.message}`;
        list.appendChild(row);
      }
    };
    button.onclick = () => { populate(); integration.render(); panel.hidden = false; byId('close').focus(); };
    function close() { panel.hidden = true; button.focus(); }
    byId('close').onclick = close;
    panel.onclick = event => { if (event.target === panel) close(); };
    panel.onkeydown = event => {
      if (event.key === 'Escape') close();
      if (event.key === 'Tab') {
        const items = [...panel.querySelectorAll('button,input,select')].filter(el => !el.disabled);
        const first = items[0], last = items[items.length - 1];
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
      }
    };
    byId('form').onsubmit = async event => {
      event.preventDefault();
      try { await integration.configure({ enabled: byId('enabled').checked, zone: byId('zone').value,
        inTime: byId('in').value, outTime: byId('out').value,
        days: [...byId('days').querySelectorAll('input:checked')].map(el => +el.value) }); }
      catch (error) { integration.notice = error.message; integration.render(); }
    };
    integration.render();
    setInterval(() => { integration.poll(); }, 1000);
    document.addEventListener('visibilitychange', () => {
      integration.poll();
      if (document.visibilityState === 'visible') integration.refreshNotifications(false).catch(() => {});
    });
    integration.poll();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mount, { once: true }); else mount();
})(typeof globalThis !== 'undefined' ? globalThis : this);
