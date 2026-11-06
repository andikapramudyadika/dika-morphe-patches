/* SPDX-License-Identifier: GPL-3.0-only */
(function (root) {
  'use strict';
  const Core = typeof module === 'object' && module.exports ? require('./core.js') : root.DikaScheduleCore;
  const PREFIX = 'dika.offline.v1.';
  const PREFERENCES = PREFIX + 'preferences';
  const PREVIEW_ROUTE = '/hr/attendance/attendance-record-time/time-attendance-preview';
  const NOTIFICATION_BASE = 1734100000;
  class Integration {
    constructor(env = {}) {
      this.root = env.root || root; this.doc = env.document || root.document;
      this.storage = env.storage || root.localStorage; this.now = env.now || Date.now;
      this.controller = null; this.engine = null; this.identity = null;
      this.machine = null; this.navigation = null; this.automaticController = null;
      this.active = null; this.preview = null; this.starting = false;
      this.observed = new WeakSet(); this.notice = ''; this.notificationRevision = 0;
      this.render = () => {};
      this.notificationQueue = Promise.resolve();
      this.draft = { ...Core.DEFAULT, days: [...Core.DEFAULT.days] };
      try {
        const saved = JSON.parse(this.storage.getItem(PREFERENCES) || 'null');
        if (saved) this.draft = Core.validate(saved);
      } catch (_) { this.notice = 'Pengaturan sebelumnya tidak dapat dibaca.'; }
    }
    account(controller = this.controller) {
      const auth = (this.machine || controller?.attendanceMachineService)?.auth?.gdAuth;
      if (!auth || !auth.id || !(auth.userId || auth.empId)) return null;
      return JSON.stringify([String(auth.id), String(auth.userId || auth.empId)]);
    }
    attachOffline(controller) {
      this.controller = controller;
      this.machine = controller?.attendanceMachineService || this.machine;
      this.ensureAccount();
    }
    attachMachine(machine) {
      this.machine = machine;
      this.connectRecorder(); this.ensureAccount();
    }
    attachNavigation(navigation) {
      this.navigation = navigation;
      this.connectRecorder(); this.ensureAccount();
    }
    connectRecorder() {
      const machine = this.machine, nav = this.navigation;
      if (!machine || !nav || typeof machine.recordAttendance !== 'function' || typeof nav.push !== 'function') return;
      if (nav.deviceService?.isNative !== true || nav.responsiveService?.getIsMobile() !== true) return;
      if (this.automaticController?.attendanceMachineService === machine && this.automaticController.navigation === nav) return;
      const integration = this;
      const controller = { attendanceMachineService: machine, navigation: nav,
        async recordAttendance(barcode) {
          const ticket = integration.ticketFor(controller);
          // Same flags and native-mobile navigation as the supplied APK's
          // original offline action. No network state, checks or time is faked.
          const params = await machine.recordAttendance({ isAttendanceBarcode: barcode, isOnline: false, isOnCall: false });
          if (!params) { if (integration.active?.ticket === ticket) integration.stop('needs-user', 'Pencatatan dibatalkan.'); return; }
          if (!ticket || integration.active?.ticket !== ticket || integration.account() !== integration.active.identity) return;
          params.attOn = 'offline';
          integration.captured(ticket, params);
          if (integration.active?.ticket === ticket) {
            // Like the original offline action, start navigation without
            // awaiting its dismissal Promise (which can remain pending until
            // a later route event). Do not keep the scheduler busy for it.
            Promise.resolve(nav.push(PREVIEW_ROUTE, params, { indexPage: true })).catch(() => {
              if (integration.active?.ticket === ticket) integration.stop('needs-user', 'Preview belum terbuka. Periksa GreatDay.');
            });
          }
        }
      };
      this.automaticController = this.controller = controller;
    }
    settings() { return this.engine?.config || this.draft; }
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
          load: () => JSON.parse(this.storage.getItem(key) || 'null') || { config: { ...this.draft, enabled: false } },
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
      if (p.loadingGetBtn || p.disableBtnSaveAttendance !== false) return;
      let button;
      if (p.btnSave === true && p.showSaveAttendance === true) button = 0;
      else if (p.btnSave === false && active.job.slot === 'in' && p.btnAttendance?.innow === true) button = 1;
      else if (p.btnSave === false && active.job.slot === 'out' && p.btnAttendance?.outnow === true) button = 3;
      else return; // Never select yesterday/tomorrow or an unavailable action.
      if (p.attendancePreviewService?.checkingFaceDetection || p.attendancePreviewService?.isUploading ||
          p.attendancePreviewService?.resultFaceDetection?.reject || p.isSetFirstBP || p.showBtnRetake) return;
      if (p.isValidTime !== true || typeof p.saveAttendance !== 'function') return;
      const settings = p.attendanceMachineService.getAttendanceSetting();
      if (!settings || (settings.takePhoto !== false && !(p.params.imageBase64 || p.params.imageLocal || p.params.imageServer))) return;
      // Persist the intent before invoking the unmodified host save handler.
      active.attempted = true;
      this.engine.event(active.job.key, 'running', 'Meminta GreatDay menyimpan catatan offline.');
      try { await p.saveAttendance(button); }
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
      this.notice = 'Jadwal dan pengingat tersimpan.'; this.render();
    }
    async configure(config) {
      this.ensureAccount();
      const valid = Core.validate(config);
      // Times and days can always be saved, including before a host controller
      // is available. Enabling recording remains scoped to a known account.
      this.draft = this.engine ? valid : { ...valid, enabled: false };
      this.storage.setItem(PREFERENCES, JSON.stringify(this.draft));
      if (this.active) this.stop('needs-user', 'Jadwal diubah; periksa proses absensi yang sedang berjalan.');
      if (!this.engine) { this.notice = 'Jadwal tersimpan. Login untuk mengaktifkan.'; this.render(); return; }
      this.engine.configure(valid);
      this.notice = 'Jadwal tersimpan.'; this.render();
      // Native permission prompts must never hold the Save button hostage.
      this.refreshNotifications(true).catch(() => {
        this.notice = 'Jadwal tersimpan. Izin pengingat belum tersedia.'; this.render();
      });
    }
  }
  if (typeof module === 'object' && module.exports) { module.exports = { Integration, NOTIFICATION_BASE }; return; }
  root.DikaOffline = new Integration();
})(typeof globalThis !== 'undefined' ? globalThis : this);
