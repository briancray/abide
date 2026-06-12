<script lang="ts">
import { log } from '@belte/belte/shared/log'
import { trace } from '@belte/belte/shared/trace'
import CodeBlock from '$browser/CodeBlock.svelte'
import { getRates } from '$server/rpc/getRates.ts'

/*
trace() is isomorphic: on the server it resolves from the request scope, in
the browser from the trace stamped into the SSR payload — so this read (it
runs during SSR and hydrates) is the traceparent of the request that
rendered this page.
*/
const pageTrace = trace()

/* DEBUG-gated diagnostic channel (browser gate: the belte-debug localStorage key). */
const demoChannel = log.channel('kitchen-sink:demo')

let channelArmed = $state(false)
function armChannel() {
    localStorage.setItem('belte-debug', 'kitchen-sink:demo')
    channelArmed = true
}

let traced = $state('(not run)')
async function runTraced() {
    /* log.trace times the work and logs name + duration at settle; failures rethrow. */
    const rates = await log.trace('fetch rates', () => getRates({ base: 'USD' }))
    traced = `1 USD = ${rates.rates.EUR} EUR — duration logged`
}
</script>

<h1 class="text-3xl font-bold">Logging &amp; tracing</h1>
<p class="mt-2 text-slate-600">
    One logger, both sides. Every record carries its channel plus — inside a request — the trace id,
    elapsed ms, and verb+path.
    <code class="font-mono">warn</code>/<code class="font-mono">error</code>
    are presentation levels, never gates: a silenced channel is silent at every level. Server lines
    render as tab-separated values, or one JSON object per line under
    <code class="font-mono">BELTE_LOG_FORMAT=json</code>.
</p>

<section class="mt-6">
    <h2 class="text-sm font-semibold">Channels</h2>
    <div class="mt-2 overflow-x-auto rounded-lg border border-slate-200 bg-white">
        <table class="w-full text-sm">
            <thead class="border-b border-slate-200 bg-slate-50 text-left">
                <tr>
                    <th class="px-4 py-2 font-mono font-medium">call</th>
                    <th class="px-4 py-2 font-medium">channel</th>
                    <th class="px-4 py-2 font-medium">gate</th>
                </tr>
            </thead>
            <tbody class="divide-y divide-slate-100">
                <tr>
                    <td class="px-4 py-2 font-mono">log(...) / log.warn / log.error</td>
                    <td class="px-4 py-2 text-slate-600">the app's own (its name)</td>
                    <td class="px-4 py-2 text-slate-600">
                        always on; <code class="font-mono">DEBUG=-&lt;name&gt;</code> silences
                    </td>
                </tr>
                <tr>
                    <td class="px-4 py-2 font-mono">log.channel(name)(...)</td>
                    <td class="px-4 py-2 font-mono text-slate-600">name</td>
                    <td class="px-4 py-2 text-slate-600">
                        emits only when <code class="font-mono">DEBUG</code> matches (browser: the
                        <code class="font-mono">belte-debug</code>
                        localStorage key)
                    </td>
                </tr>
                <tr>
                    <td class="px-4 py-2 font-mono">log.trace(name, work)</td>
                    <td class="px-4 py-2 text-slate-600">same channel as its logger</td>
                    <td class="px-4 py-2 text-slate-600">
                        times <code class="font-mono">work</code>, logs name + duration at settle,
                        rethrows failures
                    </td>
                </tr>
            </tbody>
        </table>
    </div>
    <p class="mt-2 text-xs text-slate-500">
        Belte's own framework channel — the boot surface map and per-request closing records — is on
        by default too;
        <code class="font-mono">DEBUG=-belte</code>
        silences it, and <code class="font-mono">DEBUG=belte:cache</code> opens the framework's
        diagnostic channels.
    </p>
</section>

<section class="mt-6 rounded-lg border border-slate-200 bg-white p-5">
    <h2 class="text-sm font-semibold">Try it — open the browser console</h2>
    <div class="mt-3 flex flex-wrap gap-2 text-sm">
        <button
            type="button"
            class="rounded-md border border-slate-300 px-3 py-1.5 hover:bg-slate-100"
            onclick={() => log('button clicked', { at: Date.now() })}>
            log('button clicked') — always on
        </button>
        <button
            type="button"
            class="rounded-md border border-slate-300 px-3 py-1.5 hover:bg-slate-100"
            onclick={() => demoChannel('a gated diagnostic record')}>
            log.channel('kitchen-sink:demo')(…)
        </button>
        <button
            type="button"
            class="rounded-md border border-slate-300 px-3 py-1.5 hover:bg-slate-100"
            onclick={armChannel}>
            {channelArmed ? 'belte-debug set ✓' : "arm it: belte-debug = 'kitchen-sink:demo'"}
        </button>
        <button
            type="button"
            class="rounded-md border border-slate-300 px-3 py-1.5 hover:bg-slate-100"
            onclick={runTraced}>
            log.trace('fetch rates', …)
        </button>
    </div>
    <p class="mt-3 font-mono text-xs text-slate-700">{traced}</p>
    <p class="mt-2 text-xs text-slate-500">
        The channel button is silent until armed — the
        <code class="font-mono">belte-debug</code>
        key is read per call, so toggling it takes effect without a reload.
    </p>
</section>

<section class="mt-6 rounded-lg border border-slate-200 bg-white p-5">
    <h2 class="text-sm font-semibold"><code class="font-mono">trace()</code></h2>
    <p class="mt-1 text-xs text-slate-500">
        The current W3C <code class="font-mono">traceparent</code>, on either side — in the browser,
        the trace of the request that rendered the page, so an error report from this tab can be
        joined to the server's log lines for the same request. Outside any request scope (boot
        scripts, build) it is
        <code class="font-mono">undefined</code>. This page rendered under:
    </p>
    <pre
        class="mt-3 overflow-x-auto rounded-md bg-slate-900 p-3 text-xs leading-relaxed text-slate-100"><code
        >{pageTrace}</code></pre>
</section>

<section class="mt-6 space-y-3">
    <CodeBlock
        title="this page"
        code={`import { log } from '@belte/belte/shared/log'
import { trace } from '@belte/belte/shared/trace'

log('button clicked', { at: Date.now() })             // always-on app channel
log.channel('kitchen-sink:demo')('gated record')      // DEBUG / belte-debug gated
await log.trace('fetch rates', () => getRates({ base: 'USD' })) // timed, rethrows
const pageTrace = trace()  // traceparent of the rendering request`} />

    <CodeBlock
        title="server side — same calls, request context for free"
        code={`// inside any handler, every record carries trace id + elapsed + verb+path
log('refreshed rates', { base })

// hand the traceparent to your own telemetry
reportError({ traceparent: trace() })`} />
</section>
