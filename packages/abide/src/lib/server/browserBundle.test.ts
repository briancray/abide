// Browser-EXECUTION regression test. The happy-dom test preload (bunfig.toml) DELETES the global
// `window` so the rest of the suite runs "server-side" — which means nothing else actually EXECUTES
// the built client bundle as a browser would. That gap let a real bug ship: server-only
// AsyncLocalStorage (node:async_hooks), reachable from the client via the isomorphic route(), was
// constructed at module load and threw `new AsyncLocalStorage` in the browser, killing hydration.
//
// This runs the REAL built client (loader entry + code-split chunks — TODO #6) inside a fresh happy-dom
// Window (window present, the true browser condition) against served SSR, and asserts no throw + an
// interactive counter. Because happy-dom can't resolve ESM dynamic imports over HTTP, we MATERIALIZE the
// served module graph to a temp dir (rewriting the `/__abide/chunk/` publicPath to `./` relative) and
// `await import()` the loader, so Bun's real ESM loader resolves the split graph from disk and executes
// it with the happy-dom globals present. It runs in a SUBPROCESS so setting global `window` can't
// pollute the shared test process (which would flip the isomorphic side-detection and break other tests).

import { expect, test } from 'bun:test'

// A subprocess snippet: fetch the served client module graph (loader entry + every referenced chunk),
// rewrite the `/__abide/chunk/` publicPath to a `./`-relative one, write each file into `dir`, and
// `await import()` the loader so Bun executes the REAL built graph (dynamic page-chunk import resolves
// from disk) with the happy-dom globals already installed. Returns after the boot microtasks settle.
const MATERIALIZE = `
async function runBuiltClient(url, ssr, dir) {
  const entryMatch = ssr.match(/src="(\\/__abide\\/chunk\\/[^"]+\\.js)"/);
  if (!entryMatch) throw new Error("no client loader script in SSR document");
  const entry = entryMatch[1];
  const seen = new Set();
  const queue = [entry];
  let loaderName = entry.split("/").pop();
  while (queue.length) {
    const u = queue.pop();
    if (seen.has(u)) continue;
    seen.add(u);
    const text = await (await fetch(url + u)).text();
    for (const m of text.matchAll(/\\/__abide\\/chunk\\/[^"'()\\s]+\\.js/g)) queue.push(m[0]);
    await Bun.write(dir + "/" + u.split("/").pop(), text.replaceAll("/__abide/chunk/", "./"));
  }
  await import(dir + "/" + loaderName);
  await new Promise((r) => setTimeout(r, 60));
}
`

