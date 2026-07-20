// CLIENT SOFT-NAV (M5b / C6-nav) — SPA navigation under happy-dom.
//
// Wires a small multi-page app directly into the client page registry (as the real client bundle
// entry does), then drives navigate()/link clicks/param nav and asserts: the target page mounts into
// #__abide-app, history is pushed, the soft-nav fetch carries the `Abide-Nav` header, and the reactive
// route() (name/url/params) updates. fetch is stubbed to return the server's soft-nav JSON envelope.

import { afterEach, beforeEach, expect, test } from "bun:test";
import { bootstrapApp } from "./internal/bootstrap.ts";
import { mountPathname, navigate } from "./navigate.ts";
import { loadEmitted } from "./internal/emit.ts";
import { route } from "../shared/route.ts";
import { clearClientRoute, setClientRoute } from "../shared/internal/routeHolder.ts";
import type { PageEntry } from "./internal/pageRegistry.ts";

// The two-page (+ param) app: source keyed by route pattern, exactly like the client bundle ships one
// AOT-emitted `mount` per pattern.
const HOME_SOURCE = "<h1>Home page</h1>";
const ABOUT_SOURCE = "<h2>About page</h2>";
const USER_SOURCE = "<script>import { route } from 'abide/shared/route'</script><span>user {route().params.id}</span>";

// Compile a source to its emitted client `mount` + `hydrate`, as the bundle does at build time.
async function page(source: string): Promise<PageEntry> {
  const emitted = await loadEmitted(source);
  return { mount: emitted.mount, hydrate: emitted.hydrate };
}

// Populated in beforeEach (emit is async — it instantiates each page's client module once).
let PAGES: Record<string, PageEntry>;

// The inner HTML the server soft-nav envelope carries per path. PR7: the client now HYDRATES (claims)
// this HTML in place rather than fresh-mounting over it, so it must be the REAL anchored SSR output of
// the destination page (built from the emitted `render` below), not an anchor-free approximation.
let ENVELOPE_HTML: Record<string, string>;
// The initial document body's inner HTML for `#__abide-app` — the SSR'd home page the app hydrates on
// first load. Built from the home page's emitted `render` so its anchors match the hydrate walk.
let HOME_HTML: string;

let realFetch: typeof globalThis.fetch;
let realPushState: typeof history.pushState;
let fetchCalls: { url: string; nav: string | null }[];
let pushCalls: unknown[][];
let cleanupApp: () => void;

function tick(): Promise<void> {
  return Promise.resolve();
}

function container(): HTMLElement {
  return document.getElementById("__abide-app")!;
}

beforeEach(async () => {
  const home = await loadEmitted(HOME_SOURCE);
  const about = await loadEmitted(ABOUT_SOURCE);
  const user = await loadEmitted(USER_SOURCE);
  PAGES = {
    "/": { mount: home.mount, hydrate: home.hydrate },
    "/about": { mount: about.mount, hydrate: about.hydrate },
    "/users/[id]": { mount: user.mount, hydrate: user.hydrate },
  };

  // happy-dom defaults to about:blank (null origin); give it a real URL so location behaves like a
  // browser (the preload deletes the global `window`, so reach it via document.defaultView).
  (document.defaultView as unknown as { happyDOM: { setURL(url: string): void } }).happyDOM.setURL("http://localhost/");

  // Build the REAL anchored SSR HTML the client hydrates. Static pages render context-free; the
  // param page reads route() during render, so seed the client route to /users/42 for it, then reset.
  HOME_HTML = await home.render({});
  setClientRoute({ kind: "nav", name: "/users/[id]", params: { id: "42" }, url: new URL("http://localhost/users/42"), navigating: false });
  const userHtml = await user.render({ route });
  clearClientRoute();
  ENVELOPE_HTML = {
    "/about": await about.render({}),
    "/users/42": userHtml,
  };

  // The document arrives SSR'd: seed the container with the home page's server HTML so first-load
  // hydration has real DOM to CLAIM (rather than an empty container to fresh-mount into).
  document.body.innerHTML = `<div id="__abide-app">${HOME_HTML}</div>`;

  fetchCalls = [];
  realFetch = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.pathname : (input as Request).url;
    const nav = new Headers(init?.headers).get("Abide-Nav");
    fetchCalls.push({ url, nav });
    const pathname = new URL(url, location.origin).pathname;
    const html = ENVELOPE_HTML[pathname] ?? "<p>missing</p>";
    // The streamed soft-nav body (PR4): a JSONL frame stream — a `shell` frame then a `seed` frame.
    const body = `${JSON.stringify({ kind: "shell", html, url: pathname })}\n${JSON.stringify({ kind: "seed", seed: {} })}\n`;
    return new Response(body, { headers: { "content-type": "application/jsonl" } });
  }) as typeof globalThis.fetch;

  pushCalls = [];
  realPushState = history.pushState.bind(history);
  history.pushState = function (this: History, ...args: unknown[]): void {
    pushCalls.push(args);
    return (realPushState as (...a: unknown[]) => void)(...args);
  } as typeof history.pushState;

  cleanupApp = bootstrapApp(PAGES, {});
});

