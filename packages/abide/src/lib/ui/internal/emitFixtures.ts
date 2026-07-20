// Shared `.abide` fixture corpus for the emit regression snapshot oracle (Stage 1).
//
// One-liner source strings covering every template/script capability, plus fresh-scope / interaction
// factories so the oracle can drive the emitted modules and snapshot their server HTML + client DOM.

import { signal } from "../../shared/internal/reactive.ts";
import type { Mountable } from "./runtime.ts";

export interface Fixture {
  name: string;
  src: string;
  kind: "template" | "script";
  // template kind:
  scope?: () => Record<string, unknown>;
  // script kind:
  props?: () => Record<string, unknown>;
  imports?: () => Record<string, unknown>;
  // parity toggles (default true for template; script client+server both default true):
  server?: boolean;
  client?: boolean;
  // client interaction; run identically on both hosts, then compared again:
  interact?: (host: HTMLElement, scope: Record<string, unknown>) => void | Promise<void>;
  // documented divergence from the (anchor-free, unscoped) interpreter:
  gap?: string;
  // fixture is expected to throw on render/mount (both sides):
  throws?: string;
}

function tick(): Promise<void> {
  return Promise.resolve();
}

// A component used by client component fixtures (mirrors renderClient.test.ts Card).
export const Card = (props: Record<string, unknown>, children: (() => Mountable) | null): Mountable => ({
  mount(target, anchor) {
    const div = document.createElement("div");
    div.className = "card";
    const title = document.createElement("h1");
    title.textContent = String(props.title);
    div.appendChild(title);
    const slot = document.createComment("slot");
    div.appendChild(slot);
    const childCleanup = children ? children().mount(div, null) : () => {};
    target.insertBefore(div, anchor);
    return () => {
      childCleanup();
      div.remove();
    };
  },
});

// A server-side Card (async, returns a string) mirroring renderServer.test.ts.
const serverCard = async (props: Record<string, unknown>, children: () => Promise<{ toString(): string }>) =>
  `<div class="card"><h1>${props.title}</h1>${await children()}</div>`;

