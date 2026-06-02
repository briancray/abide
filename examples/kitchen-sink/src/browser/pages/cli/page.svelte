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
    The standalone CLI binary is a thin remote client that talks to a running server over HTTP.
    Schema-bearing rpcs auto-expose as commands; argv parses against the same JSON Schema MCP uses.
</p>

<section class="mt-6 rounded-lg border border-slate-200 bg-white p-5">
    <h2 class="text-sm font-semibold">Server-side install endpoint</h2>
    <p class="mt-1 text-sm text-slate-600">
        The server exposes two CLI routes for any client that wants to install the binary.
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
                        shell installer — detects <code class="font-mono">uname</code>
                        , downloads the platform tarball, drops the binary into <code
                            class="font-mono">
                            $BELTE_INSTALL_DIR
                        </code> (default <code class="font-mono">~/.local/bin</code>
                        )
                    </td>
                </tr>
                <tr>
                    <td class="px-4 py-2 font-mono">GET /__belte/cli/&lt;platform&gt;</td>
                    <td class="px-4 py-2 text-slate-600">
                        gzipped tarball — thin binary + an <code class="font-mono">.env</code> with
                        the request's origin as <code class="font-mono">APP_URL</code>
                    </td>
                </tr>
            </tbody>
        </table>
    </div>
    <p class="mt-2 text-xs text-slate-500">
        First request triggers a <code class="font-mono">belte cli --platforms=…</code>
        build if needed; concurrent requests dedupe onto one build. Pre-build into
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
        <code class="font-mono">belte cli</code> vs <code class="font-mono">belte compile</code>
    </h2>
    <p class="mt-1">
        <code class="font-mono">belte cli</code> builds a thin remote client — only the rpc manifest
        is bundled, so it always talks to a running server over HTTP and
        <code class="font-mono">APP_URL</code> is required at runtime. For an embedded backend, <code
            class="font-mono">
            belte compile
        </code> produces the standalone
        <em>server</em> binary instead.
    </p>
</section>

<section class="mt-6 rounded-lg border border-slate-200 bg-white p-5 text-sm text-slate-600">
    <h2 class="text-sm font-semibold text-slate-900">Streaming &amp; sockets</h2>
    <p class="mt-1">
        Streaming works: an <code class="font-mono">sse</code>
        /
        <code class="font-mono">jsonl</code>
        rpc — or a socket <code class="font-mono">&lt;name&gt;-tail</code> command — prints
        frame-by-frame as NDJSON to stdout; everything else is decoded and printed once. Each socket
        contributes a <code class="font-mono">&lt;name&gt;-tail</code> command, plus
        <code class="font-mono">&lt;name&gt;-publish</code> when
        <code class="font-mono">clientPublish</code> is set.
    </p>
</section>

<section class="mt-6 space-y-3">
    <CodeBlock
        title="standalone CLI binary — argv parses against each rpc's JSON Schema"
        lang="sh"
        code={`belte cli                                          # build ./dist/cli
APP_URL=http://localhost:3000 ./dist/cli getEcho --message=hello   # call the server
./dist/cli countLog --to=5                          # streaming jsonl rpc → NDJSON frames
./dist/cli chat-tail --tail=10                      # socket: replay last 10, then stream live as NDJSON
./dist/cli --help
./dist/cli getEcho --help`} />

    <CodeBlock
        title="cross-build thin binaries — served by the install endpoint"
        lang="sh"
        code={`belte cli --platforms=linux-x64,darwin-arm64
# writes dist/cli-thin/<platform>/<programName>

# users install with:
curl -fsSL https://your-app.example/__belte/cli | sh`} />
</section>