afterEach(() => {
  cleanupApp();
  globalThis.fetch = realFetch;
  history.pushState = realPushState;
  document.body.innerHTML = "";
  // The client-route holder is a module global; reset it so it doesn't leak into other test files
  // (where route() outside a request scope must still throw).
  clearClientRoute();
});

test("initial bootstrap mounts the page for the current location", () => {
  expect(container().textContent).toContain("Home page");
  expect(route().name).toBe("/");
  expect(route().url.pathname).toBe("/");
});

test("navigate() soft-loads the target page, pushes history, and updates route()", async () => {
  await navigate("/about");

  // The About page is mounted into the app container.
  expect(container().textContent).toContain("About page");
  expect(container().textContent).not.toContain("Home page");

  // History was pushed to the new path.
  expect(pushCalls.length).toBe(1);
  expect(location.pathname).toBe("/about");

  // The soft-nav fetch carried the Abide-Nav header naming the origin path.
  expect(fetchCalls.length).toBe(1);
  expect(fetchCalls[0]!.nav).toBe("/");

  // route() reflects the destination.
  expect(route().name).toBe("/about");
  expect(route().url.pathname).toBe("/about");
});

test("an internal <a> click is intercepted and drives a soft-nav (default prevented)", async () => {
  const anchor = document.createElement("a");
  anchor.setAttribute("href", "/about");
  anchor.textContent = "About";
  document.body.appendChild(anchor);

  const event = new MouseEvent("click", { bubbles: true, cancelable: true });
  anchor.dispatchEvent(event);

  // The click was intercepted (no full navigation) and a soft-nav fetch fired with the header.
  expect(event.defaultPrevented).toBe(true);
  expect(fetchCalls.length).toBe(1);
  expect(fetchCalls[0]!.nav).toBe("/");
  expect(fetchCalls[0]!.url).toContain("/about");

  // The soft-nav now consumes a streamed body (multiple async reads), so poll until it settles rather
  // than assuming a fixed number of microtask ticks.
  for (let i = 0; i < 50 && !container().textContent!.includes("About page"); i++) await tick();
  expect(container().textContent).toContain("About page");

  anchor.remove();
});

test("soft-nav HYDRATES (claims) the swapped destination DOM in place — not a fresh mount", async () => {
  // Reproduce softLoad's two steps directly (fetch is exercised by the tests above): swap the
  // destination's REAL server HTML into the container, then run the same mountPathname the soft-nav
  // uses. PR7 unifies soft-nav onto the hydrate path (decision 6), so the destination page must CLAIM
  // the just-swapped nodes — the SAME object survives — rather than clearing + cloning fresh.
  const c = container();
  c.innerHTML = ENVELOPE_HTML["/users/42"]!; // real anchored SSR of the param page
  const serverSpan = c.querySelector("span")!;

  const hydrated = mountPathname("/users/42");
  expect(hydrated).toBe(true);

  // Attach proof: the destination span is the SAME node the innerHTML swap produced (claimed, not
  // recreated by a fresh mount), and it carries the server-rendered param value.
  expect(container().querySelector("span")).toBe(serverSpan);
  expect(serverSpan.textContent).toContain("user 42");
  expect(route().params.id).toBe("42");
});

test("param navigation updates route().params", async () => {
  await navigate("/users/42");

  expect(route().name).toBe("/users/[id]");
  expect(route().params.id).toBe("42");
  expect(route().url.pathname).toBe("/users/42");
  expect(container().textContent).toContain("user 42");
});

import { registerPages } from "./internal/pageRegistry.ts";
import { isKnownPage } from "./navigate.ts";

test("isKnownPage: only real page patterns are soft-nav targets (not /openapi.json, /rpc/*)", () => {
  const stub = (): (() => void) => () => {};
  registerPages(
    {
      "/": { mount: stub, hydrate: stub },
      "/machines": { mount: stub, hydrate: stub },
      "/topics/[slug]": { mount: stub, hydrate: stub },
    },
    {},
  );
  expect(isKnownPage("/")).toBe(true);
  expect(isKnownPage("/machines")).toBe(true);
  expect(isKnownPage("/topics/hello")).toBe(true);
  expect(isKnownPage("/openapi.json")).toBe(false);
  expect(isKnownPage("/rpc/greet")).toBe(false);
  expect(isKnownPage("/__abide/mcp")).toBe(false);
  expect(isKnownPage("/nope")).toBe(false);
});
