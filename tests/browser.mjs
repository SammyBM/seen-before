import assert from 'node:assert/strict';
import http from 'node:http';
import path from 'node:path';
import fs from 'node:fs/promises';
import os from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
let playwright;
try { playwright = await import('playwright'); }
catch {
  if (!process.env.PLAYWRIGHT_MODULE) {
    throw new Error('Browser checks need Playwright. Run npm install --no-save playwright and npx playwright install chromium first.');
  }
  playwright = await import(pathToFileURL(path.resolve(process.env.PLAYWRIGHT_MODULE)).href);
}
const executablePath = process.env.CHROMIUM_PATH || playwright.chromium.executablePath();
const cdpInstall = process.env.EXTENSION_CDP === '1';
const collectUICoverage = process.env.COLLECT_UI_COVERAGE === '1';
const uiCoverage = [];
const coveragePages = new Set();
async function startCoverage(page) {
  if (!collectUICoverage) return;
  await page.coverage.startJSCoverage({resetOnNavigation:false});
  coveragePages.add(page);
}
async function checkpointCoverage() {
  if (!collectUICoverage) return;
  for (const page of coveragePages) {
    if (page.isClosed()) { coveragePages.delete(page); continue; }
    uiCoverage.push(...await page.coverage.stopJSCoverage());
    await page.coverage.startJSCoverage({resetOnNavigation:false});
  }
}

