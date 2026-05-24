<!--
Root page — served at GET /. Every folder under src/pages/ that contains a
page.svelte mounts at that folder's URL.
-->
<script lang="ts">
import { cache } from 'belte/cache'
import { getHello } from '$rpc/getHello.ts'

/*
Top-level await runs on the server during SSR. The Response is captured into
the per-request cache, serialized into the HTML, and replayed on the client
during hydration — no second fetch.
*/
const hello = await cache(getHello)().then((res) => res.json())
</script>

<h1>{hello.message}</h1>
<p>Edit <code>src/pages/page.svelte</code> and the page hot-reloads.</p>
