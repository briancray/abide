<script lang="ts">
import CodeBlock from '$browser/CodeBlock.svelte'
</script>

<h1 class="text-3xl font-bold"><code class="font-mono">belte/bundle</code></h1>
<p class="mt-2 text-slate-600">
    <code class="font-mono">belte bundle</code> produces a movable, self-contained native
    desktop app for the host platform — the standalone server binary, a launcher, and the
    native webview library travel together, so it runs on another machine of the same OS
    with nothing installed. It drives the OS webview over FFI (WebKit / WebView2 /
    WebKitGTK); no Chromium is bundled.
</p>

<section class="mt-6">
    <h2 class="text-sm font-semibold">Launch modes</h2>
    <p class="mt-1 text-xs text-slate-500">
        Mode is keyed on <code class="font-mono">APP_URL</code> at launch, exactly like the
        <a class="underline" href="/cli">CLI</a> binary.
    </p>
    <div class="mt-2 overflow-x-auto rounded-lg border border-slate-200 bg-white">
        <table class="w-full text-sm">
            <thead class="border-b border-slate-200 bg-slate-50 text-left">
                <tr>
                    <th class="px-4 py-2 font-mono font-medium">APP_URL</th>
                    <th class="px-4 py-2 font-medium">behavior</th>
                </tr>
            </thead>
            <tbody class="divide-y divide-slate-100">
                <tr>
                    <td class="px-4 py-2 font-mono text-slate-600">set</td>
                    <td class="px-4 py-2 text-slate-600">remote — point the webview at that server, start nothing</td>
                </tr>
                <tr>
                    <td class="px-4 py-2 font-mono text-slate-600">unset</td>
                    <td class="px-4 py-2 text-slate-600">embedded — spawn the sibling server binary on a free local port</td>
                </tr>
            </tbody>
        </table>
    </div>
</section>

<section class="mt-6">
    <h2 class="text-sm font-semibold"><code class="font-mono">src/bundle/window.ts</code></h2>
    <p class="mt-1 text-xs text-slate-500">
        Optional default-exported <code class="font-mono">BundleWindow</code>, baked into the
        launcher. Every field is optional.
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
                    <td class="px-4 py-2 text-slate-600">custom top-level menus, inserted between Edit and Window</td>
                </tr>
            </tbody>
        </table>
    </div>
</section>

<section class="mt-6 rounded-lg border border-slate-200 bg-white p-5 text-sm text-slate-600">
    <h2 class="text-sm font-semibold text-slate-900">Custom menus emit page events</h2>
    <p class="mt-1">
        A menu item carries no arguments — clicking it fires the item's
        <code class="font-mono">emit</code> name. Subscribe with
        <code class="font-mono">onMenu</code> from
        <code class="font-mono">belte/bundle/onMenu</code>: it hands your handler the name and
        returns an unsubscribe, so it drops straight into an
        <code class="font-mono">$effect</code>. Your code makes the relevant rpc call, so the
        menu can drive parameterised work. The standard App / Edit / Window menus (Quit,
        copy/paste, minimize) are always installed.
    </p>
</section>

<section class="mt-6 rounded-lg border border-slate-200 bg-white p-5 text-sm text-slate-600">
    <h2 class="text-sm font-semibold text-slate-900"><code class="font-mono">belte bundle</code> vs <code class="font-mono">belte compile</code></h2>
    <p class="mt-1">
        <code class="font-mono">belte bundle</code> wraps the server binary in a desktop
        launcher + webview for this platform. For just the embedded
        <em>server</em> executable (no window), use
        <code class="font-mono">belte compile</code> — the same binary the bundle spawns. On
        macOS, drop <code class="font-mono">src/bundle/icon.png</code> and the build converts
        it to <code class="font-mono">icon.icns</code> and wires the Info.plist. Bundles are
        <strong>unsigned</strong> — distributing to other users still needs platform signing.
    </p>
</section>

<section class="mt-6 space-y-3">
    <CodeBlock
        title="src/bundle/window.ts — this app's window config"
        code={`import type { BundleWindow } from 'belte/bundle/BundleWindow'

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
} satisfies BundleWindow`} />

    <CodeBlock
        title="src/browser/pages/layout.svelte — the app side of the menu contract"
        lang="svelte"
        code={`import { onMenu } from 'belte/bundle/onMenu'
import { navigate } from 'belte/browser/navigate'

$effect(() =>
    onMenu((name) => {
        if (name === 'reload-session') location.reload()
        else if (name === 'open-mcp') void navigate('/mcp')
    }),
)`} />

    <CodeBlock
        title="build the bundle (unsigned, host platform)"
        lang="sh"
        code={`belte bundle           # → dist/<program>.app (macOS) or dist/<program>/
belte compile          # just the embedded server binary the bundle spawns`} />
</section>
