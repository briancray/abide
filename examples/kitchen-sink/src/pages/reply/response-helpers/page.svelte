<script lang="ts">
import { HttpError } from 'belte/shared/HttpError'
import { getEcho } from '$rpc/getEcho.ts'
import { getProduct } from '$rpc/getProduct.ts'
import { redirectExample } from '$rpc/redirectExample.ts'

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
    Plain `fetch(redirectExample.url, { redirect: 'manual' })` so we can
    observe the 302 without the browser following it.
    */
    const response = await fetch(redirectExample.url, { redirect: 'manual' })
    last = `redirect() → status=${response.status} Location=${response.headers.get('location')}`
}
</script>

<h1 class="text-3xl font-bold"><code class="font-mono">belte/response</code></h1>
<p class="mt-2 text-slate-600">
    Response constructors with rpc-friendly defaults. All of them set
    <code class="font-mono">Cache-Control: no-store</code>
    unless the caller overrides it — intermediary caches shouldn't memoise rpc replies.
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
            <code class="font-mono">redirect(...)</code> (fetch w/ manual redirect)
        </button>
    </div>
    <p class="mt-4 font-mono text-sm text-slate-700">{last}</p>
</section>

<section class="mt-6 rounded-lg border border-slate-200 bg-white p-5 text-sm text-slate-600">
    <p>Source — every handler under <code class="font-mono">src/rpc/</code> uses these:</p>
    <pre class="mt-3 overflow-x-auto rounded-md bg-slate-900 p-4 text-xs leading-relaxed text-slate-100"><code
        >{`import { json, error, redirect } from 'belte/response'

return json({ ok: true })              // 200, application/json, no-store
return error(404, 'not found')         // 404, text/plain
return redirect('/login')              // 302 with Location: /login`}</code></pre>
</section>
