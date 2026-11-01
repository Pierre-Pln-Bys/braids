<!--
  Lightbox.svelte

  Copyright (c) 2026 braids contributors

  braids is distributed under the GNU AGPL v3 license, see LICENSE for details.

  Image viewer: zoom (wheel towards the cursor, + / - / 0, double-click),
  pan (drag; arrow keys or h j k l while zoomed), switch between the images
  of the chat or list (← → or j k while not zoomed), Esc closes.
-->
<script lang="ts">
  import { ChevronLeft, ChevronRight, ExternalLink, X, ZoomIn, ZoomOut } from '@lucide/svelte';
  import * as api from '../lib/api';
  import { store } from '../lib/store.svelte';
  import { ui } from '../lib/ui.svelte';

  const MIN = 1;
  const MAX = 8;
  const PAN_STEP = 80;

  const lb = $derived(ui.lightbox!);
  const item = $derived(lb.items[lb.index]);
  const count = $derived(lb.items.length);

  let scale = $state(1);
  let x = $state(0);
  let y = $state(0);
  let stage: HTMLDivElement | undefined = $state();
  let drag: { px: number; py: number; x: number; y: number; moved: boolean } | null = null;

  // a new image starts fitted
  $effect(() => {
    void item?.path;
    scale = 1;
    x = 0;
    y = 0;
  });

  function close() {
    ui.lightbox = null;
  }

  function go(delta: number) {
    if (count < 2 || !ui.lightbox) return;
    ui.lightbox.index = (lb.index + delta + count) % count;
  }

  // zoom to s, keeping the point (cx, cy) (relative to the stage center) in place
  function zoomTo(s: number, cx = 0, cy = 0) {
    const next = Math.min(MAX, Math.max(MIN, s));
    const k = next / scale;
    x = cx - (cx - x) * k;
    y = cy - (cy - y) * k;
    scale = next;
    if (scale === 1) {
      x = 0;
      y = 0;
    }
  }

  function center(e: { clientX: number; clientY: number }): [number, number] {
    const r = stage!.getBoundingClientRect();
    return [e.clientX - (r.left + r.width / 2), e.clientY - (r.top + r.height / 2)];
  }

  function onWheel(e: WheelEvent) {
    e.preventDefault();
    const [cx, cy] = center(e);
    zoomTo(scale * Math.exp(-e.deltaY * 0.0015), cx, cy);
  }

  function onDblClick(e: MouseEvent) {
    const [cx, cy] = center(e);
    zoomTo(scale > 1 ? 1 : 2.5, cx, cy);
  }

  function onPointerDown(e: PointerEvent) {
    if (e.button !== 0) return;
    drag = { px: e.clientX, py: e.clientY, x, y, moved: false };
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  }

  function onPointerMove(e: PointerEvent) {
    if (!drag) return;
    const dx = e.clientX - drag.px;
    const dy = e.clientY - drag.py;
    if (Math.abs(dx) + Math.abs(dy) > 3) drag.moved = true;
    if (scale > 1) {
      x = drag.x + dx;
      y = drag.y + dy;
    }
  }

  function onPointerUp(e: PointerEvent) {
    const d = drag;
    drag = null;
    // a click on the backdrop (not a drag, not on the image) closes
    if (d && !d.moved && scale === 1 && e.target === stage) close();
  }

  function onKey(e: KeyboardEvent) {
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    const zoomed = scale > 1;
    const k = e.key;
    let handled = true;
    if (k === 'Escape') close();
    else if (k === '+' || k === '=') zoomTo(scale * 1.5);
    else if (k === '-' || k === '_') zoomTo(scale / 1.5);
    else if (k === '0') zoomTo(1);
    else if (zoomed && (k === 'ArrowLeft' || k === 'h')) x += PAN_STEP;
    else if (zoomed && (k === 'ArrowRight' || k === 'l')) x -= PAN_STEP;
    else if (zoomed && (k === 'ArrowUp' || k === 'k')) y += PAN_STEP;
    else if (zoomed && (k === 'ArrowDown' || k === 'j')) y -= PAN_STEP;
    else if (k === 'ArrowRight' || k === 'j' || k === 'l' || k === 'ArrowDown' || k === 'PageDown') go(1);
    else if (k === 'ArrowLeft' || k === 'k' || k === 'h' || k === 'ArrowUp' || k === 'PageUp') go(-1);
    else handled = false;
    if (handled) {
      e.preventDefault();
      e.stopPropagation();
    }
  }
