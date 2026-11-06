/* Browser regression tests use synthetic host services, never a real account. */
const { chromium } = require('playwright');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const dir = path.resolve(__dirname, '../patches/src/main/resources/greatday8');
const output = path.resolve(__dirname, '../test-results');
fs.mkdirSync(output, { recursive: true });
const fixture = `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1">
<style>:root{--ion-color-primary:#f68a22;--ion-color-primary-contrast:white;--gd-comp-color-bg-1:#f0f2f4;--gd-comp-color-bg-2:white;--ion-text-color:#292b33;--ion-color-medium:#757984}body{margin:0;font-family:Arial,sans-serif;background:#f0f2f4}h2,h3{font-size:72px!important}button{font-size:30px!important}input{font-size:38px!important}p{color:red!important}</style>
<script>
window.mode=new URLSearchParams(location.search).get('mode')||'online';
window._now=Date.parse('2026-11-05T23:59:50Z');Date.now=()=>window._now;
window.saved=[];window.calls=[];window.notifications=[];
window.Capacitor={nativePromise:async(p,m,o)=>{
 if(mode==='notify-blocked')return new Promise(()=>{});
 if(m==='getPending')return{notifications:[{id:7},...notifications]};
 if(m.includes('Permissions'))return{display:'granted'};
 if(m==='cancel'){notifications=notifications.filter(n=>!o.notifications.some(x=>x.id===n.id));return{}};
 if(m==='schedule'){notifications.push(...o.notifications);return{notifications:o.notifications}};
 return{};
}};
</script><script src="/core.js"></script><script src="/runtime.js"></script><script src="/ui.js"></script></head><body><app-root><main style="padding:20px"><h1>GreatDay test host</h1><p>Synthetic services. No company data.</p></main></app-root>
<script>
if(mode!=='unbound'){
 window.network={isOnline:mode!=='offline',isOffline:mode==='offline'};
 window.machine={networkService:network,auth:{gdAuth:{id:'test-company',userId:'test-user'},companySetting:{offlineMode:true}},getAttendanceSetting:()=>({takePhoto:false}),recordAttendance:async flags=>{calls.push(flags);return{id:'record-'+calls.length,datetime:new Date(_now).toISOString(),geolocation:{latitude:1,longitude:2}}}};
 window.nav={deviceService:{isNative:true},responsiveService:{getIsMobile:()=>true},push:async(route,params)=>{
   window.lastRoute=route;
   const el=document.createElement('app-time-attendance-preview');el.textContent='Native preview fixture';document.querySelector('app-root').appendChild(el);
   const service={saveAttendanceToStorage:async params=>{saved.push(params);return saved}};
   const preview={params,attendanceMachineService:machine,attendanceSyncService:service,attendancePreviewService:{},disableBtnSaveAttendance:false,showSaveAttendance:true,btnSave:true,isValidTime:true,saveAttendance:async()=>service.saveAttendanceToStorage(params)};
   DikaOffline.attachPreview(preview);
 }};
 DikaOffline.attachMachine(machine);DikaOffline.attachNavigation(nav);
}
</script></body></html>`;

