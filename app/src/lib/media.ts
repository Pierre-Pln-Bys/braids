// media.ts
//
// Copyright (c) 2026 braids contributors
//
// braids is distributed under the GNU AGPL v3 license, see LICENSE for details.

// Sources for <video> and <audio>. WebKitGTK (the desktop app's web view on
// Linux) does not play media from the app's file protocol (asset:), only
// from http(s), file and blob URLs. So in the desktop app the file is read
// through the protocol into a blob, typed by its name; one blob per file,
// shared by the elements showing it and freed when the last one is gone.

import { fileUrl, isTauri } from './api';

const TYPES: Record<string, string> = {
  mp4: 'video/mp4', m4v: 'video/mp4', mov: 'video/quicktime', webm: 'video/webm', mkv: 'video/x-matroska', '3gp': 'video/3gpp',
  ogv: 'video/ogg', mp3: 'audio/mpeg', m4a: 'audio/mp4', aac: 'audio/aac', wav: 'audio/wav', flac: 'audio/flac',
  ogg: 'audio/ogg', oga: 'audio/ogg', opus: 'audio/ogg', weba: 'audio/webm',
};

export function mediaType(path: string, fallback = ''): string {
  const ext = path.toLowerCase().split('.').pop() ?? '';
  return TYPES[ext] ?? fallback;
}

const blobs = new Map<string, { url: Promise<string>; refs: number }>();

function acquire(path: string, type: string): Promise<string> {
  let entry = blobs.get(path);
  if (!entry) {
    const url = fetch(fileUrl(path))
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.blob();
      })
      .then((b) => URL.createObjectURL(new Blob([b], { type: mediaType(path, type || b.type) })));
    entry = { url, refs: 0 };
    blobs.set(path, entry);
    url.catch(() => blobs.delete(path));
  }
  entry.refs++;
  return entry.url;
}

function release(path: string) {
  const entry = blobs.get(path);
  if (!entry || --entry.refs > 0) return;
  // a moment later: the same file is often shown again right away (the
  // viewer opening, the list re-rendering)
  setTimeout(() => {
    if (entry.refs > 0 || blobs.get(path) !== entry) return;
    blobs.delete(path);
    entry.url.then((u) => URL.revokeObjectURL(u)).catch(() => {});
  }, 5000);
}

export interface MediaParams {
  path: string;
  type?: string; // MIME type if known (from the message)
  fragment?: string; // e.g. "#t=0.1" for a poster frame
  lazy?: boolean; // read the file only once the element comes near the screen
}

// use:mediaSrc={{ path }} on a <video> or <audio>; dispatches "error" on the
// element when the file cannot be read.
export function mediaSrc(node: HTMLMediaElement, params: MediaParams) {
  let current = '';
  let observer: IntersectionObserver | null = null;

  function set(p: MediaParams) {
    if (p.lazy && isTauri && typeof IntersectionObserver !== 'undefined') {
      observer?.disconnect();
      observer = new IntersectionObserver(([e]) => {
        if (!e.isIntersecting) return;
        observer?.disconnect();
        observer = null;
        load(p);
      }, { rootMargin: '400px' });
      observer.observe(node);
      return;
    }
    load(p);
  }

  function load(p: MediaParams) {
    if (current === p.path) return;
    if (current && isTauri) release(current);
    current = p.path;
    if (!p.path) {
      node.removeAttribute('src');
      return;
    }
    if (!isTauri) {
      node.src = fileUrl(p.path) + (p.fragment ?? '');
      return;
    }
    const path = p.path;
    acquire(path, p.type ?? '')
      .then((url) => {
        if (current === path) node.src = url + (p.fragment ?? '');
      })
      .catch(() => {
        if (current === path) node.dispatchEvent(new Event('error'));
      });
  }

  set(params);
  return {
    update: set,
    destroy() {
      observer?.disconnect();
      if (current && isTauri) release(current);
      current = '';
    },
  };
}