</script>

<svelte:window onkeydown={onKey} />

{#if item}
  <div class="lightbox" role="dialog" aria-modal="true" aria-label={item.name}>
    <div class="lb-bar">
      <span class="lb-name">{item.name}</span>
      {#if count > 1}<span class="lb-pos">{lb.index + 1} / {count}</span>{/if}
      <span class="lb-zoom">{Math.round(scale * 100)}%</span>
      <button class="icon-btn" aria-label="Zoom out" title="Zoom out (-)" onclick={() => zoomTo(scale / 1.5)} disabled={scale <= MIN}><ZoomOut size={19} /></button>
      <button class="icon-btn" aria-label="Zoom in" title="Zoom in (+)" onclick={() => zoomTo(scale * 1.5)} disabled={scale >= MAX}><ZoomIn size={19} /></button>
      <button class="icon-btn" aria-label="Open with default app" title="Open with default app" onclick={() => api.openPath(item.path).catch((e) => store.toastError(e))}><ExternalLink size={19} /></button>
      <button class="icon-btn" aria-label="Close" title="Close (Esc)" onclick={close}><X size={20} /></button>
    </div>
    <div
      class="lb-stage"
      class:zoomed={scale > 1}
      role="presentation"
      bind:this={stage}
      onwheel={onWheel}
      ondblclick={onDblClick}
      onpointerdown={onPointerDown}
      onpointermove={onPointerMove}
      onpointerup={onPointerUp}
    >
      <img src={api.fileUrl(item.path)} alt={item.name} draggable="false" style:transform={`translate(${x}px, ${y}px) scale(${scale})`} />
      {#if count > 1}
        <button class="nav prev" aria-label="Previous image" title="Previous (← or k)" onclick={() => go(-1)} onpointerdown={(e) => e.stopPropagation()}><ChevronLeft size={26} /></button>
        <button class="nav next" aria-label="Next image" title="Next (→ or j)" onclick={() => go(1)} onpointerdown={(e) => e.stopPropagation()}><ChevronRight size={26} /></button>
      {/if}
    </div>
    <div class="lb-hint">Scroll or + / − to zoom · drag or arrows to move · {count > 1 ? '← → or j k to switch · ' : ''}Esc to close</div>
  </div>
{/if}

<style>
  .lightbox { position: fixed; inset: 0; z-index: 70; background: rgba(15, 14, 13, 0.94); display: flex; flex-direction: column; animation: fade var(--duration-fast) var(--ease); }
  .lb-bar { display: flex; align-items: center; gap: 4px; padding: 10px 12px 10px 20px; color: #f2efeb; }
  .lb-bar .icon-btn { color: #f2efeb; }
  .lb-bar .icon-btn:hover:not(:disabled) { background: rgba(255, 255, 255, 0.1); }
  .lb-bar .icon-btn:disabled { opacity: 0.35; }
  .lb-name { flex: 1; font-size: 13px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .lb-pos, .lb-zoom { font-size: 12px; color: rgba(242, 239, 235, 0.7); font-variant-numeric: tabular-nums; padding: 0 6px; }
  .lb-stage { flex: 1; min-height: 0; position: relative; display: flex; align-items: center; justify-content: center; overflow: hidden; padding: 0 64px; touch-action: none; cursor: default; }
  .lb-stage.zoomed { cursor: grab; }
  .lb-stage.zoomed:active { cursor: grabbing; }
  .lb-stage img { max-width: 100%; max-height: 100%; object-fit: contain; border-radius: 6px; user-select: none; transform-origin: center center; transition: transform 60ms linear; }
  .nav {
    position: absolute; top: 50%; transform: translateY(-50%); width: 44px; height: 44px; border-radius: 22px; border: 0;
    display: flex; align-items: center; justify-content: center; background: rgba(255, 255, 255, 0.08); color: #f2efeb;
  }
  .nav:hover { background: rgba(255, 255, 255, 0.18); }
  .prev { left: 12px; }
  .next { right: 12px; }
  .lb-hint { text-align: center; font-size: 11px; color: rgba(242, 239, 235, 0.5); padding: 6px 12px 10px; }
</style>
