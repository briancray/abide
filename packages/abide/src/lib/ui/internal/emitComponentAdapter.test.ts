// COMPONENT DEFAULT-ADAPTER UNIT TEST (Stage: components-as-files PR1).
//
// Every emitted `.abide` module now carries a trailing `export default` adapter reusing its own
// `mount`/`render`. This test drives the CLIENT adapter DIRECTLY (not via a consumer page): emit a
// component source, import its `default`, call it with `(props, childrenFn, parentScope)`, mount the
// returned Mountable into a happy-dom host, and assert composed output, `{children()}` slot rendering,
// and reference-site prop reactivity. Proves the adapter's calling convention + scope wiring in
// isolation, independent of the cross-file resolver (PR2).

import { describe, expect, test } from "bun:test";
import { pathToFileURL } from "node:url";
import { unlink } from "node:fs/promises";
import { emitModuleSource } from "./emit.ts";
import { signal } from "../../shared/internal/reactive.ts";
import type { Mountable } from "./runtime.ts";

function tick(): Promise<void> {
  return Promise.resolve();
}

type ComponentAdapter = (
  props: Record<string, unknown>,
  childrenFn: (() => Mountable) | null,
  parentScope: unknown,
) => Mountable;

// Emit a component source, write its CLIENT module (runtime rewritten to the sibling real runtime) to a
// temp file next to this test, and return its default adapter. The module stays resident after import,
// so the temp file is safe to unlink immediately.
async function loadClientDefault(source: string): Promise<ComponentAdapter> {
  const { client } = emitModuleSource(source);
  const src = client.replace('"abide/ui/internal/runtime"', '"./runtime.ts"');
  const file = `${import.meta.dir}/.emit-adapter-${crypto.randomUUID()}.client.ts`;
  await Bun.write(file, src);
  try {
    const mod = (await import(pathToFileURL(file).href)) as { default: ComponentAdapter };
    return mod.default;
  } finally {
    await unlink(file).catch(() => {});
  }
}

describe("component default adapter — client", () => {
  const SOURCE =
    `<script>import { props } from "abide/ui/props"; const p = props()</script>` +
    `<section><span>{p.title}</span><div>{children()}</div></section>`;

  test("mounts with props, renders the children slot, and reacts to a reference-site prop change", async () => {
    const adapter = await loadClientDefault(SOURCE);

    const title = signal("Hi");
    const propsObj: Record<string, unknown> = {};
    Object.defineProperty(propsObj, "title", { get: () => title(), enumerable: true });

    // The children factory yields a Mountable that inserts a marked text node (mirrors an inline
    // snippet / component `{children()}` slot on the client).
    const childrenFn = (): Mountable => ({
      mount(target: Node, anchor: Node | null) {
        const node = document.createTextNode("KID");
        target.insertBefore(node, anchor);
        return () => node.remove();
      },
    });

    const host = document.createElement("div");
    const mountable = adapter(propsObj, childrenFn, {});
    const dispose = mountable.mount(host, null);

    const span = host.querySelector("span")!;
    expect(span.textContent).toBe("Hi");
    // `{children()}` slot rendered inside the component's own <div>.
    expect(host.querySelector("div")!.textContent).toBe("KID");

    // Reference-site (`p.title`) prop read is reactive.
    title.set("Bye");
    await tick();
    expect(span.textContent).toBe("Bye");

    dispose();
    expect(host.textContent).toBe("");
  });

  test("parentScope is inherited via the prototype chain (component reads a caller-provided binding)", async () => {
    // The component references a bare identifier (`label`) it never imported → it resolves off scope,
    // which the adapter builds as `Object.create(parentScope)`. Proves contextual inheritance.
    const adapter = await loadClientDefault("<p>{label}</p>");
    const host = document.createElement("div");
    const mountable = adapter({}, null, { label: "from-parent" });
    mountable.mount(host, null);
    expect(host.querySelector("p")!.textContent).toBe("from-parent");
  });
});
