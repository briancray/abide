// Browser-EXECUTION regression test. The happy-dom test preload (bunfig.toml) DELETES the global
// `window` so the rest of the suite runs "server-side" — which means nothing else actually EXECUTES
// the built client bundle as a browser would. That gap let a real bug ship: server-only
// AsyncLocalStorage (node:async_hooks), reachable from the client via the isomorphic route(), was
// constructed at module load and threw `new AsyncLocalStorage` in the browser, killing hydration.
//
// This runs the real client bundle inside a fresh happy-dom Window (window present, the true browser
// condition) against served SSR, and asserts no throw + an interactive counter. It runs in a
// SUBPROCESS so setting global `window` can't pollute the shared test process (which would flip the
// isomorphic side-detection and break other tests).

import { expect, test } from 'bun:test'

const HELPER = (dir: string, servePath: string) => `
import { Window } from "happy-dom";
import { serve } from ${JSON.stringify(servePath)};
await Bun.write(${JSON.stringify(dir)} + "/src/ui/pages/page.abide", "<script>import { state } from 'abide/ui/state'; let count = state(0)</script><button onclick={() => count++}>Count: {count}</button>");
await Bun.write(${JSON.stringify(dir)} + "/src/app.ts", "export const middleware = []\\n");
const { url, stop } = await serve(${JSON.stringify(dir)}, { dev: true });
// Fetch everything BEFORE polluting globals, then stop the server so no server request sees window.
const ssr = await (await fetch(url + "/")).text();
const bundle = await (await fetch(url + "/__abide/client.js")).text();
await stop();
// Real browser condition: window present before the bundle runs.
const win = new Window({ url: url + "/" });
const g = globalThis;
for (const k of ["window","document","location","navigator","history","Element","Node","Event","HTMLElement"]) g[k] = win[k] ?? g[k];
g.window = win;
win.document.body.innerHTML = (ssr.match(/<body>([\\s\\S]*)<\\/body>/) || [,ssr])[1];
// ATTACH PROOF (PR7): capture the SERVER-rendered nodes BEFORE the bundle runs. True attach-hydration
// must CLAIM these exact nodes — a fresh mount (old behavior, or the whole-page fallback) would clear
// the container and create NEW ones, so identity (===) after hydrate is the load-bearing check.
const container = win.document.getElementById("__abide-app");
const serverBtn = win.document.body.querySelector("button");
const serverBtnText = serverBtn ? serverBtn.firstChild : null; // the "Count: " text node inside the button
if (!container || !serverBtn) { console.log("RESULT: no-server-dom"); process.exit(3); }
let threw = "";
try { new Function(bundle + "\\n//# sourceURL=client.js")(); await new Promise(r=>setTimeout(r,50)); }
catch (e) { threw = e.message; }
if (threw) { console.log("THREW: " + threw); process.exit(1); }
const btnAfter = win.document.body.querySelector("button");
const sameNode = btnAfter === serverBtn; // the SAME object survived hydration (claimed, not recreated)
// The container was never emptied: the server button is still attached under it, and its inner text
// node kept identity (a clear+fresh-mount would have detached both).
const notCleared = container.contains(serverBtn) && serverBtn.parentNode !== null && (serverBtnText === null || serverBtnText.parentNode === serverBtn);
const before = (win.document.body.textContent.match(/Count:\\s*\\d+/)||[])[0]; // server value, un-repainted
serverBtn.click(); await Promise.resolve(); await new Promise(r=>setTimeout(r,20));
const after = (win.document.body.textContent.match(/Count:\\s*\\d+/)||[])[0];
if (!sameNode) { console.log("RESULT: recreated-not-claimed"); process.exit(4); }
if (!notCleared) { console.log("RESULT: container-cleared"); process.exit(5); }
if (before === "Count: 0" && after === "Count: 1") { console.log("RESULT: attached-interactive"); process.exit(0); }
console.log("RESULT: not-interactive before=" + before + " after=" + after); process.exit(2);
`

