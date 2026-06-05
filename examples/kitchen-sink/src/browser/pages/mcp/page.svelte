<script lang="ts">
import CodeBlock from '$browser/CodeBlock.svelte'

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

async function listResources() {
    listOutput = await call(2, 'resources/list')
}

async function listPrompts() {
    listOutput = await call(3, 'prompts/list')
}

async function callGetProduct() {
    callOutput = await call(4, 'tools/call', {
        name: 'getProduct',
        arguments: { id: '1' },
    })
}

async function callCreateEcho() {
    callOutput = await call(5, 'tools/call', {
        name: 'createEcho',
        arguments: { message: 'hello from /__belte/mcp' },
    })
}

async function callChatTail() {
    callOutput = await call(8, 'tools/call', {
        name: 'chat-tail',
        arguments: { count: 5 },
    })
}

async function callCountLog() {
    callOutput = await call(9, 'tools/call', {
        name: 'countLog',
        arguments: { to: 5 },
    })
}

async function readAbout() {
    callOutput = await call(6, 'resources/read', { uri: 'belte://resources/about.md' })
}

async function getSummarizePrompt() {
    callOutput = await call(7, 'prompts/get', {
        name: 'summarize',
        arguments: { topic: 'otters', tone: 'playful' },
    })
}
</script>

<h1 class="text-3xl font-bold"><code class="font-mono">belte/mcp</code></h1>
<p class="mt-2 text-slate-600">
    Auto-mounted at<code class="font-mono">POST /__belte/mcp</code> — JSON-RPC 2.0, MCP protocol<code
        class="font-mono">
        2025-06-18
    </code>
    . Zero config: tools, prompts, and resources are derived from code you already wrote, and the
    server name/version come from<code class="font-mono">package.json</code>
    .
</p>

<section class="mt-6">
    <h2 class="text-sm font-semibold">Derivation rules</h2>
    <div class="mt-2 overflow-x-auto rounded-lg border border-slate-200 bg-white">
        <table class="w-full text-sm">
            <thead class="border-b border-slate-200 bg-slate-50 text-left">
                <tr>
                    <th class="px-4 py-2 font-medium">source</th>
                    <th class="px-4 py-2 font-medium">becomes</th>
                    <th class="px-4 py-2 font-medium">notes</th>
                </tr>
            </thead>
            <tbody class="divide-y divide-slate-100">
                <tr>
                    <td class="px-4 py-2 text-slate-600">
                        rpc with<code class="font-mono">inputSchema</code>
                    </td>
                    <td class="px-4 py-2 font-mono text-slate-500">tool &lt;name&gt;</td>
                    <td class="px-4 py-2 text-slate-600">
                        read-only verbs (<code class="font-mono">GET</code>
                        /<code class="font-mono">HEAD</code>
                        ) auto-expose; mutating verbs opt in via<code class="font-mono">
                            clients.mcp
                        </code>
                        . The verb feeds the tool's read/write annotations.
                    </td>
                </tr>
                <tr>
                    <td class="px-4 py-2 text-slate-600">
                        socket with<code class="font-mono">schema</code>
                    </td>
                    <td class="px-4 py-2 font-mono text-slate-500">
                        &lt;name&gt;-tail / &lt;name&gt;-publish
                    </td>
                    <td class="px-4 py-2 text-slate-600">
                        <code class="font-mono">-tail</code> reads recent buffered messages;<code
                            class="font-mono">
                            -publish
                        </code> only when<code class="font-mono">clientPublish</code> is set.
                    </td>
                </tr>
                <tr>
                    <td class="px-4 py-2 font-mono text-slate-600">
                        src/mcp/prompts/&lt;name&gt;.md
                    </td>
                    <td class="px-4 py-2 font-mono text-slate-500">prompt &lt;name&gt;</td>
                    <td class="px-4 py-2 text-slate-600">
                        frontmatter<code class="font-mono">arguments</code> → argument list;<code
                            class="font-mono">
                            {`{{name}}`}
                        </code> body → message
                    </td>
                </tr>
                <tr>
                    <td class="px-4 py-2 font-mono text-slate-600">
                        src/mcp/resources/&lt;path&gt;
                    </td>
                    <td class="px-4 py-2 font-mono text-slate-500">
                        belte://resources/&lt;path&gt;
                    </td>
                    <td class="px-4 py-2 text-slate-600">
                        file resource — text inline, binary base64
                    </td>
                </tr>
            </tbody>
        </table>
    </div>
    <p class="mt-2 text-xs text-slate-500">
        No input schema → no MCP exposure. The schema is the gate that makes the non-browser
        surfaces safe to advertise. Override per-declaration with
        <code class="font-mono">{`{ clients: { mcp: false } }`}</code>
        — or opt a mutating verb in with
        <code class="font-mono">{`{ clients: { mcp: true } }`}</code>
        .
    </p>
</section>

