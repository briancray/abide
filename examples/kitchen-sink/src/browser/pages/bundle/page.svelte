<script lang="ts">
import CodeBlock from '$browser/CodeBlock.svelte'
</script>

<h1 class="text-3xl font-bold"><code class="font-mono">belte/bundle</code></h1>
<p class="mt-2 text-slate-600">
    <code class="font-mono">belte bundle</code> produces a movable, self-contained native desktop
    app for the host platform — the standalone server binary, a launcher, and the native webview
    library travel together, so it runs on another machine of the same OS with nothing installed. It
    drives the OS webview over FFI (WebKit / WebView2 / WebKitGTK); no Chromium is bundled.
</p>

<section class="mt-6">
    <h2 class="text-sm font-semibold">Launch</h2>
    <p class="mt-1 text-xs text-slate-500">
        The launcher records the last connection in a per-user data dir and, on relaunch, boots or
        probes it<em>before</em> opening the window — so a configured app opens straight at the live
        server, no connect-screen flash. The connect screen shows only when there's a real choice to
        make: first run, missing required config, or a dead/forgotten server.
    </p>
    <div class="mt-2 overflow-x-auto rounded-lg border border-slate-200 bg-white">
        <table class="w-full text-sm">
            <thead class="border-b border-slate-200 bg-slate-50 text-left">
                <tr>
                    <th class="px-4 py-2 font-medium">action</th>
                    <th class="px-4 py-2 font-medium">behavior</th>
                </tr>
            </thead>
            <tbody class="divide-y divide-slate-100">
                <tr>
                    <td class="px-4 py-2 font-mono text-slate-600">Start server</td>
                    <td class="px-4 py-2 text-slate-600">
                        spawn the sibling server binary on a free local port, then point the window
                        at it; opens the setup modal first when the app declares config (below)
                    </td>
                </tr>
                <tr>
                    <td class="px-4 py-2 font-mono text-slate-600">Connect (form)</td>
                    <td class="px-4 py-2 text-slate-600">
                        probe the entered URL is a belte server, then point the window at it
                    </td>
                </tr>
                <tr>
                    <td class="px-4 py-2 font-mono text-slate-600">Disconnect</td>
                    <td class="px-4 py-2 text-slate-600">
                        reap any embedded server, forget the saved connection, return to the connect
                        screen
                    </td>
                </tr>
            </tbody>
        </table>
    </div>
    <p class="mt-2 text-xs text-slate-500">
        The always-installed File menu drives Start server / Disconnect; the connect screen's form
        is where you point at a remote URL. A liveness watch bounces the window back if the
        connected server stops responding. Override the screen itself with
        <code class="font-mono">src/bundle/disconnected.svelte</code>
        .
    </p>
</section>

<section class="mt-6">
    <h2 class="text-sm font-semibold"><code class="font-mono">src/bundle/window.ts</code></h2>
    <p class="mt-1 text-xs text-slate-500">
        Optional default-exported<code class="font-mono">BundleWindow</code>
        , baked into the launcher. Every field is optional.
    </p>
    <div class="mt-2 overflow-x-auto rounded-lg border border-slate-200 bg-white">
        <table class="w-full text-sm">
            <thead class="border-b border-slate-200 bg-slate-50 text-left">
                <tr>
                    <th class="px-4 py-2 font-mono font-medium">field</th>
                    <th class="px-4 py-2 font-medium">default</th>
                    <th class="px-4 py-2 font-medium">meaning</th>
                </tr>
            </thead>
            <tbody class="divide-y divide-slate-100">
                <tr>
                    <td class="px-4 py-2 font-mono">title</td>
                    <td class="px-4 py-2 text-slate-600">program name</td>
                    <td class="px-4 py-2 text-slate-600">window + menu-bar title</td>
                </tr>
                <tr>
                    <td class="px-4 py-2 font-mono">width / height</td>
                    <td class="px-4 py-2 text-slate-600">1024 / 768</td>
                    <td class="px-4 py-2 text-slate-600">initial window size</td>
                </tr>
                <tr>
                    <td class="px-4 py-2 font-mono">menu</td>
                    <td class="px-4 py-2 text-slate-600">—</td>
                    <td class="px-4 py-2 text-slate-600">
                        custom top-level menus, inserted between Edit and Window
                    </td>
                </tr>
                <tr>
                    <td class="px-4 py-2 font-mono">config</td>
                    <td class="px-4 py-2 text-slate-600">—</td>
                    <td class="px-4 py-2 text-slate-600">
                        Standard Schema of env the embedded server needs; drives the first-run setup
                        modal
                    </td>
                </tr>
            </tbody>
        </table>
    </div>
</section>

<section class="mt-6 rounded-lg border border-slate-200 bg-white p-5 text-sm text-slate-600">
    <h2 class="text-sm font-semibold text-slate-900">First-run config</h2>
    <p class="mt-1">
        A<code class="font-mono">config</code> schema on the window declares the env the embedded
        server needs. Its JSON Schema drives a setup modal on the connect screen — each property is
        one env var the server reads via<code class="font-mono">Bun.env</code>
        , and the standard slots map to the form:<code class="font-mono">title</code> → label,
        <code class="font-mono">description</code> → hint,
        <code class="font-mono">format: 'password'</code> → masked input,
        <code class="font-mono">default</code> → prefill. Answers persist to a per-user data-dir
        <code class="font-mono">.env</code>
        ; a required key with no default is what makes the modal appear when you click Start.
    </p>
