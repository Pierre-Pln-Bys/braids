// main.ts
//
// Copyright (c) 2026 braids contributors
//
// braids is distributed under the GNU AGPL v3 license, see LICENSE for details.

import { mount } from 'svelte';
import App from './App.svelte';
import { store } from './lib/store.svelte';
import { theme } from './lib/theme.svelte';
import './styles/tokens.css';
import './styles/app.css';

theme.init();

// No browser context menu (Reload, Inspect Element, ...): the app has its own
// menus; text fields keep theirs for cut / copy / paste.
window.addEventListener('contextmenu', (e) => {
  const t = e.target as HTMLElement | null;
  const editable = !!t?.closest('input, textarea, [contenteditable=""], [contenteditable="true"]');
  if (!editable) e.preventDefault();
});
const app = mount(App, { target: document.getElementById('app')! });
store.start();

// for the UI tests and debugging from the devtools console
(window as any).__braids = { store };

export default app;
