<script lang="ts">
import { cache } from 'belte/cache'
import { getPost } from '$rpc/getPost.ts'

/*
Pages under bracket folders get their dynamic segments as props. The id
prop is typed via the auto-generated Routes augmentation belte emits at
src/.belte/routes.d.ts — same shape as `nav.params` for this route.
*/
let { id }: { id: string } = $props()

/*
`cache(fn, { key })` scopes the cache entry under the explicit key.
Without it, two posts would share a single getPost entry and clobber each
other. The args pass through to the handler over `/rpc/getPost?id=…`.
Wrapping `await` inside `$derived` makes the value re-resolve when `id`
changes (e.g. navigating /posts/1 → /posts/2 without remounting the Page).
*/
const post = $derived(
    await cache(getPost, { key: ['post', id] })({ id }).then((res) => res.json()),
)
</script>

<h1 class="text-3xl font-bold">Post {id}</h1>
{#if post}
    <p class="mt-3 text-slate-700">{post.title}</p>
{:else}
    <p class="mt-3 text-slate-500">No post with id {id}.</p>
{/if}

<p class="mt-6 text-sm">
    <a class="underline" href="/">Back home</a>
</p>