</section>

<section class="mt-6 rounded-lg border border-slate-200 bg-white p-5 text-sm text-slate-600">
    <h2 class="text-sm font-semibold text-slate-900">Custom menus emit page events</h2>
    <p class="mt-1">
        A menu item carries no arguments — clicking it fires the item's
        <code class="font-mono">emit</code> name. Subscribe with
        <code class="font-mono">onMenu</code> from
        <code class="font-mono">belte/bundle/onMenu</code>
        : pass a name plus a handler to fire for one item, or a single handler to take every name.
        Both return an unsubscribe, so they drop straight into an
        <code class="font-mono">$effect</code>
        . Your code makes the relevant rpc call, so the menu can drive parameterised work. The
        standard App / Edit / Window menus (Quit, copy/paste, minimize) are always installed.
    </p>
</section>

<section class="mt-6 rounded-lg border border-slate-200 bg-white p-5 text-sm text-slate-600">
    <h2 class="text-sm font-semibold text-slate-900">
        Detect the bundle with<code class="font-mono">bundled()</code>
    </h2>
    <p class="mt-1">
        <code class="font-mono">bundled</code> from
        <code class="font-mono">belte/shared/bundled</code> reports whether the code is running
        inside the desktop bundle —<code class="font-mono">true</code> in the bundle's webview or
        its embedded server process,<code class="font-mono">false</code> in a plain browser tab or a
        standalone server binary. Same name and meaning on both sides (the client reads the
        webview's init flag; the server reads the launcher's<code class="font-mono">
            BELTE_PARENT_PID
        </code>
        ), so a page can branch desktop-only UI without threading a flag through your code.
    </p>
</section>

<section class="mt-6 rounded-lg border border-slate-200 bg-white p-5 text-sm text-slate-600">
    <h2 class="text-sm font-semibold text-slate-900">
        <code class="font-mono">belte bundle</code> vs<code class="font-mono">belte compile</code>
    </h2>
    <p class="mt-1">
        <code class="font-mono">belte bundle</code> wraps the server binary in a desktop launcher +
        webview for this platform. For just the embedded
        <em>server</em> executable (no window), use
        <code class="font-mono">belte compile</code> — the same binary the bundle spawns. On macOS,
        drop<code class="font-mono">src/bundle/icon.png</code> and the build converts it to<code
            class="font-mono">
            icon.icns
        </code> and wires the Info.plist. The finished<code class="font-mono">.app</code> is
        <strong>ad-hoc code-signed</strong> so it launches on other Macs (a quarantined copy may
        still need<code class="font-mono">xattr -cr</code> once); full distribution still needs a
        Developer ID signature and notarization.
    </p>
</section>

<section class="mt-6 space-y-3">
    <CodeBlock
        title="src/bundle/window.ts — this app's window config"
        code={`import type { BundleWindow } from '@belte/belte/bundle/BundleWindow'
import { z } from 'zod'

export default {
    title: 'belte kitchen-sink',
    width: 1280,
    height: 880,
    menu: [
        {
            label: 'Demo',
            items: [
                { label: 'Reload session', shortcut: 'r', emit: 'reload-session' },
                { separator: true },
                { label: 'Open MCP panel', emit: 'open-mcp' },
            ],
        },
    ],
    config: z.object({
        // required, no default → forces the setup modal on first Start
        HOST_ROOT: z.string().meta({ title: 'Content folder', description: 'Absolute path the server reads content from' }),
        API_KEY: z.string().optional().meta({ title: 'API key', format: 'password' }),
        WELCOME_MESSAGE: z.string().default('Hello from the kitchen sink').optional().meta({ title: 'Welcome message' }),
    }),
} satisfies BundleWindow`} />

    <CodeBlock
        title="src/browser/pages/layout.svelte — the app side of the menu contract"
        lang="svelte"
        code={`import { onMenu } from '@belte/belte/bundle/onMenu'
import { navigate } from '@belte/belte/browser/navigate'

// name-filtered: one handler per item
$effect(() => onMenu('reload-session', () => location.reload()))
$effect(() => onMenu('open-mcp', () => void navigate('/mcp')))

// or catch-all: every name through one handler
// $effect(() => onMenu((name) => { ... }))`} />

    <CodeBlock
        title="any server handler reads config straight off the env"
        code={`const root = Bun.env.HOST_ROOT   // delivered by the setup modal → data-dir .env`} />

    <CodeBlock
        title="src/browser/pages/page.svelte — branch desktop-only UI"
        lang="svelte"
        code={`import { bundled } from '@belte/belte/shared/bundled'

// true in the bundle's webview / embedded server, false in a plain browser tab
{#if bundled()}
    <button onclick={() => location.reload()}>Reload window</button>
{/if}`} />

    <CodeBlock
        title="build the bundle (host platform)"
        lang="sh"
        code={`belte bundle           # → dist/<program>.app (macOS) or dist/<program>/
belte compile          # just the embedded server binary the bundle spawns`} />
</section>
