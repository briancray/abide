// M5a — server-side page SSR. A `page.abide` source served as a full HTML document via the router,
// with in-proc RPC reads (cell) during render and route() available in the template. Pages run
// through the middleware onion like any request.

import { expect, test } from "bun:test";
import { createTestApp } from "../test/createTestApp.ts";
import { GET } from "../server/GET.ts";
import { error } from "../server/error.ts";
import { documentHead, documentTail, renderDocument, warmPages } from "../server/internal/pages.ts";
import type { HydrationSeed, RenderDocumentOptions } from "../server/internal/pages.ts";
import { loadEmittedServer } from "../ui/internal/emit.ts";
import type { Middleware } from "../server/internal/middleware.ts";

// Streaming SSR (PR1/PR2) — the head/tail seam must compose back to the byte-identical buffered doc.
test("documentHead + inner + documentTail is byte-identical to renderDocument across opts", () => {
  const seed: HydrationSeed = { reads: [{ name: "greet", args: { name: "a" }, value: "hi a" }], states: [1] };
  const cases: Array<{ inner: string; opts?: RenderDocumentOptions }> = [
    { inner: "<h1>plain</h1>" },
    { inner: "<p>seeded</p>", opts: { seed } },
    { inner: "<p>styled</p>", opts: { styles: true, seed } },
    { inner: "<p>dev</p>", opts: { devReloadScript: "console.log(1)", seed, styles: true } },
    { inner: "<p>t</p>", opts: { title: "Title & <thing>" } },
  ];
  for (const { inner, opts } of cases) {
    expect(documentHead(opts) + inner + documentTail(opts?.seed, opts)).toBe(renderDocument(inner, opts));
  }
});

// SSR HTML now carries the client skeleton's comment anchors; strip them for structural assertions.
function stripAnchors(html: string): string {
  return html.replace(/<!--\[-->|<!--\]-->|<!---->/g, "");
}

test("SSRs a page as a full HTML document with an in-proc RPC read", async () => {
  const app = createTestApp({
    routes: { greet: GET(({ name }: { name: string }) => "hi " + name) },
    pages: {
      "/": "<script>import { state } from 'abide/ui/state'; import greet from '../../server/rpc/greet'; let title = state('Home')</script><main><h1>{title}</h1><p>{await greet({name:'ada'})}</p></main>",
    },
  });

  const response = await app.fetch("/");
  expect(response.status).toBe(200);
  expect(response.headers.get("content-type")).toContain("text/html");

  const body = await response.text();
  expect(body).toContain("<!doctype html>");
  expect(body).toContain('<div id="__abide-app">');
  expect(stripAnchors(body)).toContain("<h1>Home</h1>");
  expect(body).toContain("hi ada");

  await app.stop();
});

test("a fast {#await} block renders inline — no placeholder/patch (PR2 deadline)", async () => {
  const app = createTestApp({
    routes: { quick: GET(() => "INLINE") },
    pages: {
      "/": "<script>import quick from '../../server/rpc/quick'</script><main>{#await quick()}<span>loading</span>{:then v}<b>{v}</b>{/await}</main>",
    },
  });

  const body = await (await app.fetch("/")).text();
  // A read that settles within the macrotask deadline renders inline — byte-identical shape to before.
  expect(stripAnchors(body)).toContain("<b>INLINE</b>");
  expect(body).not.toContain("abide-slot");
  expect(body).not.toContain("data-ab-patch");
  expect(body).not.toContain("loading");

  await app.stop();
});

