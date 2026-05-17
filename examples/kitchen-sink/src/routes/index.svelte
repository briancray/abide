<script lang="ts">
let { data }: { data: { requestedAt: string; user?: string } } = $props()

let timeNow = $state('')
let timeError = $state('')
async function fetchTime() {
    timeError = ''
    timeNow = ''
    const res = await fetch('/time')
    if (!res.ok) {
        timeError = `${res.status} ${res.statusText}`
        return
    }
    const { now } = (await res.json()) as { now: string }
    timeNow = now
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
  <h2 class="text-lg font-semibold">1. Layouts & resolve hooks</h2>
  <p class="mt-1 text-sm text-slate-600">
    The root <code class="font-mono">_layout.ts</code> resolve hook runs server-side per request
    and feeds <code class="font-mono">data</code> into every page.
  </p>
  <dl class="mt-3 grid grid-cols-[max-content_1fr] gap-x-4 gap-y-1 text-sm">
    <dt class="text-slate-500">requestedAt</dt>
    <dd><code class="font-mono">{data.requestedAt}</code></dd>
    <dt class="text-slate-500">user</dt>
    <dd><code class="font-mono">{data.user ?? '(none)'}</code></dd>
  </dl>
</section>

<section class="mt-6 rounded-lg border border-slate-200 bg-white p-5">
  <h2 class="text-lg font-semibold">2. API routes</h2>
  <p class="mt-1 text-sm text-slate-600">
    <code class="font-mono">routes/time.ts</code> exports a <code class="font-mono">GET</code>
    that returns a JSON <code class="font-mono">Response</code>.
  </p>
  <div class="mt-3 flex items-center gap-3">
    <button
      class="rounded-md border border-slate-300 px-3 py-1.5 text-sm hover:bg-slate-100"
      onclick={fetchTime}
    >
      Fetch /time
    </button>
    <code class="font-mono text-sm text-slate-600">
      {timeError || timeNow || '(not fetched)'}
    </code>
  </div>
</section>

<section class="mt-6 rounded-lg border border-slate-200 bg-white p-5">
  <h2 class="text-lg font-semibold">3. Auth</h2>
  <p class="mt-1 text-sm text-slate-600">
    Cookie-based session. <code class="font-mono">routes/dashboard.ts</code> is colocated with
    a page and returns <code class="font-mono">&#123; redirect: '/login' &#125;</code> when no
    session is present.
  </p>
  <div class="mt-3 flex items-center gap-3 text-sm">
    {#if data.user}
      <span class="text-slate-600">
        Signed in as <strong>{data.user}</strong>.
      </span>
      <a class="text-slate-900 underline" href="/dashboard">Go to /dashboard</a>
    {:else}
      <a
        class="rounded-md bg-slate-900 px-3 py-1.5 text-white hover:bg-slate-700"
        href="/login"
      >
        Log in
      </a>
      <a class="text-slate-900 underline" href="/dashboard">
        Try /dashboard (will redirect)
      </a>
    {/if}
  </div>
</section>

<section class="mt-6 rounded-lg border border-slate-200 bg-white p-5">
  <h2 class="text-lg font-semibold">4. WebSocket</h2>
  <p class="mt-1 text-sm text-slate-600">
    <code class="font-mono">src/socket.ts</code> is wired into the same
    <code class="font-mono">Bun.serve</code> process — no second server.
  </p>
  <div class="mt-3 flex gap-2">
    <button
      class="rounded-md border border-slate-300 px-3 py-1.5 text-sm hover:bg-slate-100 disabled:opacity-50"
      onclick={connect}
      disabled={ws !== undefined}
    >
      Connect
    </button>
    <button
      class="rounded-md border border-slate-300 px-3 py-1.5 text-sm hover:bg-slate-100 disabled:opacity-50"
      onclick={ping}
      disabled={ws === undefined}
    >
      Send message
    </button>
    <button
      class="rounded-md border border-slate-300 px-3 py-1.5 text-sm hover:bg-slate-100 disabled:opacity-50"
      onclick={disconnect}
      disabled={ws === undefined}
    >
      Disconnect
    </button>
  </div>
  {#if messages.length > 0}
    <ul class="mt-3 space-y-1 text-sm">
      {#each messages as m (m)}
        <li><code class="font-mono text-slate-600">{m}</code></li>
      {/each}
    </ul>
  {/if}
</section>

<section class="mt-6 rounded-lg border border-slate-200 bg-white p-5">
  <h2 class="text-lg font-semibold">5. Error handling</h2>
  <p class="mt-1 text-sm text-slate-600">
    belte sets <code class="font-mono">Cache-Control: no-store</code> on 4xx/5xx and an
    <code class="font-mono">Allow</code> header on 405.
  </p>
  <div class="mt-3 flex flex-wrap gap-2">
    <button
      class="rounded-md border border-slate-300 px-3 py-1.5 text-sm hover:bg-slate-100"
      onclick={() => trigger('GET /nope', '/nope', { headers: { Accept: 'application/json' } })}
    >
      404 (unknown route)
    </button>
    <button
      class="rounded-md border border-slate-300 px-3 py-1.5 text-sm hover:bg-slate-100"
      onclick={() => trigger('POST /time', '/time', { method: 'POST' })}
    >
      405 (POST /time)
    </button>
    <button
      class="rounded-md border border-slate-300 px-3 py-1.5 text-sm hover:bg-slate-100"
      onclick={() => trigger('GET /boom', '/boom')}
    >
      500 (handler throws)
    </button>
  </div>
  {#if errorOutcome}
    <p class="mt-3 font-mono text-sm text-slate-600">{errorOutcome}</p>
  {/if}
</section>
