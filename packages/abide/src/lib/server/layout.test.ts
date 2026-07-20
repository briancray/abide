// TODO #7 — layout.abide wiring. A `layout.abide` at a directory wraps the pages at/below it, nested
// layouts compose outer→inner, and the page renders where a layout calls `{children()}`. Covers SSR
// composition (server), the hydration-seed record inside layouts, layout param/route() access, the
// isomorphic client compose+hydrate path, and back-compat (a directory with no layout renders bare).

import { describe, expect, test } from "bun:test";
import { createTestApp } from "../test/createTestApp.ts";
import { GET } from "../server/GET.ts";
import { loadEmitted } from "../ui/internal/emit.ts";
import { compose } from "../ui/internal/compose.ts";
import { Raw } from "../ui/internal/serverRuntime.ts";
import { signal } from "../shared/internal/reactive.ts";
import { layoutChain } from "./internal/layouts.ts";

// SSR HTML carries the client skeleton's comment anchors; strip them for structural assertions.
function stripAnchors(html: string): string {
  return html.replace(/<!--\[-->|<!--\]-->|<!---->/g, "");
}

function tick(): Promise<void> {
  return Promise.resolve();
}

describe("SSR — layout composition", () => {
  test("a root layout with {children()} wraps a page", async () => {
    const app = createTestApp({
      pages: { "/": "<p>page body</p>" },
      layouts: { "/": '<div class="chrome"><nav>NAV</nav>{children()}</div>' },
    });

    const body = stripAnchors(await (await app.fetch("/")).text());
    expect(body).toContain('<div class="chrome"><nav>NAV</nav><p>page body</p></div>');

    await app.stop();
  });

  test("nested layouts compose outermost → innermost around the page", async () => {
    const app = createTestApp({
      pages: { "/admin/users": "<p>USERS</p>" },
      layouts: {
        "/": "<root>{children()}</root>",
        "/admin": "<admin>{children()}</admin>",
      },
    });

    const body = stripAnchors(await (await app.fetch("/admin/users")).text());
    expect(body).toContain("<root><admin><p>USERS</p></admin></root>");

    await app.stop();
  });

  test("a directory with no layout still renders the page bare (back-compat)", async () => {
    const app = createTestApp({
      // A layout scoped to /admin must NOT wrap a page outside that subtree.
      pages: { "/other": "<p>OTHER</p>" },
      layouts: { "/admin": "<admin>{children()}</admin>" },
    });

    const body = stripAnchors(await (await app.fetch("/other")).text());
    expect(body).toContain("<p>OTHER</p>");
    expect(body).not.toContain("<admin>");

    await app.stop();
  });

  test("an RPC read inside a layout is recorded into the hydration seed", async () => {
    const app = createTestApp({
      routes: { banner: GET(() => "SALE") },
      pages: { "/": "<p>home</p>" },
      layouts: { "/": "<script>import banner from '../../server/rpc/banner'</script><header>{await banner({})}</header>{children()}" },
    });

    const html = await (await app.fetch("/")).text();
    expect(stripAnchors(html)).toContain("<header>SALE</header>");
    const match = html.match(/<script type="application\/json" id="__abide-seed">(.*?)<\/script>/s);
    const seed = JSON.parse(match![1]!) as { reads?: Array<{ name: string; args: unknown; value: unknown }> };
    expect(seed.reads).toEqual([{ name: "banner", args: {}, value: "SALE" }]);

    await app.stop();
  });

  test("route() params resolve inside a layout", async () => {
    const app = createTestApp({
      pages: { "/users/[id]": "<p>page</p>" },
      layouts: { "/": "<script>import { route } from 'abide/shared/route'</script><crumb>{route().params.id}</crumb>{children()}" },
    });

    const body = stripAnchors(await (await app.fetch("/users/42")).text());
    expect(body).toContain("<crumb>42</crumb>");
    expect(body).toContain("<p>page</p>");

    await app.stop();
  });
});

