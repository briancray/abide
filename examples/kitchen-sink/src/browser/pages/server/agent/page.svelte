<script lang="ts">
import CodeBlock from '$browser/CodeBlock.svelte'
import { chat } from '$server/rpc/chat.ts'

type ChatMessage = { role: 'user' | 'assistant'; text: string }
// `ok` is undefined while the call is in flight, then set from its tool_result frame.
type ToolCall = { id: string; name: string; input: unknown; ok?: boolean }

/*
One AgentFrame per JSONL line — the shape belte/server/agent yields and the
Claude Code engine relays. Inlined here so the client page makes no cross-side
import; `jsonl()` adds a final `{"$error":"…"}` line if the handler throws.
*/
type Frame =
    | { type: 'text'; delta: string }
    | { type: 'tool_use'; id: string; name: string; input: unknown }
    | { type: 'tool_result'; id: string; name: string; ok: boolean }
    | { type: 'done'; stop: string }
    | { $error: string }

let messages = $state<ChatMessage[]>([])
let toolCalls = $state<ToolCall[]>([])
let draft = $state('Which tools can you call? Use one and show me the result.')
let streaming = $state(false)
let error = $state<string | undefined>(undefined)

/*
POST the running transcript, then read the JSONL response frame-by-frame —
the same TextDecoderStream + split-by-newline idiom as the plain streaming
demo, folding each AgentFrame into the live assistant turn.
*/
async function send() {
    const text = draft.trim()
    if (!text || streaming) {
        return
    }
    error = undefined
    toolCalls = []
    const history: ChatMessage[] = [...messages, { role: 'user', text }]
    draft = ''
    // Seed the empty assistant turn the text deltas accumulate into.
    messages = [...history, { role: 'assistant', text: '' }]
    streaming = true
    try {
        const response = await chat.raw({ messages: history })
        if (!response.ok || !response.body) {
            throw new Error(`HTTP ${response.status}`)
        }
        const reader = response.body.pipeThrough(new TextDecoderStream()).getReader()
        let buffer = ''
        while (true) {
            const { value, done } = await reader.read()
            if (done) {
                break
            }
            buffer += value
            const lines = buffer.split('\n')
            buffer = lines.pop() ?? ''
            for (const line of lines) {
                if (line) {
                    apply(JSON.parse(line) as Frame)
                }
            }
        }
    } catch (cause) {
        error = cause instanceof Error ? cause.message : String(cause)
    } finally {
        streaming = false
    }
}

// Fold one frame into the live assistant turn ($state proxies make the nested mutation reactive).
function apply(frame: Frame) {
    if ('$error' in frame) {
        error = frame.$error
        return
    }
    if (frame.type === 'text') {
        const last = messages[messages.length - 1]
        if (last?.role === 'assistant') {
            last.text += frame.delta
        }
    } else if (frame.type === 'tool_use') {
        toolCalls = [...toolCalls, { id: frame.id, name: frame.name, input: frame.input }]
    } else if (frame.type === 'tool_result') {
        // Resolve the matching call's outcome — denied (dontAsk) shows the same as failed.
        toolCalls = toolCalls.map((call) =>
            call.id === frame.id ? { ...call, ok: frame.ok } : call,
        )
    }
}
</script>

<nav class="mb-2 text-sm text-slate-500">
    <a href="/server" class="hover:text-slate-900"><code class="font-mono">belte/server</code></a>
    <span class="mx-2">/</span>
    <span>Agent</span>
</nav>
<h1 class="text-3xl font-bold">Agent</h1>
<p class="mt-2 text-slate-600">
    <code class="font-mono">agent(engine, messages)</code>
    runs a model against this app's own MCP surface and streams back
    <code class="font-mono">AgentFrame</code>
    s. Here the
    <code class="font-mono">@belte/claude-code</code>
    engine drives Claude Code over the app's schema-bearing verbs.
