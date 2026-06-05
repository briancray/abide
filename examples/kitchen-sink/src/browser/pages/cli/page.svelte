<script lang="ts">
import CodeBlock from '$browser/CodeBlock.svelte'

let installer = $state('(not fetched)')

async function fetchInstaller() {
    const response = await fetch('/__belte/cli')
    installer = await response.text()
}
</script>

<h1 class="text-3xl font-bold"><code class="font-mono">belte/cli</code></h1>
<p class="mt-2 text-slate-600">
    <code class="font-mono">belte cli</code> builds a standalone binary — a thin remote client with
    the rpc manifest baked in, shipped beside the compiled<em>server</em> so it can connect to a
    remote server or start a local instance. Schema-bearing rpcs auto-expose as commands; argv
    parses against the same JSON Schema MCP uses. Each socket adds a<code class="font-mono">
        &lt;name&gt;-tail
    </code>
    command (plus<code class="font-mono">&lt;name&gt;-publish</code> when
    <code class="font-mono">clientPublish</code> is set).
</p>

<section class="mt-6 rounded-lg border border-slate-200 bg-white p-5">
    <h2 class="text-sm font-semibold">Connection</h2>
    <p class="mt-1 text-sm text-slate-600">
        One rule:<code class="font-mono">/</code> manages the connection, a bare word runs a
        command. The connection verbs are<code class="font-mono">/</code>
        -prefixed only — no bare aliases — so a bare word is always a command.
    </p>
    <div class="mt-3 overflow-x-auto rounded-lg border border-slate-200">
        <table class="w-full text-sm">
            <thead class="border-b border-slate-200 bg-slate-50 text-left">
                <tr>
                    <th class="px-4 py-2 font-mono font-medium">command</th>
                    <th class="px-4 py-2 font-medium">does</th>
                </tr>
            </thead>
            <tbody class="divide-y divide-slate-100">
                <tr>
                    <td class="px-4 py-2 font-mono">app /connect &lt;url&gt;</td>
                    <td class="px-4 py-2 text-slate-600">
                        connect to a remote server, open a session
                    </td>
                </tr>
                <tr>
                    <td class="px-4 py-2 font-mono">app /start</td>
                    <td class="px-4 py-2 text-slate-600">start a local instance, open a session</td>
                </tr>
                <tr>
                    <td class="px-4 py-2 font-mono">app /disconnect</td>
                    <td class="px-4 py-2 text-slate-600">forget the saved connection</td>
                </tr>
                <tr>
                    <td class="px-4 py-2 font-mono">app</td>
                    <td class="px-4 py-2 text-slate-600">
                        resume the saved connection in a session
                    </td>
                </tr>
                <tr>
                    <td class="px-4 py-2 font-mono">app &lt;command&gt; [--flags]</td>
                    <td class="px-4 py-2 text-slate-600">one-shot dispatch (scripting)</td>
                </tr>
            </tbody>
        </table>
    </div>
    <p class="mt-2 text-xs text-slate-500">
        A session prints the banner once, then a status line (&ldquo;connected to
        &lt;name&gt;&rdquo; or &ldquo;running a local instance&rdquo;) and a prompt: bare words run
        commands, while
        <code class="font-mono">/connect</code>
        ,<code class="font-mono">/start</code>
        ,
        <code class="font-mono">/disconnect</code>
        ,<code class="font-mono">/help</code>
        , and
        <code class="font-mono">/exit</code> manage it. The saved connection lives in the per-user
        data dir; with none recorded the CLI resumes the baked<code class="font-mono">APP_URL</code>
        .
    </p>
</section>

<section class="mt-6 rounded-lg border border-slate-200 bg-white p-5">
    <h2 class="text-sm font-semibold">Flags &amp; env</h2>
    <p class="mt-1 text-sm text-slate-600">
        Each command's flags derive from its input JSON Schema.
    </p>
    <div class="mt-3 overflow-x-auto rounded-lg border border-slate-200">
        <table class="w-full text-sm">
            <thead class="border-b border-slate-200 bg-slate-50 text-left">
                <tr>
                    <th class="px-4 py-2 font-medium">schema type</th>
                    <th class="px-4 py-2 font-mono font-medium">flag form</th>
                </tr>
            </thead>
            <tbody class="divide-y divide-slate-100">
                <tr>
                    <td class="px-4 py-2 text-slate-600">boolean</td>
                    <td class="px-4 py-2 font-mono">--name / --no-name</td>
                </tr>
                <tr>
                    <td class="px-4 py-2 text-slate-600">number / integer</td>
                    <td class="px-4 py-2 font-mono">--name &lt;n&gt;</td>
                </tr>
                <tr>
                    <td class="px-4 py-2 text-slate-600">array</td>
                    <td class="px-4 py-2 font-mono">repeat --name &lt;v&gt;</td>
                </tr>
                <tr>
                    <td class="px-4 py-2 text-slate-600">other</td>
                    <td class="px-4 py-2 font-mono">--name &lt;value&gt;</td>
                </tr>
                <tr>
                    <td class="px-4 py-2 text-slate-600">any shape</td>
                    <td class="px-4 py-2 font-mono">
                        --json '&lt;object&gt;' or pipe JSON on stdin
                    </td>
                </tr>
            </tbody>
        </table>
    </div>
    <p class="mt-3 text-sm text-slate-600">
        <code class="font-mono">APP_URL</code> is the default server URL (baked at install,
        shell-overridable);<code class="font-mono">APP_TOKEN</code> is sent as
        <code class="font-mono">Authorization: Bearer &lt;value&gt;</code>
        .
    </p>
