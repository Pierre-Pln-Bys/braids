<!--
  MediaDialog.svelte

  Copyright (c) 2026 braids contributors

  braids is distributed under the GNU AGPL v3 license, see LICENSE for details.

  Shared media of a chat, or of all chats and accounts: images and videos,
  files and links, newest first, paged from braidsd (media.list) while
  scrolling. Attachments not on this computer are downloaded on click.
-->
<script lang="ts">
  import { Download, ExternalLink, FileText, Film, Link as LinkIcon, LoaderCircle, MessageSquare, Play, X } from '@lucide/svelte';
  import { onDestroy, tick, untrack } from 'svelte';
  import { openLink } from '../lib/actions';
  import * as api from '../lib/api';
  import { mediaSrc } from '../lib/media';
  import { chatKey, fileMime, fileReady, galleryItems, splitKey, store } from '../lib/store.svelte';
  import type { Message } from '../lib/types';
  import { openLightbox, ui } from '../lib/ui.svelte';

  type Kind = 'media' | 'files' | 'links';
  const TABS: { kind: Kind; label: string }[] = [
    { kind: 'media', label: 'Media' },
    { kind: 'files', label: 'Files' },
    { kind: 'links', label: 'Links' },
  ];

  let { scope }: { scope: string } = $props(); // chat key, '' for all chats

  let kind = $state<Kind>('media');
  let items = $state<Message[]>([]);
  let nextBefore = $state(0);
  let loading = $state(false);
  let done = $state(false);
  let error = $state('');
  let listEl: HTMLDivElement | undefined = $state();
  let generation = 0;

  const scopeChat = $derived(scope ? store.chats[scope] : undefined);
  const title = $derived(scopeChat ? `Shared in ${store.chatName(scopeChat)}` : 'Shared media');
  const id = (m: Message) => `${m.accountId}\u0001${m.chatId}\u0001${m.id}`;

  // downloads (and other changes) of the listed messages
  const listener = (m: Message) => {
    const i = items.findIndex((x) => id(x) === id(m));
    if (i >= 0) items[i] = m;
  };
  store.messageListeners.add(listener);
  onDestroy(() => store.messageListeners.delete(listener));

  $effect(() => {
    void kind;
    void scope;
    untrack(reset);
  });

  function reset() {
    generation++;
    items = [];
    nextBefore = 0;
    done = false;
    error = '';
    loading = false;
    load();
  }

  async function load() {
    if (loading || done) return;
    loading = true;
    const gen = generation;
    try {
      const [accountId, chatId] = scope ? splitKey(scope) : ['', ''];
      const r = await api.call('media.list', {
        kind,
        limit: kind === 'media' ? 60 : 40,
        ...(accountId ? { accountId, chatId } : {}),
        ...(nextBefore ? { beforeTime: nextBefore } : {}),
      });
      if (gen !== generation) return;
      const known = store.accounts;
      items = [...items, ...(r.items as Message[]).filter((m) => known[m.accountId])];
      nextBefore = r.nextBefore;
      done = !r.nextBefore;
    } catch (e) {
      if (gen === generation) error = e instanceof Error ? e.message : String(e);
      done = true;
    } finally {
      if (gen === generation) loading = false;
    }
    // fill the view
    await tick();
    if (gen === generation && listEl && !done && listEl.scrollHeight <= listEl.clientHeight + 80) load();
  }

  function onScroll() {
    if (listEl && listEl.scrollHeight - listEl.scrollTop - listEl.clientHeight < 300) load();
  }

  function close() {
    ui.media = null;
  }

  function meta(m: Message): string {
    const parts: string[] = [];
    const chat = store.chats[chatKey(m.accountId, m.chatId)];
    if (!scope && chat) parts.push(store.chatName(chat));
    parts.push(store.senderName(m));
    parts.push(new Date(m.time).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' }));
    return parts.join(' · ');
  }

  function showInChat(m: Message) {
    const key = chatKey(m.accountId, m.chatId);
    close();
    store.openChat(key).then(() => {
      ui.jumpRequest = { chatKey: key, msgId: m.id };
    });
  }

  async function download(m: Message) {
    try {
      await api.call('files.download', { accountId: m.accountId, chatId: m.chatId, msgId: m.id });
    } catch (e) {
      store.toastError(e);
    }
  }

  function openMedia(m: Message) {
    if (!fileReady(m.file)) {
      if (m.file?.status !== 'downloading') download(m);
      return;
    }
    // images and videos in the viewer (the media tab's order), files outside
    const gallery = galleryItems(items);
    if (gallery.some((g) => g.path === m.file!.path)) openLightbox(gallery, m.file!.path);
    else api.openPath(m.file!.path).catch((e) => store.toastError(e));
  }

  function urls(text: string): string[] {
    const found = text.match(/(?:https?:\/\/|www\.)[^\s<>"]+/gi) ?? [];
    return [...new Set(found.map((u) => u.replace(/[).,;:!?\]*_~]+$/, '')))];
  }

  function host(url: string): string {
    try {
      return new URL(url.startsWith('www.') ? `https://${url}` : url).host;
    } catch {
      return url;
    }
  }
</script>

<svelte:window onkeydown={(e) => e.key === 'Escape' && !ui.lightbox && close()} />

<div class="scrim" role="presentation" onclick={(e) => e.target === e.currentTarget && close()}>
  <div class="dialog wide" role="dialog" aria-modal="true" aria-labelledby="media-title">
    <div class="dialog-head">
      <h2 id="media-title">{title}</h2>
      <button class="icon-btn" aria-label="Close" onclick={close}><X size={18} /></button>
    </div>
    <div class="tabs" role="tablist">
      {#each TABS as t}
        <button role="tab" aria-selected={kind === t.kind} class:active={kind === t.kind} onclick={() => (kind = t.kind)}>{t.label}</button>
      {/each}
    </div>
    <div class="body scroll" bind:this={listEl} onscroll={onScroll}>
      {#if kind === 'media'}
        <div class="grid">
          {#each items as m (id(m))}
            {@const ready = fileReady(m.file)}
            {@const video = fileMime(m.file).startsWith('video/')}
            <div class="tile">
              <button class="thumb" onclick={() => openMedia(m)} aria-label="{ready ? 'Open' : 'Download'} {m.file?.name}" title={meta(m)}>
                {#if ready && !video}
                  <img src={api.fileUrl(m.file!.path)} alt={m.file!.name} loading="lazy" />
                {:else if ready && video}
                  <!-- svelte-ignore a11y_media_has_caption -->
                  <video use:mediaSrc={{ path: m.file!.path, type: m.file!.mimeType, fragment: '#t=0.1', lazy: true }} preload="metadata" muted></video>
                  <span class="vplay"><Play size={16} fill="currentColor" /></span>
                {:else}
                  <span class="placeholder">
                    {#if m.file?.status === 'downloading'}<LoaderCircle size={22} class="spin" />
                    {:else if !ready}<Download size={22} />
                    {:else}<Film size={22} />{/if}
                    <small>{m.file?.name}</small>
                  </span>
                {/if}
              </button>
              <button class="goto" aria-label="Show in chat" title="Show in chat" onclick={() => showInChat(m)}><MessageSquare size={14} /></button>
            </div>
          {/each}
        </div>
      {:else if kind === 'files'}
        {#each items as m (id(m))}
          {@const ready = fileReady(m.file)}
          <div class="row">
            <button class="main" onclick={() => openMedia(m)} title={ready ? 'Open' : 'Download'}>
              <span class="ico">
                {#if m.file?.status === 'downloading'}<LoaderCircle size={18} class="spin" />{:else if ready}<FileText size={18} />{:else}<Download size={18} />{/if}
              </span>
              <span class="text"><b>{m.file?.name}</b><small>{meta(m)}</small></span>
            </button>
            <button class="icon-btn" aria-label="Show in chat" title="Show in chat" onclick={() => showInChat(m)}><MessageSquare size={16} /></button>
          </div>
        {/each}
      {:else}
        {#each items as m (id(m))}
          {#each urls(m.text) as url}
            <div class="row">
              <button class="main" onclick={() => openLink(url.startsWith('www.') ? `https://${url}` : url)} title={url}>
                <span class="ico"><LinkIcon size={18} /></span>
                <span class="text"><b>{host(url)}</b><small class="url">{url}</small><small>{meta(m)}</small></span>
                <ExternalLink size={14} />
              </button>
              <button class="icon-btn" aria-label="Show in chat" title="Show in chat" onclick={() => showInChat(m)}><MessageSquare size={16} /></button>
            </div>
          {/each}
        {/each}
      {/if}

      {#if loading}
        <div class="status"><LoaderCircle size={16} class="spin" /></div>
      {:else if error}
        <div class="status">{error}</div>
      {:else if done && !items.length}
        <div class="status">{kind === 'media' ? 'No photos or videos yet.' : kind === 'files' ? 'No files yet.' : 'No links yet.'}</div>
      {/if}
    </div>
  </div>
</div>

<style>
  /* nearly the whole window: media wants room */
  .dialog.wide { width: min(1600px, calc(100vw - 48px)); max-width: none; height: calc(100vh - 48px); max-height: none; display: flex; flex-direction: column; }
  .tabs { display: flex; gap: 4px; padding: 0 16px 8px; border-bottom: 1px solid var(--border); }
  .tabs button { border: 0; background: none; padding: 6px 12px; border-radius: var(--radius-md); font-size: 13px; font-weight: 600; color: var(--text-muted); }
  .tabs button:hover { background: var(--hover); }
  .tabs button.active { color: var(--accent); background: var(--accent-soft); }
  .body { flex: 1; min-height: 0; padding: 12px 16px 16px; display: flex; flex-direction: column; gap: 2px; }
  .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(160px, 1fr)); gap: 6px; }
  .tile { position: relative; aspect-ratio: 1; }
  .thumb { width: 100%; height: 100%; border: 0; padding: 0; border-radius: 8px; overflow: hidden; background: var(--skeleton); display: block; }
  .thumb { position: relative; }
  .thumb img, .thumb video { width: 100%; height: 100%; object-fit: cover; display: block; background: #000; }
  .vplay {
    position: absolute; left: 50%; top: 50%; transform: translate(-50%, -50%); width: 34px; height: 34px; border-radius: 17px;
    display: flex; align-items: center; justify-content: center; background: rgb(0 0 0 / 0.55); color: #fff; pointer-events: none;
  }
  .placeholder { width: 100%; height: 100%; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 6px; color: var(--text-muted); padding: 8px; }
  .placeholder small { font-size: 11px; max-width: 100%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .goto {
    position: absolute; right: 4px; bottom: 4px; border: 0; width: 26px; height: 26px; border-radius: 13px; display: none;
    align-items: center; justify-content: center; background: color-mix(in srgb, var(--surface) 88%, transparent); color: var(--text);
  }
  .tile:hover .goto, .goto:focus-visible { display: flex; }
  .row { display: flex; align-items: center; gap: 4px; }
  .main { flex: 1; min-width: 0; display: flex; align-items: center; gap: 10px; padding: 8px; border: 0; background: none; border-radius: var(--radius-md); text-align: left; color: var(--text); }
  .main:hover { background: var(--hover); }
  .ico { width: 36px; height: 36px; border-radius: 8px; background: var(--surface-2); color: var(--text-2); display: flex; align-items: center; justify-content: center; flex-shrink: 0; }
  .text { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 1px; }
  .text b { font-size: 14px; font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .text small { font-size: 12px; color: var(--text-muted); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .text small.url { color: var(--accent); }
  .status { display: flex; justify-content: center; padding: 16px; color: var(--text-muted); font-size: 13px; }
</style>
