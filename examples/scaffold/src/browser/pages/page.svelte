<!--
Root page — served at GET /. Every folder under src/browser/pages/ that
contains a page.svelte mounts at that folder's URL.
-->
<script lang="ts">
import { cache } from '@briancray/belte/browser/cache'
import { getHello } from '$server/rpc/getHello.ts'

/*
Top-level await runs on the server during SSR. The decoded body is captured
into the per-request cache, serialized into the HTML, and replayed on the
client during hydration — no second fetch. `cache(fn)()` returns the
Content-Type-decoded value (JSON object, string, or Blob); reach for
`.raw(args)` if you need the underlying Response.
*/
const hello = await cache(getHello)()
</script>

<h1>{hello.message}</h1>
<p>Edit <code>src/browser/pages/page.svelte</code> and the page hot-reloads.</p>