<section class="mt-6 rounded-lg border border-slate-200 bg-white p-5">
    <h2 class="text-sm font-semibold">Try it</h2>
    <p class="mt-1 text-xs text-slate-500">
        Hits<code class="font-mono">POST /__belte/mcp</code> directly from the browser. Read-only
        rpcs (<code class="font-mono">getEcho</code>
        ,
        <code class="font-mono">getProduct</code>
        ,
        <code class="font-mono">countLog</code>
        ) are tools automatically; the mutating<code class="font-mono">createEcho</code>
        opts in via<code class="font-mono">clients.mcp</code>
        ; the<code class="font-mono">chat</code> socket exposes<code class="font-mono">
            chat-tail
        </code>
        ;
        <code class="font-mono">about.md</code> is a resource; and
        <code class="font-mono">summarize</code> is a prompt.
    </p>
    <div class="mt-3 flex flex-wrap gap-2 text-sm">
        <button
            type="button"
            class="rounded-md border border-slate-300 px-3 py-1.5 hover:bg-slate-100"
            onclick={listTools}>
            tools/list
        </button>
        <button
            type="button"
            class="rounded-md border border-slate-300 px-3 py-1.5 hover:bg-slate-100"
            onclick={listResources}>
            resources/list
        </button>
        <button
            type="button"
            class="rounded-md border border-slate-300 px-3 py-1.5 hover:bg-slate-100"
            onclick={listPrompts}>
            prompts/list
        </button>
        <button
            type="button"
            class="rounded-md border border-slate-300 px-3 py-1.5 hover:bg-slate-100"
            onclick={callGetProduct}>
            tools/call → getProduct
        </button>
        <button
            type="button"
            class="rounded-md border border-slate-300 px-3 py-1.5 hover:bg-slate-100"
            onclick={callCreateEcho}>
            tools/call → createEcho
        </button>
        <button
            type="button"
            class="rounded-md border border-slate-300 px-3 py-1.5 hover:bg-slate-100"
            onclick={callChatTail}>
            tools/call → chat-tail
        </button>
        <button
            type="button"
            class="rounded-md border border-slate-300 px-3 py-1.5 hover:bg-slate-100"
            onclick={callCountLog}>
            tools/call → countLog
        </button>
        <button
            type="button"
            class="rounded-md border border-slate-300 px-3 py-1.5 hover:bg-slate-100"
            onclick={readAbout}>
            resources/read → about.md
        </button>
        <button
            type="button"
            class="rounded-md border border-slate-300 px-3 py-1.5 hover:bg-slate-100"
            onclick={getSummarizePrompt}>
            prompts/get → summarize
        </button>
    </div>
    <div class="mt-3 grid gap-3 sm:grid-cols-2">
        <div>
            <p class="text-xs font-medium text-slate-500">list</p>
            <pre
                class="mt-1 overflow-x-auto rounded-md bg-slate-900 p-3 text-xs leading-relaxed text-slate-100"><code
                >{listOutput}</code></pre>
        </div>
        <div>
            <p class="text-xs font-medium text-slate-500">call / read / get</p>
            <pre
                class="mt-1 overflow-x-auto rounded-md bg-slate-900 p-3 text-xs leading-relaxed text-slate-100"><code
                >{callOutput}</code></pre>
        </div>
    </div>
</section>

<section class="mt-6 rounded-lg border border-slate-200 bg-white p-5">
    <h2 class="text-sm font-semibold">Auth forwarding</h2>
    <p class="mt-1 text-sm text-slate-600">
        Inbound MCP requests forward<code class="font-mono">cookie</code>
        ,
        <code class="font-mono">authorization</code>
        , and the
        <code class="font-mono">x-forwarded-for</code> /
        <code class="font-mono">-proto</code> /<code class="font-mono">-host</code> hints onto every
        synthesized rpc request, so the session middleware in
        <code class="font-mono">src/app.ts</code> keeps working unchanged. Tool calls go through the
        same<code class="font-mono">verb.fetch</code> path as the HTTP route — validation, response
        helpers, and error mapping behave identically.
    </p>
</section>

<section class="mt-6 rounded-lg border border-slate-200 bg-white p-5 text-sm text-slate-600">
    <h2 class="text-sm font-semibold text-slate-900">Streaming caveat</h2>
    <p class="mt-1">
        MCP exposes request/response tools, prompts, and snapshot resources — not a live
        subscription. A socket's<code class="font-mono">-tail</code> tool returns the recent
        buffered messages, not a live stream; real-time fan-out stays on the
        <a class="underline" href="/server/sockets">ws multiplex</a>
        .
    </p>
</section>

<section class="mt-6 space-y-3">
    <CodeBlock
        title="src/mcp/prompts/summarize.md — an MCP prompt"
        lang="sh"
        code={`---
description: Draft a request to summarize a topic.
arguments:
  - name: topic
    description: the subject to summarize
    required: true
  - name: tone
    description: optional voice for the summary
    required: false
---
Write a concise summary of {{topic}} in a {{tone}} tone.`} />

    <CodeBlock
        title="src/mcp/resources/about.md — a file resource"
        lang="sh"
        code={`# any file under src/mcp/resources/ is served as belte://resources/<path>
src/mcp/resources/about.md   →   belte://resources/about.md`} />

    <CodeBlock
        title="from a shell — call a tool"
        lang="sh"
        code={`curl -sX POST http://localhost:3000/__belte/mcp \\
  -H 'content-type: application/json' \\
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"getProduct","arguments":{"id":"1"}}}'`} />
</section>
