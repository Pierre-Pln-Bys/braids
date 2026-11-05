<!--
  Sticker.svelte

  Copyright (c) 2026 braids contributors

  braids is distributed under the GNU AGPL v3 license, see LICENSE for details.

  A sticker without a bubble: an image (WebP, PNG, animated WebP), a video
  sticker (WebM, looping) or a Telegram animated sticker (.tgs, gzipped
  Lottie JSON). Animations play while on screen; the emoji stands in while
  the file loads or when it cannot be shown.
-->
<script lang="ts">
  import { onDestroy } from 'svelte';
  import * as api from '../lib/api';
  import { mediaSrc } from '../lib/media';
  import { fileReady } from '../lib/store.svelte';
  import type { FileRef } from '../lib/types';

  let { file, emoji }: { file: FileRef; emoji: string } = $props();

  const SIZE = 168;
  const ready = $derived(fileReady(file));
  const isLottie = $derived(file.mimeType === 'application/x-tgsticker' || file.name.toLowerCase().endsWith('.tgs'));
  const isVideo = $derived(file.mimeType.startsWith('video/'));

  let box: HTMLDivElement | undefined = $state();
  let failed = $state(false);
  let anim: { play(): void; pause(): void; destroy(): void } | null = null;
  let observer: IntersectionObserver | null = null;

  async function loadLottie(el: HTMLDivElement, path: string) {
    try {
      if (typeof DecompressionStream === 'undefined') throw new Error('no gzip');
      const res = await fetch(api.fileUrl(path));
      const json = await new Response(res.body!.pipeThrough(new DecompressionStream('gzip'))).json();
      const { default: lottie } = await import('lottie-web/build/player/esm/lottie_light.min.js');
      anim?.destroy();
      anim = lottie.loadAnimation({ container: el, renderer: 'svg', loop: true, autoplay: false, animationData: json });
      // play only while visible: a long chat has many stickers
      observer?.disconnect();
      observer = new IntersectionObserver(([e]) => (e.isIntersecting ? anim?.play() : anim?.pause()));
      observer.observe(el);
    } catch {
      failed = true;
    }
  }

  $effect(() => {
    if (ready && isLottie && box) loadLottie(box, file.path);
  });

  onDestroy(() => {
    observer?.disconnect();
    anim?.destroy();
  });
</script>

<div class="sticker" style:--size="{SIZE}px" role="img" aria-label={emoji ? `Sticker ${emoji}` : 'Sticker'}>
  {#if !ready || failed}
    <span class="stand-in">{emoji || '🖼️'}</span>
  {:else if isLottie}
    <div class="lottie" bind:this={box}></div>
  {:else if isVideo}
    <!-- svelte-ignore a11y_media_has_caption -->
    <video use:mediaSrc={{ path: file.path, type: file.mimeType, lazy: true }} autoplay loop muted playsinline onerror={() => (failed = true)}></video>
  {:else}
    <img src={api.fileUrl(file.path)} alt={emoji || 'Sticker'} loading="lazy" draggable="false" onerror={() => (failed = true)} />
  {/if}
</div>

<style>
  .sticker { width: var(--size); height: var(--size); display: flex; align-items: center; justify-content: center; }
  .sticker img, .sticker video, .lottie { max-width: 100%; max-height: 100%; width: 100%; height: 100%; object-fit: contain; }
  .stand-in { font-size: 64px; line-height: 1; opacity: 0.85; }
</style>
