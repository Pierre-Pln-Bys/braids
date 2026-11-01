// ui.mjs
//
// Copyright (c) 2026 braids contributors
//
// braids is distributed under the GNU AGPL v3 license, see LICENSE for details.

// End-to-end UI test: a fresh braidsd (Dummy protocol), the web UI from the
// Vite dev server (dev bridge instead of the Tauri shell) and Chromium via
// Playwright. Usage: node tests/ui.mjs [--braidsd PATH] [--screenshots DIR]

import { spawn } from 'node:child_process';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const appDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const opt = (name, def) => (args.includes(name) ? args[args.indexOf(name) + 1] : def);
const braidsd = path.resolve(opt('--braidsd', path.join(appDir, '../build/bin/braidsd')));
const shots = opt('--screenshots', '');

let chromium;
try {
  ({ chromium } = require('playwright'));
} catch {
  ({ chromium } = await import('playwright'));
}

let failures = 0;
function check(cond, msg) {
  if (!cond) {
    failures++;
    console.log(`not ok - ${msg}`);
    throw new Error(msg);
  }
  console.log(`ok - ${msg}`);
}

const confdir = fs.mkdtempSync(path.join(os.tmpdir(), 'braids-ui-'));
const daemon = spawn(braidsd, ['--confdir', confdir], { stdio: ['ignore', 'ignore', 'inherit'] });
process.env.BRAIDS_CONFDIR = confdir;

const { createServer } = await import('vite');
const server = await createServer({ root: appDir, configFile: path.join(appDir, 'vite.config.ts'), server: { port: 1421, strictPort: false }, logLevel: 'warn' });
await server.listen();
const url = server.resolvedUrls.local[0];