(async () => {
  const server = http.createServer((req, res) => {
    const pathname = new URL(req.url, 'http://localhost').pathname;
    if (['/core.js', '/runtime.js', '/ui.js'].includes(pathname)) {
      res.setHeader('Content-Type', 'text/javascript'); res.end(fs.readFileSync(path.join(dir, pathname.slice(1))));
    } else { res.setHeader('Content-Type', 'text/html'); res.end(fixture); }
  }).listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  let browser;
  try {
    browser = await chromium.launch({ headless: true });
    const base = `http://127.0.0.1:${server.address().port}`;
    for (const mode of ['unbound', 'online', 'offline', 'notify-blocked']) {
      const context = await browser.newContext({ viewport: { width: 412, height: 820 }, timezoneId: 'Europe/London', locale: 'id-ID' });
      const page = await context.newPage(), errors = []; page.on('pageerror', error => errors.push(String(error)));
      await page.goto(`${base}/?mode=${mode}`); await page.click('#dika-open');
      await page.waitForSelector('#dika-panel[data-open]');
      assert.equal(await page.locator('#dika-zone').count(), 0);
      assert.equal(await page.locator('#dika-save').isEnabled(), true);
      await page.fill('#dika-in', '08:00'); await page.fill('#dika-out', '21:30');
      await page.locator('#dika-days input[value="2"]').uncheck();
      if (mode !== 'unbound') await page.check('#dika-enabled');
      await page.click('#dika-save');
      await page.waitForFunction(() => DikaOffline.settings().inTime === '08:00');
      assert.equal(await page.locator('#dika-save').isEnabled(), true);
      const current = await page.evaluate(() => DikaOffline.settings());
      assert.equal(current.zone, 'Asia/Makassar'); assert.equal(current.days.includes(2), false);
      assert.equal(await page.textContent('#dika-in-display'), '08:00');
      assert.equal(await page.textContent('#dika-out-display'), '21:30');
      await page.waitForSelector('#dika-panel', { state: 'hidden' });
      await page.click('#dika-open');
      assert.equal(await page.textContent('#dika-message'), '');
      const titleSize = await page.locator('#dika-title').evaluate(el => getComputedStyle(el).fontSize);
      assert.equal(titleSize, '20px'); // Host's !important 72px rule must not leak.
      const accent = await page.locator('#dika-save').evaluate(el => getComputedStyle(el).backgroundColor);
      assert.equal(accent, 'rgb(246, 138, 34)');
      await page.locator('#dika-panel').evaluate(el => Promise.all(el.getAnimations({ subtree: true }).map(a => a.finished.catch(() => {}))));
      await page.screenshot({ path: path.join(output, `settings-${mode}.png`) });
      await page.click('#dika-close'); await page.waitForSelector('#dika-panel', { state: 'hidden' });
      if (mode === 'online' || mode === 'offline') {
        await page.evaluate(() => { window._now = Date.parse('2026-11-06T00:00:10Z'); return DikaOffline.poll(); });
        assert.equal(await page.evaluate(() => saved.length), 1);
        assert.equal(await page.evaluate(() => DikaOffline.engine.ledger['2026-11-06:in'].status), 'stored-offline');
        assert.equal(await page.evaluate(() => network.isOnline), mode === 'online');
        assert.equal(await page.evaluate(() => calls[0].isOnline), false);
        assert.equal(await page.evaluate(() => saved[0].datetime), '2026-11-06T00:00:10.000Z');
        await page.evaluate(() => DikaOffline.poll()); assert.equal(await page.evaluate(() => saved.length), 1);
      }
      await page.reload(); await page.click('#dika-open');
      assert.equal(await page.inputValue('#dika-in'), '08:00');
      assert.equal(await page.inputValue('#dika-out'), '21:30');
      assert.equal(await page.locator('#dika-days input[value="2"]').isChecked(), false);
      for (const day of await page.locator('#dika-days input').all()) await day.uncheck();
      await page.click('#dika-save');
      assert.match(await page.textContent('#dika-message'), /Pilih hari kerja/);
      assert.equal(await page.locator('#dika-save').isEnabled(), true);
      await page.locator('#dika-days input[value="1"]').check(); await page.click('#dika-save');
      await page.waitForSelector('#dika-panel', { state: 'hidden' });
      assert.equal(await page.textContent('#dika-message'), '');
      assert.deepEqual(errors, []);
      await context.close(); console.log(`PASS browser ${mode}: save, reload, validation, fixed WITA, scoped styles`);
    }
    for (const size of [{ width: 320, height: 640 }, { width: 768, height: 1024 }]) {
      const page = await browser.newPage({ viewport: size, locale: 'id-ID' }); await page.goto(`${base}/?mode=online`); await page.click('#dika-open');
      await page.locator('#dika-panel').evaluate(el => Promise.all(el.getAnimations({ subtree: true }).map(a => a.finished.catch(() => {}))));
      const card = await page.locator('#dika-card').boundingBox(), save = await page.locator('#dika-save').boundingBox();
      assert.ok(card.x >= 0 && card.x + card.width <= size.width);
      assert.ok(save.y >= 0 && save.y + save.height <= size.height);
      await page.screenshot({ path: path.join(output, `settings-${size.width}.png`) }); await page.close();
      console.log(`PASS layout ${size.width}x${size.height}`);
    }
  } finally { if (browser) await browser.close(); server.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
