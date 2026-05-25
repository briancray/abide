<script lang="ts">
import { HttpError } from 'belte/shared/HttpError'
import { getEcho } from '$route/getEcho.ts'
import { getProduct } from '$route/getProduct.ts'
import { redirectExample } from '$route/redirectExample.ts'

let last = $state('(no call yet)')

async function callJson() {
    const value = await getEcho({ message: 'json()' })
    last = `json → ${JSON.stringify(value)}`
}

async function callError() {
    try {
        await getProduct({ id: 'missing' })
        last = '(no error?)'
    } catch (err) {
        if (err instanceof HttpError) {
            const body = await err.response.text()
            last = `error(404) → status=${err.status} body="${body}"`
        } else {
            last = String(err)
        }
    }
}

async function callRedirectFetch() {
    /*
    Browsers don't expose the raw 302 to JS — `redirect: 'manual'` returns
    an opaqueredirect with status=0 and no headers, and `redirect: 'follow'`
    (the default) walks the chain transparently. The visible signal that a
    redirect happened is `response.redirected=true` plus `response.url`
    pointing at the final destination.
    */
    const response = await fetch(redirectExample.url)
    last = `redirect() → redirected=${response.redirected} finalUrl=${new URL(response.url).pathname} status=${response.status}`
}
</script>

<h1 class="text-3xl font-bold"><code class="font-mono">belte/respond</code></h1>
<p class="mt-2 text-slate-600">
    Response constructors with route-friendly defaults. All of them set
    <code class="font-mono">Cache-Control: no-store</code>
    unless the caller overrides it — intermediary caches shouldn't memoise route replies.
</p>

<section class="mt-6 rounded-lg border border-slate-200 bg-white p-5">
    <div class="flex flex-wrap gap-2 text-sm">
        <button
            type="button"
            class="rounded-md border border-slate-300 px-3 py-1.5 hover:bg-slate-100"
            onclick={callJson}>
            <code class="font-mono">json(...)</code>
        </button>
        <button
            type="button"
            class="rounded-md border border-slate-300 px-3 py-1.5 hover:bg-slate-100"
            onclick={callError}>
            <code class="font-mono">error(404, ...)</code> (via missing product)
        </button>
        <button
            type="button"
            class="rounded-md border border-slate-300 px-3 py-1.5 hover:bg-slate-100"
            onclick={callRedirectFetch}>
            <code class="font-mono">redirect(...)</code> (fetch + follow)
        </button>
        <a
            href={redirectExample.url}
            class="rounded-md border border-slate-300 px-3 py-1.5 hover:bg-slate-100">
            <code class="font-mono">redirect(...)</code> (navigate — watch the address bar)
        </a>
    </div>
    <p class="mt-4 font-mono text-sm text-slate-700">{last}</p>
    <p class="mt-2 text-xs text-slate-500">
        Note: <code class="font-mono">redirect: 'manual'</code>
        in fetch returns an opaqueredirect (status=0, headers hidden) and
        <code class="font-mono">redirect: 'follow'</code>
        walks the chain transparently — the visible signal is
        <code class="font-mono">response.redirected</code>
        and <code class="font-mono">response.url</code>.
    </p>
</section>

<section class="mt-6 rounded-lg border border-slate-200 bg-white p-5 text-sm text-slate-600">
    <p>Source — every handler under <code class="font-mono">src/route/</code> uses these:</p>
    <pre class="mt-3 overflow-x-auto rounded-md bg-slate-900 p-4 text-xs leading-relaxed text-slate-100"><code
        >{`import { json, error, redirect } from 'belte/respond'

return json({ ok: true })              // 200, application/json, no-store
return error(404, 'not found')         // 404, text/plain
return redirect('/login')              // 302 with Location: /login`}</code></pre>
</section>