</section>

<section class="mt-6 rounded-lg border border-slate-200 bg-white p-5">
    <h2 class="text-sm font-semibold">Server-side install endpoint</h2>
    <p class="mt-1 text-sm text-slate-600">
        A running server offers two CLI routes for any client that wants to install the binary.
    </p>
    <div class="mt-3 overflow-x-auto rounded-lg border border-slate-200">
        <table class="w-full text-sm">
            <thead class="border-b border-slate-200 bg-slate-50 text-left">
                <tr>
                    <th class="px-4 py-2 font-mono font-medium">route</th>
                    <th class="px-4 py-2 font-medium">returns</th>
                </tr>
            </thead>
            <tbody class="divide-y divide-slate-100">
                <tr>
                    <td class="px-4 py-2 font-mono">GET /__belte/cli</td>
                    <td class="px-4 py-2 text-slate-600">
                        shell installer — detects<code class="font-mono">uname</code>
                        , downloads the platform tarball, extracts it into
                        <code class="font-mono">$BELTE_INSTALL_DIR</code> (default
                        <code class="font-mono">~/.local/bin</code>
                        )
                    </td>
                </tr>
                <tr>
                    <td class="px-4 py-2 font-mono">GET /__belte/cli/&lt;platform&gt;</td>
                    <td class="px-4 py-2 text-slate-600">
                        gzipped tarball — the cli binary, its sibling
                        <code class="font-mono">server</code> binary, and an
                        <code class="font-mono">.env</code> with the request's origin as
                        <code class="font-mono">APP_URL</code> (and
                        <code class="font-mono">APP_TOKEN</code> when the request was authenticated)
                    </td>
                </tr>
            </tbody>
        </table>
    </div>
    <p class="mt-2 text-xs text-slate-500">
        First request triggers a<code class="font-mono">belte cli --platforms=…</code> build of both
        binaries if needed; concurrent requests dedupe onto one build. Pre-build into
        <code class="font-mono">dist/cli-thin/</code> to skip the on-demand step.
    </p>
    <button
        type="button"
        class="mt-3 rounded-md border border-slate-300 px-3 py-1.5 text-sm hover:bg-slate-100"
        onclick={fetchInstaller}>
        GET /__belte/cli
    </button>
    <pre
        class="mt-3 overflow-x-auto rounded-md bg-slate-900 p-3 text-xs leading-relaxed text-slate-100"><code
        >{installer}</code></pre>
</section>

<section class="mt-6 rounded-lg border border-slate-200 bg-white p-5 text-sm text-slate-600">
    <h2 class="text-sm font-semibold text-slate-900">
        <code class="font-mono">belte cli</code> vs<code class="font-mono">belte compile</code>
    </h2>
    <p class="mt-1">
        <code class="font-mono">belte cli</code> builds the client and ships the compiled server
        beside the cli binary, so the cli can talk to a remote server or boot one with
        <code class="font-mono">/start</code>
        . For just the embedded backend,
        <code class="font-mono">belte compile</code> produces the standalone<em>server</em> binary
        on its own.
    </p>
</section>

<section class="mt-6 rounded-lg border border-slate-200 bg-white p-5 text-sm text-slate-600">
    <h2 class="text-sm font-semibold text-slate-900">Streaming &amp; sockets</h2>
    <p class="mt-1">
        Streaming works: an<code class="font-mono">sse</code> /<code class="font-mono">
            jsonl
        </code> rpc — or a socket<code class="font-mono">&lt;name&gt;-tail</code> command — prints
        frame-by-frame as NDJSON to stdout; everything else is decoded and printed once. See
        <a class="text-blue-600 hover:underline" href="/server/sockets">/server/sockets</a> for the
        socket primitive.
    </p>
</section>

<section class="mt-6 space-y-3">
    <CodeBlock
        title="build — cli binary plus its sibling server"
        lang="sh"
        code={`belte cli                  # writes ./dist/cli and ./dist/server
belte cli --platforms=linux-x64,darwin-arm64
# writes dist/cli-thin/<platform>/<programName> + server`} />

    <CodeBlock
        title="connect, start, resume — open an interactive session"
        lang="sh"
        code={`./dist/cli /start                       # boot a local instance, drop into a session
./dist/cli /connect https://app.example  # connect to a remote server
./dist/cli                               # resume the saved connection
./dist/cli /disconnect                   # forget it`} />

    <CodeBlock
        title="one-shot dispatch — for scripting"
        lang="sh"
        code={`APP_URL=http://localhost:3000 ./dist/cli getEcho --message=hello
./dist/cli countLog --to=5         # streaming jsonl rpc → NDJSON frames
./dist/cli chat-tail --tail=10     # socket: replay last 10, then stream live as NDJSON
./dist/cli --help
./dist/cli getEcho --help`} />

    <CodeBlock
        title="users install from a running server"
        lang="sh"
        code={`curl -fsSL https://your-app.example/__belte/cli | sh`} />
</section>