const browser = await chromium.launch();
const errors = [];
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => m.type() === 'error' && !m.text().includes('Notification') && errors.push(m.text()));
  const shot = async (name) => shots && (await page.screenshot({ path: path.join(shots, `${name}.png`) }));
  const composer = page.locator('textarea[aria-label=Message]');

  await page.goto(url);
  await page.getByText('Welcome to braids').waitFor({ timeout: 30000 });
  check(true, 'welcome screen without accounts');
  await shot('welcome');

  // add account
  await page.getByRole('button', { name: /Dummy/ }).click();
  await page.locator('#auth-input').waitFor();
  check((await page.locator('label[for=auth-input]').textContent()) === 'Phone number', 'wizard asks for phone');
  await page.fill('#auth-input', '+46 700 1234');
  await page.keyboard.press('Enter');
  await page.waitForFunction(() => document.querySelector('label[for=auth-input]')?.textContent === 'Verification code');
  await page.fill('#auth-input', '000000');
  await page.keyboard.press('Enter');
  await page.locator('.field .error').waitFor();
  check(true, 'wrong code shows an error and asks again');
  await page.fill('#auth-input', '1234');
  await page.keyboard.press('Enter');
  await page.getByText('Done — go to inbox').waitFor({ timeout: 30000 });
  check(true, 'account added, syncing step');
  await page.getByText('Done — go to inbox').click();

  // chat list
  await page.getByRole('option', { name: /The Office/ }).waitFor({ timeout: 30000 });
  check((await page.getByRole('option').count()) >= 2, 'chat list shows the chats');
  // profile pictures: shown where the protocol has one, initials otherwise
  await page.waitForFunction(() => [...document.querySelectorAll('[role=option]')].some((o) => o.textContent.includes('Michael') && o.querySelector('.circle img')?.naturalWidth > 0));
  check(true, 'profile picture shown');
  const dwight = page.locator('.row', { has: page.locator('.name', { hasText: /^Dwight$/ }) });
  check(await dwight.locator('.circle img').count() === 0 && (await dwight.locator('.circle').textContent()) === 'D', 'initials without a picture');
  await page.fill('input[aria-label="Search chats"]', 'offi');
  check((await page.getByRole('option').count()) === 1, 'search filters chats');
  await page.fill('input[aria-label="Search chats"]', '');

  // conversation
  await page.getByRole('option', { name: /The Office/ }).click();
  await page.locator('[data-msg-id]').first().waitFor();
  check((await page.locator('.msg .sender').count()) > 0, 'group shows sender names');
  check((await page.locator('.system-line').first().textContent()) === 'Andy joined', 'group event shown as a system line');
  await page.keyboard.press('Control+i');
  await page.locator('.info .member').first().waitFor();
  check(await page.locator('.info .member').count() === 5, 'member list shows 5');
  await page.getByRole('button', { name: 'Show all 6' }).click();
  check(await page.locator('.info .member').count() === 6, 'member list expands');
  await page.keyboard.press('Control+i');
  await composer.fill('Hello *team* `code`');
  await composer.press('Enter');
  const own = page.locator('.msg.own').last();
  await own.locator('strong', { hasText: 'team' }).waitFor();
  check((await own.locator('code').textContent()) === 'code', 'sent message rendered with markup');
  check((await page.getByRole('option', { name: /The Office/ }).textContent()).includes('You:'), 'chat preview shows own message');

  // @-mention suggestions from the group members
  await composer.fill('');
  await composer.pressSequentially('thanks @an');
  await page.locator('.mentions [role=option]', { hasText: 'Andy' }).waitFor();
  await page.waitForFunction(() => document.querySelectorAll('.mentions [role=option]').length === 1, null, { timeout: 5000 }).catch(() => {});
  check(await page.locator('.mentions [role=option]').count() === 1, 'mention suggestions filtered by name');
  await shot('mention');
  await composer.press('Enter');
  check((await composer.inputValue()) === 'thanks @Andy ', 'Enter inserts the mention');
  await composer.press('Enter');
  await page.locator('.msg.own', { hasText: 'thanks @Andy' }).last().waitFor();
  check(true, 'message with mention sent');

  // one-line message: react and reply side by side
  const oneLiner = page.locator('.msg.own', { hasText: 'Hello team' }).last();
  await oneLiner.hover();
  check(await oneLiner.locator('.actions').evaluate((el) => getComputedStyle(el).flexDirection === 'row' && el.querySelectorAll('button').length === 2),
    'hover bar of a one-line message: react, reply, horizontal');
  // sender name + three lines: two more actions (copy text, forward)
  const threeLiner = page.locator('.msg', { hasText: 'storm your village' }).last();
  await threeLiner.hover();
  check(await threeLiner.locator('.actions').evaluate((el) => [...el.querySelectorAll('button')].map((b) => b.getAttribute('aria-label')).join(',')) === 'React,Reply,Copy text,Forward…',
    'hover bar grows with the message: react, reply, copy text, forward');
  const lastTheirs = page.locator('.msg:not(.own)').last();
  await lastTheirs.hover();
  await lastTheirs.getByRole('button', { name: 'Reply' }).click();
  await page.getByText(/^Replying to/).waitFor();
  await composer.fill('a reply');
  await composer.press('Enter');
  await page.locator('.msg.own .quote').last().waitFor();
  check(true, 'reply with quote');

  const last = page.locator('.msg.own').last();
  await last.hover();
  check(await last.locator('.actions').evaluate((el) => el.querySelectorAll('button').length >= 2), 'hover bar shown');
  await last.getByRole('button', { name: 'React', exact: true }).click();
  await page.locator('.react-pop button').first().click();
  await last.locator('.chip.mine').waitFor();
  check(true, 'reaction added');
  await last.locator('.chip.mine').click();
  await last.locator('.chip.mine').waitFor({ state: 'detached' });
  check(true, 'reaction removed');

  await composer.focus();
  await composer.press('ArrowUp');
  await page.getByText('Editing message').waitFor();
  await composer.fill('a reply, edited');
  await composer.press('Enter');
  await page.locator('.msg.own').last().getByText('edited', { exact: true }).waitFor();
  check((await page.locator('.msg.own').last().textContent()).includes('a reply, edited'), 'edit shown in place');
  await shot('conversation');

  await page.locator('.msg.own').last().click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'Delete for everyone' }).click();
  await page.getByRole('button', { name: 'Delete for everyone' }).click();
  await page.waitForFunction(() => !document.body.textContent.includes('a reply, edited'));
  check(true, 'delete with confirmation');

  // more menu: copy, forward with origin line (to the same chat, so no other
  // chat's preview mentions it)
  await page.getByRole('option', { name: /Michael/ }).click();
  const theirs = page.locator('.msg:not(.own)').last();
  await theirs.waitFor();
  await theirs.hover();
  await shot('hover-bar');
  // two-line message: react and reply stacked, nothing more
  check(await theirs.locator('.actions').evaluate((el) => getComputedStyle(el).flexDirection === 'column' && el.querySelectorAll('button').length === 2),
    'hover bar of a two-line message: react, reply, vertical');
  await theirs.click({ button: 'right' });
  check(await page.getByRole('menuitem', { name: 'Copy text' }).count() === 1 && await page.getByRole('menuitem', { name: 'Open file' }).count() === 0,
    'context menu has copy, no open');
  await page.getByRole('menuitem', { name: 'Forward…' }).click();
  await page.getByText('Forward message').waitFor();
  check(await page.getByLabel('Add “Forwarded from” line').isChecked(), '"Forwarded from" line on by default');
  await page.fill('input[aria-label="Search chats to forward to"]', 'Michael');
  await page.locator('.target', { hasText: 'Michael' }).first().click();
  await page.locator('.toast', { hasText: 'Forwarded to Michael' }).waitFor();
  await page.locator('.msg.own', { hasText: 'Forwarded from Michael' }).last().waitFor();
  check(true, 'message forwarded with origin line');
  await page.getByRole('option', { name: /The Office/ }).click();
  await page.locator('[data-msg-id]').first().waitFor();

  // draft survives switching chats
  await composer.fill('unsent words');
  await page.getByRole('option', { name: /Michael/ }).click();
  check((await page.getByRole('option', { name: /The Office/ }).textContent()).includes('Draft:'), 'draft shown in chat list');
  await page.getByRole('option', { name: /The Office/ }).click();
  check((await composer.inputValue()) === 'unsent words', 'draft restored');
  await composer.fill('');

  // images: a sent photo is shown inline (the type is guessed from the extension)
  const png = path.join(confdir, '..', `braids-ui-${process.pid}.png`);
  fs.writeFileSync(png, Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64'));
  await page.evaluate(async (filePath) => {
    const accounts = await (await fetch('/__braids/call', { method: 'POST', body: JSON.stringify({ method: 'accounts.list' }) })).json();
    await fetch('/__braids/call', { method: 'POST', body: JSON.stringify({ method: 'messages.send', params: { accountId: accounts.result[0].accountId, chatId: 'Michael_0', filePath } }) });
  }, png);
  await page.getByRole('option', { name: /Michael/ }).click();
  await page.waitForFunction(() => [...document.querySelectorAll('.msg .image img')].some((img) => img.naturalWidth > 0));
  check(true, 'sent image shown inline');

  // a pasted photo is previewed as a small tile before sending
  await page.evaluate(async () => {
    const b64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
    const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
    const dt = new DataTransfer();
    dt.items.add(new File([bytes], 'holiday.png', { type: 'image/png' }));
    document.querySelector('textarea[aria-label=Message]').dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
  });
  await page.waitForFunction(() => [...document.querySelectorAll('.composer .thumb img')].some((img) => img.naturalWidth > 0));
  check(true, 'attached photo previewed');
  await shot('attachment-preview');
  await page.locator('.composer .thumb .remove').click();
  check(await page.locator('.composer .thumb').count() === 0, 'preview removed with the attachment');

  // forwarding an image keeps the image and adds the origin line
  const images = () => page.locator('.msg.own .image').count();
  const imagesBefore = await images();
  await page.locator('.msg.own', { has: page.locator('.image') }).last().click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'Forward…' }).click();
  await page.fill('input[aria-label="Search chats to forward to"]', 'Michael');
  await page.locator('.target', { hasText: 'Michael' }).first().click();
  await page.waitForFunction((n) => document.querySelectorAll('.msg.own .image').length > n, imagesBefore);
  check((await page.locator('.msg.own', { has: page.locator('.image') }).last().textContent()).includes('Forwarded from me'),
    'forwarded image with origin line');

  // voice messages: inline player with play / pause and time
  const wav = path.join(confdir, '..', `braids-ui-${process.pid}.wav`);
  {
    const rate = 8000;
    const samples = rate; // 1 s
    const buf = Buffer.alloc(44 + samples * 2);
    buf.write('RIFF', 0); buf.writeUInt32LE(36 + samples * 2, 4); buf.write('WAVE', 8); buf.write('fmt ', 12);
    buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20); buf.writeUInt16LE(1, 22); buf.writeUInt32LE(rate, 24);
    buf.writeUInt32LE(rate * 2, 28); buf.writeUInt16LE(2, 32); buf.writeUInt16LE(16, 34); buf.write('data', 36); buf.writeUInt32LE(samples * 2, 40);
    for (let i = 0; i < samples; i++) buf.writeInt16LE(Math.round(Math.sin((i * 2 * Math.PI * 440) / rate) * 8000), 44 + i * 2);
    fs.writeFileSync(wav, buf);
  }
  await page.evaluate(async (filePath) => {
    const accounts = await (await fetch('/__braids/call', { method: 'POST', body: JSON.stringify({ method: 'accounts.list' }) })).json();
    await fetch('/__braids/call', { method: 'POST', body: JSON.stringify({ method: 'messages.send', params: { accountId: accounts.result[0].accountId, chatId: 'Michael_0', filePath } }) });
  }, wav);
  const voice = page.locator('.msg .voice').last();
  await voice.waitFor();
  await page.waitForFunction(() => document.querySelector('.msg:last-of-type .voice .time, .voice .time')?.textContent === '0:01', null, { timeout: 10000 }).catch(() => {});
  check((await voice.locator('.time').textContent()) === '0:01', 'voice message shows its duration');
  await voice.getByRole('button', { name: 'Play', exact: true }).click();
  await voice.getByRole('button', { name: 'Pause' }).waitFor();
  check(true, 'voice message plays');
  await voice.getByRole('button', { name: 'Playback speed' }).click();
  check((await voice.getByRole('button', { name: 'Playback speed' }).textContent()) === '1.5×', 'playback speed');
  await voice.getByRole('button', { name: 'Play', exact: true }).waitFor({ timeout: 5000 });
  check(true, 'voice message ends');

  // shared media: across all chats, images and links, "Show in chat"
  await composer.fill('docs at https://example.org/braids');
  await composer.press('Enter');
  await page.getByRole('button', { name: 'Shared media' }).click();
  await page.locator('[role=dialog] .thumb img').first().waitFor();
  check(await page.locator('[role=dialog] .thumb').count() >= 2, 'shared media lists the images of all chats');
  await shot('shared-media');
  await page.getByRole('tab', { name: 'Links' }).click();
  await page.locator('[role=dialog] .row', { hasText: 'example.org' }).waitFor();
  check(true, 'shared links listed');
  await shot('shared-links');
  await page.getByRole('tab', { name: 'Files' }).click();
  await page.locator('[role=dialog] .row', { hasText: '.wav' }).waitFor();
  check(true, 'files tab lists the audio file');
  await page.getByRole('tab', { name: 'Media' }).click();
  await page.locator('[role=dialog] .tile').first().hover();
  await page.locator('[role=dialog] .goto').first().click();
  await page.waitForFunction(() => !document.querySelector('[aria-labelledby=media-title]'));
  check(true, 'show in chat closes the dialog');
  await page.keyboard.press('Control+i');
  await page.locator('.info .media img').first().waitFor();
  await page.getByRole('button', { name: 'Show all' }).click();
  check((await page.locator('#media-title').textContent()).startsWith('Shared in'), 'chat media from the info panel');
  await page.keyboard.press('Escape');
  await page.locator('.info .actions').getByRole('button', { name: 'Media' }).click();
  check((await page.locator('#media-title').textContent()).startsWith('Shared in'), 'Media button in the chat info');
  await page.keyboard.press('Escape');

  // image viewer: switch, zoom, pan, close
  await page.locator('.msg .image').last().click();
  await page.locator('.lightbox img').waitFor();
  const pos = () => page.locator('.lb-pos').textContent();
  const first = await pos();
  check(/^\d+ \/ \d+$/.test(first), `viewer shows the position among the chat's images (${first})`);
  await page.keyboard.press('k');
  check((await pos()) !== first, 'k shows the previous image');
  await page.keyboard.press('j');
  check((await pos()) === first, 'j shows the next image');
  await page.keyboard.press('+');
  check((await page.locator('.lb-zoom').textContent()) === '150%', '+ zooms in');
  await page.keyboard.press('ArrowLeft');
  check((await pos()) === first && (await page.locator('.lightbox img').getAttribute('style')).includes('translate(80px'), 'arrows pan while zoomed');
  await page.locator('.lb-stage').hover();
  await page.mouse.wheel(0, -300);
  check(parseInt(await page.locator('.lb-zoom').textContent()) > 150, 'wheel zooms in');
  await page.keyboard.press('0');
  check((await page.locator('.lb-zoom').textContent()) === '100%', '0 resets the zoom');
  await page.keyboard.press('Escape');
  await page.locator('.lightbox').waitFor({ state: 'detached' });
  check(true, 'Esc closes the viewer');

  // no browser context menu outside text fields
  const prevented = (sel) => page.locator(sel).first().evaluate((el) => {
    const ev = new MouseEvent('contextmenu', { bubbles: true, cancelable: true });
    el.dispatchEvent(ev);
    return ev.defaultPrevented;
  });
  check(await prevented('.conv header .who-sub, .conv header'), 'no browser menu on the app');
  check(!(await prevented('textarea[aria-label=Message]')), 'text fields keep their menu');
  await page.keyboard.press('Control+i');

  // unread message counts
  const kevinRow = page.locator('.chatlist .row', { has: page.locator('.name', { hasText: /^Kevin$/ }) });
  check((await kevinRow.locator('.unread-count').textContent()) === '2', 'unread message count in the list');
  check((await page.getByRole('button', { name: /All chats/ }).locator('.count').textContent()) === '1', 'folder counts chats, not messages');
  // only a group event new (Angela joined): grey, not bold, not counted
  const partyRow = page.locator('.chatlist .row', { has: page.locator('.name', { hasText: /^Party Planning$/ }) });
  check(await partyRow.locator('.unread-count.muted').textContent() === '1', 'group event only: grey count');
  check(!(await partyRow.getAttribute('class')).includes('unread'), 'group event only: row not bold');
  check((await partyRow.textContent()).includes('Angela joined'), 'group event in the preview');

  // mark as unread: a count of one until opened
  const pamRow2 = page.locator('.chatlist .row', { has: page.locator('.name', { hasText: /^Pam$/ }) });
  await pamRow2.click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'Mark as unread' }).click();
  await pamRow2.locator('.unread-count').waitFor();
  check((await pamRow2.locator('.unread-count').textContent()) === '1', 'chat marked unread');
  await pamRow2.click();
  await pamRow2.locator('.unread-count').waitFor({ state: 'detached' });
  check(true, 'opening clears the unread mark');

  // loading / outdated indicator: network gone and back
  await page.context().setOffline(true);
  await page.locator('.chatlist .sync', { hasText: 'Offline' }).waitFor();
  check(true, 'offline shown');
  await page.context().setOffline(false);
  await page.locator('.chatlist .sync', { hasText: 'Updating' }).waitFor();
  await shot('updating');
  await page.locator('.chatlist .sync').waitFor({ state: 'detached', timeout: 15000 });
  check(true, 'updating shown until the accounts caught up');

  // long chats: only a window of messages is rendered, more while scrolling up
  await page.evaluate(async () => {
    const call = async (method, params) => (await (await fetch('/__braids/call', { method: 'POST', body: JSON.stringify({ method, params }) })).json()).result;
    const accounts = await call('accounts.list', {});
    for (let i = 1; i <= 200; i++) await call('messages.send', { accountId: accounts[0].accountId, chatId: 'Oscar_0', text: `bulk ${i}` });
  });
  await page.getByRole('option', { name: /Oscar/ }).click();
  await page.locator('.msg', { hasText: 'bulk 200' }).waitFor();
  const count = () => page.locator('.messages [data-msg-id]').count();
  // load the whole history by scrolling up
  for (let i = 0; i < 40 && (await count()) <= 200; i++) {
    await page.locator('.messages').evaluate((el) => { el.scrollTop = 0; });
    await page.waitForTimeout(200);
  }
  const total = await count();
  check(total > 200, `whole history rendered after scrolling up (${total})`);
  // back at the bottom: only the newest are rendered
  await page.locator('.messages').evaluate((el) => { el.scrollTop = el.scrollHeight; });
  await page.waitForFunction(() => document.querySelectorAll('.messages [data-msg-id]').length <= 150);
  const windowed = await count();
  check(windowed === 150, `back at the bottom: window of ${windowed} messages`);
  // scrolling up reveals loaded messages, keeping the view in place
  await page.locator('.messages').evaluate((el) => { el.scrollTop = 0; });
  await page.waitForFunction((n) => document.querySelectorAll('.messages [data-msg-id]').length > n, windowed);
  check(await count() === Math.min(total, windowed + 60), 'scrolling up reveals up to 60 more');
  await page.waitForTimeout(100);
  check(await page.locator('.messages').evaluate((el) => el.scrollTop > 200), 'view kept in place while revealing');
  await page.getByRole('option', { name: /The Office/ }).click();

  // groups have a rounded-square avatar, people a round one
  check(await page.getByRole('option', { name: /The Office/ }).locator('.circle.group').count() === 1, 'group avatar is a rounded square');
  check(await page.getByRole('option', { name: /Michael/ }).locator('.circle.group').count() === 0, 'person avatar is round');

  // reopening a chat shows the latest messages, not the old position
  await page.getByRole('option', { name: /The Office/ }).click();
  await page.locator('.messages').evaluate((el) => { el.scrollTop = 0; });
  await page.getByRole('option', { name: /Michael/ }).click();
  await page.getByRole('option', { name: /The Office/ }).click();
  await page.waitForTimeout(300);
  check(await page.locator('.messages').evaluate((el) => el.scrollHeight > el.clientHeight && el.scrollHeight - el.scrollTop - el.clientHeight < 60),
    'reopened chat scrolled to the latest message');
  // a chat opened for the first time (history loaded on opening)
  await page.getByRole('option', { name: /Kelly/ }).click();
  await page.locator('[data-msg-id]').first().waitFor();
  await page.waitForTimeout(500);
  check(await page.locator('.messages').evaluate((el) => el.scrollHeight - el.scrollTop - el.clientHeight < 60), 'first opening shows the latest message');
  await page.getByRole('option', { name: /The Office/ }).click();
  await page.locator('[data-msg-id]').first().waitFor();

  // categories: favorite, default, archived
  await page.getByRole('option', { name: /Dwight/ }).click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'Add to favorites' }).click();
  check(await (await page.locator('.chatlist .row', { has: page.locator('.name', { hasText: /^Dwight$/ }) }).locator('.circle').getAttribute('style')).includes('--favorite'), 'favorite marked in the list');
  check(await page.locator('.chatlist .section').count() === 0, 'no favorites section, sorted by date');
  await page.getByRole('button', { name: 'Favorites' }).click();
  check((await page.getByRole('option').count()) === 1, 'favorites folder');
  await shot('favorites');
  await page.getByRole('button', { name: 'All chats' }).click();

  // mute: braids' own setting, shown in the list
  const pamRow = page.locator('.chatlist .row', { has: page.locator('.name', { hasText: /^Pam$/ }) });
  await pamRow.click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'Mute', exact: true }).click();
  await pamRow.locator('.flag[title=Muted]').waitFor();
  check(true, 'muted chat marked in the list');
  await page.getByRole('option', { name: /The Office/ }).click();
  await page.locator('.system-line').first().scrollIntoViewIfNeeded();
  await shot('mute-and-system-line');
  await pamRow.click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'Unmute' }).click();
  await pamRow.locator('.flag[title=Muted]').waitFor({ state: 'detached' });
  check(true, 'chat unmuted');

  await page.getByRole('option', { name: /Jim/ }).click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'Archive' }).click();
  check((await page.getByRole('option', { name: /Jim/ }).count()) === 0, 'archived chat leaves the inbox');
  await page.getByRole('button', { name: /Archived/ }).click();
  check((await page.getByRole('option', { name: /Jim/ }).count()) === 1, 'archived chat in Archived');
  await page.getByRole('option', { name: /Jim/ }).click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'Unarchive' }).click();
  await page.getByRole('button', { name: 'All chats' }).click();
  check((await page.getByRole('option', { name: /Jim/ }).count()) === 1, 'unarchived chat back in the inbox');

  // join a group by link
  await page.getByRole('button', { name: 'New chat' }).click();
  await page.getByRole('tab', { name: 'Join a group' }).click();
  await page.fill('input[aria-label="Invite link or address"]', 'https://dummy.example/nope');
  await page.getByRole('button', { name: 'Join', exact: true }).click();
  await page.locator('.join .error').waitFor();
  check((await page.locator('.join .error').textContent()).includes('Not a Dummy invite link'), 'invalid invite link reported');
  await shot('join-group');
  await page.fill('input[aria-label="Invite link or address"]', 'https://dummy.example/join/Accounting');
  await page.getByRole('button', { name: 'Join', exact: true }).click();
  await page.locator('.conv header', { hasText: 'Accounting' }).waitFor();
  check(await page.getByText('Join a group').count() === 0, 'joined group opened');

  // an invite link in a message opens "Join a group" with the link
  await composer.fill('come to https://dummy.example/join/Sales');
  await composer.press('Enter');
  await page.locator('.msg.own a[data-link]', { hasText: 'dummy.example/join/Sales' }).last().click();
  await page.getByRole('tab', { name: 'Join a group', selected: true }).waitFor();
  check((await page.inputValue('input[aria-label="Invite link or address"]')) === 'https://dummy.example/join/Sales', 'invite link in a message opens Join a group');
  await page.getByRole('button', { name: 'Join', exact: true }).click();
  await page.locator('.conv header', { hasText: 'Sales' }).waitFor();
  check(true, 'joined from the link');
  await page.getByRole('option', { name: /The Office/ }).click();
  await page.keyboard.press('Control+i');
  await page.getByText('Group info').waitFor();
  await shot('inbox');
  await page.keyboard.press('Control+i');

  // info panel and theme
  await page.keyboard.press('Control+i');
  await page.getByText('Group info').waitFor();
  check(true, 'info panel opens');
  await page.locator('.info .description', { hasText: 'Dunder Mifflin Scranton' }).waitFor();
  check(await page.locator('.info .description a[data-link]').count() === 1, 'group description shown with link');
  // default shortcuts
  await page.keyboard.press('Control+Space');
  check(await page.evaluate(() => document.activeElement?.getAttribute('aria-label') === 'Search chats'), 'Ctrl+Space focuses chat search');
  await page.keyboard.press('Escape');
  const selectedName = () => page.locator('[role=option][aria-selected=true] .name').textContent();
  const before = await selectedName();
  await page.keyboard.press('Alt+j');
  await page.waitForFunction((b) => document.querySelector('[role=option][aria-selected=true] .name')?.textContent !== b, before);
  check(true, 'Alt+J opens the next chat');
  await page.keyboard.press('Alt+k');
  await page.waitForFunction((b) => document.querySelector('[role=option][aria-selected=true] .name')?.textContent === b, before);
  check(true, 'Alt+K back to the previous chat');
  await page.keyboard.press('Control+b');
  await page.locator('.chatlist h2', { hasText: 'Favorites' }).waitFor();
  check(true, 'Ctrl+B shows favorites');
  await page.keyboard.press('Control+a');
  await page.locator('.chatlist h2', { hasText: 'All chats' }).waitFor();
  check(true, 'Ctrl+A shows all chats');
  // AZERTY: the key labelled A sits where QWERTY has Q (code KeyQ)
  const azerty = (key, code) => page.evaluate(([key, code]) => {
    (document.activeElement ?? document.body).dispatchEvent(new KeyboardEvent('keydown', { key, code, ctrlKey: true, bubbles: true, cancelable: true }));
  }, [key, code]);
  await page.keyboard.press('Control+b');
  await page.locator('.chatlist h2', { hasText: 'Favorites' }).waitFor();
  await azerty('q', 'KeyA');
  await page.waitForTimeout(200);
  check(await page.locator('.chatlist h2', { hasText: 'Favorites' }).count() === 1, 'AZERTY Ctrl+Q (physical A) is not All chats');
  await azerty('a', 'KeyQ');
  await page.locator('.chatlist h2', { hasText: 'All chats' }).waitFor();
  check(true, 'shortcuts follow the keyboard layout (AZERTY Ctrl+A)');

  // changing a shortcut
  await page.keyboard.press('Control+,');
  await page.getByRole('button', { name: 'Keyboard' }).click();
  await page.getByRole('button', { name: 'Add shortcut for Search chats' }).click();
  await page.keyboard.press('l');
  await page.locator('.record-error').waitFor();
  check(true, 'plain key rejected as shortcut');
  await page.keyboard.press('Control+e');
  await page.locator('.toast', { hasText: 'removed from' }).first().waitFor();
  check(await page.locator('[data-action=searchChats] .combo').count() === 2 &&
    await page.locator('[data-action=editLast] .combo').count() === 0, 'recorded shortcut moves from the other action');
  await page.keyboard.press('Escape');
  await page.keyboard.press('Control+e');
  check(await page.evaluate(() => document.activeElement?.getAttribute('aria-label') === 'Search chats'), 'changed shortcut works');
  await page.keyboard.press('Escape');
  await page.keyboard.press('Control+,');
  await page.getByRole('button', { name: 'Keyboard' }).click();
  await page.getByRole('button', { name: 'Reset all' }).click();
  check(await page.locator('[data-action=editLast] .combo').count() === 1 &&
    await page.locator('[data-action=searchChats] .combo').count() === 1, 'reset all restores the defaults');
  await shot('settings-keyboard');
  await page.getByRole('button', { name: 'General' }).click();
  await page.getByRole('button', { name: 'Dark' }).click();
  check(await page.evaluate(() => document.documentElement.classList.contains('t-dark')), 'dark theme applied');
  await shot('settings-dark');

  // remove account
  await page.getByRole('button', { name: 'Accounts' }).click();
  await page.locator('.acct-row').first().click();
  await page.getByRole('button', { name: 'Remove account…' }).click();
  await page.getByRole('button', { name: 'Remove account', exact: true }).click();
  await page.getByText('Welcome to braids').waitFor({ timeout: 30000 });
  check(true, 'account removed, back to welcome');

  // responsive: single pane below 900 px
  await page.setViewportSize({ width: 800, height: 800 });
  check(true, 'narrow viewport');

  check(errors.length === 0, `no page errors${errors.length ? `: ${errors.join(' | ')}` : ''}`);
} catch (e) {
  if (!failures) {
    failures++;
    console.log(`not ok - ${e.message}`);
  }
} finally {
  await browser.close();
  await server.close();
  daemon.kill('SIGTERM');
  await new Promise((r) => daemon.once('exit', r));
  fs.rmSync(confdir, { recursive: true, force: true });
  fs.rmSync(path.join(confdir, '..', `braids-ui-${process.pid}.png`), { force: true });
  fs.rmSync(path.join(confdir, '..', `braids-ui-${process.pid}.wav`), { force: true });
}

console.log(failures ? `${failures} failed` : 'all tests passed');
process.exit(failures ? 1 : 0);
