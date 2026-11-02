<!--
  ChatList.svelte

  Copyright (c) 2026 braids contributors

  braids is distributed under the GNU AGPL v3 license, see LICENSE for details.

  The unified inbox: chats of all accounts (or the selected folder/account),
  newest activity first, favorites with a gold avatar ring. Search by name,
  and through the messages of all chats (messages.search); context menu per chat.
-->
<script lang="ts">
  import { AtSign, BellOff, LoaderCircle, Menu as MenuIcon, Search, SquarePen, WifiOff, X } from '@lucide/svelte';
  import { untrack } from 'svelte';
  import { chatMenu } from '../lib/actions';
  import * as api from '../lib/api';
  import { listTime } from '../lib/format';
  import { bindings, comboKeys } from '../lib/keybinds.svelte';
  import { chatKey, store } from '../lib/store.svelte';
  import type { Chat, Message } from '../lib/types';
  import { ui } from '../lib/ui.svelte';
  import Avatar from './Avatar.svelte';
  import Braid from './Braid.svelte';

  let searchInput: HTMLInputElement | undefined = $state();
  let listEl: HTMLDivElement | undefined = $state();
  let cursor = $state(-1); // keyboard cursor, distinct from selection

  const chats = $derived(store.chatList);

  const title = $derived.by(() => {
    const f = store.filter;
    if (f.kind === 'archived') return 'Archived';
    if (f.kind === 'favorites') return 'Favorites';
    if (f.kind === 'account') return store.accountName(f.accountId);
    return 'All chats';
  });

  $effect(() => {
    if (ui.focusSearch) searchInput?.focus();
  });

  function open(c: Chat) {
    store.openChat(chatKey(c.accountId, c.id));
    ui.focusComposer++;
  }

  function preview(c: Chat): { prefix: string; prefixKind: string; text: string } {
    const key = chatKey(c.accountId, c.id);
    const typing = store.typingNames(key);
    if (typing.length) return { prefix: '', prefixKind: 'typing', text: c.isGroup ? `${typing[0].split(' ')[0]} is typing…` : 'typing…' };
    const draft = store.drafts[key];
    if (draft && key !== store.current) return { prefix: 'Draft:', prefixKind: 'draft', text: draft };
    const m = c.lastMessage;
    if (!m) return { prefix: '', prefixKind: '', text: '' };
    if (m.system) return { prefix: '', prefixKind: '', text: store.systemLine(m) };
    const prefix = m.isOutgoing ? 'You:' : c.isGroup ? `${store.senderName(m).split(' ')[0]}:` : '';
    return { prefix, prefixKind: 'sender', text: store.previewText(m) };
  }

  // ---- message search (2+ characters), newest first, paged ----
  let found = $state<Message[]>([]);
  let foundNext = $state(0);
  let finding = $state(false);
  let searchGen = 0;
  const msgQuery = $derived(store.search.trim().length >= 2 ? store.search.trim() : '');

  $effect(() => {
    const q = msgQuery;
    const scope = store.filter.kind === 'account' ? store.filter.accountId : '';
    untrack(() => {
      const gen = ++searchGen;
      found = [];
      foundNext = 0;
      finding = !!q;
      if (!q) return;
      setTimeout(() => gen === searchGen && findMessages(q, scope, 0, gen), 250);
    });
  });

  async function findMessages(q: string, scope: string, before: number, gen: number) {
    finding = true;
    try {
      const r = await api.call('messages.search', { text: q, limit: 30, ...(scope ? { accountId: scope } : {}), ...(before ? { beforeTime: before } : {}) });
      if (gen !== searchGen) return;
      found = [...found, ...(r.items as Message[]).filter((m) => store.chats[chatKey(m.accountId, m.chatId)])];
      foundNext = r.nextBefore;
    } catch {
      if (gen === searchGen) foundNext = 0;
    } finally {
      if (gen === searchGen) finding = false;
    }
  }

  function moreMessages() {
    if (!finding && foundNext) findMessages(msgQuery, store.filter.kind === 'account' ? store.filter.accountId : '', foundNext, searchGen);
  }

  function openFound(m: Message) {
    const key = chatKey(m.accountId, m.chatId);
    store.openChat(key).then(() => {
      ui.jumpRequest = { chatKey: key, msgId: m.id };
    });
  }

  // the text around the first match, with the match marked
  function snippet(text: string, q: string): { before: string; match: string; after: string } {
    const flat = text.replace(/\s+/g, ' ');
    const i = flat.toLowerCase().indexOf(q.toLowerCase());
    if (i < 0) return { before: flat.slice(0, 80), match: '', after: '' };
    const start = Math.max(0, i - 24);
    return { before: (start ? '…' : '') + flat.slice(start, i), match: flat.slice(i, i + q.length), after: flat.slice(i + q.length, i + q.length + 80) };
  }

  function onKey(e: KeyboardEvent) {
    if (!chats.length) return;
    if (e.key === 'ArrowDown' || e.key === 'j') {
      cursor = Math.min(chats.length - 1, cursor + 1);
    } else if (e.key === 'ArrowUp' || e.key === 'k') {
      cursor = Math.max(0, cursor - 1);
    } else if (e.key === 'Enter' && cursor >= 0) {
      open(chats[cursor]);
      return;
    } else {
      return;
    }
    e.preventDefault();
    listEl?.querySelectorAll<HTMLElement>('[role=option]')[cursor]?.scrollIntoView({ block: 'nearest' });
  }

  function onSearchKey(e: KeyboardEvent) {
    if (e.key === 'Escape') {
      store.search = '';
      searchInput?.blur();
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      cursor = 0;
      listEl?.focus();
    } else if (e.key === 'Enter' && chats.length) {
      open(chats[0]);
    }
  }