test("a slow {#await} block streams as an out-of-order patch (PR2)", async () => {
  const app = createTestApp({
    routes: {
      slow: GET(async () => {
        await new Promise((resolve) => setTimeout(resolve, 15));
        return "PATCHED";
      }),
    },
    pages: {
      "/": "<script>import slow from '../../server/rpc/slow'</script><main>{#await slow()}<span>loading</span>{:then v}<b>{v}</b>{/await}</main>",
    },
  });

  const body = await (await app.fetch("/")).text();
  // The shell flushes the placeholder slot with the pending fallback...
  expect(body).toContain('<abide-slot id="ab-p:0"');
  expect(body).toContain("loading");
  // ...and the resolved value arrives LATER as an out-of-order <template> patch + move-script.
  expect(body).toContain('<template data-ab-patch="0">');
  expect(stripAnchors(body)).toContain("<b>PATCHED</b>");
  expect(body).toContain("$abidePatch(0)");
  // Ordering: the slot precedes its patch, and the value streamed (only inside the patch, not the shell).
  expect(body.indexOf('<abide-slot id="ab-p:0"')).toBeLessThan(body.indexOf('<template data-ab-patch="0">'));
  expect(body.indexOf("PATCHED")).toBeGreaterThan(body.indexOf('<template data-ab-patch="0">'));

  await app.stop();
});

test("a fast {#await} error with no {:catch} → controlled 500 before first flush (PR5)", async () => {
  const app = createTestApp({
    routes: {
      boom: GET(() => {
        throw new Error("kaboom");
      }),
    },
    pages: {
      "/": "<script>import boom from '../../server/rpc/boom'</script><main>{#await boom()}<span>loading</span>{:then v}<b>{v}</b>{/await}</main>",
    },
  });

  // The read settles (rejects) within the deadline, so it renders inline; with no {:catch} that rethrows
  // BEFORE the shell flushes → a controlled 500 (the TODO #7 guarantee holds for streaming forms too).
  const response = await app.fetch("/");
  expect(response.status).toBe(500);

  await app.stop();
});

test("a slow {#await} error WITH {:catch} streams the catch branch as a patch (PR5)", async () => {
  const app = createTestApp({
    routes: {
      slowBoom: GET(async () => {
        await new Promise((resolve) => setTimeout(resolve, 15));
        throw new Error("slow-kaboom");
      }),
    },
    pages: {
      "/": "<script>import slowBoom from '../../server/rpc/slowBoom'</script><main>{#await slowBoom()}<span>loading</span>{:then v}<b>{v}</b>{:catch e}<i>{e.message}</i>{/await}</main>",
    },
  });

  const response = await app.fetch("/");
  expect(response.status).toBe(200); // shell already flushed — the error rides in as a patch, not a 500
  const body = await response.text();
  expect(body).toContain('<abide-slot id="ab-p:0"'); // placeholder in the shell
  expect(body).toContain('<template data-ab-patch="0">'); // the {:catch} branch streamed as a patch
  expect(stripAnchors(body)).toContain("slow-kaboom");

  await app.stop();
});

test("a slow {#await} error with NO {:catch} → 200 with an empty patch that clears the slot (PR5)", async () => {
  const app = createTestApp({
    routes: {
      slowBoom: GET(async () => {
        await new Promise((resolve) => setTimeout(resolve, 15));
        throw new Error("uncaught-stream-error");
      }),
    },
    pages: {
      "/": "<script>import slowBoom from '../../server/rpc/slowBoom'</script><main>{#await slowBoom()}<span>loading</span>{:then v}<b>{v}</b>{/await}</main>",
    },
  });

  const response = await app.fetch("/");
  expect(response.status).toBe(200); // headers already flushed → cannot 500; the subtree degrades
  const body = await response.text();
  // An empty patch clears the pending fallback rather than leaving a stuck spinner (server also logs).
  expect(body).toContain('<template data-ab-patch="0"></template>');

  await app.stop();
});

// (Fast/synchronous `{#for await}` draining inline — byte-identical to the buffered path — is proven by
// the emit oracle's `for await` fixtures via the no-stream-scope full drain; not re-tested here because
// createTestApp's cold first-compile can elapse the 4ms deadline before render, deferring even a fast
// stream. The real app warms pages, so the deadline is meaningful.)

