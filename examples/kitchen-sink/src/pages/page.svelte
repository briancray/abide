<script lang="ts">
import { cache } from 'belte/cache'
import { navigate } from 'belte/nav'
import { getNow } from '$rpc/getNow.ts'
import { boom } from '$rpc/boom.ts'

const ssrTime = await cache(getNow, { ttl: 0 })()
    .then((res) => res.json())
    .then(({ now }) => now)

let remoteTime = $state('')
async function callRemote() {
    const res = await getNow()
    remoteTime = res.ok ? (await res.json()).now : `${res.status} ${res.statusText}`
}

let fetchedTime = $state('')
async function callPlainFetch() {
    const res = await fetch(getNow.url)
    fetchedTime = res.ok ? (await res.json()).now : `${res.status} ${res.statusText}`
}

let ws: WebSocket | undefined = $state(undefined)
let messages = $state<string[]>([])
function connect() {
    const sock = new WebSocket(`ws://${location.host}/__belte/socket`)
    sock.addEventListener('message', (e) => {
        messages = [...messages, String(e.data)]
    })
    sock.addEventListener('close', () => {
        ws = undefined
    })
    ws = sock
}
function ping() {
    ws?.send(`hello at ${new Date().toLocaleTimeString()}`)
}
function disconnect() {
    ws?.close()
}

let errorOutcome = $state('')
async function trigger(label: string, url: string, init?: RequestInit) {
    const res = await fetch(url, init)
    const allow = res.headers.get('allow')
    errorOutcome = `${label} → ${res.status}${allow ? ` (Allow: ${allow})` : ''}`
}
</script>

<h1 class="text-3xl font-bold">belte kitchen-sink</h1>
<p class="mt-2 text-slate-600">
    Each section below exercises a belte feature against this same running server.
</p>

<section class="mt-8 rounded-lg border border-slate-200 bg-white p-5">
    <h2 class="text-lg font-semibold">1. SSR data</h2>
    <p class="mt-1 text-sm text-slate-600">
        Top-level <code class="font-mono">await cache(getNow)()</code>
        runs on the server during SSR — the value is baked into the HTML and arrives with the first paint.
    </p>
    <p class="mt-3 font-mono text-sm text-slate-600">{ssrTime}</p>
</section>

<section class="mt-6 rounded-lg border border-slate-200 bg-white p-5">
    <h2 class="text-lg font-semibold">2. Remote functions</h2>
    <p class="mt-1 text-sm text-slate-600">
        <code class="font-mono">src/rpc/getNow.ts</code>
        exports a typed remote function. On the client it's a proxy —
        <code class="font-mono">await getNow()</code>
        — that fetches the same URL. Because it's just an HTTP endpoint, plain
        <code class="font-mono">fetch(getNow.url)</code> works too.
    </p>
    <div class="mt-3 flex items-center gap-3">
        <button
            type="button"
            class="rounded-md border border-slate-300 px-3 py-1.5 text-sm hover:bg-slate-100"
            onclick={callRemote}>
            Call getNow()
        </button>
        <code class="font-mono text-sm text-slate-600">{remoteTime || '(not called)'}</code>
    </div>
    <div class="mt-2 flex items-center gap-3">
        <button
            type="button"
            class="rounded-md border border-slate-300 px-3 py-1.5 text-sm hover:bg-slate-100"
            onclick={callPlainFetch}>
            fetch(getNow.url)
        </button>
        <code class="font-mono text-sm text-slate-600">{fetchedTime || '(not called)'}</code>
    </div>
</section>

<section class="mt-6 rounded-lg border border-slate-200 bg-white p-5">
    <h2 class="text-lg font-semibold">3. Auth</h2>
    <p class="mt-1 text-sm text-slate-600">
        Cookie-based session. <code class="font-mono">src/rpc/getSession.ts</code>
        exposes <code class="font-mono">getSession()</code>
        , called from layouts/pages via
        <code class="font-mono">cache()</code>
        . This is just an example auth implementation and should be solved in userland.
    </p>
    <p class="mt-3 text-sm text-slate-600">
        <a class="text-slate-900 underline" href="/dashboard">Go to /dashboard</a>
    </p>
</section>