export const FIXTURES: Fixture[] = [
  // --- text + interpolation --------------------------------------------------
  { name: "plain text", src: "hello world", kind: "template", scope: () => ({}) },
  { name: "interpolation", src: "Hi {name}!", kind: "template", scope: () => ({ name: "Bob" }) },
  { name: "interpolation escapes", src: "{value}", kind: "template", scope: () => ({ value: "<b>x</b>" }) },
  { name: "quotes/ampersands escaped", src: "{value}", kind: "template", scope: () => ({ value: `a & "b" 'c'` }) },
  { name: "undefined renders empty", src: "[{value}]", kind: "template", scope: () => ({ value: undefined }) },
  { name: "null renders empty", src: "[{value}]", kind: "template", scope: () => ({ value: null }) },
  { name: "zero and false", src: "{a}/{b}", kind: "template", scope: () => ({ a: 0, b: false }) },
  { name: "expression interpolation", src: "{a + b}", kind: "template", scope: () => ({ a: 2, b: 3 }) },
  { name: "globals under scope", src: "{String(n)}", kind: "template", scope: () => ({ n: 42 }) },

  // --- html() ----------------------------------------------------------------
  { name: "html() raw", src: "{html(markup)}", kind: "template", scope: () => ({ markup: "<b>hi</b>" }) },
  { name: "html() undefined", src: "{html(markup)}", kind: "template", scope: () => ({ markup: undefined }) },

  // --- await interpolation ---------------------------------------------------
  {
    name: "await interp escapes",
    src: "{await p}",
    kind: "template",
    scope: () => ({ p: Promise.resolve("<z>") }),
  },
  { name: "await interp value", src: "{await p}", kind: "template", scope: () => ({ p: Promise.resolve("ok") }) },

  // --- elements + attributes -------------------------------------------------
  { name: "static attribute", src: '<a href="/x">go</a>', kind: "template", scope: () => ({}) },
  { name: "static attr escaped", src: '<a title="a&b">x</a>', kind: "template", scope: () => ({}) },
  { name: "expr attr string", src: "<input type={t}>", kind: "template", scope: () => ({ t: "text" }) },
  { name: "expr attr false", src: "<input disabled={d}>", kind: "template", scope: () => ({ d: false }) },
  { name: "expr attr true", src: "<input disabled={d}>", kind: "template", scope: () => ({ d: true }) },
  { name: "expr attr null", src: "<input value={v}>", kind: "template", scope: () => ({ v: null }) },
  { name: "boolean static attr", src: '<input type="text" required>', kind: "template", scope: () => ({}) },
  { name: "event omitted server", src: "<button onclick={fn}>x</button>", kind: "template", scope: () => ({ fn: () => {} }), client: false },
  {
    name: "class directive truthy",
    src: '<div class="base" class:active={on}>x</div>',
    kind: "template",
    scope: () => ({ on: true }),
  },
  {
    name: "class directive falsy",
    src: '<div class="base" class:active={on}>x</div>',
    kind: "template",
    scope: () => ({ on: false }),
  },
  { name: "style directive", src: "<div style:color={c}>x</div>", kind: "template", scope: () => ({ c: "red" }) },
  {
    name: "multiple style directives",
    src: "<div style:color={c} style:margin={m}>x</div>",
    kind: "template",
    scope: () => ({ c: "red", m: "0" }),
  },
  {
    name: "spread attributes",
    src: "<div {...attrs}>y</div>",
    kind: "template",
    scope: () => ({ attrs: { id: "x", class: "c", hidden: true, onclick: () => {} } }),
  },
  { name: "bind:value server", src: "<input bind:value={v}>", kind: "template", scope: () => ({ v: "hello" }), client: false },
  { name: "bind:checked server", src: "<input bind:checked={c}>", kind: "template", scope: () => ({ c: true }), client: false },

  // --- void / nesting --------------------------------------------------------
  { name: "void element", src: "<br>", kind: "template", scope: () => ({}) },
  { name: "void with attr", src: "<img src={u}>", kind: "template", scope: () => ({ u: "/a.png" }) },
  { name: "self-closing void", src: "<hr/>", kind: "template", scope: () => ({}) },
  { name: "nested elements", src: "<div><span>{x}</span></div>", kind: "template", scope: () => ({ x: "hi" }) },

  // --- if --------------------------------------------------------------------
  { name: "if truthy", src: "{#if a}yes{/if}", kind: "template", scope: () => ({ a: true }) },
  { name: "if falsy", src: "{#if a}yes{/if}", kind: "template", scope: () => ({ a: false }) },
  { name: "if else", src: "{#if a}A{:else}B{/if}", kind: "template", scope: () => ({ a: false }) },
  { name: "else if", src: "{#if a}A{:else if b}B{:else}C{/if}", kind: "template", scope: () => ({ a: false, b: true }) },
  { name: "else if to else", src: "{#if a}A{:else if b}B{:else}C{/if}", kind: "template", scope: () => ({ a: false, b: false }) },

  // --- for -------------------------------------------------------------------
  { name: "for array", src: "{#for x of list}<li>{x}</li>{/for}", kind: "template", scope: () => ({ list: ["a", "b"] }) },
  { name: "for index", src: "{#for x, i of list}<li>{i}:{x}</li>{/for}", kind: "template", scope: () => ({ list: ["a", "b"] }) },
  { name: "for empty", src: "{#for x of list}<li>{x}</li>{/for}", kind: "template", scope: () => ({ list: [] }) },
  {
    name: "for destructure",
    src: "{#for { name } of list}<li>{name}</li>{/for}",
    kind: "template",
    scope: () => ({ list: [{ name: "a" }, { name: "b" }] }),
  },
  { name: "for await array", src: "{#for await x of src}<i>{x}</i>{/for}", kind: "template", scope: () => ({ src: [1, 2] }), client: false },
  {
    name: "for await catch",
    src: "{#for await x of src}<i>{x}</i>{:catch e}err:{e.message}{/for}",
    kind: "template",
    client: false,
    scope: () => ({
      src: (async function* () {
        yield "p";
        throw new Error("boom");
      })(),
    }),
  },
  { name: "for keyed by key", src: "{#for x of list by x}<li>{x}</li>{/for}", kind: "template", scope: () => ({ list: ["a", "b"] }) },
  {
    name: "for + prefix (outer scope)",
    src: "{#for x of list}{prefix}{x} {/for}",
    kind: "template",
    scope: () => ({ list: ["a"], prefix: ">" }),
  },

  // --- nested blocks ---------------------------------------------------------
  {
    name: "for in if in element (true)",
    src: "<ul>{#if show}{#for x of items}<li>{x}</li>{/for}{/if}</ul>",
    kind: "template",
    scope: () => ({ show: true, items: ["a", "b"] }),
  },
  {
    name: "for in if in element (false)",
    src: "<ul>{#if show}{#for x of items}<li>{x}</li>{/for}{/if}</ul>",
    kind: "template",
    scope: () => ({ show: false, items: ["a", "b"] }),
  },

  // --- await block -----------------------------------------------------------
  {
    name: "await then",
    src: "{#await p}loading{:then v}<span>{v}</span>{:catch e}<b>{e.message}</b>{/await}",
    kind: "template",
    scope: () => ({ p: Promise.resolve("hi") }),
    client: false,
  },
  {
    name: "await catch",
    src: "{#await p}loading{:then v}<span>{v}</span>{:catch e}<b>{e.message}</b>{/await}",
    kind: "template",
    scope: () => ({ p: Promise.reject(new Error("boom")) }),
    client: false,
  },
  {
    name: "await finally",
    src: "{#await p}{:then v}{v}{:finally}!{/await}",
    kind: "template",
    scope: () => ({ p: Promise.resolve("x") }),
    client: false,
  },

  // --- switch ----------------------------------------------------------------
  { name: "switch match", src: "{#switch n}{:case 1}one{:case 2}two{:default}other{/switch}", kind: "template", scope: () => ({ n: 2 }) },
  { name: "switch default", src: "{#switch n}{:case 1}one{:default}other{/switch}", kind: "template", scope: () => ({ n: 9 }) },
  { name: "switch no match", src: "{#switch n}{:case 1}one{/switch}", kind: "template", scope: () => ({ n: 9 }) },

  // --- try -------------------------------------------------------------------
  {
    name: "try catch",
    src: "{#try}{bad()}{:catch e}caught:{e.message}{/try}",
    kind: "template",
    scope: () => ({
      bad: () => {
        throw new Error("nope");
      },
    }),
  },
  { name: "try ok", src: "{#try}ok{:catch e}bad{/try}", kind: "template", scope: () => ({}) },
  { name: "try finally", src: "{#try}a{:catch e}b{:finally}!{/try}", kind: "template", scope: () => ({}) },

  // --- components ------------------------------------------------------------
  {
    name: "component props + children (server)",
    src: "<Card title={t}>inner {x}</Card>",
    kind: "template",
    server: true,
    client: false,
    scope: () => ({ Card: serverCard, t: "Hello", x: "body" }),
  },
  {
    name: "component spread (server)",
    src: "<Card {...data}/>",
    kind: "template",
    server: true,
    client: false,
    scope: () => ({ Card: async (props: Record<string, unknown>) => `<b>${props.a}-${props.b}</b>`, data: { a: 1, b: 2 } }),
  },
  {
    name: "component missing throws",
    src: "<Missing/>",
    kind: "template",
    scope: () => ({}),
    throws: "<Missing> is not a component in scope",
  },
  {
    name: "component props (client)",
    src: "<Card title={t} />",
    kind: "template",
    server: false,
    scope: () => ({ Card, t: "Hello" }),
  },
  {
    name: "component children slot (client)",
    src: "<Card title={t}>slotted {name}</Card>",
    kind: "template",
    server: false,
    scope: () => ({ Card, t: "Hi", name: "Bob" }),
  },

  // --- snippets --------------------------------------------------------------
  {
    name: "snippet defined and called",
    src: "{#snippet item(x)}<li>{x}</li>{/snippet}<ul>{item('a')}{item('b')}</ul>",
    kind: "template",
    scope: () => ({}),
  },
  {
    name: "snippet hoisted",
    src: "<ul>{item('a')}</ul>{#snippet item(x)}<li>{x}</li>{/snippet}",
    kind: "template",
    scope: () => ({}),
  },
  {
    name: "snippet not escaped",
    src: "{#snippet raw(v)}<b>{v}</b>{/snippet}{raw('hi')}",
    kind: "template",
    scope: () => ({}),
  },
  {
    name: "snippet client fragment",
    src: "{#snippet greeting(n)}Hi {n}!{/snippet}{greeting(name)}",
    kind: "template",
    server: false,
    scope: () => ({ name: "Bob" }),
  },

  // --- styles / scripts ------------------------------------------------------
  { name: "script emits nothing", src: "<script>let x = 1</script><p>{n}</p>", kind: "template", scope: () => ({ n: 5 }) },
  {
    name: "style scoped (#13)",
    src: "<style>.a{color:red}</style>",
    kind: "template",
    scope: () => ({}),
    gap: "#13 scoped styles intentionally rewrite the CSS selector; the no-op interpreter does not.",
  },
  {
    // #20: a scoped `<style>` with an actual element — proves the scope attribute (`data-ab-<hash>`)
    // is stamped on the element by BOTH emitters (server render + client DOM), so the rewritten
    // selector `.a[data-ab-<hash>]` matches during SSR/no-JS and after hydration, not just on a
    // fresh client mount.
    name: "style scoped element (#13/#20)",
    src: '<div class="a">x</div><style>.a{color:red}</style>',
    kind: "template",
    scope: () => ({}),
    gap: "#13 scoped styles rewrite the selector and stamp the element; the no-op interpreter does neither.",
  },

  // --- reactive (client interaction) ----------------------------------------
  {
    name: "reactive text node",
    src: "count: {count}",
    kind: "template",
    server: false,
    scope: () => {
      const count = signal(1);
      const s: Record<string, unknown> = { __count: count };
      Object.defineProperty(s, "count", { get: () => count() });
      return s;
    },
    interact: (_host, s) => {
      (s.__count as ReturnType<typeof signal>).set(2);
      return tick();
    },
  },
  {
    name: "reactive attribute",
    src: "<div class={cls}></div>",
    kind: "template",
    server: false,
    scope: () => {
      const cls = signal("one");
      const s: Record<string, unknown> = { __cls: cls };
      Object.defineProperty(s, "cls", { get: () => cls() });
      return s;
    },
    interact: (_host, s) => {
      (s.__cls as ReturnType<typeof signal>).set("two");
      return tick();
    },
  },
  {
    name: "reactive if toggle",
    src: "{#if show}<p>yes</p>{/if}",
    kind: "template",
    server: false,
    scope: () => {
      const show = signal(false);
      const s: Record<string, unknown> = { __show: show };
      Object.defineProperty(s, "show", { get: () => show() });
      return s;
    },
    interact: (_host, s) => {
      (s.__show as ReturnType<typeof signal>).set(true);
      return tick();
    },
  },
  {
    name: "reactive keyed reorder",
    src: "{#for item of items by item.id}<li>{item.id}</li>{/for}",
    kind: "template",
    server: false,
    scope: () => {
      const items = signal([{ id: 1 }, { id: 2 }, { id: 3 }]);
      const s: Record<string, unknown> = { __items: items };
      Object.defineProperty(s, "items", { get: () => items() });
      return s;
    },
    interact: (_host, s) => {
      (s.__items as ReturnType<typeof signal>).set([{ id: 3 }, { id: 1 }, { id: 2 }]);
      return tick();
    },
  },
  {
    name: "reactive switch",
    src: "{#switch v}{:case 1}one{:case 2}two{/switch}",
    kind: "template",
    server: false,
    scope: () => {
      const v = signal(1);
      const s: Record<string, unknown> = { __v: v };
      Object.defineProperty(s, "v", { get: () => v() });
      return s;
    },
    interact: (_host, s) => {
      (s.__v as ReturnType<typeof signal>).set(2);
      return tick();
    },
  },
  {
    name: "event click updates via signal",
    src: "<button onclick={inc}>{count}</button>",
    kind: "template",
    server: false,
    scope: () => {
      const count = signal(0);
      const s: Record<string, unknown> = { inc: () => count.set(count() + 1) };
      Object.defineProperty(s, "count", { get: () => count() });
      return s;
    },
    interact: async (host) => {
      host.querySelector("button")!.dispatchEvent(new Event("click"));
      await tick();
    },
  },
  {
    name: "await inline resolves",
    src: "{await p}",
    kind: "template",
    server: false,
    scope: () => ({ p: Promise.resolve("ok") }),
    interact: async () => {
      await tick();
      await tick();
    },
  },
  {
    name: "await block pending then",
    src: "{#await p}loading{:then v}{v}{/await}",
    kind: "template",
    server: false,
    scope: () => ({ p: Promise.resolve("done") }),
    interact: async () => {
      await tick();
      await tick();
    },
  },

  // --- assemble-level (script-bearing) --------------------------------------
  {
    name: "state drives text",
    src: "<script>import { state } from 'abide/ui/state'; let name = state('world')</script><h1>Hello {name}</h1>",
    kind: "script",
  },
  {
    name: "numeric state",
    src: "<script>import { state } from 'abide/ui/state'; let count = state(41)</script><span>{count + 1}</span>",
    kind: "script",
  },
  {
    name: "props destructuring",
    src: "<script>import { props } from 'abide/ui/props'; const {who} = props()</script>{who}",
    kind: "script",
    props: () => ({ who: "x" }),
  },
  {
    name: "computed from state",
    src: "<script>import { state } from 'abide/ui/state'; let n = state(2); const d = state.computed(()=>n*2)</script><span>{d}</span>",
    kind: "script",
  },
  {
    name: "const + function",
    src: "<script>const base = 10\nfunction plus(n){ return base + n }</script><span>{plus(5)}</span>",
    kind: "script",
  },
  {
    name: "injected import",
    src: "<script>import greet from 'greet'</script>{greet('bob')}",
    kind: "script",
    imports: () => ({ greet: (x: string) => "hi " + x }),
  },
  {
    name: "module script const",
    src: "<script module>const answer = 42</script><span>{answer}</span>",
    kind: "script",
  },
  {
    name: "multiple state vars",
    src: "<script>import { state } from 'abide/ui/state'; let a = state(1); let b = state(2)</script><span>{a + b}</span>",
    kind: "script",
  },
  {
    name: "event increments state",
    src: "<script>import { state } from 'abide/ui/state'; let count = state(0)</script><button onclick={() => count++}>+</button><span>{count}</span>",
    kind: "script",
    server: false,
    interact: async (host) => {
      host.querySelector("button")!.click();
      await tick();
    },
  },
  {
    name: "compound assignment",
    src: "<script>import { state } from 'abide/ui/state'; let count = state(0)</script><button onclick={() => count += 5}>+</button><span>{count}</span>",
    kind: "script",
    server: false,
    interact: async (host) => {
      host.querySelector("button")!.click();
      await tick();
    },
  },
  {
    name: "function handler mutates state",
    src: "<script>import { state } from 'abide/ui/state'\nlet count = state(0)\nfunction inc(){ count++ }</script><button onclick={inc}>+</button><span>{count}</span>",
    kind: "script",
    server: false,
    interact: async (host) => {
      host.querySelector("button")!.click();
      await tick();
    },
  },
  {
    name: "computed updates on state change",
    src: "<script>import { state } from 'abide/ui/state'; let n = state(2); const d = state.computed(()=>n*2)</script><button onclick={()=>n++}>+</button><span>{d}</span>",
    kind: "script",
    server: false,
    interact: async (host) => {
      host.querySelector("button")!.click();
      await tick();
    },
  },
  {
    name: "state drives if",
    src: "<script>import { state } from 'abide/ui/state'; let show = state(false)</script><button onclick={()=>show = true}>go</button>{#if show}<p>yes</p>{/if}",
    kind: "script",
    server: false,
    interact: async (host) => {
      host.querySelector("button")!.click();
      await tick();
    },
  },
  {
    name: "state.linked reseeds",
    src: "<script>import { state } from 'abide/ui/state'; let a = state(1); let b = state.linked(()=>a * 10)</script><button onclick={()=>a++}>+</button><span>{b}</span>",
    kind: "script",
    server: false,
    interact: async (host) => {
      host.querySelector("button")!.click();
      await tick();
    },
  },
];
