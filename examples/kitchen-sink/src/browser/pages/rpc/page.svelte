<script lang="ts">
import { HttpError } from '@belte/belte/shared/HttpError'
import CodeBlock from '$browser/CodeBlock.svelte'
import RpcHeader from '$browser/RpcHeader.svelte'
import { createEcho } from '$server/rpc/createEcho.ts'
import { deleteEcho } from '$server/rpc/deleteEcho.ts'
import { getEcho } from '$server/rpc/getEcho.ts'
import { headEcho } from '$server/rpc/headEcho.ts'
import { patchEcho } from '$server/rpc/patchEcho.ts'
import { replaceEcho } from '$server/rpc/replaceEcho.ts'
import { uploadNote } from '$server/rpc/uploadNote.ts'

type EchoCall = { verb: string; outcome: string }
let log = $state<EchoCall[]>([])

function record(verb: string, outcome: string) {
    log = [...log, { verb, outcome }].slice(-12)
}

async function safeCall(verb: string, fn: () => Promise<unknown>): Promise<void> {
    try {
        const value = await fn()
        record(verb, value === undefined ? '(no body)' : JSON.stringify(value))
    } catch (err) {
        const status = err instanceof HttpError ? `${err.status} ${err.statusText}` : String(err)
        record(verb, `error: ${status}`)
    }
}

const message = $state({ value: 'hello' })
</script>

<RpcHeader />

<section class="mt-6">
    <h2 class="text-sm font-semibold">Options</h2>
    <div class="mt-2 overflow-x-auto rounded-lg border border-slate-200 bg-white">
        <table class="w-full text-sm">
            <thead class="border-b border-slate-200 bg-slate-50 text-left">
                <tr>
                    <th class="px-4 py-2 font-mono font-medium">option</th>
                    <th class="px-4 py-2 font-medium">effect</th>
                    <th class="px-4 py-2 font-medium">default</th>
                </tr>
            </thead>
            <tbody class="divide-y divide-slate-100">
                <tr>
                    <td class="px-4 py-2 font-mono">inputSchema</td>
                    <td class="px-4 py-2 text-slate-600">
                        Standard Schema (zod, valibot, …) validating args; 422 on failure
                    </td>
                    <td class="px-4 py-2 text-slate-500">none</td>
                </tr>
                <tr>
                    <td class="px-4 py-2 font-mono">outputSchema</td>
                    <td class="px-4 py-2 text-slate-600">
                        success body for OpenAPI / MCP output — see
                        <code class="font-mono">getProduct</code>
                        in <a class="underline" href="/openapi.json">/openapi.json</a>
                    </td>
                    <td class="px-4 py-2 text-slate-500">none</td>
                </tr>
                <tr>
                    <td class="px-4 py-2 font-mono">filesSchema</td>
                    <td class="px-4 py-2 text-slate-600">
                        validates <code class="font-mono">File</code> parts of a multipart body
                    </td>
                    <td class="px-4 py-2 text-slate-500">none</td>
                </tr>
                <tr>
                    <td class="px-4 py-2 font-mono">clients.browser</td>
                    <td class="px-4 py-2 text-slate-600">expose to the browser bundle</td>
                    <td class="px-4 py-2 font-mono text-slate-500">true</td>
                </tr>
                <tr>
                    <td class="px-4 py-2 font-mono">clients.mcp</td>
                    <td class="px-4 py-2 text-slate-600">
                        expose as an MCP tool — see <a class="underline" href="/mcp">mcp</a>
                    </td>
                    <td class="px-4 py-2 text-slate-600">
                        auto for schema'd GET/HEAD; mutations opt in
                    </td>
                </tr>
                <tr>
                    <td class="px-4 py-2 font-mono">clients.cli</td>
                    <td class="px-4 py-2 text-slate-600">
                        expose as a CLI subcommand — see <a class="underline" href="/cli">cli</a>
                    </td>
                    <td class="px-4 py-2 text-slate-600">auto for any schema'd verb</td>
                </tr>
                <tr>
                    <td class="px-4 py-2 font-mono">crossOrigin</td>
                    <td class="px-4 py-2 text-slate-600">
                        exempt from the same-origin mutation gate — see
                        <a class="underline" href="/security">Security defaults</a>
                    </td>
                    <td class="px-4 py-2 font-mono text-slate-500">false</td>
                </tr>
            </tbody>
        </table>
    </div>
    <ul class="mt-2 space-y-1 text-xs text-slate-500">
        <li>
            Query args travel as strings — use <code class="font-mono">z.coerce.number()</code>, not
            <code class="font-mono">z.number()</code>, on GET/DELETE/HEAD params (see
            <code class="font-mono">countLog</code>
            under <a class="underline" href="/rpc/streaming">streaming</a>).
        </li>
        <li>
            rpc URLs are flat — no <code class="font-mono">[id]</code> segments; pass identifiers
            via args. Dynamic segments are a
            <a class="underline" href="/pages">page-tree</a>
            feature.
        </li>
        <li>
            Wrong verb on a known URL → <code class="font-mono">405</code>
            with <code class="font-mono">Allow</code> header.
        </li>
    </ul>
</section>

