// site-screenshots.mjs
//
// Copyright (c) 2026 braids contributors
//
// braids is distributed under the GNU AGPL v3 license, see LICENSE for details.

// Screenshots for the website (site/img/): the app in Chromium with demo
// data, light and dark. Four Dummy accounts in showcase mode (phone +991..4,
// each with its own share of the demo chats) are shown as Telegram, WhatsApp,
// Signal and Matrix, so the inbox looks like it does with real accounts.
// Usage (from app/, braidsd built with Dummy):
//   node scripts/site-screenshots.mjs [--braidsd PATH]

import { spawn } from 'node:child_process';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const appDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const opt = (name, def) => (args.includes(name) ? args[args.indexOf(name) + 1] : def);
const braidsd = path.resolve(opt('--braidsd', path.join(appDir, '../build/bin/braidsd')));
const out = path.join(appDir, '../site/img');
fs.mkdirSync(out, { recursive: true });

// showcase persona (last digit of the phone number) -> protocol shown
const PERSONAS = { 1: 'Telegram', 2: 'WhatsAppMd', 3: 'Signal', 4: 'Matrix' };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function call(base, method, params = {}) {
  const res = await fetch(`${base}/__braids/call`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ method, params }) });
  const reply = await res.json();
  if (reply.error) throw Object.assign(new Error(reply.error.message), { code: reply.error.code });
  return reply.result;
}

// answers an auth step as soon as braidsd asks for it
async function input(base, setupId, field, value) {
  for (let i = 0; i < 100; i++) {
    try {
      return await call(base, 'accounts.authInput', { setupId, field, value });
    } catch (e) {
      if (e.code !== 5) throw e;
      await sleep(100);
    }
  }
  throw new Error(`no ${field} prompt`);
}

async function addShowcaseAccounts(base) {
  for (const n of Object.keys(PERSONAS)) {
    const { setupId } = await call(base, 'accounts.add', { protocol: 'Dummy' });
    await input(base, setupId, 'phone', `+99${n}`);
    await input(base, setupId, 'code', '1234');
  }
  for (let i = 0; i < 100 && (await call(base, 'accounts.list')).length < 4; i++) await sleep(100);
}

async function session(theme, shots) {
  const confdir = fs.mkdtempSync(path.join(os.tmpdir(), 'braids-site-'));
  const daemon = spawn(braidsd, ['--confdir', confdir], { stdio: 'ignore' });
  process.env.BRAIDS_CONFDIR = confdir;
  const { createServer } = await import('vite');
  const server = await createServer({ root: appDir, configFile: path.join(appDir, 'vite.config.ts'), server: { port: 1430, strictPort: false }, logLevel: 'warn' });
  await server.listen();
  const base = server.resolvedUrls.local[0].replace(/\/$/, '');
  const browser = await chromium.launch();
  try {
    await addShowcaseAccounts(base);
    const page = await browser.newPage({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 2 });
    // the showcase accounts appear as the messengers they stand for
    await page.route('**/__braids/call', async (route) => {
      const body = JSON.parse(route.request().postData() || '{}');
      if (body.method !== 'accounts.list') return route.continue();
      const response = await route.fetch();
      const reply = await response.json();
      for (const a of reply.result ?? []) {
        const persona = a.accountId.slice(-1);
        if (PERSONAS[persona]) a.protocol = PERSONAS[persona];
      }
      await route.fulfill({ response, json: reply });
    });
    await page.addInitScript((t) => {
      localStorage.setItem('braids.settings.v1', JSON.stringify({ theme: t }));
    }, theme);
    await page.goto(base);
    await page.locator('.chatlist .row').nth(6).waitFor();
    // a favorite, for the gold ring
    await page.locator('.row', { has: page.locator('.name', { hasText: /^Pam$/ }) }).click({ button: 'right' });
    await page.getByRole('menuitem', { name: 'Add to favorites' }).click();
    await page.getByRole('option', { name: /The Office/ }).click();
    await page.locator('[data-msg-id]').first().waitFor();
    await page.waitForTimeout(800);
    // day labels at their place in the history (not floating over a message
    // as while scrolling)
    await page.addStyleTag({ content: '.day { position: static !important; }' });
    await page.locator('.messages').evaluate((el) => { el.scrollTop = el.scrollHeight; });
    await shots(page);
  } finally {
    await browser.close();
    await server.close();
    daemon.kill();
  }
}

const save = (page, name) => page.screenshot({ path: path.join(out, `${name}.png`) });

// a close-up: the box of the given elements, with a margin, inside the window
async function saveClip(page, name, selectors, margin = 24) {
  const boxes = [];
  for (const sel of selectors) boxes.push(await page.locator(sel).first().boundingBox());
  const vp = page.viewportSize();
  const x = Math.max(0, Math.min(...boxes.map((b) => b.x)) - margin);
  const y = Math.max(0, Math.min(...boxes.map((b) => b.y)) - margin);
  const right = Math.min(vp.width, Math.max(...boxes.map((b) => b.x + b.width)) + margin);
  const bottom = Math.min(vp.height, Math.max(...boxes.map((b) => b.y + b.height)) + margin);
  await page.screenshot({ path: path.join(out, `${name}.png`), clip: { x, y, width: right - x, height: bottom - y } });
}

await session('light', async (page) => {
  await save(page, 'inbox-light');
  // forward anywhere: a Telegram group message to a chat of another messenger
  await page.locator('.msg:not(.own)', { hasText: 'storm your village' }).click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'Forward…' }).click();
  await page.locator('[role=dialog] .target').nth(5).waitFor();
  await page.waitForTimeout(400);
  await saveClip(page, 'forward-light', ['[role=dialog][aria-labelledby=forward-title]'], 0);
  await page.keyboard.press('Escape');
  // keyboard shortcuts
  await page.keyboard.press('Control+,');
  await page.getByRole('button', { name: 'Keyboard' }).click();
  await page.waitForTimeout(300);
  await saveClip(page, 'keyboard-light', ['[role=dialog]'], 0);
});

await session('dark', async (page) => {
  await save(page, 'inbox-dark');
});

console.log(`screenshots in ${out}`);
process.exit(0);
