// actions.ts
//
// Copyright (c) 2026 braids contributors
//
// braids is distributed under the GNU AGPL v3 license, see LICENSE for details.

// Chat and message actions shared by the chat list, conversation and info panel.

import { Archive, ArchiveRestore, Bell, BellOff, Image, Mail, MailCheck, MessageCircle, Star, StarOff, Trash2 } from '@lucide/svelte';
import * as api from './api';
import { inviteLinkProtocol } from './protocols';
import { chatKey, splitKey, store } from './store.svelte';
import type { Chat } from './types';
import { openLightbox, ui, type MenuItem } from './ui.svelte';

export function chatMenu(c: Chat): MenuItem[] {
  const items: MenuItem[] = [];
  if (c.isUnread) {
    items.push({
      label: 'Mark as read',
      icon: MailCheck,
      run: async () => {
        const msg = c.lastMessage;
        if (msg) await api.call('messages.markRead', { accountId: c.accountId, chatId: c.id, msgId: msg.id }).catch((e) => store.toastError(e));
      },
    });
  } else {
    items.push({
      label: 'Mark as unread',
      icon: Mail,
      run: () => api.call('chats.markUnread', { accountId: c.accountId, chatId: c.id }).catch((e) => store.toastError(e)),
    });
  }
  const category = store.category(c);
  items.push({
    label: category === 'favorite' ? 'Remove from favorites' : 'Add to favorites',
    icon: category === 'favorite' ? StarOff : Star,
    run: () => store.setCategory(c, category === 'favorite' ? 'default' : 'favorite'),
  });
  items.push({
    label: c.isMuted ? 'Unmute' : 'Mute',
    icon: c.isMuted ? Bell : BellOff,
    run: () => store.setMuted(c, !c.isMuted),
  });
  items.push({
    label: category === 'archived' ? 'Unarchive' : 'Archive',
    icon: category === 'archived' ? ArchiveRestore : Archive,
    run: () => store.setCategory(c, category === 'archived' ? 'default' : 'archived'),
  });
  items.push({
    label: c.isGroup ? 'Leave group…' : 'Delete chat…',
    icon: Trash2,
    danger: true,
    run: async () => {
      const name = store.chatName(c);
      const ok = await ui.confirm(
        c.isGroup ? `Leave “${name}”?` : `Delete chat with ${name}?`,
        c.isGroup ? 'You will stop receiving messages from this group.' : 'The chat and its history are removed from this account.',
        c.isGroup ? 'Leave' : 'Delete',
        true,
      );
      if (ok) await api.call('chats.delete', { accountId: c.accountId, chatId: c.id }).catch((e) => store.toastError(e));
    },
  });
  return items;
}

// Starts editing the newest own text message of the current chat, if the
// protocol still allows editing it.
export function editLastOwnMessage(): boolean {
  if (!store.current) return false;
  const list = store.messages[store.current]?.items ?? [];
  const win = store.accounts[splitKey(store.current)[0]]?.capabilities.editWindowSec ?? 0;
  const m = [...list].reverse().find((x) => x.isOutgoing && !x.isDeleted && x.text);
  if (!m || win === 0 || (win > 0 && Date.now() - m.time > win * 1000)) return false;
  ui.reply = null;
  ui.edit = m;
  return true;
}

// Opens a link from a message or description: a group invite link of a
// messenger with a connected account opens "Join a group", others the browser.
// copies text to the clipboard; `done` is shown when it worked
export function copyText(text: string, done = '') {
  api
    .copyText(text)
    .then(() => done && store.toast(done))
    .catch((e) => store.toastError(e));
}

// Ctrl+C outside text fields: the selected text, or without a selection the
// text of the message under the mouse
export function copyShortcut(e: KeyboardEvent): boolean {
  if (!(e.ctrlKey || e.metaKey) || e.altKey || e.shiftKey || e.key.toLowerCase() !== 'c') return false;
  const t = e.target as HTMLElement | null;
  if (t?.closest('input, textarea, [contenteditable=""], [contenteditable="true"]')) return false;
  const selected = window.getSelection()?.toString() ?? '';
  if (selected) {
    copyText(selected);
    return true;
  }
  const m = ui.hoverMessage;
  if (m?.text && !m.isDeleted) {
    copyText(m.text, 'Message copied');
    return true;
  }
  return false;
}

export function openLink(url: string) {
  const protocol = inviteLinkProtocol(url);
  if (protocol && store.accountList.some((a) => a.protocol === protocol && a.capabilities.joinChat)) {
    ui.joinLink = url;
    ui.newChatOpen = true;
    return;
  }
  api.openUrl(url).catch((e) => store.toastError(e));
}

// Opens a profile picture (of a user or a chat) in the image viewer.
export function viewPicture(accountId: string, id: string, name: string): boolean {
  const path = store.avatar(accountId, id);
  if (!path) return false;
  openLightbox([{ path, name: `${name} – profile picture`, fullAvatar: chatKey(accountId, id) }], path);
  store.requestFullAvatar(accountId, id);
  return true;
}

// The private chat with a user: opened, or created first.
export async function messagePrivately(accountId: string, userId: string) {
  ui.infoOpen = ui.wide && ui.infoOpen;
  const key = chatKey(accountId, userId);
  try {
    if (store.chats[key]) await store.openChat(key);
    else await store.createChat(accountId, userId);
    ui.focusComposer++;
  } catch (e) {
    store.toastError(e);
  }
}

// Menu for a person in a group (avatar, name, member list).
export function personMenu(accountId: string, userId: string, name: string): MenuItem[] {
  const items: MenuItem[] = [];
  if (store.avatar(accountId, userId)) items.push({ label: 'View profile picture', icon: Image, run: () => viewPicture(accountId, userId, name) });
  if (userId !== store.accounts[accountId]?.selfId) items.push({ label: `Message ${name.split(' ')[0]} privately`, icon: MessageCircle, run: () => messagePrivately(accountId, userId) });
  return items;
}