<section class="mt-6 rounded-lg border border-slate-200 bg-white p-5">
    <h2 class="text-lg font-semibold">4. Live cache + invalidation</h2>
    <p class="mt-1 text-sm text-slate-600">
        <code class="font-mono">src/rpc/getCounter.ts</code>
        (GET), <code class="font-mono">src/rpc/incrementCounter.ts</code> (POST),
        and <code class="font-mono">src/rpc/resetCounter.ts</code> (DELETE) all touch the same
        module-level state. Reading
        <code class="font-mono">cache(fn)()</code>
        inside <code class="font-mono">$derived</code> subscribes;
        <code class="font-mono">cache.invalidate(fn)</code>
        broadcasts and every derived binding refetches.
    </p>
    <p class="mt-3 text-sm text-slate-600">
        <a class="text-slate-900 underline" href="/counter">Go to /counter</a>
    </p>
</section>

<section class="mt-6 rounded-lg border border-slate-200 bg-white p-5">
    <h2 class="text-lg font-semibold">5. WebSocket</h2>
    <p class="mt-1 text-sm text-slate-600">
        <code class="font-mono">src/app.ts</code> defines <code class="font-mono">socket</code> —
        wired into the same <code class="font-mono">Bun.serve</code> process.
    </p>
    <div class="mt-3 flex gap-2">
        <button
            type="button"
            class="rounded-md border border-slate-300 px-3 py-1.5 text-sm hover:bg-slate-100 disabled:opacity-50"
            onclick={connect}
            disabled={ws !== undefined}>
            Connect
        </button>
        <button
            type="button"
            class="rounded-md border border-slate-300 px-3 py-1.5 text-sm hover:bg-slate-100 disabled:opacity-50"
            onclick={ping}
            disabled={ws === undefined}>
            Send message
        </button>
        <button
            type="button"
            class="rounded-md border border-slate-300 px-3 py-1.5 text-sm hover:bg-slate-100 disabled:opacity-50"
            onclick={disconnect}
            disabled={ws === undefined}>
            Disconnect
        </button>
    </div>
    {#if messages.length > 0}
        <ul class="mt-3 space-y-1 text-sm">
            {#each messages as m}
                <li><code class="font-mono text-slate-600">{m}</code></li>
            {/each}
        </ul>
    {/if}
</section>

<section class="mt-6 rounded-lg border border-slate-200 bg-white p-5">
    <h2 class="text-lg font-semibold">6. Dynamic routes</h2>
    <p class="mt-1 text-sm text-slate-600">
        <code class="font-mono">src/pages/posts/[id]/page.svelte</code> mounts at
        <code class="font-mono">/posts/:id</code>. The <code class="font-mono">id</code> arrives as a
        $prop, typed via the generated
        <code class="font-mono">Routes</code>
        augmentation. <code class="font-mono">navigate(href)</code>
        from
        <code class="font-mono">belte/nav</code> does the same SPA navigation as clicking a link.
    </p>
    <div class="mt-3 flex flex-wrap gap-2">
        <a
            href="/posts/1"
            class="rounded-md border border-slate-300 px-3 py-1.5 text-sm hover:bg-slate-100">
            /posts/1 (link)
        </a>
        <button
            type="button"
            class="rounded-md border border-slate-300 px-3 py-1.5 text-sm hover:bg-slate-100"
            onclick={() => navigate('/posts/2')}>
            /posts/2 (navigate())
        </button>
    </div>
</section>

<section class="mt-6 rounded-lg border border-slate-200 bg-white p-5">
    <h2 class="text-lg font-semibold">7. Error handling</h2>
    <p class="mt-1 text-sm text-slate-600">
        belte sets <code class="font-mono">Cache-Control: no-store</code> on 4xx/5xx and an
        <code class="font-mono">Allow</code> header on 405.
    </p>
    <div class="mt-3 flex flex-wrap gap-2">
        <button
            type="button"
            class="rounded-md border border-slate-300 px-3 py-1.5 text-sm hover:bg-slate-100"
            onclick={() => trigger('GET /nope', '/nope', { headers: { Accept: 'application/json' } })}>
            404 (unknown route)
        </button>
        <button
            type="button"
            class="rounded-md border border-slate-300 px-3 py-1.5 text-sm hover:bg-slate-100"
            onclick={() => trigger('POST /rpc/getNow', getNow.url, { method: 'POST' })}>
            405 (POST /rpc/getNow)
        </button>
        <button
            type="button"
            class="rounded-md border border-slate-300 px-3 py-1.5 text-sm hover:bg-slate-100"
            onclick={() => trigger('GET /rpc/boom', boom.url)}>
            500 (handler throws)
        </button>
    </div>
    {#if errorOutcome}
        <p class="mt-3 font-mono text-sm text-slate-600">{errorOutcome}</p>
    {/if}
</section>
