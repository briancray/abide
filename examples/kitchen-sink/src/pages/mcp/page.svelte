<script lang="ts">
import CodeBlock from '$lib/CodeBlock.svelte'

let listOutput = $state('(not called)')
let callOutput = $state('(not called)')

async function call(id: number, method: string, params?: Record<string, unknown>) {
    const response = await fetch('/__belte/mcp', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id, method, params }),
    })
    return JSON.stringify(await response.json(), undefined, 2)
}

async function listTools() {
    listOutput = await call(1, 'tools/list')
}

async function listResourceTemplates() {
    listOutput = await call(2, 'resources/templates/list')
}

async function listPrompts() {
    listOutput = await call(3, 'prompts/list')
}

async function callCreateEcho() {
    callOutput = await call(4, 'tools/call', {
        name: 'createEcho',
        arguments: { message: 'hello from /__belte/mcp' },
    })
}

async function readGetProduct() {
    callOutput = await call(5, 'resources/read', { uri: 'belte://rpc/getProduct?id=1' })
}

async function getSummarizePrompt() {
    callOutput = await call(6, 'prompts/get', {
        name: 'summarize',
        arguments: { topic: 'otters', tone: 'playful' },
    })
}
</script>

<h1 class="text-3xl font-bold"><code class="font-mono">belte/mcp</code></h1>
<p class="mt-2 text-slate-600">
    Auto-mounted at <code class="font-mono">POST /__belte/mcp</code> — JSON-RPC 2.0, MCP
    protocol <code class="font-mono">2025-06-18</code>. Tools, resources, and prompts are
    derived from the same rpcs and sockets the browser already uses, plus the prompts under
    <code class="font-mono">src/server/prompts/</code>; no second registry to maintain.
</p>

<section class="mt-6">
    <h2 class="text-sm font-semibold">Derivation rules</h2>
    <div class="mt-2 overflow-x-auto rounded-lg border border-slate-200 bg-white">
        <table class="w-full text-sm">
            <thead class="border-b border-slate-200 bg-slate-50 text-left">
                <tr>
                    <th class="px-4 py-2 font-medium">source</th>
                    <th class="px-4 py-2 font-medium">becomes</th>
                    <th class="px-4 py-2 font-medium">when</th>
                </tr>
            </thead>
            <tbody class="divide-y divide-slate-100">
                <tr>
                    <td class="px-4 py-2 text-slate-600">non-GET rpc with <code class="font-mono">schema</code></td>
                    <td class="px-4 py-2 font-mono text-slate-500">tool &lt;name&gt;</td>
                    <td class="px-4 py-2 text-slate-600">writes (POST/PUT/PATCH/DELETE) are tools</td>
                </tr>
                <tr>
                    <td class="px-4 py-2 text-slate-600">GET rpc with <code class="font-mono">schema</code></td>
                    <td class="px-4 py-2 font-mono text-slate-500">belte://rpc/&lt;name&gt;{`{?args}`}</td>
                    <td class="px-4 py-2 text-slate-600">reads are resources — args become a resource template</td>
                </tr>
                <tr>
                    <td class="px-4 py-2 text-slate-600">prompts/&lt;name&gt;.ts</td>
                    <td class="px-4 py-2 font-mono text-slate-500">prompt &lt;name&gt;</td>
                    <td class="px-4 py-2 text-slate-600">schema → argument list; <code class="font-mono">render()</code> → messages</td>
                </tr>
                <tr>
                    <td class="px-4 py-2 text-slate-600">socket with <code class="font-mono">schema</code></td>
                    <td class="px-4 py-2 font-mono text-slate-500">tool await_&lt;name&gt;</td>
                    <td class="px-4 py-2 text-slate-600">blocks for the next published entry (default 30000ms)</td>
                </tr>
                <tr>
                    <td class="px-4 py-2 text-slate-600">socket with <code class="font-mono">clientPublish</code></td>
                    <td class="px-4 py-2 font-mono text-slate-500">tool publish_&lt;name&gt;</td>
                    <td class="px-4 py-2 text-slate-600">payload validated by the socket's schema</td>
                </tr>
                <tr>
                    <td class="px-4 py-2 text-slate-600">socket history</td>
                    <td class="px-4 py-2 font-mono text-slate-500">belte://stream/&lt;name&gt;</td>
                    <td class="px-4 py-2 text-slate-600">resource — latest history window as JSON</td>
                </tr>
            </tbody>
        </table>
    </div>
    <p class="mt-2 text-xs text-slate-500">
        No schema → no MCP exposure. The schema is the gate that makes the non-browser
        surfaces safe to advertise. Override per-declaration with
        <code class="font-mono">{`{ clients: { mcp: false } }`}</code>.
    </p>
</section>

