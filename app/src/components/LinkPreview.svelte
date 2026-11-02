<!--
  LinkPreview.svelte

  Copyright (c) 2026 braids contributors

  braids is distributed under the GNU AGPL v3 license, see LICENSE for details.

  The card under a message with a link: site, title, description and image
  of the first linked page. Nothing is shown when the page has no preview.
-->
<script lang="ts">
  import { openLink } from '../lib/actions';
  import * as api from '../lib/api';

  let { url }: { url: string } = $props();

  let preview = $state<api.LinkPreview | null>(null);
  let imageFailed = $state(false);

  $effect(() => {
    const u = url;
    preview = null;
    imageFailed = false;
    api.linkPreview(u).then((p) => {
      if (u === url) preview = p;
    });
  });

  const imageSrc = $derived(!preview?.image ? '' : /^https?:/.test(preview.image) ? preview.image : api.fileUrl(preview.image));
</script>

{#if preview}
  <button class="link-preview" onclick={() => openLink(url)} title={preview.url}>
    {#if imageSrc && !imageFailed}
      <img src={imageSrc} alt="" loading="lazy" onerror={() => (imageFailed = true)} />
    {/if}
    <span class="lp-text">
      <span class="lp-site">{preview.siteName}</span>
      <b>{preview.title}</b>
      {#if preview.description}<span class="lp-desc">{preview.description}</span>{/if}
    </span>
  </button>
{/if}

<style>
  .link-preview {
    display: flex; flex-direction: column; width: 100%; max-width: 360px; margin: 6px 0 2px; padding: 0; overflow: hidden; text-align: left;
    border: 0; border-left: 3px solid var(--accent); border-radius: 4px 10px 10px 4px; background: color-mix(in srgb, var(--accent) 7%, transparent); color: var(--text);
  }
  .link-preview:hover { background: color-mix(in srgb, var(--accent) 12%, transparent); }
  img { width: 100%; max-height: 180px; object-fit: cover; display: block; }
  .lp-text { display: flex; flex-direction: column; gap: 2px; padding: 7px 10px 8px; min-width: 0; }
  .lp-site { font-size: 12px; font-weight: 600; color: var(--accent); }
  b { font-size: 13px; font-weight: 600; line-height: 18px; display: -webkit-box; -webkit-line-clamp: 2; line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
  .lp-desc { font-size: 12px; line-height: 17px; color: var(--text-2); display: -webkit-box; -webkit-line-clamp: 3; line-clamp: 3; -webkit-box-orient: vertical; overflow: hidden; }
</style>
