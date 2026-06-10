<script lang="ts">
import { HttpError } from '@belte/belte/shared/HttpError'
import CodeBlock from '$browser/CodeBlock.svelte'
import RpcHeader from '$browser/RpcHeader.svelte'
import { getEcho } from '$server/rpc/getEcho.ts'
import { getProduct } from '$server/rpc/getProduct.ts'
import { redirectExample } from '$server/rpc/redirectExample.ts'

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
    const response = await fetch(redirectExample.url)
    redirectOutcome = `redirected=${response.redirected} finalUrl=${new URL(response.url).pathname} status=${response.status}`
}
</script>

<RpcHeader />
<h1 class="mt-8 text-3xl font-bold">Response helpers</h1>
<p class="mt-2 text-slate-600">
    Response constructors with rpc-friendly defaults — all set
    <code class="font-mono">Cache-Control: no-store</code>
    unless the caller overrides via
    <code class="font-mono">init</code>.
</p>

<section class="mt-6">
    <div class="overflow-x-auto rounded-lg border border-slate-200 bg-white">
        <table class="w-full text-sm">
            <thead class="border-b border-slate-200 bg-slate-50 text-left">
                <tr>
                    <th class="px-4 py-2 font-mono font-medium">helper</th>
                    <th class="px-4 py-2 font-medium">content-type</th>
                    <th class="px-4 py-2 font-medium">notes</th>
                </tr>
            </thead>
            <tbody class="divide-y divide-slate-100">
                <tr>
                    <td class="px-4 py-2 font-mono">json(data, init?)</td>
                    <td class="px-4 py-2 font-mono text-slate-500">application/json</td>
                    <td class="px-4 py-2 text-slate-600">
                        thin wrapper over <code class="font-mono">Response.json</code>
                    </td>
                </tr>
                <tr>
                    <td class="px-4 py-2 font-mono">error(status, msg?)</td>
                    <td class="px-4 py-2 font-mono text-slate-500">text/plain</td>
                    <td class="px-4 py-2 text-slate-600">
                        message verbatim; status reason phrase if omitted
                    </td>
                </tr>
                <tr>
                    <td class="px-4 py-2 font-mono">redirect(url, status?)</td>
                    <td class="px-4 py-2 font-mono text-slate-500">Location header</td>
                    <td class="px-4 py-2 text-slate-600">defaults to 302; accepts relative URLs</td>
                </tr>
            </tbody>
        </table>
    </div>
    <p class="mt-2 text-xs text-slate-500">
        The streaming helpers <code class="font-mono">jsonl()</code> and
        <code class="font-mono">sse()</code>
        complete the set — see <a class="underline" href="/rpc/streaming">jsonl / sse</a>.
        <code class="font-mono">json</code>/<code class="font-mono">jsonl</code>/<code
            class="font-mono"
            >sse</code
        >
        carry the value type to the caller.
    </p>
</section>

<section class="mt-6 rounded-lg border border-slate-200 bg-white p-5">
    <h2 class="text-sm font-semibold">Try it</h2>
    <div class="mt-3 flex flex-wrap gap-2 text-sm">
        <button
            type="button"
            class="rounded-md border border-slate-300 px-3 py-1.5 hover:bg-slate-100"
            onclick={callJson}>
            json — getEcho({`{ message: 'json()' }`}
            )
        </button>
        <button
            type="button"
            class="rounded-md border border-slate-300 px-3 py-1.5 hover:bg-slate-100"
            onclick={callError}>
            error — getProduct({`{ id: 'missing' }`}
            )
        </button>
        <button
            type="button"
            class="rounded-md border border-slate-300 px-3 py-1.5 hover:bg-slate-100"
            onclick={callRedirectFetch}>
            redirect — fetch(redirectExample.url)
        </button>
        <a
            href={redirectExample.url}
            class="rounded-md border border-slate-300 px-3 py-1.5 hover:bg-slate-100">
            redirect — navigate
        </a>
    </div>
    <ul class="mt-3 space-y-1 font-mono text-xs text-slate-700">
        <li>json:{jsonOutcome}</li>
        <li>error:{errorOutcome}</li>
        <li>redirect:{redirectOutcome}</li>
    </ul>
    <p class="mt-2 text-xs text-slate-500">
        Browsers don't expose the 302 directly to JS —
        <code class="font-mono">response.redirected</code>
        + <code class="font-mono">response.url</code>
        are the visible signals.
    </p>
</section>

<section class="mt-6 space-y-3">
    <CodeBlock
        title="src/server/rpc/*.ts — three handlers, three helpers"
        code={`import { GET } from '@belte/belte/server/GET'
import { json } from '@belte/belte/server/json'
import { error } from '@belte/belte/server/error'
import { redirect } from '@belte/belte/server/redirect'

// getEcho.ts — json
export const getEcho = GET<{ message: string }>(({ message }) =>
    json({ method: 'GET' as const, message }),
)

// getProduct.ts — error
export const getProduct = GET<{ id: string }>(({ id }) => {
    const product = products[id]
    if (!product) return error(404, \`no product with id \${id}\`)
    return json(product)
})

// redirectExample.ts — redirect
export const redirectExample = GET(() => redirect('/rpc'))`} />
</section>
