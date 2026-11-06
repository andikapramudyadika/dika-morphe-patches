const { test } = require('node:test');
const assert = require('node:assert/strict');
const Core = require('../patches/src/main/resources/greatday8/core.js');
const { Integration } = require('../patches/src/main/resources/greatday8/runtime.js');
const NOW = Date.parse('2026-11-06T00:00:10Z'); // Friday, 08:00 WITA
const config = { ...Core.DEFAULT, enabled: true, inTime: '08:00', outTime: '21:55' };

test('schedule uses chosen zone, workdays, and only the current minute', () => {
  assert.equal(Core.due(config, NOW, {}).length, 1);
  assert.equal(Core.due({ ...config, zone: 'Asia/Jakarta' }, NOW, {}).length, 0);
  assert.equal(Core.due({ ...config, days: [1] }, NOW, {}).length, 0);
  assert.equal(Core.due(config, NOW + 60000, {}).length, 0);
  assert.equal(Core.due({ ...config, enabled: false }, NOW, {}).length, 0);
  assert.equal(Core.wall(Date.parse('2026-11-05T16:00:00Z'), config.zone).date, '2026-11-06');
});
test('invalid, duplicate and empty schedules are rejected', () => {
  for (const bad of [{ inTime: '25:00' }, { days: [] }, { days: [0] }, { zone: 'UTC' }, { outTime: config.inTime }]) {
    assert.throws(() => Core.validate({ ...config, ...bad }));
  }
});
test('at most once survives concurrent polling, restart and time edits', async () => {
  let data, calls = 0, unblock;
  const options = { load: () => data, save: d => { data = JSON.parse(JSON.stringify(d)); }, now: () => NOW,
    run: () => { calls++; return new Promise(resolve => { unblock = resolve; }); } };
  const e = new Core.Engine(options); e.configure(config);
  const first = e.tick(); await e.tick(); assert.equal(calls, 1);
  assert.equal(data.ledger['2026-11-06:in'].status, 'running');
  const restarted = new Core.Engine({ ...options, run: () => { calls++; } });
  assert.equal(restarted.ledger['2026-11-06:in'].status, 'interrupted');
  await restarted.tick(); assert.equal(calls, 1);
  e.configure({ ...config, inTime: '08:01' });
  unblock(); await first;
  e.now = () => NOW + 60000; await e.tick(); assert.equal(calls, 1);
});
test('a storage reservation failure prevents recording entirely', async () => {
  let calls = 0;
  const e = new Core.Engine({ load: () => ({ config }), save: () => { throw Error('full'); }, now: () => NOW, run: () => { calls++; } });
  await assert.rejects(e.tick()); assert.equal(calls, 0);
});
test('notification dates are future-only, bounded, and in WITA', () => {
  const plan = Core.notificationPlan(config, NOW);
  assert.ok(plan.length <= 28 && plan.length > 0);
  assert.ok(plan.every(n => n.at > NOW));
  assert.equal(plan[0].slot, 'out');
  assert.equal(Core.wall(plan[0].at, config.zone).time, '21:55');
  assert.equal(Core.notificationPlan({ ...config, enabled: false }, NOW).length, 0);
});

