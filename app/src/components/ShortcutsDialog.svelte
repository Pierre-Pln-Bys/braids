<!--
  ShortcutsDialog.svelte

  Copyright (c) 2026 braids contributors

  braids is distributed under the GNU AGPL v3 license, see LICENSE for details.

  Read-only overview of the current keyboard shortcuts, by group. Shows the
  user's own bindings; "Change shortcuts…" opens Settings → Keyboard.
-->
<script lang="ts">
  import { X } from '@lucide/svelte';
  import { ACTIONS, GROUPS, bindings, comboKeys } from '../lib/keybinds.svelte';
  import { ui } from '../lib/ui.svelte';

  function close() {
    ui.shortcuts = false;
  }

  function change() {
    ui.shortcuts = false;
    ui.settingsAccount = '';
    ui.settingsSection = 'keyboard';
    ui.settingsOpen = true;
  }
</script>

<svelte:window onkeydown={(e) => e.key === 'Escape' && close()} />

<div class="scrim" role="presentation" onclick={(e) => e.target === e.currentTarget && close()}>
  <div class="dialog" role="dialog" aria-modal="true" aria-labelledby="shortcuts-title">
    <div class="dialog-head">
      <h2 id="shortcuts-title">Keyboard shortcuts</h2>
      <button class="icon-btn" aria-label="Close" onclick={close}><X size={18} /></button>
    </div>
    <div class="dialog-body">
      {#each GROUPS as g (g.id)}
        <section>
          <h3>{g.label}</h3>
          {#each ACTIONS.filter((a) => a.group === g.id) as a (a.id)}
            <div class="sc-row" data-shortcut={a.id}>
              <span>{a.label}</span>
              <span class="combos">
                {#each bindings(a.id) as combo (combo)}
                  <span class="combo">
                    {#each comboKeys(combo) as k}<kbd>{k}</kbd>{/each}
                  </span>
                {:else}
                  <span class="none">Not set</span>
                {/each}
              </span>
            </div>
          {/each}
        </section>
      {/each}
      <button class="link" onclick={change}>Change shortcuts…</button>
    </div>
  </div>
</div>

<style>
  section { display: flex; flex-direction: column; gap: 2px; }
  h3 { margin: 8px 0 4px; font-size: 12px; text-transform: uppercase; letter-spacing: 0.04em; color: var(--text-muted); }
  .sc-row { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 4px 0; font-size: 14px; }
  .combos { display: flex; gap: 10px; flex-wrap: wrap; justify-content: flex-end; }
  .combo { display: flex; gap: 3px; }
  kbd { font-family: var(--mono); font-size: 11px; border: 1px solid var(--border-strong); border-bottom-width: 2px; border-radius: 4px; padding: 0 5px; min-width: 20px; text-align: center; }
  .none { font-size: 13px; color: var(--text-muted); }
  .link { align-self: flex-start; margin-top: 8px; border: 0; background: none; padding: 0; color: var(--accent); font-size: 13px; }
  .link:hover { text-decoration: underline; }
</style>