<script lang="ts">
import CodeBlock from '$lib/CodeBlock.svelte'
import { HttpError } from 'belte/shared/HttpError'
import { getEcho } from '$route/getEcho.ts'
import { getProduct } from '$route/getProduct.ts'
import { redirectExample } from '$route/redirectExample.ts'

let jsonOutcome = $state('(not called)')
let errorOutcome = $state('(not called)')
let redirectOutcome = $state('(not called)')

async function callJson() {
    const value = await getEcho({ message: 'json()' })
    jsonOutcome = JSON.stringify(value)
}

async function callError() {
    try {
        await getProduct({ id: 'missing' })
        errorOutcome = '(no error?)'
    } catch (err) {
        if (err instanceof HttpError) {
            const body = await err.response.text()
            errorOutcome = `status=${err.status} body="${body}"`
        } else {
            errorOutcome = String(err)
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
    redirectOutcome = `redirected=${response.redirected} finalUrl=${new URL(response.url).pathname} status=${response.status}`
}
</script>

<h1 class="text-3xl font-bold"><code class="font-mono">belte/respond</code></h1>
<p class="mt-2 text-slate-600">
    Response constructors with route-friendly defaults. All of them set
    <code class="font-mono">Cache-Control: no-store</code>
    unless the caller overrides it — intermediary caches shouldn't memoise route replies.
</p>

<section class="mt-6 rounded-lg border border-slate-200 bg-white p-5">
    <h2 class="text-sm font-semibold"><code class="font-mono">json(data, init?)</code></h2>
    <p class="mt-1 text-sm text-slate-600">
        Thin wrapper over <code class="font-mono">Response.json</code>
        — same shape, plus a default
        <code class="font-mono">Cache-Control: no-store</code>.
    </p>
    <button
        type="button"
        class="mt-3 rounded-md border border-slate-300 px-3 py-1.5 text-sm hover:bg-slate-100"
        onclick={callJson}>
        call getEcho({`{ message: 'json()' }`})
    </button>
    <p class="mt-2 font-mono text-xs text-slate-700">{jsonOutcome}</p>
    <CodeBlock
        title="src/route/getEcho.ts (server)"
        code={`import { GET } from 'belte/route'
import { json } from 'belte/respond'

export const getEcho = GET<{ message: string }>(({ message }) =>
    json({ method: 'GET' as const, message }),
)`} />
    <CodeBlock
        title="this page (client)"
        code={`import { getEcho } from '$route/getEcho.ts'

const value = await getEcho({ message: 'json()' })  // typed: { method: 'GET'; message: string }`} />
</section>

<section class="mt-6 rounded-lg border border-slate-200 bg-white p-5">
    <h2 class="text-sm font-semibold"><code class="font-mono">error(status, message?)</code></h2>
    <p class="mt-1 text-sm text-slate-600">
        Plain-text error <code class="font-mono">Response</code>
        — the message reaches the caller verbatim via
        <code class="font-mono">err.response.text()</code>. Missing-status reason phrase is used
        when <code class="font-mono">message</code> is omitted.
    </p>
    <button
        type="button"
        class="mt-3 rounded-md border border-slate-300 px-3 py-1.5 text-sm hover:bg-slate-100"
        onclick={callError}>
        call getProduct({`{ id: 'missing' }`}) — handler returns error(404, ...)
    </button>
    <p class="mt-2 font-mono text-xs text-slate-700">{errorOutcome}</p>
    <CodeBlock
        title="src/route/getProduct.ts (server)"
        code={`import { GET } from 'belte/route'
import { json, error } from 'belte/respond'

export const getProduct = GET<{ id: string }>(({ id }) => {
    const product = products[id]
    if (!product) {
        return error(404, \`no product with id \${id}\`)
    }
    return json(product)
})`} />
    <CodeBlock
        title="this page (client)"
        code={`import { HttpError } from 'belte/shared/HttpError'
import { getProduct } from '$route/getProduct.ts'

try {
    await getProduct({ id: 'missing' })
} catch (err) {
    if (err instanceof HttpError) {
        const body = await err.response.text()
        /* status=404 body="no product with id missing" */
    }
}`} />
</section>

<section class="mt-6 rounded-lg border border-slate-200 bg-white p-5">
    <h2 class="text-sm font-semibold"><code class="font-mono">redirect(url, status?)</code></h2>
    <p class="mt-1 text-sm text-slate-600">
        Accepts relative URLs (<code class="font-mono">Response.redirect</code> throws on them) and
        defaults to 302.
    </p>
    <div class="mt-3 flex flex-wrap gap-2 text-sm">
        <button
            type="button"
            class="rounded-md border border-slate-300 px-3 py-1.5 hover:bg-slate-100"
            onclick={callRedirectFetch}>
            fetch(redirectExample.url) — default follow
        </button>
        <a
            href={redirectExample.url}
            class="rounded-md border border-slate-300 px-3 py-1.5 hover:bg-slate-100">
            navigate (watch the address bar)
        </a>
    </div>
    <p class="mt-2 font-mono text-xs text-slate-700">{redirectOutcome}</p>
    <p class="mt-2 text-xs text-slate-500">
        Browsers don't expose the raw 302 to JS —
        <code class="font-mono">redirect: 'manual'</code>
        returns an opaqueredirect (status=0, headers hidden), and
        <code class="font-mono">redirect: 'follow'</code>
        walks the chain transparently. The visible signal is
        <code class="font-mono">response.redirected</code>
        and <code class="font-mono">response.url</code>.
    </p>
    <CodeBlock
        title="src/route/redirectExample.ts (server)"
        code={`import { GET } from 'belte/route'
import { redirect } from 'belte/respond'

export const redirectExample = GET(() => redirect('/route'))`} />
    <CodeBlock
        title="this page (client)"
        code={`import { redirectExample } from '$route/redirectExample.ts'

const response = await fetch(redirectExample.url)
/* response.redirected=true, response.url=http://.../route, response.status=200 */`} />
</section>