function fixture({ allowed = true, visible = true, failStore = false } = {}) {
  let now = NOW;
  const map = new Map(), doc = { visibilityState: visible ? 'visible' : 'hidden', querySelectorAll: () => [] };
  const app = new Integration({ root: {}, document: doc, now: () => now,
    storage: { getItem: k => map.get(k) || null, setItem: (k, v) => map.set(k, v) } });
  app.refreshNotifications = async () => {};
  const machine = { auth: { gdAuth: { id: 'company-test', userId: 'user-test' }, companySetting: { offlineMode: allowed } },
    getAttendanceSetting: () => ({ takePhoto: false }) };
  let calls = 0, saves = 0;
  const service = { saveAttendanceToStorage: async params => { saves++; if (failStore) throw Error('store failed'); return [params]; } };
  const controller = { attendanceMachineService: machine,
    recordAttendance(barcode) { calls++; assert.equal(barcode, false);
      const ticket = app.ticketFor(controller);
      app.captured(ticket, { id: 'new-record', attOn: 'offline' });
      return Promise.resolve();
    } };
  app.attachOffline(controller); app.engine.configure(config);
  const preview = { params: { id: 'new-record', attOn: 'offline' }, attendanceMachineService: machine,
    attendanceSyncService: service, attendancePreviewService: {},
    disableBtnSaveAttendance: false, showSaveAttendance: true, btnSave: true, isValidTime: true,
    saveAttendance: async () => service.saveAttendanceToStorage(preview.params) };
  return { app, controller, preview, doc, machine, service, calls: () => calls, saves: () => saves,
    setNow: n => { now = n; }, activatePreview() { app.attachPreview(preview); app.visible = sel => sel === 'app-time-attendance-preview'; } };
}
test('only the native persisted result produces stored-offline status', async () => {
  const f = fixture(); await f.app.poll();
  assert.equal(f.calls(), 1); assert.equal(f.app.engine.ledger['2026-11-06:in'].status, 'running');
  f.activatePreview(); await f.app.poll();
  assert.equal(f.saves(), 1); assert.equal(f.app.engine.ledger['2026-11-06:in'].status, 'stored-offline');
  await f.app.poll(); assert.equal(f.saves(), 1);
});
test('hidden WebView does not start, and a missed minute is not backfilled', async () => {
  const f = fixture({ visible: false }); await f.app.poll(); assert.equal(f.calls(), 0);
  f.setNow(NOW + 60000); f.doc.visibilityState = 'visible'; await f.app.poll(); assert.equal(f.calls(), 0);
});
test('company offline permission is required', async () => {
  const f = fixture({ allowed: false }); await f.app.poll(); assert.equal(f.calls(), 0);
  assert.equal(f.app.engine.ledger['2026-11-06:in'].status, 'needs-user');
});
test('manual or unrelated records cannot be attributed to an automatic attempt', async () => {
  const f = fixture(); await f.app.poll();
  f.app.captured(null, { id: 'manual', attOn: 'offline' });
  assert.equal(f.app.active.recordId, 'new-record');
  f.app.persisted({ id: 'manual' }, [{ id: 'manual' }]);
  assert.equal(f.app.engine.ledger['2026-11-06:in'].status, 'running');
});
test('photo, disabled button, face processing, online mode and wrong record prevent auto-save', async () => {
  const mutations = [
    f => { f.preview.disableBtnSaveAttendance = true; },
    f => { f.preview.attendancePreviewService.checkingFaceDetection = true; },
    f => { f.preview.attendancePreviewService.resultFaceDetection = { reject: true }; },
    f => { f.preview.params.attOn = 'online'; },
    f => { f.preview.params.id = 'other'; },
    f => { f.preview.isSetFirstBP = true; },
    f => { f.preview.isValidTime = false; },
    f => { f.machine.getAttendanceSetting = () => ({ takePhoto: true }); }
  ];
  for (const change of mutations) {
    const f = fixture(); await f.app.poll(); f.activatePreview(); change(f); await f.app.poll(); assert.equal(f.saves(), 0);
  }
});
test('failed native storage is not reported as success or retried', async () => {
  const f = fixture({ failStore: true }); await f.app.poll(); f.activatePreview(); await f.app.poll();
  assert.equal(f.app.engine.ledger['2026-11-06:in'].status, 'needs-user');
  await f.app.poll(); assert.equal(f.saves(), 1); assert.equal(f.calls(), 1);
});
test('account changes cancel the active attempt and do not inherit enabled schedules', async () => {
  const f = fixture(); await f.app.poll(); f.activatePreview();
  const previous = f.app.engine;
  f.machine.auth.gdAuth.userId = 'other-user'; await f.app.poll();
  assert.equal(f.saves(), 0); assert.equal(f.app.engine.config.enabled, false);
  assert.equal(previous.ledger['2026-11-06:in'].status, 'needs-user');
});
test('a late preview never triggers delayed automatic saving', async () => {
  const f = fixture(); await f.app.poll(); f.activatePreview(); f.setNow(NOW + 91000); await f.app.poll();
  assert.equal(f.saves(), 0); assert.equal(f.app.engine.ledger['2026-11-06:in'].status, 'needs-user');
});
test('notification disable operations are serialized and cancel only owned ids', async () => {
  const f = fixture(), operations = [];
  const { NOTIFICATION_BASE } = require('../patches/src/main/resources/greatday8/runtime.js');
  f.app.refreshNotifications = Integration.prototype.refreshNotifications;
  f.app.native = async (method, value) => {
    operations.push([method, value]);
    if (method === 'getPending') return { notifications: [{ id: 5 }, { id: NOTIFICATION_BASE }] };
    if (method === 'checkPermissions') return { display: 'granted' };
    return {};
  };
  const first = f.app.refreshNotifications(false);
  f.app.engine.configure({ ...config, enabled: false });
  const second = f.app.refreshNotifications(false);
  await Promise.all([first, second]);
  assert.equal(operations.some(x => x[0] === 'schedule'), false);
  assert.deepEqual(operations.find(x => x[0] === 'cancel')[1], { notifications: [{ id: NOTIFICATION_BASE }] });
});