test("a slow {#for await} streams items as append-patches then marks complete (PR6)", async () => {
  const app = createTestApp({
    pages: {
      "/": "<script>const slowGen = async function*(){ for (const l of ['a','b','c']){ await new Promise((r)=>setTimeout(r,15)); yield l } }</script><main>{#for await chunk of slowGen()}<span>{chunk}</span>{/for}</main>",
    },
  });

  const body = await (await app.fetch("/")).text();
  // The shell flushes the empty list container, then each item streams as an append-patch...
  expect(body).toContain('<abide-list id="ab-l:0"');
  expect(body).toContain('<template data-ab-append="0">');
  expect(body).toContain("$abideAppend(0)");
  expect(stripAnchors(body)).toContain("<span>a</span>");
  expect(stripAnchors(body)).toContain("<span>c</span>");
  // ...and the source ended within the budget → a complete marker (the client will CLAIM the items).
  expect(body).toContain("$abideDone(0)");

  await app.stop();
});

test("route() is available inside a page template (kind = nav)", async () => {
  const app = createTestApp({
    pages: { "/x": "<script>import { route } from 'abide/shared/route'</script><span>{route().kind}</span>" },
  });

  const response = await app.fetch("/x");
  expect(response.status).toBe(200);
  const body = await response.text();
  expect(stripAnchors(body)).toContain("<span>nav</span>");

  await app.stop();
});

test("an unknown path still 404s; RPC + openapi unaffected", async () => {
  const app = createTestApp({
    routes: { greet: GET(({ name }: { name: string }) => "hi " + name) },
    pages: { "/": "<h1>ok</h1>" },
  });

  const notFound = await app.fetch("/nope");
  expect(notFound.status).toBe(404);

  const rpcResponse = await app.fetch("/rpc/greet?args=" + encodeURIComponent(JSON.stringify({ name: "z" })));
  expect(rpcResponse.status).toBe(200);
  expect(await rpcResponse.json()).toBe("hi z");

  const openapi = await app.fetch("/openapi.json");
  expect(openapi.status).toBe(200);
  expect((await openapi.json()).openapi).toBe("3.1.0");

  await app.stop();
});

test("warmPages pre-compiles every page + layout so first-hit SSR is cache-warm", async () => {
  // Unique sources so the module cache starts cold for this test (the caches are module-global).
  const page = "<p>warm-page-3f9a</p>";
  const layout = "<section>warm-layout-3f9a {children()}</section>";

  await warmPages({
    pages: { "/warm": page },
    layouts: { "/": layout },
  });

  // A warmed source resolves SYNCHRONOUSLY afterward: `Bun.peek` returns the settled module (not the
  // promise) only when warmPages already awaited the cold compile. A cold call would still be pending.
  for (const source of [page, layout]) {
    const pending = loadEmittedServer(source);
    const settled = Bun.peek(pending);
    expect(settled).not.toBe(pending); // settled → warm primed it (a cold compile would still be pending)
    expect(typeof (settled as { render?: unknown }).render).toBe("function");
  }
});

test("warmPages is resilient — a broken page is logged and skipped, good pages still warm", async () => {
  // A component import with no source dir throws during emit; warmPages must catch it, not reject.
  const broken = "<script>import Missing from './Missing.abide'</script><Missing/>";
  const good = "<p>warm-good-7c2b</p>";

  await expect(warmPages({ pages: { "/broken": broken, "/good": good } })).resolves.toBeUndefined();

  const settled = Bun.peek(loadEmittedServer(good));
  expect(typeof (settled as { render?: unknown }).render).toBe("function");
});

test("a short-circuiting middleware blocks the SSR page", async () => {
  const guard: Middleware = () => error(403, "nope");
  const app = createTestApp({
    middleware: [guard],
    pages: { "/": "<h1>secret</h1>" },
  });

  const response = await app.fetch("/");
  expect(response.status).toBe(403);
  const body = await response.text();
  expect(body).not.toContain("secret");

  await app.stop();
});