const HELPER = (dir: string, servePath: string) => `
import { Window } from "happy-dom";
import { serve } from ${JSON.stringify(servePath)};
${MATERIALIZE}
await Bun.write(${JSON.stringify(dir)} + "/src/ui/pages/page.abide", "<script>import { state } from 'abide/ui/state'; let count = state(0)</script><button onclick={() => count++}>Count: {count}</button>");
await Bun.write(${JSON.stringify(dir)} + "/src/app.ts", "export const middleware = []\\n");
const { url, stop } = await serve(${JSON.stringify(dir)}, { dev: true });
// Fetch the SSR + client graph BEFORE polluting globals; the server stays up so the graph fetch works.
const ssr = await (await fetch(url + "/")).text();
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
try { await runBuiltClient(url, ssr, ${JSON.stringify(dir)} + "/built"); }
catch (e) { threw = e.message || String(e); }
await stop();
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
// the client; dev does not. Prove (a) minification actually engaged (the prod client graph is
// materially smaller than the same app's dev graph) and (b) the MINIFIED build still attach-hydrates
// and stays interactive in a real browser env — the production path is otherwise untested (every other
// browser test serves `dev: true`).
const MINIFY_HELPER = (dir: string, servePath: string) => `
import { Window } from "happy-dom";
import { serve } from ${JSON.stringify(servePath)};
${MATERIALIZE}
// Sum every served client JS file (loader + all chunks) — the whole split graph's bytes.
async function graphBytes(url, ssr) {
  const entry = ssr.match(/src="(\\/__abide\\/chunk\\/[^"]+\\.js)"/)[1];
  const seen = new Set(); const queue = [entry]; let total = 0;
  while (queue.length) { const u = queue.pop(); if (seen.has(u)) continue; seen.add(u);
    const t = await (await fetch(url + u)).text(); total += t.length;
    for (const m of t.matchAll(/\\/__abide\\/chunk\\/[^"'()\\s]+\\.js/g)) queue.push(m[0]); }
  return total;
}
await Bun.write(${JSON.stringify(dir)} + "/src/ui/pages/page.abide", "<script>import { state } from 'abide/ui/state'; let count = state(0)</script><button onclick={() => count++}>Count: {count}</button>");
await Bun.write(${JSON.stringify(dir)} + "/src/app.ts", "export const middleware = []\\n");
const dev = await serve(${JSON.stringify(dir)}, { dev: true });
const devSsr = await (await fetch(dev.url + "/")).text();
const devBytes = await graphBytes(dev.url, devSsr);
await dev.stop();
const prod = await serve(${JSON.stringify(dir)}, { dev: false });
const ssr = await (await fetch(prod.url + "/")).text();
const prodBytes = await graphBytes(prod.url, ssr);
if (!(prodBytes < devBytes * 0.9)) { console.log("RESULT: not-minified prod=" + prodBytes + " dev=" + devBytes); await prod.stop(); process.exit(6); }
const win = new Window({ url: prod.url + "/" });
const g = globalThis;
for (const k of ["window","document","location","navigator","history","Element","Node","Event","HTMLElement"]) g[k] = win[k] ?? g[k];
g.window = win;
win.document.body.innerHTML = (ssr.match(/<body>([\\s\\S]*)<\\/body>/) || [,ssr])[1];
const serverBtn = win.document.body.querySelector("button");
if (!serverBtn) { console.log("RESULT: no-server-dom"); await prod.stop(); process.exit(3); }
let threw = "";
try { await runBuiltClient(prod.url, ssr, ${JSON.stringify(dir)} + "/built"); }
catch (e) { threw = e.message || String(e); }
await prod.stop();
if (threw) { console.log("THREW: " + threw); process.exit(1); }
const sameNode = win.document.body.querySelector("button") === serverBtn;
const before = (win.document.body.textContent.match(/Count:\\s*\\d+/)||[])[0];
serverBtn.click(); await Promise.resolve(); await new Promise(r=>setTimeout(r,20));
const after = (win.document.body.textContent.match(/Count:\\s*\\d+/)||[])[0];
if (!sameNode) { console.log("RESULT: recreated-not-claimed"); process.exit(4); }
if (before === "Count: 0" && after === "Count: 1") { console.log("RESULT: minified-attached-interactive"); process.exit(0); }
console.log("RESULT: not-interactive before=" + before + " after=" + after); process.exit(2);
`

test('production (minified) client is smaller AND still attach-hydrates + stays interactive', async () => {
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
// since the server is already stopped) and the rpc-call count would be non-zero. (The client graph is
// materialized BEFORE the fetch spy is installed, so fetching the chunks isn't miscounted as an RPC.)
const SEED_HELPER = (dir: string, servePath: string, getPath: string) => `
import { Window } from "happy-dom";
import { serve } from ${JSON.stringify(servePath)};
${MATERIALIZE}
await Bun.write(${JSON.stringify(dir)} + "/src/server/rpc/greet.ts", "import { GET } from " + ${JSON.stringify(JSON.stringify(getPath))} + "\\nexport default GET(({ name }) => 'hi ' + name)\\n");
await Bun.write(${JSON.stringify(dir)} + "/src/ui/pages/page.abide", "<script>import greet from '../../server/rpc/greet'</script><p>{await greet({name:'ada'})}</p>");
await Bun.write(${JSON.stringify(dir)} + "/src/app.ts", "export const middleware = []\\n");
const { url, stop } = await serve(${JSON.stringify(dir)}, { dev: true });
const ssr = await (await fetch(url + "/")).text();
if (!ssr.includes("hi ada")) { console.log("RESULT: ssr-missing-value"); await stop(); process.exit(3); }
// Pre-materialize the client graph to disk (real fetch) BEFORE installing the RPC fetch spy.
const builtDir = ${JSON.stringify(dir)} + "/built";
{
  const entry = ssr.match(/src="(\\/__abide\\/chunk\\/[^"]+\\.js)"/)[1];
  const seen = new Set(); const queue = [entry];
  while (queue.length) { const u = queue.pop(); if (seen.has(u)) continue; seen.add(u);
    const t = await (await fetch(url + u)).text();
    for (const m of t.matchAll(/\\/__abide\\/chunk\\/[^"'()\\s]+\\.js/g)) queue.push(m[0]);
    await Bun.write(builtDir + "/" + u.split("/").pop(), t.replaceAll("/__abide/chunk/", "./")); }
  globalThis.__abideLoader = builtDir + "/" + entry.split("/").pop();
}
await stop();
const win = new Window({ url: url + "/" });
const g = globalThis;
for (const k of ["window","document","location","navigator","history","Element","Node","Event","HTMLElement"]) g[k] = win[k] ?? g[k];
g.window = win;
// Fetch spy: any /rpc/ hit means the client re-fetched instead of using the seed.
let rpcCalls = 0;
g.fetch = (u, ...a) => { if (String(u).includes("/rpc/")) { rpcCalls++; return Promise.resolve(new Response('"REFETCHED"', { status: 200, headers: { "content-type": "application/json" } })); } return Promise.reject(new Error("unexpected fetch " + u)); };
win.document.body.innerHTML = (ssr.match(/<body>([\\s\\S]*)<\\/body>/) || [,ssr])[1];
let threw = "";
try { await import(globalThis.__abideLoader); await new Promise(r=>setTimeout(r,60)); }
catch (e) { threw = e.message || String(e); }
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
