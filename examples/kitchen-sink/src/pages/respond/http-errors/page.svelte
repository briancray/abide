<script lang="ts">
import CodeBlock from '$lib/CodeBlock.svelte'
import { HttpError } from 'belte/shared/HttpError'
import { getProduct } from '$route/getProduct.ts'
import { boom } from '$route/boom.ts'
import { getEcho } from '$route/getEcho.ts'

let outcome404 = $state('(not triggered)')
let outcome405 = $state('(not triggered)')
let outcome500 = $state('(not triggered)')

async function trigger404() {
    try {
        await getProduct({ id: 'missing' })
        outcome404 = '(no error?)'
    } catch (err) {
        if (err instanceof HttpError) {
            outcome404 = `caught HttpError(${err.status}) — Cache-Control: ${err.response.headers.get('cache-control')}`
        } else {
            outcome404 = String(err)
        }
    }
}

async function trigger405() {
    /*
    POST to a GET-only route — framework returns 405 with an Allow header.
    Using plain fetch so we can inspect the headers ourselves.
    */
    const response = await fetch(getEcho.url, { method: 'POST' })
    outcome405 = `status=${response.status} Allow=${response.headers.get('allow')}`
}

async function trigger500() {
    try {
        await boom()
        outcome500 = '(no error?)'
    } catch (err) {
        const status = err instanceof HttpError ? err.status : 'unknown'
        outcome500 = `caught HttpError(${status})`
    }
}
</script>

<h1 class="text-3xl font-bold">HTTP errors</h1>
<p class="mt-2 text-slate-600">
    Non-2xx responses come back through the same call site as the success path. Direct calls
    throw <code class="font-mono">HttpError</code>
    with <code class="font-mono">status</code>, <code class="font-mono">statusText</code>, and
    the raw <code class="font-mono">response</code>. The framework sets
    <code class="font-mono">Cache-Control: no-store</code>
    on every error response, and 405s carry an
    <code class="font-mono">Allow</code> header.
</p>

<section class="mt-6 rounded-lg border border-slate-200 bg-white p-5">
    <h2 class="text-sm font-semibold">404 — handler returns <code class="font-mono">error(404)</code></h2>
    <button
        type="button"
        class="mt-3 rounded-md border border-slate-300 px-3 py-1.5 text-sm hover:bg-slate-100"
        onclick={trigger404}>
        getProduct({`{ id: 'missing' }`}) → 404
    </button>
    <p class="mt-2 font-mono text-xs text-slate-700">{outcome404}</p>
    <CodeBlock
        title="src/route/getProduct.ts (server)"
        code={`import { GET } from 'belte/route'
import { json, error } from 'belte/respond'

export const getProduct = GET<{ id: string }>(({ id }) => {
    const product: Product | undefined = products[id]
    if (!product) return error(404, \`no product with id \${id}\`)
    return json(product)
})`} />
    <CodeBlock
        title="this page (client)"
        code={`import { HttpError } from 'belte/shared/HttpError'

try {
    await getProduct({ id: 'missing' })
} catch (err) {
    if (err instanceof HttpError && err.status === 404) {
        /* err.response is the underlying Response;
           Cache-Control: no-store is set by the framework */
    }
}`} />
</section>

<section class="mt-6 rounded-lg border border-slate-200 bg-white p-5">
    <h2 class="text-sm font-semibold">405 — wrong verb to an HTTP route</h2>
    <p class="mt-1 text-sm text-slate-600">
        Routes are bound to a single verb. Sending the wrong one returns
        <code class="font-mono">405 Method Not Allowed</code>
        with <code class="font-mono">Allow</code> listing what would have worked.
    </p>
    <button
        type="button"
        class="mt-3 rounded-md border border-slate-300 px-3 py-1.5 text-sm hover:bg-slate-100"
        onclick={trigger405}>
        POST /route/getEcho → 405
    </button>
    <p class="mt-2 font-mono text-xs text-slate-700">{outcome405}</p>
    <CodeBlock
        title="src/route/getEcho.ts (server — GET-bound, see verb-rpcs demo)"
        code={`export const getEcho = GET<{ message: string }>(({ message }) => json({ ... }))
/* The framework owns the verb dispatch — POST/PUT/etc. against this URL → 405 with Allow: GET */`} />
    <CodeBlock
        title="this page (client)"
        code={`const response = await fetch(getEcho.url, { method: 'POST' })
/* response.status === 405; response.headers.get('allow') === 'GET' */`} />
</section>

<section class="mt-6 rounded-lg border border-slate-200 bg-white p-5">
    <h2 class="text-sm font-semibold">500 — handler throws</h2>
    <p class="mt-1 text-sm text-slate-600">
        A thrown exception inside a handler routes through
        <code class="font-mono">app.handleError</code>
        (defined in <code class="font-mono">src/app.ts</code> here). Cache-Control is
        <code class="font-mono">no-store</code>.
    </p>
    <button
        type="button"
        class="mt-3 rounded-md border border-slate-300 px-3 py-1.5 text-sm hover:bg-slate-100"
        onclick={trigger500}>
        boom() → 500
    </button>
    <p class="mt-2 font-mono text-xs text-slate-700">{outcome500}</p>
    <CodeBlock
        title="src/route/boom.ts (server)"
        code={`import { GET } from 'belte/route'

export const boom = GET(() => {
    throw new Error('intentional boom — exercising the 500 error path')
})`} />
    <CodeBlock
        title="src/app.ts handleError (server fallback)"
        code={`export const handleError: AppModule['handleError'] = (error) => {
    console.error(error)
    return new Response('something went wrong — check the server logs', { status: 500 })
}`} />
    <CodeBlock
        title="this page (client)"
        code={`import { HttpError } from 'belte/shared/HttpError'

try {
    await boom()
} catch (err) {
    /* err instanceof HttpError, err.status === 500 */
}`} />
</section>