describe("layout error boundaries + module parity (TODO #7 follow-ups)", () => {
  test("a layout wrapping {children()} in {#try} contains a throwing inner page (200)", async () => {
    const app = createTestApp({
      pages: { "/": "<script>throw new Error('page boom')</script><p>never</p>" },
      layouts: { "/": "<root>{#try}{children()}{:catch e}<err>{e.message}</err>{/try}</root>" },
    });

    const response = await app.fetch("/");
    expect(response.status).toBe(200);
    const body = stripAnchors(await response.text());
    // The layout's catch branch renders instead of the page; the layout chrome is intact.
    expect(body).toContain("<root>");
    expect(body).toContain("<err>page boom</err>");
    expect(body).not.toContain("never");

    await app.stop();
  });

  test("a throwing page with NO {#try} boundary returns a controlled 500 (not Bun's default)", async () => {
    const app = createTestApp({
      pages: { "/": "<script>throw new Error('unhandled')</script><p>never</p>" },
      layouts: { "/": "<root>{children()}</root>" },
    });

    const response = await app.fetch("/");
    expect(response.status).toBe(500);

    await app.stop();
  });

  test("a layout's <script module> runs ONCE across two pages sharing it", async () => {
    // A distinct layout source (fresh module-cache key) with a module-scope counter. Module setup is
    // memoized once per emitted module, so both pages must render the SAME stamp — not 1 then 2.
    const key = "__abideT7moduleParity";
    (globalThis as Record<string, unknown>)[key] = 0;
    const layout = `<script module>let STAMP = ((globalThis["${key}"]) = (globalThis["${key}"]) + 1)</script><chrome>{STAMP}</chrome>{children()}`;
    const app = createTestApp({
      pages: { "/a": "<p>A</p>", "/b": "<p>B</p>" },
      layouts: { "/": layout },
    });

    const a = stripAnchors(await (await app.fetch("/a")).text());
    const b = stripAnchors(await (await app.fetch("/b")).text());
    expect(a).toContain("<chrome>1</chrome>");
    expect(a).toContain("<p>A</p>");
    expect(b).toContain("<chrome>1</chrome>"); // module body did NOT re-run for the second page
    expect(b).toContain("<p>B</p>");
    expect((globalThis as Record<string, unknown>)[key]).toBe(1);

    delete (globalThis as Record<string, unknown>)[key];
    await app.stop();
  });
});

describe("layoutChain — discovery + ordering", () => {
  test("selects applicable layouts on segment boundaries, ordered root → nearest", () => {
    const layouts = { "/": "R", "/admin": "A", "/admin/reports": "AR", "/blog": "B" };
    expect(layoutChain("/admin/reports/q3", layouts)).toEqual(["R", "A", "AR"]);
    expect(layoutChain("/admin", layouts)).toEqual(["R", "A"]);
    // "/administrators" must NOT match the "/admin" layout (segment boundary).
    expect(layoutChain("/administrators", layouts)).toEqual(["R"]);
    expect(layoutChain("/", layouts)).toEqual(["R"]);
  });
});

describe("client — compose hydrate claims layout + page DOM", () => {
  test("hydrating a composed layout+page claims the same page node and stays reactive", async () => {
    const layout = await loadEmitted('<div class="chrome"><nav>NAV</nav>{children()}</div>');
    const page = await loadEmitted("<p>Page {msg}</p>");

    const msg = signal("hi");
    const scope: Record<string, unknown> = {};
    Object.defineProperty(scope, "msg", { get: () => msg(), enumerable: true });

    // Server-render the composed tree (page wrapped in layout via the server children component).
    const pageHtml = await page.render(scope);
    const fullHtml = await layout.render({ ...scope, children: async () => new Raw(pageHtml) });

    const host = document.createElement("div");
    host.innerHTML = fullHtml;
    const serverNav = host.querySelector("nav");
    const serverP = host.querySelector("p");

    compose([layout, page]).hydrate(host, scope);

    // Same server nodes claimed (no recreate) and no write on hydration pass 1.
    expect(host.querySelector("nav")).toBe(serverNav);
    expect(host.querySelector("p")).toBe(serverP);
    expect(serverP!.textContent).toBe("Page hi");

    // A subsequent update mutates the SAME claimed page node in place.
    msg.set("bye");
    await tick();
    expect(host.querySelector("p")).toBe(serverP);
    expect(serverP!.textContent).toBe("Page bye");
  });
});