<section class="mt-6 rounded-lg border border-slate-200 bg-white p-5">
    <h2 class="text-sm font-semibold">Try it</h2>
    <p class="mt-1 text-xs text-slate-500">
        Hits the endpoint at <code class="font-mono">POST /__belte/mcp</code> directly from the
        browser. The write rpcs (<code class="font-mono">createEcho</code>,
        <code class="font-mono">publishChat</code>) plus <code class="font-mono">await_chat</code>
        are tools; the read rpcs (<code class="font-mono">getEcho</code>,
        <code class="font-mono">getProduct</code>) are resource templates; and
        <code class="font-mono">summarize</code> is a prompt.
    </p>
    <div class="mt-3 flex flex-wrap gap-2 text-sm">
        <button type="button" class="rounded-md border border-slate-300 px-3 py-1.5 hover:bg-slate-100" onclick={listTools}>
            tools/list
        </button>
        <button type="button" class="rounded-md border border-slate-300 px-3 py-1.5 hover:bg-slate-100" onclick={listResourceTemplates}>
            resources/templates/list
        </button>
        <button type="button" class="rounded-md border border-slate-300 px-3 py-1.5 hover:bg-slate-100" onclick={listPrompts}>
            prompts/list
        </button>
        <button type="button" class="rounded-md border border-slate-300 px-3 py-1.5 hover:bg-slate-100" onclick={callCreateEcho}>
            tools/call → createEcho
        </button>
        <button type="button" class="rounded-md border border-slate-300 px-3 py-1.5 hover:bg-slate-100" onclick={readGetProduct}>
            resources/read → getProduct
        </button>
        <button type="button" class="rounded-md border border-slate-300 px-3 py-1.5 hover:bg-slate-100" onclick={getSummarizePrompt}>
            prompts/get → summarize
        </button>
    </div>
    <div class="mt-3 grid gap-3 sm:grid-cols-2">
        <div>
            <p class="text-xs font-medium text-slate-500">list</p>
            <pre class="mt-1 overflow-x-auto rounded-md bg-slate-900 p-3 text-xs leading-relaxed text-slate-100"><code
                >{listOutput}</code></pre>
        </div>
        <div>
            <p class="text-xs font-medium text-slate-500">call / read / get</p>
            <pre class="mt-1 overflow-x-auto rounded-md bg-slate-900 p-3 text-xs leading-relaxed text-slate-100"><code
                >{callOutput}</code></pre>
        </div>
    </div>
</section>

<section class="mt-6 rounded-lg border border-slate-200 bg-white p-5">
    <h2 class="text-sm font-semibold">Auth forwarding</h2>
    <p class="mt-1 text-sm text-slate-600">
        Inbound MCP requests forward <code class="font-mono">cookie</code>,
        <code class="font-mono">authorization</code>,
        <code class="font-mono">x-forwarded-for</code>,
        <code class="font-mono">x-forwarded-proto</code> onto every synthesized rpc request,
        so the session middleware in <code class="font-mono">src/app.ts</code> keeps working
        unchanged. Tool calls go through the same <code class="font-mono">verb.fetch</code>
        path as the HTTP route — validation, response helpers, and error mapping behave
        identically.
    </p>
</section>

<section class="mt-6 rounded-lg border border-slate-200 bg-white p-5 text-sm text-slate-600">
    <h2 class="text-sm font-semibold text-slate-900">Streaming caveat</h2>
    <p class="mt-1">
        MCP gets single-shot <code class="font-mono">await_&lt;name&gt;</code>
        plus snapshot resources — not a live subscription. Real-time fan-out stays on the
        <a class="underline" href="/server/sockets">ws multiplex</a> for now.
    </p>
</section>

<section class="mt-6 space-y-3">
    <CodeBlock
        title="src/server/mcp.ts — optional customisation"
        code={`import { createMcpServer } from 'belte/mcp/createMcpServer'
import { HttpError } from 'belte/server/HttpError'

export default createMcpServer({
    name: 'kitchen-sink',
    version: '0.0.1',
    // authorize: (req) => {
    //     if (!req.headers.get('authorization')) {
    //         throw new HttpError(401, 'mcp requires bearer token')
    //     }
    // },
})`} />

    <CodeBlock
        title="src/server/prompts/summarize.ts — an MCP prompt"
        code={`import { prompt } from 'belte/server/prompt'
import { z } from 'zod'

const schema = z.object({ topic: z.string(), tone: z.string().optional() })

export const summarize = prompt({
    description: 'Draft a request to summarize a topic.',
    schema,
    render: ({ topic, tone }) =>
        \`Write a concise summary of \${topic}\${tone ? \` in a \${tone} tone\` : ''}.\`,
})`} />

    <CodeBlock
        title="from a shell — read a GET resource"
        lang="sh"
        code={`curl -sX POST http://localhost:3000/__belte/mcp \\
  -H 'content-type: application/json' \\
  -d '{"jsonrpc":"2.0","id":1,"method":"resources/read","params":{"uri":"belte://rpc/getProduct?id=1"}}'`} />
</section>
