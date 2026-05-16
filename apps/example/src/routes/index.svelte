<script lang="ts">
let { data }: { data: { requestedAt: string } } = $props()

let count = $state(0)
let lastMessage = $state('')
let ws: WebSocket | undefined = $state(undefined)
let serverTime = $state('')

function connect() {
    ws = new WebSocket(`ws://${location.host}/ws`)
    ws.addEventListener('message', (e) => {
        lastMessage = String(e.data)
    })
}

function ping() {
    ws?.send(`ping ${count}`)
}

async function fetchTime() {
    const res = await fetch('/time')
    const json = (await res.json()) as { now: string }
    serverTime = json.now
}
</script>

<h1 class="text-3xl font-bold">Welcome</h1>
<p class="mt-2 text-slate-600">
  Rendered at <code class="font-mono text-sm">{data.requestedAt}</code> (from the resolve hook).
</p>

<button
  class="mt-6 rounded-md bg-slate-900 px-4 py-2 text-white hover:bg-slate-700"
  onclick={() => count++}
>
  Clicked {count} {count === 1 ? "time" : "times"}
</button>

<div class="mt-10 border-t border-slate-200 pt-6">
  <h2 class="text-xl font-semibold">API route</h2>
  <div class="mt-4 flex items-center gap-3">
    <button
      class="rounded-md border border-slate-300 px-3 py-1.5 hover:bg-slate-100"
      onclick={fetchTime}
    >
      Fetch /time
    </button>
    <code class="font-mono text-sm text-slate-600">{serverTime || "(not fetched)"}</code>
  </div>
</div>

<div class="mt-10 border-t border-slate-200 pt-6">
  <h2 class="text-xl font-semibold">WebSocket</h2>
  <div class="mt-4 flex gap-2">
    <button
      class="rounded-md border border-slate-300 px-3 py-1.5 hover:bg-slate-100 disabled:opacity-50"
      onclick={connect}
      disabled={ws !== undefined}
    >
      Connect
    </button>
    <button
      class="rounded-md border border-slate-300 px-3 py-1.5 hover:bg-slate-100 disabled:opacity-50"
      onclick={ping}
      disabled={ws === undefined}
    >
      Send ping
    </button>
  </div>
  <p class="mt-3 text-sm text-slate-600">
    Last message: <code class="font-mono">{lastMessage || "(none yet)"}</code>
  </p>
</div>