test('built client bundle ATTACH-hydrates the SSR DOM (same node, no clear) + stays interactive', async () => {
    const dir = `/tmp/abide-bt-${crypto.randomUUID()}`
    const servePath = `${import.meta.dir}/../cli/serve.ts`
    const helperPath = `${dir}/run.ts`
    await Bun.write(helperPath, HELPER(dir, servePath))
    // abide package root (so `happy-dom` resolves) is three dirs up from src/lib/server.
    const pkgRoot = `${import.meta.dir}/../../..`
    const proc = Bun.spawnSync(['bun', 'run', helperPath], {
        cwd: pkgRoot,
        stdout: 'pipe',
        stderr: 'pipe',
    })
    const out = proc.stdout.toString() + proc.stderr.toString()
    await Bun.$`rm -rf ${dir}`.quiet().nothrow()
    // "attached-interactive" == the server button was the SAME node after hydrate (sameNode), the
    // container was never cleared (notCleared), AND the counter still increments on that claimed node.
    if (!out.includes('RESULT: attached-interactive'))
        throw new Error(`browser attach-hydration failed:\n${out}`)
    expect(out).toContain('RESULT: attached-interactive')
    expect(proc.exitCode).toBe(0)
}, 30000)

// TODO #6 — a PRODUCTION build (`abide start`/`abide build`, i.e. `serve({ dev: false })`) MINIFIES
// the client bundle; dev does not. Prove (a) minification actually engaged (the prod bundle is
// materially smaller than the same app's dev bundle) and (b) the MINIFIED bundle still attach-hydrates
// and stays interactive in a real browser env — the production path is otherwise untested (every other
// browser test serves `dev: true`).
const MINIFY_HELPER = (dir: string, servePath: string) => `
import { Window } from "happy-dom";
import { serve } from ${JSON.stringify(servePath)};
await Bun.write(${JSON.stringify(dir)} + "/src/ui/pages/page.abide", "<script>import { state } from 'abide/ui/state'; let count = state(0)</script><button onclick={() => count++}>Count: {count}</button>");
await Bun.write(${JSON.stringify(dir)} + "/src/app.ts", "export const middleware = []\\n");
const dev = await serve(${JSON.stringify(dir)}, { dev: true });
const devBundle = await (await fetch(dev.url + "/__abide/client.js")).text();
await dev.stop();
const prod = await serve(${JSON.stringify(dir)}, { dev: false });
const ssr = await (await fetch(prod.url + "/")).text();
const bundle = await (await fetch(prod.url + "/__abide/client.js")).text();
await prod.stop();
if (!(bundle.length < devBundle.length * 0.9)) { console.log("RESULT: not-minified prod=" + bundle.length + " dev=" + devBundle.length); process.exit(6); }
const win = new Window({ url: prod.url + "/" });
const g = globalThis;
for (const k of ["window","document","location","navigator","history","Element","Node","Event","HTMLElement"]) g[k] = win[k] ?? g[k];
g.window = win;
win.document.body.innerHTML = (ssr.match(/<body>([\\s\\S]*)<\\/body>/) || [,ssr])[1];
const serverBtn = win.document.body.querySelector("button");
if (!serverBtn) { console.log("RESULT: no-server-dom"); process.exit(3); }
let threw = "";
try { new Function(bundle + "\\n//# sourceURL=client.js")(); await new Promise(r=>setTimeout(r,50)); }
catch (e) { threw = e.message; }
if (threw) { console.log("THREW: " + threw); process.exit(1); }
const sameNode = win.document.body.querySelector("button") === serverBtn;
const before = (win.document.body.textContent.match(/Count:\\s*\\d+/)||[])[0];
serverBtn.click(); await Promise.resolve(); await new Promise(r=>setTimeout(r,20));
const after = (win.document.body.textContent.match(/Count:\\s*\\d+/)||[])[0];
if (!sameNode) { console.log("RESULT: recreated-not-claimed"); process.exit(4); }
if (before === "Count: 0" && after === "Count: 1") { console.log("RESULT: minified-attached-interactive"); process.exit(0); }
console.log("RESULT: not-interactive before=" + before + " after=" + after); process.exit(2);
`

