<script lang="ts">
import { cache } from '@belte/belte/shared/cache'
import CodeBlock from '$browser/CodeBlock.svelte'
import RpcHeader from '$browser/RpcHeader.svelte'
import { getSession } from '$server/rpc/getSession.ts'
import { whoAmI } from '$server/rpc/whoAmI.ts'

const me = await cache(whoAmI)()
const session = await cache(getSession)()
</script>

<RpcHeader />
<h1 class="mt-8 text-3xl font-bold">Request scope</h1>
<p class="mt-2 text-slate-600">
    Per-request accessors backed by <code class="font-mono">AsyncLocalStorage</code> — reach for
    them from any scope inside a handler or SSR pass, no plumbing.
</p>

<section class="mt-6">
    <div class="overflow-x-auto rounded-lg border border-slate-200 bg-white">
        <table class="w-full text-sm">
            <thead class="border-b border-slate-200 bg-slate-50 text-left">
                <tr>
                    <th class="px-4 py-2 font-mono font-medium">helper</th>
                    <th class="px-4 py-2 font-medium">returns</th>
                </tr>
            </thead>
            <tbody class="divide-y divide-slate-100">
                <tr>
                    <td class="px-4 py-2 font-mono">request()</td>
                    <td class="px-4 py-2 text-slate-600">
                        the inbound <code class="font-mono">Request</code> — throws outside a
                        request scope
                    </td>
                </tr>
                <tr>
                    <td class="px-4 py-2 font-mono">cookies()</td>
                    <td class="px-4 py-2 text-slate-600">
                        <code class="font-mono">Bun.CookieMap</code>; mutations flush as
                        <code class="font-mono">Set-Cookie</code>
                        when the handler returns
                    </td>
                </tr>
                <tr>
                    <td class="px-4 py-2 font-mono">server()</td>
                    <td class="px-4 py-2 text-slate-600">
                        the live <code class="font-mono">Bun.Server</code> — in-process dispatch
                        (CLI, MCP, tests) gets a no-op stand-in
                    </td>
                </tr>
            </tbody>
        </table>
    </div>
    <p class="mt-2 text-xs text-slate-500">
        In-process calls (SSR, MCP) forward only an allowlist —
        <code class="font-mono">cookie</code>, <code class="font-mono">authorization</code>,
        <code class="font-mono">traceparent</code>, <code class="font-mono">tracestate</code>,
        <code class="font-mono">x-forwarded-for</code>,
        <code class="font-mono">x-forwarded-proto</code>,
        <code class="font-mono">x-forwarded-host</code>
        — onto the synthesized Request; a handler reading anything else during SSR sees nothing. Add
        names via
        <code class="font-mono">forwardHeaders</code>
        in <code class="font-mono">src/app.ts</code>. This app forwards
        <code class="font-mono">user-agent</code>
        so the SSR read below isn't blank.
    </p>
</section>

<section class="mt-6 rounded-lg border border-slate-200 bg-white p-5">
    <h2 class="text-sm font-semibold">
        <code class="font-mono">request()</code>
        — read inbound headers
    </h2>
    <p class="mt-1 text-xs text-slate-500">
        <code class="font-mono">whoAmI()</code>
        reads <code class="font-mono">cookie</code> and
        <code class="font-mono">user-agent</code>
        off the inbound request. The value below rendered during SSR — it only carries your
        user-agent because <code class="font-mono">src/app.ts</code> declares
        <code class="font-mono">forwardHeaders = ['user-agent']</code>.
    </p>
    <pre
        class="mt-3 overflow-x-auto rounded-md bg-slate-900 p-4 text-xs leading-relaxed text-slate-100"><code
        >{JSON.stringify(me, undefined, 2)}</code></pre>
</section>

<section class="mt-6 rounded-lg border border-slate-200 bg-white p-5">
    <h2 class="text-sm font-semibold">
        <code class="font-mono">cookies()</code>
        — the session cookie
    </h2>
    <p class="mt-1 text-xs text-slate-500">
        The auth showcase rides this jar: <code class="font-mono">login</code> writes the session id
        with
        <code class="font-mono">cookies().set(...)</code>
        (flushed as <code class="font-mono">Set-Cookie</code> alongside its 303 redirect),
        <code class="font-mono">getSession</code>
        reads it back with <code class="font-mono">cookies().get(...)</code>, and
        <code class="font-mono">logout</code>
        expires it with <code class="font-mono">cookies().delete(...)</code>. Current session:
    </p>
    <pre
        class="mt-3 overflow-x-auto rounded-md bg-slate-900 p-4 text-xs leading-relaxed text-slate-100"><code
        >{JSON.stringify(session, undefined, 2)}</code></pre>
    <p class="mt-2 text-xs text-slate-500">
        <a class="underline" href="/auth/login">Log in</a>
        and come back to watch it change — same cookie read during SSR and over the wire.
    </p>
</section>

<section class="mt-6 space-y-3">
    <CodeBlock
        title="src/server/rpc/whoAmI.ts"
        code={`import { GET } from '@belte/belte/server/GET'
import { request } from '@belte/belte/server/request'
import { json } from '@belte/belte/server/json'

export const whoAmI = GET(() => {
    const headers = request().headers
    return json({
        hasCookie: headers.has('cookie'),
        userAgent: headers.get('user-agent'),
    })
})`} />

    <CodeBlock
        title="src/sessions.ts — cookies() is the jar"
        code={`import { cookies } from '@belte/belte/server/cookies'

export function createSession(user: string): string {
    const id = crypto.randomUUID()
    sessions.set(id, { user })
    cookies().set(SESSION_COOKIE, id, { httpOnly: true, sameSite: 'lax', path: '/' })
    return id
}

export function getSession(): { user: string } | undefined {
    const id = cookies().get(SESSION_COOKIE)
    return id ? sessions.get(id) : undefined
}`} />

    <CodeBlock
        title="src/app.ts — widen the in-process header allowlist"
        code={`// in-process calls forward only cookie/authorization/traceparent/
// tracestate/x-forwarded-* by default
export const forwardHeaders = ['user-agent']`} />
</section>
