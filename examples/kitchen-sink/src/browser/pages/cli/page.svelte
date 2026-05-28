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
    The in-process / remote rpc client (<code class="font-mono">createClient</code>) and the
    standalone CLI binary toolchain. Schema-bearing rpcs auto-expose; argv parses against
    the same JSON Schema MCP uses.
</p>

<section class="mt-6">
    <h2 class="text-sm font-semibold"><code class="font-mono">createClient&lt;Api&gt;(opts?)</code></h2>
    <div class="mt-2 overflow-x-auto rounded-lg border border-slate-200 bg-white">
        <table class="w-full text-sm">
            <thead class="border-b border-slate-200 bg-slate-50 text-left">
                <tr>
                    <th class="px-4 py-2 font-mono font-medium">option</th>
                    <th class="px-4 py-2 font-medium">mode</th>
                    <th class="px-4 py-2 font-medium">behavior</th>
                </tr>
            </thead>
            <tbody class="divide-y divide-slate-100">
                <tr>
                    <td class="px-4 py-2 font-mono">url</td>
                    <td class="px-4 py-2 text-slate-600">remote</td>
                    <td class="px-4 py-2 text-slate-600">each call hits <code class="font-mono">&lt;url&gt;/&lt;path&gt;</code> via <code class="font-mono">fetch</code></td>
                </tr>
                <tr>
                    <td class="px-4 py-2 font-mono">(no url)</td>
                    <td class="px-4 py-2 text-slate-600">in-process</td>
                    <td class="px-4 py-2 text-slate-600">looks up the verb in the registry, calls <code class="font-mono">verb.fetch</code> — no network</td>
                </tr>
                <tr>
                    <td class="px-4 py-2 font-mono">token</td>
                    <td class="px-4 py-2 text-slate-600">both</td>
                    <td class="px-4 py-2 text-slate-600">sets <code class="font-mono">authorization: Bearer &lt;token&gt;</code></td>
                </tr>
                <tr>
                    <td class="px-4 py-2 font-mono">manifest</td>
                    <td class="px-4 py-2 text-slate-600">both</td>
                    <td class="px-4 py-2 text-slate-600">bundler-emitted CLI manifest; in-process falls back to the live registry</td>
                </tr>
            </tbody>
        </table>
    </div>
</section>

<section class="mt-6 rounded-lg border border-slate-200 bg-white p-5">
    <h2 class="text-sm font-semibold">Server-side install endpoint</h2>
    <p class="mt-1 text-sm text-slate-600">
        <code class="font-mono">createServer</code> registers two CLI routes for any client
        that wants to install the binary.
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
                    <td class="px-4 py-2 text-slate-600">shell installer — detects <code class="font-mono">uname</code>, downloads the platform tarball, drops the binary into <code class="font-mono">$BELTE_INSTALL_DIR</code> (default <code class="font-mono">~/.local/bin</code>)</td>
                </tr>
                <tr>
                    <td class="px-4 py-2 font-mono">GET /__belte/cli/&lt;platform&gt;</td>
                    <td class="px-4 py-2 text-slate-600">gzipped tarball — thin binary + an <code class="font-mono">.env</code> with the request's origin as <code class="font-mono">APP_URL</code></td>
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
    <pre class="mt-3 overflow-x-auto rounded-md bg-slate-900 p-3 text-xs leading-relaxed text-slate-100"><code
        >{installer}</code></pre>
</section>

<section class="mt-6">
    <h2 class="text-sm font-semibold">Thin vs full at build time</h2>
    <div class="mt-2 overflow-x-auto rounded-lg border border-slate-200 bg-white">
        <table class="w-full text-sm">
            <thead class="border-b border-slate-200 bg-slate-50 text-left">
                <tr>
                    <th class="px-4 py-2 font-mono font-medium">APP_URL at build</th>
                    <th class="px-4 py-2 font-medium">mode</th>
                    <th class="px-4 py-2 font-medium">behavior</th>
                </tr>
            </thead>
            <tbody class="divide-y divide-slate-100">
                <tr>
                    <td class="px-4 py-2 text-slate-600">unset</td>
                    <td class="px-4 py-2 text-slate-600">full</td>
                    <td class="px-4 py-2 text-slate-600">every rpc module is bundled in — in-process when <code class="font-mono">APP_URL</code> is unset at runtime, remote when it's set</td>
                </tr>
                <tr>
                    <td class="px-4 py-2 text-slate-600">set</td>
                    <td class="px-4 py-2 text-slate-600">thin</td>
                    <td class="px-4 py-2 text-slate-600">only the manifest is bundled — requires <code class="font-mono">APP_URL</code> at runtime</td>
                </tr>
            </tbody>
        </table>
    </div>
</section>

<section class="mt-6 rounded-lg border border-slate-200 bg-white p-5 text-sm text-slate-600">
    <h2 class="text-sm font-semibold text-slate-900">Streaming caveat</h2>
    <p class="mt-1">
        CLI commands cover the request/response surface only — sockets,
        <code class="font-mono">sse</code>, and <code class="font-mono">jsonl</code>
        rpcs aren't reachable from the binary yet. Use the browser or
        <a class="underline" href="/mcp">MCP</a> surface for those.
    </p>
</section>

<section class="mt-6 space-y-3">
    <CodeBlock
        title="scripts/seed.ts — in-process rpc client for migration scripts"
        code={`import { createClient } from 'belte/cli/createClient'
import { createEcho } from '$server/rpc/createEcho.ts'   // import forces the registry to populate
void createEcho                                   // referenced so the import isn't tree-shaken

const client = createClient<{
    createEcho: (args: { message: string }) => Promise<{ method: 'POST'; message: string }>
}>()
await client.createEcho({ message: 'seeded' })`} />

    <CodeBlock
        title="standalone CLI binary — argv parses against each rpc's JSON Schema"
        lang="sh"
        code={`belte cli                                          # build ./dist/cli
./dist/cli getEcho --message=hello                 # in-process (no APP_URL)
APP_URL=http://localhost:3000 ./dist/cli getEcho --message=hello   # remote
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