test('production (minified) client bundle is smaller AND still attach-hydrates + stays interactive', async () => {
    const dir = `/tmp/abide-min-${crypto.randomUUID()}`
    const servePath = `${import.meta.dir}/../cli/serve.ts`
    const helperPath = `${dir}/run.ts`
    await Bun.write(helperPath, MINIFY_HELPER(dir, servePath))
    const pkgRoot = `${import.meta.dir}/../../..`
    const proc = Bun.spawnSync(['bun', 'run', helperPath], {
        cwd: pkgRoot,
        stdout: 'pipe',
        stderr: 'pipe',
    })
    const out = proc.stdout.toString() + proc.stderr.toString()
    await Bun.$`rm -rf ${dir}`.quiet().nothrow()
    if (!out.includes('RESULT: minified-attached-interactive'))
        throw new Error(`minified bundle hydration failed:\n${out}`)
    expect(out).toContain('RESULT: minified-attached-interactive')
    expect(proc.exitCode).toBe(0)
}, 30000)

// §5 hydration seed replay in a REAL browser env: an SSR'd `{await greet(...)}` records its value
// into the seed, and the client replays it on hydration so the RPC is NOT re-fetched. The fetch spy
// returns a distinct "REFETCHED" sentinel — if replay were broken the page would show that (or hang,
// since the server is already stopped) and the rpc-call count would be non-zero.
const SEED_HELPER = (dir: string, servePath: string, getPath: string) => `
import { Window } from "happy-dom";
import { serve } from ${JSON.stringify(servePath)};
await Bun.write(${JSON.stringify(dir)} + "/src/server/rpc/greet.ts", "import { GET } from " + ${JSON.stringify(JSON.stringify(getPath))} + "\\nexport default GET(({ name }) => 'hi ' + name)\\n");
await Bun.write(${JSON.stringify(dir)} + "/src/ui/pages/page.abide", "<script>import greet from '../../server/rpc/greet'</script><p>{await greet({name:'ada'})}</p>");
await Bun.write(${JSON.stringify(dir)} + "/src/app.ts", "export const middleware = []\\n");
const { url, stop } = await serve(${JSON.stringify(dir)}, { dev: true });
const ssr = await (await fetch(url + "/")).text();
const bundle = await (await fetch(url + "/__abide/client.js")).text();
await stop();
if (!ssr.includes("hi ada")) { console.log("RESULT: ssr-missing-value"); process.exit(3); }
const win = new Window({ url: url + "/" });
const g = globalThis;
for (const k of ["window","document","location","navigator","history","Element","Node","Event","HTMLElement"]) g[k] = win[k] ?? g[k];
g.window = win;
// Fetch spy: any /rpc/ hit means the client re-fetched instead of using the seed.
let rpcCalls = 0;
g.fetch = (u, ...a) => { if (String(u).includes("/rpc/")) { rpcCalls++; return Promise.resolve(new Response('"REFETCHED"', { status: 200, headers: { "content-type": "application/json" } })); } return Promise.reject(new Error("unexpected fetch " + u)); };
win.document.body.innerHTML = (ssr.match(/<body>([\\s\\S]*)<\\/body>/) || [,ssr])[1];
let threw = "";
try { new Function(bundle + "\\n//# sourceURL=client.js")(); await new Promise(r=>setTimeout(r,50)); }
catch (e) { threw = e.message; }
if (threw) { console.log("THREW: " + threw); process.exit(1); }
const text = win.document.body.textContent;
if (rpcCalls === 0 && text.includes("hi ada") && !text.includes("REFETCHED")) { console.log("RESULT: replayed"); process.exit(0); }
console.log("RESULT: refetched rpcCalls=" + rpcCalls + " text=" + JSON.stringify(text)); process.exit(2);
`

test('client replays the SSR seed on hydration without re-fetching the RPC', async () => {
    const dir = `/tmp/abide-seed-${crypto.randomUUID()}`
    const servePath = `${import.meta.dir}/../cli/serve.ts`
    const getPath = `${import.meta.dir}/GET.ts`
    const helperPath = `${dir}/run.ts`
    await Bun.write(helperPath, SEED_HELPER(dir, servePath, getPath))
    const pkgRoot = `${import.meta.dir}/../../..`
    const proc = Bun.spawnSync(['bun', 'run', helperPath], {
        cwd: pkgRoot,
        stdout: 'pipe',
        stderr: 'pipe',
    })
    const out = proc.stdout.toString() + proc.stderr.toString()
    await Bun.$`rm -rf ${dir}`.quiet().nothrow()
    if (!out.includes('RESULT: replayed')) throw new Error(`seed-replay failed:\n${out}`)
    expect(out).toContain('RESULT: replayed')
    expect(proc.exitCode).toBe(0)
}, 30000)