const profile = await fs.mkdtemp(path.join(os.tmpdir(), 'seen-before-test-'));
const screenshotDir = process.env.SCREENSHOT_DIR || path.join(root, 'test-results');
await fs.mkdir(screenshotDir, { recursive: true });
const html = `<!doctype html><html lang="en"><meta charset="utf-8"><title>Seen Before browser test</title>
<style>body{font:18px system-ui;margin:48px;color:#18304d}a{display:block;margin:18px 0;width:max-content}iframe{height:100px}</style>
<h1>Link memory test</h1><p>Local browser verification fixture.</p>
<a id="normal" href="/article"><span>Read an article</span></a>
<a id="fragment-repeat" href="/article#part">Same article, another section</a>
<a id="query" href="/article?edition=2">Different query</a>
<a id="newtab" href="/newtab" target="_blank" rel="noopener">Open a new tab</a>
<a id="modified" href="/modified">Modified click</a>
<a id="shift" href="/shift">New window click</a>
<a id="middle" href="/middle">Middle click</a>
<a id="keyboard" href="/keyboard">Keyboard link</a>
<a id="same-fragment" href="#section">Same-page section</a>
<a id="empty-fragment" href="#">Back to top</a>
<a id="download" href="/file.txt" download>Download</a>
<a id="spa" href="/spa">SPA navigation</a>
<div id="shadow-host"></div><div id="dynamic-host"></div>
<div id="section">Section</div><iframe src="/frame"></iframe>
<script>
window.spaActivations=0;
document.getElementById('spa').addEventListener('click', e=>{e.preventDefault();window.spaActivations++;history.pushState({},'', '/spa');});
document.getElementById('shadow-host').attachShadow({mode:'open'}).innerHTML='<a id="shadow" href="/shadow">Shadow link</a>';
</script></html>`;
const server = http.createServer((req, res) => {
  if (req.url === '/file.txt') { res.writeHead(200, {'content-type':'text/plain'}); res.end('sample'); return; }
  res.writeHead(200, {'content-type':'text/html; charset=utf-8'});
  if (req.url === '/frame') res.end('<!doctype html><a id="frame-link" href="/framed" target="_top">Frame link</a>');
  else if (req.url?.startsWith('/source')) res.end(html);
  else res.end('<!doctype html><title>Destination</title><h1>Destination</h1><p id="part">Part</p><a href="/source">Back to links</a>');
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
let context;
let installedExtensionId;
const results = [];
const errors = [];
async function check(name, fn) {
  await fn();
  await checkpointCoverage();
  results.push(name);
  console.log(`PASS ${name}`);
}
async function waitFor(predicate, label) {
  const deadline = Date.now() + 7000;
  while (Date.now() < deadline) {
    if (await predicate()) return;
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  throw new Error(`Timed out: ${label}`);
}
try {
  async function launch() {
    const launched = await playwright.chromium.launchPersistentContext(profile, {
      executablePath,
      headless: true,
      ignoreDefaultArgs: cdpInstall ? ['--disable-extensions'] : [],
      viewport: {width:1100,height:820},
      args: ['--no-sandbox', '--disable-dev-shm-usage', ...(cdpInstall
        ? ['--enable-unsafe-extension-debugging']
        : [`--disable-extensions-except=${root}`, `--load-extension=${root}`])]
    });
    launched.setDefaultTimeout(10000);
    launched.setDefaultNavigationTimeout(10000);
    launched.on('page', p => p.on('pageerror', e => errors.push(e.message)));
    if (cdpInstall) {
      const cdp = await launched.browser().newBrowserCDPSession();
      const { extensions } = await cdp.send('Extensions.getExtensions');
      const existing = extensions.find(ext => ext.path === root);
      installedExtensionId = existing?.id || (await cdp.send('Extensions.loadUnpacked', {path:root})).id;
      await cdp.detach();
    }
    return launched;
  }
  context = await launch();
  let worker = context.serviceWorkers()[0];
  if (!worker && !installedExtensionId) worker = await context.waitForEvent('serviceworker', {timeout:10000});
  const extensionId = installedExtensionId || new URL(worker.url()).host;
  const popup = await context.newPage();
  await popup.setViewportSize({width:380,height:700});
  await startCoverage(popup);
  await popup.goto(`chrome-extension://${extensionId}/popup.html`);
  async function message(type, extra = {}) {
    const result = await popup.evaluate(request => chrome.runtime.sendMessage(request), {type, ...extra});
    assert.equal(result?.ok, true, JSON.stringify(result));
    return result;
  }
  async function state() { return message('GET_STATE'); }
  async function reset() { await message('CLEAR_HISTORY'); await message('SET_ENABLED', {enabled:true}); }
  const page = await context.newPage();
  await startCoverage(page);
  page.on('pageerror', e => errors.push(e.message));
  async function source() { await checkpointCoverage(); await page.goto(origin + '/source'); }
  const dialog = () => page.getByRole('dialog');
  async function repeat(selector, options) {
    await page.locator(selector).click(options);
    await dialog().waitFor({state:'visible'});
    assert.equal(new URL(page.url()).pathname, '/source');
  }
  async function cancel() {
    await page.getByRole('button', {name:/cancel/i}).click();
    await dialog().waitFor({state:'hidden'});
  }
  await reset();
  await check('extension installs and popup starts empty', async()=> {
    assert.equal((await state()).total,0);
    assert.match(await popup.locator('body').innerText(), /Seen Before/i);
    await popup.locator('body').screenshot({path:path.join(screenshotDir,'popup-empty.png')});
  });
  await check('first click navigates and persists one record', async()=> {
    await source();
    await page.locator('#normal span').click();
    await page.waitForURL(origin+'/article');
    const data = await state();
    assert.equal(data.total,1);
    assert.equal(data.records[0].url,origin+'/article');
    assert.equal(data.records[0].clickCount,1);
  });
  await check('repeat warns before navigation; Cancel preserves count and focus', async()=> {
    await source();
    await repeat('#normal');
    await page.screenshot({path:path.join(screenshotDir,'repeat-warning.png')});
    await cancel();
    assert.equal((await state()).records[0].clickCount,1);
    assert.equal(await page.locator('#normal').evaluate(el=>document.activeElement===el),true);
  });
  await check('Open anyway navigates and increments the repeat count', async()=> {
    await repeat('#normal');
    await page.getByRole('button',{name:/open anyway/i}).click();
    await page.waitForURL(origin+'/article');
    assert.equal((await state()).records[0].clickCount,2);
  });
  await check('fragment variants warn; query variants are distinct', async()=> {
    await source();
    await repeat('#fragment-repeat');
    await cancel();
    await page.locator('#query').click();
    await page.waitForURL(origin+'/article?edition=2');
    assert.equal((await state()).total,2);
  });
  await check('same-page anchors and downloads are excluded', async()=> {
    await source();
    await page.locator('#same-fragment').click();
    await page.waitForURL(origin+'/source#section');
    await page.locator('#same-fragment').click();
    await page.locator('#empty-fragment').click();
    assert.equal(new URL(page.url()).pathname,'/source');
    const downloaded = page.waitForEvent('download');
    await page.locator('#download').click();
    await downloaded;
    assert.equal((await state()).total,2);
  });
  await check('target blank first and repeat preserve new tabs', async()=> {
    await source();
    let next = context.waitForEvent('page');
    await page.locator('#newtab').click();
    let child = await next; await child.waitForURL(origin+'/newtab'); await child.close();
    await repeat('#newtab');
    next = context.waitForEvent('page');
    await page.getByRole('button',{name:/open anyway/i}).click();
    child = await next; await child.waitForURL(origin+'/newtab'); await child.close();
    assert.equal(new URL(page.url()).pathname,'/source');
  });
  await check('Ctrl click first and repeat preserve new tabs', async()=> {
    await source();
    let next = context.waitForEvent('page');
    await page.locator('#modified').click({modifiers:['Control']});
    let child = await next; await child.waitForURL(origin+'/modified'); await child.close();
    await repeat('#modified',{modifiers:['Control']});
    next = context.waitForEvent('page');
    await page.getByRole('button',{name:/open anyway/i}).click();
    child = await next; await child.waitForURL(origin+'/modified'); await child.close();
  });
  await check('Shift click first and repeat preserve a separate window', async()=> {
    await source();
    let next = context.waitForEvent('page');
    await page.locator('#shift').click({modifiers:['Shift']});
    let child = await next; await child.waitForURL(origin+'/shift'); await child.close();
    await repeat('#shift',{modifiers:['Shift']});
    next = context.waitForEvent('page');
    await page.getByRole('button',{name:/open anyway/i}).click();
    child = await next; await child.waitForURL(origin+'/shift'); await child.close();
    assert.equal(new URL(page.url()).pathname,'/source');
  });
  await check('middle click first and repeat preserve new tabs', async()=> {
    await source();
    let next = context.waitForEvent('page');
    await page.locator('#middle').click({button:'middle'});
    let child = await next; await child.waitForURL(origin+'/middle'); await child.close();
    await repeat('#middle',{button:'middle'});
    next = context.waitForEvent('page');
    await page.getByRole('button',{name:/open anyway/i}).click();
    child = await next; await child.waitForURL(origin+'/middle'); await child.close();
  });
  await check('keyboard activation and Escape cancellation', async()=> {
    await source(); await page.locator('#keyboard').focus(); await page.keyboard.press('Enter');
    await page.waitForURL(origin+'/keyboard');
    await source(); await page.locator('#keyboard').focus(); await page.keyboard.press('Enter');
    await dialog().waitFor({state:'visible'});
    assert.equal(await page.getByRole('button',{name:/open anyway/i}).evaluate(el=>el.getRootNode().activeElement===el),true);
    await page.keyboard.press('Tab');
    assert.equal(await page.getByRole('button',{name:/cancel/i}).evaluate(el=>el.getRootNode().activeElement===el),true);
    await page.keyboard.press('Tab');
    assert.equal(await page.getByRole('button',{name:/open anyway/i}).evaluate(el=>el.getRootNode().activeElement===el),true);
    await page.keyboard.press('Escape'); await dialog().waitFor({state:'hidden'});
    assert.equal(new URL(page.url()).pathname,'/source');
  });
  await check('dynamic links, open shadow roots and frames are tracked', async()=> {
    await source();
    await page.evaluate(()=>{const a=document.createElement('a');a.id='dynamic';a.href='/dynamic';a.textContent='Dynamic';document.getElementById('dynamic-host').append(a);});
    await page.locator('#dynamic').click(); await page.waitForURL(origin+'/dynamic');
    await source(); await page.locator('#shadow').click(); await page.waitForURL(origin+'/shadow');
    await source(); await page.frameLocator('iframe').locator('#frame-link').click(); await page.waitForURL(origin+'/framed');
    const urls = (await state()).records.map(r=>r.url);
    for(const name of ['dynamic','shadow','framed']) assert.ok(urls.includes(origin+'/'+name));
  });
  await check('SPA click handlers run once with native route behavior', async()=> {
    await source(); await page.locator('#spa').click(); await page.waitForURL(origin+'/spa');
    assert.equal(await page.evaluate(()=>window.spaActivations),1);
    await source(); await repeat('#spa');
    assert.equal(await page.evaluate(()=>window.spaActivations),0);
    await page.getByRole('button',{name:/open anyway/i}).click(); await page.waitForURL(origin+'/spa');
    assert.equal(await page.evaluate(()=>window.spaActivations),1);
  });
  await check('paused extension allows repeated links without recording', async()=> {
    await message('SET_ENABLED',{enabled:false});
    const previous = await state();
    await source(); await page.locator('#normal').click(); await page.waitForURL(origin+'/article');
    assert.deepEqual((await state()).records,previous.records);
    await message('SET_ENABLED',{enabled:true});
  });
  await check('popup history, toggle, remove and clear controls work', async()=> {
    await popup.reload();
    await popup.locator('body').screenshot({path:path.join(screenshotDir,'popup-history.png')});
    assert.match(await popup.locator('body').innerText(), /127\.0\.0\.1/);
    const before = (await state()).total;
    const remove = popup.getByRole('button',{name:/remove|forget/i}).first();
    await remove.click();
    await waitFor(async()=> (await state()).total===before-1,'remove reflected in state');
    const toggle = popup.getByRole('checkbox').or(popup.getByRole('switch')).first();
    await toggle.click(); await waitFor(async()=> !(await state()).enabled,'pause toggle');
    await toggle.click(); await waitFor(async()=> (await state()).enabled,'resume toggle');
    await popup.getByRole('button',{name:/clear history/i}).click();
    const confirm = popup.getByRole('button',{name:/clear|yes|confirm/i}).last();
    await confirm.click();
    await waitFor(async()=> (await state()).total===0,'clear reflected in state');
  });
  await check('history survives a full browser restart', async()=> {
    await source(); await page.locator('#normal').click(); await page.waitForURL(origin+'/article');
    if (collectUICoverage) {
      uiCoverage.push(...await popup.coverage.stopJSCoverage(),...await page.coverage.stopJSCoverage());
      coveragePages.delete(popup); coveragePages.delete(page);
    }
    await context.close();
    context = await launch();
    const restarted = await context.newPage(); await restarted.goto(origin+'/source');
    await restarted.locator('#normal').click();
    await restarted.getByRole('dialog').waitFor({state:'visible'});
    assert.equal(new URL(restarted.url()).pathname,'/source');
  });
  await check('extension reload fails open on an already-open page', async()=> {
    const restarted = context.pages().find(p=>p.url().startsWith(origin+'/source'));
    await restarted.getByRole('button',{name:/cancel/i}).click();
    const currentWorker = context.serviceWorkers()[0];
    await currentWorker.evaluate(()=>chrome.runtime.reload()).catch(error=> {
      if (!/closed|destroyed|reload/i.test(error.message)) throw error;
    });
    await new Promise(resolve=>setTimeout(resolve,300));
    await restarted.locator('#query').click();
    await restarted.waitForURL(origin+'/article?edition=2');
  });
  if (collectUICoverage) await fs.writeFile(path.join(screenshotDir,'ui-v8-coverage.json'),JSON.stringify(uiCoverage));
  assert.deepEqual(errors,[],'No unhandled browser errors');
  console.log(`\n${results.length} browser scenarios passed.`);
  await fs.writeFile(path.join(screenshotDir,'browser-results.json'), JSON.stringify({browser:await context.browser().version(),cdpInstall,passed:results.length,scenarios:results,errors},null,2)+'\n');
} finally {
  if(context) await context.close();
  await new Promise(resolve=>server.close(resolve));
  await fs.rm(profile,{recursive:true,force:true});
}