<section class="mt-6 rounded-lg border border-slate-200 bg-white p-5">
    <h2 class="text-sm font-semibold">Try every verb</h2>
    <label class="mt-2 block text-xs font-medium">
        message
        <input
            bind:value={message.value}
            class="mt-1 block w-full rounded-md border border-slate-300 px-3 py-1.5 text-sm">
    </label>
    <div class="mt-3 flex flex-wrap gap-2 text-sm">
        <button
            type="button"
            class="rounded-md border border-slate-300 px-3 py-1.5 hover:bg-slate-100"
            onclick={() => safeCall('GET', () => getEcho({ message: message.value }))}>
            GET
        </button>
        <button
            type="button"
            class="rounded-md border border-slate-300 px-3 py-1.5 hover:bg-slate-100"
            onclick={() => safeCall('POST', () => createEcho({ message: message.value }))}>
            POST
        </button>
        <button
            type="button"
            class="rounded-md border border-slate-300 px-3 py-1.5 hover:bg-slate-100"
            onclick={() => safeCall('PUT', () => replaceEcho({ message: message.value }))}>
            PUT
        </button>
        <button
            type="button"
            class="rounded-md border border-slate-300 px-3 py-1.5 hover:bg-slate-100"
            onclick={() => safeCall('PATCH', () => patchEcho({ message: message.value }))}>
            PATCH
        </button>
        <button
            type="button"
            class="rounded-md border border-slate-300 px-3 py-1.5 hover:bg-slate-100"
            onclick={() => safeCall('DELETE', () => deleteEcho({ message: message.value }))}>
            DELETE
        </button>
        <button
            type="button"
            class="rounded-md border border-slate-300 px-3 py-1.5 hover:bg-slate-100"
            onclick={() => safeCall('HEAD', () => headEcho())}>
            HEAD
        </button>
    </div>
    {#if log.length > 0}
        <ul class="mt-3 space-y-1 font-mono text-xs text-slate-700">
            {#each log as entry, i (i)}
                <li>{entry.verb} →{entry.outcome}</li>
            {/each}
        </ul>
    {/if}
</section>

<section class="mt-6 rounded-lg border border-slate-200 bg-white p-5">
    <h2 class="text-sm font-semibold">
        <code class="font-mono">filesSchema</code>
        — multipart upload
    </h2>
    <p class="mt-1 text-xs text-slate-500">
        A body verb accepts a <code class="font-mono">FormData</code> in place of typed args: text
        fields validate against
        <code class="font-mono">inputSchema</code>, <code class="font-mono">File</code> parts
        against
        <code class="font-mono">filesSchema</code>, merged into the handler's args. Files stay out
        of the JSON-Schema projection.
    </p>
    <form
        class="mt-3 flex flex-wrap items-end gap-2 text-sm"
        onsubmit={async (event) => {
            event.preventDefault()
            const formData = new FormData(event.currentTarget)
            await safeCall('upload', () => uploadNote(formData))
        }}>
        <label class="text-xs font-medium">
            title
            <input
                name="title"
                value="receipts"
                class="mt-1 block rounded-md border border-slate-300 px-3 py-1.5 text-sm">
        </label>
        <label class="text-xs font-medium">
            attachments
            <input name="attachments" type="file" multiple class="mt-1 block text-sm">
        </label>
        <button
            type="submit"
            class="rounded-md border border-slate-300 px-3 py-1.5 hover:bg-slate-100">
            uploadNote(formData)
        </button>
    </form>
    <p class="mt-2 text-xs text-slate-500">
        Submitting with no file 422s from <code class="font-mono">filesSchema</code> — the outcome
        lands in the verb log above.
    </p>
</section>

<section class="mt-6 space-y-3">
    <CodeBlock
        title="src/server/rpc/*.ts — one verb per file"
        code={`// getEcho.ts — inputSchema validates args and exposes the rpc to MCP + CLI
import { GET } from '@belte/belte/server/GET'
import { json } from '@belte/belte/server/json'
import { z } from 'zod'
const inputSchema = z.object({ message: z.string() })
export const getEcho = GET(({ message }) =>
    json({ method: 'GET' as const, message }), { inputSchema })

// createEcho.ts — POST: args from the JSON body; a mutation opts into MCP explicitly
export const createEcho = POST(
    ({ message }) => json({ method: 'POST' as const, message }, { status: 201 }),
    { inputSchema, clients: { mcp: true } },
)

// headEcho.ts — HEAD: response carries headers, no body
export const headEcho = HEAD(() =>
    new Response(undefined, { status: 204, headers: { 'x-echo': 'HEAD' } }),
)`} />

    <CodeBlock
        title="src/server/rpc/uploadNote.ts — filesSchema validates the File parts"
        code={`const inputSchema = z.object({ title: z.string() })
const filesSchema = z.object({ attachments: z.array(z.instanceof(File)).min(1) })

export const uploadNote = POST(
    ({ title, attachments }) =>
        json({ title, attachments: attachments.map((f) => ({ name: f.name, bytes: f.size })) }),
    { inputSchema, filesSchema },
)

// call site — a FormData in place of typed args
await uploadNote(formData)`} />

    <CodeBlock
        title="schema library without toJSONSchema()? wrap once"
        code={`import { withJsonSchema } from '@belte/belte/shared/withJsonSchema'
import { toJsonSchema } from '@valibot/to-json-schema'

// zod 4 / Effect / Arktype project natively; wrap anything else where it's declared
const inputSchema = withJsonSchema(valibotSchema, (s) => toJsonSchema(s))`} />

    <CodeBlock
        title="client — same call shape per verb"
        code={`await getEcho({ message: 'hello' })       // typed { method: 'GET'; message: string }
await createEcho({ message: 'hello' })    // typed { method: 'POST'; message: string }
// HEAD resolves to undefined; the rest resolve to the decoded body`} />
</section>