</script>

<section class="chatlist" aria-label="Chat list">
  <div class="head">
    <div class="title-row">
      {#if ui.narrow}
        <button class="icon-btn" aria-label="Open sidebar" onclick={() => (ui.drawerOpen = true)}><MenuIcon size={20} strokeWidth={1.75} /></button>
      {/if}
      <h2>{title}</h2>
      {#if store.syncStatus === 'updating'}
        <span class="sync" role="status" title="Fetching the latest messages"><LoaderCircle size={13} class="spin" />Updating…</span>
      {:else if store.syncStatus === 'offline'}
        <span class="sync" role="status" title="No network: chats may be outdated"><WifiOff size={13} />Offline</span>
      {/if}
      <button class="icon-btn" aria-label="New chat" title="New chat" onclick={() => (ui.newChatOpen = true)} disabled={!store.accountList.length}>
        <SquarePen size={19} strokeWidth={1.75} />
      </button>
    </div>
    <label class="search">
      <Search size={16} strokeWidth={1.75} />
      <input
        bind:this={searchInput}
        bind:value={store.search}
        placeholder="Search chats"
        aria-label="Search chats"
        onkeydown={onSearchKey}
      />
      {#if store.search}
        <button class="icon-btn sm" aria-label="Clear search" onclick={() => (store.search = '')}><X size={15} /></button>
      {:else}
        {#if bindings('searchChats')[0]}<kbd>{comboKeys(bindings('searchChats')[0]).join(' ')}</kbd>{/if}
      {/if}
    </label>
  </div>

  <div
    class="list scroll"
    role="listbox"
    aria-label="Chats"
    tabindex="0"
    bind:this={listEl}
    onkeydown={onKey}
    onblur={() => (cursor = -1)}
  >
    {#each chats as c, i (chatKey(c.accountId, c.id))}
      {@const key = chatKey(c.accountId, c.id)}
      {@const p = preview(c)}
      {@const selected = key === store.current}
      <div
        class="row"
        class:selected
        class:cursor={i === cursor}
        class:unread={c.isUnread && !store.eventsOnly(c)}
        class:muted={c.isMuted}
        role="option"
        aria-selected={selected}
        tabindex="-1"
        onclick={() => open(c)}
        onkeydown={(e) => e.key === 'Enter' && open(c)}
        oncontextmenu={(e) => { e.preventDefault(); ui.openMenu(e, chatMenu(c)); }}
      >
        <Avatar name={store.chatName(c)} id={c.id} accountId={c.accountId} group={c.isGroup} ring={selected ? 'var(--selected)' : 'var(--bg-1)'}
          favorite={store.category(c) === 'favorite'}
          online={!c.isGroup && store.isOnline(c.accountId, c.id)} />
        <div class="body">
          <div class="line1">
            <span class="name">{store.chatName(c)}</span>
            {#if c.isMuted}<span class="flag" title="Muted"><BellOff size={13} /></span>{/if}
            <span class="grow"></span>
            <span class="time">{listTime(c.lastActivity)}</span>
          </div>
          <div class="line2">
            <span class="preview">
              {#if p.prefixKind === 'typing'}
                <span class="typing">{p.text}</span>
              {:else}
                {#if p.prefix}<span class="prefix" class:draft={p.prefixKind === 'draft'}>{p.prefix}</span>{/if}
                {p.text}
              {/if}
            </span>
            {#if c.isUnreadMention}<span class="mention-dot" title="Mentioned"><AtSign size={12} strokeWidth={2.5} /></span>{/if}
            {#if c.isUnread}
              {@const n = store.chatUnread(c)}
              <span class="unread-count" class:muted={c.isMuted || store.eventsOnly(c)}
                title={store.eventsOnly(c) ? `${n} new group ${n === 1 ? 'event' : 'events'}` : `${n} unread`}>{n > 999 ? '999+' : n}</span>
            {/if}
          </div>
        </div>
      </div>
    {:else}
      <div class="empty">
        {#if !store.synced}
          {#each [0, 1, 2, 3, 4] as i}
            <div class="skeleton" style:opacity={1 - i * 0.18}><span class="sk-av"></span><span class="sk-lines"><span></span><span></span></span></div>
          {/each}
        {:else if store.search}
          {#if !msgQuery}<p>No chats match “{store.search}”.</p>{/if}
        {:else if store.filter.kind === 'archived'}
          <p>No archived chats.</p>
        {:else if store.filter.kind === 'favorites'}
          <p><b>No favorites yet.</b><br />Right-click a chat and choose “Add to favorites”.</p>
        {:else if store.accountList.length}
          <Braid width={200} height={28} faint />
          <p><b>No chats yet.</b><br />They appear here as the accounts sync.</p>
        {/if}
      </div>
    {/each}

    {#if msgQuery}
      <div class="found" aria-label="Messages">
        <h3>Messages</h3>
        {#each found as m (`${m.accountId}\u0001${m.chatId}\u0001${m.id}`)}
          {@const c = store.chats[chatKey(m.accountId, m.chatId)]}
          {@const sn = snippet(m.text, msgQuery)}
          <button class="hit" onclick={() => openFound(m)}>
            <Avatar name={store.chatName(c)} id={c.id} accountId={c.accountId} group={c.isGroup} size={36} ring="var(--bg-1)" />
            <span class="body">
              <span class="line1"><span class="name">{store.chatName(c)}</span><span class="grow"></span><span class="time">{listTime(m.time)}</span></span>
              <span class="hit-text">{#if c.isGroup || m.isOutgoing}<span class="prefix">{m.isOutgoing ? 'You' : store.senderName(m).split(' ')[0]}:</span> {/if}{sn.before}<mark>{sn.match}</mark>{sn.after}</span>
            </span>
          </button>
        {/each}
        {#if finding}
          <p class="found-status"><LoaderCircle size={14} class="spin" />Searching messages…</p>
        {:else if !found.length}
          <p class="found-status">No messages contain “{msgQuery}”.</p>
        {:else if foundNext}
          <button class="more" onclick={moreMessages}>More results</button>
        {/if}
      </div>
    {/if}
  </div>
</section>

<style>
  .found { padding: 4px 0 12px; }
  .found h3 { margin: 10px 14px 4px; font-size: 12px; font-weight: 600; letter-spacing: 0.04em; text-transform: uppercase; color: var(--text-muted); }
  .hit { width: 100%; display: flex; align-items: center; gap: 10px; padding: 7px 12px; border: 0; background: none; text-align: left; color: var(--text); }
  .hit:hover { background: var(--hover); }
  .hit .body { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 1px; }
  .hit-text { font-size: 13px; color: var(--text-2); display: -webkit-box; -webkit-line-clamp: 2; line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; overflow-wrap: anywhere; }
  .hit-text mark { background: var(--accent-soft); color: var(--accent); border-radius: 3px; padding: 0 1px; font-weight: 600; }
  .found-status { display: flex; align-items: center; justify-content: center; gap: 6px; font-size: 13px; color: var(--text-muted); margin: 8px 12px; }
  .more { display: block; margin: 6px auto 0; border: 0; background: none; color: var(--accent); font-size: 13px; font-weight: 600; }
  .chatlist { width: var(--chatlist-w, 330px); flex-shrink: 0; background: var(--bg-1); border-right: 1px solid var(--border); display: flex; flex-direction: column; min-height: 0; }
  .head { padding: 12px 12px 8px; display: flex; flex-direction: column; gap: 10px; }
  .title-row { display: flex; align-items: center; gap: 6px; }
  h2 { margin: 0; font-size: 18px; font-weight: 650; flex: 1; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .sync { display: inline-flex; align-items: center; gap: 5px; font-size: 12px; color: var(--text-muted); white-space: nowrap; flex-shrink: 0; }
  .search {
    display: flex; align-items: center; gap: 8px; height: 34px; padding: 0 4px 0 10px; border-radius: var(--radius-md);
    background: var(--surface-2); border: 1px solid var(--border); color: var(--text-muted);
  }
  .search:focus-within { border-color: var(--accent); box-shadow: 0 0 0 3px var(--accent-soft); }
  .search input { flex: 1; min-width: 0; border: 0; outline: none; background: transparent; font-size: 14px; color: var(--text); }
  .search input::placeholder { color: var(--text-muted); }
  kbd { font-family: var(--mono); font-size: 10px; color: var(--text-muted); border: 1px solid var(--border); border-radius: 4px; padding: 0 4px; margin-right: 4px; }
  .list { flex: 1; padding: 0 6px 8px; display: flex; flex-direction: column; gap: 1px; outline: none; min-height: 0; }
  .row { display: flex; gap: 12px; align-items: center; padding: 9px 12px; border-radius: 10px; cursor: default; flex-shrink: 0; }
  .row:hover { background: var(--hover); }
  .row.selected { background: var(--selected); }
  .row.cursor { box-shadow: inset 0 0 0 2px var(--focus); }
  .body { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 2px; }
  .line1, .line2 { display: flex; align-items: center; gap: 5px; }
  .name { font-size: 14px; font-weight: 500; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; min-width: 0; }
  .unread .name { font-weight: 650; }
  .grow { flex: 1; }
  .time { font-size: 12px; color: var(--text-muted); flex-shrink: 0; }
  .unread .time { color: var(--accent); }
  .unread.muted .time { color: var(--text-muted); }
  .preview { font-size: 13px; color: var(--text-muted); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; flex: 1; min-width: 0; }
  .unread .preview { color: var(--text); }
  .prefix { color: var(--text-2); font-weight: 500; }
  .unread .prefix { font-weight: 600; }
  .prefix.draft { color: var(--danger); font-weight: 600; }
  .typing { color: var(--accent); font-style: italic; }
  .flag { color: var(--text-muted); display: flex; flex-shrink: 0; }
  .unread-count {
    min-width: 20px; height: 20px; padding: 0 6px; border-radius: 10px; background: var(--accent); color: var(--on-accent);
    font-size: 11px; font-weight: 700; line-height: 20px; text-align: center; flex-shrink: 0; font-variant-numeric: tabular-nums;
  }
  .unread-count.muted { background: var(--border-strong); color: var(--text-2); }
  .mention-dot { width: 18px; height: 18px; border-radius: 50%; background: var(--accent); color: var(--on-accent); display: flex; align-items: center; justify-content: center; flex-shrink: 0; }
  .empty { padding: 24px 16px; color: var(--text-muted); font-size: 13px; text-align: center; display: flex; flex-direction: column; align-items: center; gap: 10px; }
  .empty p { margin: 0; }
  .empty b { color: var(--text-2); }
  .skeleton { display: flex; gap: 12px; align-items: center; width: 100%; padding: 9px 6px; }
  .sk-av { width: 44px; height: 44px; border-radius: 50%; background: var(--skeleton); flex-shrink: 0; }
  .sk-lines { flex: 1; display: flex; flex-direction: column; gap: 8px; }
  .sk-lines span { height: 10px; border-radius: 5px; background: var(--skeleton); }
  .sk-lines span:first-child { width: 60%; }
</style>
