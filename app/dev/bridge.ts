// bridge.ts
//
// Copyright (c) 2026 braids contributors
//
// braids is distributed under the GNU AGPL v3 license, see LICENSE for details.

// Development bridge: lets the UI run in a normal browser (`npm run dev`)
// against a running braidsd, without the Tauri shell. Serves
//   POST /__braids/call     {method, params} -> {result} | {error}
//   GET  /__braids/events   server-sent events: daemon events and connection state
//   GET  /__braids/file     ?path=  local file (downloads, attachments)
//   POST /__braids/upload   ?name=  body saved to a temp file -> {path}
//   GET  /__braids/preview  ?url=   link preview {url, title, description, siteName, image (URL)} | null
// Only active in the dev server, which listens on localhost.

import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Plugin } from 'vite';

function socketPath(): string {
  if (process.env.BRAIDS_SOCKET) return process.env.BRAIDS_SOCKET;
  if (process.env.BRAIDS_CONFDIR) return path.join(process.env.BRAIDS_CONFDIR, 'braidsd.sock');
  const runtime = process.env.XDG_RUNTIME_DIR;
  const xdg = runtime ? path.join(runtime, 'braids', 'braidsd.sock') : '';
  if (xdg && fs.existsSync(xdg)) return xdg;
  return path.join(os.homedir(), '.config', 'braids', 'braidsd.sock');
}

type Pending = { resolve: (msg: any) => void };

class DaemonConnection {
  private sock: net.Socket | null = null;
  private buf = '';
  private nextId = 1;
  private pending = new Map<number, Pending>();
  private listeners = new Set<(data: string) => void>();
  connected = false;

  start() {
    this.connect();
  }

  private connect() {
    const sock = net.createConnection(socketPath());
    sock.setEncoding('utf8');
    sock.on('connect', () => {
      this.sock = sock;
      this.connected = true;
      this.broadcast(JSON.stringify({ method: '$connection', params: { connected: true } }));
    });
    sock.on('data', (chunk: string) => {
      this.buf += chunk;
      let pos;
      while ((pos = this.buf.indexOf('\n')) >= 0) {
        const line = this.buf.slice(0, pos);
        this.buf = this.buf.slice(pos + 1);
        if (!line.trim()) continue;
        const msg = JSON.parse(line);
        if (msg.id !== undefined && msg.method === undefined) {
          this.pending.get(msg.id)?.resolve(msg);
          this.pending.delete(msg.id);
        } else {
          this.broadcast(line);
        }
      }
    });
    const retry = () => {
      if (this.sock === sock || !this.connected) {
        const wasConnected = this.connected;
        this.sock = null;
        this.connected = false;
        this.buf = '';
        for (const p of this.pending.values()) p.resolve({ error: { code: -32000, message: 'disconnected' } });
        this.pending.clear();
        if (wasConnected) this.broadcast(JSON.stringify({ method: '$connection', params: { connected: false } }));
      }
      setTimeout(() => this.connect(), 1000);
    };
    sock.on('error', () => {});
    sock.on('close', retry);
  }

  call(method: string, params: unknown): Promise<any> {
    if (!this.sock) return Promise.resolve({ error: { code: -32000, message: 'braidsd not running' } });
    const id = this.nextId++;
    return new Promise((resolve) => {
      this.pending.set(id, { resolve });
      this.sock!.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n');
    });
  }

  subscribe(fn: (data: string) => void) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private broadcast(data: string) {
    for (const fn of this.listeners) fn(data);
  }
}

function readBody(req: IncomingMessage): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

const MIME: Record<string, string> = {
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif',
  '.webp': 'image/webp', '.svg': 'image/svg+xml', '.pdf': 'application/pdf', '.mp4': 'video/mp4',
};

export function braidsBridge(): Plugin {
  return {
    name: 'braids-dev-bridge',
    apply: 'serve',
    configureServer(server) {
      const daemon = new DaemonConnection();
      daemon.start();
      const uploadDir = fs.mkdtempSync(path.join(os.tmpdir(), 'braids-upload-'));

      server.middlewares.use(async (req: IncomingMessage, res: ServerResponse, next: () => void) => {
        const url = new URL(req.url ?? '/', 'http://localhost');
        if (!url.pathname.startsWith('/__braids/')) return next();

        if (url.pathname === '/__braids/call' && req.method === 'POST') {
          const { method, params } = JSON.parse((await readBody(req)).toString('utf8'));
          const reply = await daemon.call(method, params ?? {});
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify(reply.error ? { error: reply.error } : { result: reply.result }));
        } else if (url.pathname === '/__braids/events') {
          res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
          res.write(`data: ${JSON.stringify({ method: '$connection', params: { connected: daemon.connected } })}\n\n`);
          const unsubscribe = daemon.subscribe((data) => res.write(`data: ${data}\n\n`));
          req.on('close', () => unsubscribe());
        } else if (url.pathname === '/__braids/file') {
          const file = url.searchParams.get('path') ?? '';
          if (!path.isAbsolute(file) || !fs.existsSync(file) || !fs.statSync(file).isFile()) {
            res.statusCode = 404;
            res.end();
            return;
          }
          res.setHeader('Content-Type', MIME[path.extname(file).toLowerCase()] ?? 'application/octet-stream');
          fs.createReadStream(file).pipe(res);
        } else if (url.pathname === '/__braids/upload' && req.method === 'POST') {
          const name = path.basename(url.searchParams.get('name') || 'file');
          const dir = fs.mkdtempSync(path.join(uploadDir, 'f'));
          const file = path.join(dir, name);
          fs.writeFileSync(file, await readBody(req), { mode: 0o600 });
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify({ path: file }));
        } else if (url.pathname === '/__braids/preview') {
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify(await linkPreview(url.searchParams.get('url') ?? '')));
        } else {
          res.statusCode = 404;
          res.end();
        }
      });
    },
  };
}

// Link previews for development (the desktop app fetches them in the Rust
// shell, src-tauri/src/linkpreview.rs): the page's Open Graph tags, the image
// as its URL.
async function linkPreview(raw: string): Promise<Record<string, string> | null> {
  try {
    const page = new URL(raw);
    if (page.protocol !== 'http:' && page.protocol !== 'https:') return null;
    const res = await fetch(page, { signal: AbortSignal.timeout(8000), headers: { 'User-Agent': 'Mozilla/5.0 braids link preview' } });
    if (!res.ok || !(res.headers.get('content-type') ?? '').includes('html')) return null;
    const html = (await res.text()).slice(0, 768 * 1024);
    const meta: Record<string, string> = {};
    for (const tag of html.match(/<meta\b[^>]*>/gi) ?? []) {
      const attr = (n: string) => tag.match(new RegExp(`${n}\\s*=\\s*("([^"]*)"|'([^']*)')`, 'i'))?.slice(2).find((v) => v !== undefined);
      const key = (attr('property') ?? attr('name'))?.toLowerCase();
      const content = attr('content');
      if (key && content !== undefined && !(key in meta)) meta[key] = content;
    }
    const decode = (v = '') => v.replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/\s+/g, ' ').trim();
    const title = decode(meta['og:title'] ?? meta['twitter:title'] ?? html.match(/<title[^>]*>([^<]*)/i)?.[1]);
    if (!title) return null;
    const image = meta['og:image'] ?? meta['twitter:image'];
    return {
      url: res.url,
      title,
      description: decode(meta['og:description'] ?? meta['twitter:description'] ?? meta.description),
      siteName: decode(meta['og:site_name']) || page.host.replace(/^www\./, ''),
      image: image ? new URL(decode(image), res.url).toString() : '',
    };
  } catch {
    return null;
  }
}