</p>
<p class="mt-2 text-xs text-slate-500">
    The server host must have Claude Code available (it uses its own auth — no API key in config).
    Permission is fixed server-side:<code class="font-mono">tools: []</code> drops every Claude Code
    built-in and<code class="font-mono">dontAsk</code> denies anything not in the
    <code class="font-mono">allow</code> list, so the agent can only call
    <code class="font-mono">getProduct</code> and<code class="font-mono">getRates</code> — ask it to
    use another verb and watch it get denied.
</p>

<section class="mt-6 rounded-lg border border-slate-200 bg-white p-5">
    <h2 class="text-sm font-semibold">Chat — try it</h2>

    {#if messages.length > 0}
        <ul class="mt-3 space-y-2">
            {#each messages as message, i (i)}
                <li class="text-sm">
                    <span
                        class="mr-2 font-mono text-xs uppercase"
                        class:text-slate-400={message.role === 'user'}
                        class:text-indigo-500={message.role === 'assistant'}>
                        {message.role}
                    </span>
                    <span class="whitespace-pre-wrap text-slate-800">{message.text}</span>
                </li>
            {/each}
        </ul>
    {/if}

    {#if toolCalls.length > 0}
        <div class="mt-3 rounded-md border border-slate-200 bg-slate-50 p-3">
            <p class="text-xs font-semibold text-slate-500">tool calls</p>
            <ul class="mt-1 space-y-1 font-mono text-xs text-slate-700">
                {#each toolCalls as call, i (i)}
                    <li>
                        <span
                            class:text-slate-400={call.ok === undefined}
                            class:text-emerald-600={call.ok === true}
                            class:text-red-600={call.ok === false}>
                            {call.ok === undefined ? '…' : call.ok ? '✓' : 'denied'}
                        </span>
                        {call.name}
                        ({JSON.stringify(call.input)}
                        )
                    </li>
                {/each}
            </ul>
        </div>
    {/if}

    <form
        class="mt-4 flex gap-2"
        onsubmit={(event) => {
            event.preventDefault()
            void send()
        }}>
        <input
            type="text"
            bind:value={draft}
            disabled={streaming}
            placeholder="Ask the agent…"
            class="flex-1 rounded-md border border-slate-300 px-3 py-1.5 text-sm outline-none focus:border-slate-500 disabled:opacity-60">
        <button
            type="submit"
            disabled={streaming || !draft.trim()}
            class="rounded-md bg-slate-900 px-4 py-1.5 text-sm text-white hover:bg-slate-700 disabled:opacity-60">
            {streaming ? 'streaming…' : 'send'}
        </button>
    </form>

    {#if error}
        <p class="mt-3 text-sm text-red-600">{error}</p>
    {/if}
</section>

<section class="mt-6 space-y-3">
    <CodeBlock
        title="src/server/rpc/chat.ts"
        code={`import { agent } from '@belte/belte/server/agent'
import { jsonl } from '@belte/belte/server/jsonl'
import { POST } from '@belte/belte/server/POST'
import { engine } from '@belte/claude-code'

// Permission fixed server-side: no built-ins, deny anything not allowed.
const chatEngine = engine({
    tools: [],
    permissions: {
        defaultMode: 'dontAsk',
        allow: ['mcp__app__getProduct', 'mcp__app__getRates'],
    },
})

export const chat = POST(
    ({ messages }) => jsonl(agent(chatEngine, messages)),
    { inputSchema, clients: { cli: false } }, // no clients.mcp → never a tool itself
)`} />

    <CodeBlock
        title="client — read the AgentFrame stream"
        code={`const response = await chat.raw({ messages: history })
const reader = response.body!.pipeThrough(new TextDecoderStream()).getReader()
// split-by-newline; each line is one AgentFrame:
//   { type: 'text', delta }   → append to the assistant turn
//   { type: 'tool_use', name, input } → the model called an app tool
//   { type: 'done', stop }    → the turn finished`} />
</section>
