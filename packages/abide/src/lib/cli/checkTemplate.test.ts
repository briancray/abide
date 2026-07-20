// Tests for `abide check` TEMPLATE type-flow (C10.2–6, TODO #11 PR1) — the `emitCheck` lowering.
//
// Same on-disk fixture style as check.test.ts, but the errors live in TEMPLATE expressions (not the
// script): RPC/loop/await/narrowing/annotations. Asserts the diagnostic maps to the `.abide` template
// line and that clean templates + narrowing pass.

import { test, expect, afterEach } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { check } from "./check.ts";

const TSCONFIG = JSON.stringify({
  compilerOptions: {
    lib: ["ESNext", "DOM"],
    target: "ESNext",
    module: "Preserve",
    moduleResolution: "bundler",
    moduleDetection: "force",
    allowImportingTsExtensions: true,
    noEmit: true,
    strict: true,
    noUnusedLocals: true,
    skipLibCheck: true,
    types: [],
  },
  include: ["src/**/*.ts"],
});

const cleanupDirs: string[] = [];
afterEach(() => {
  for (const dir of cleanupDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

async function makeProject(files: Record<string, string>): Promise<string> {
  const root = mkdtempSync(join(tmpdir(), "abide-check-tpl-"));
  cleanupDirs.push(root);
  await Bun.write(join(root, "tsconfig.json"), TSCONFIG);
  for (const [relative, content] of Object.entries(files)) await Bun.write(join(root, relative), content);
  return root;
}

test("a type error in a template interpolation is caught and mapped to the template line", async () => {
  const page =
    "<script>\n" + // 1
    "const count = 5\n" + // 2  (number)
    "</script>\n" + // 3
    "<p>{count.toUpperCase()}</p>\n"; // 4  number has no toUpperCase → TS2339 on line 4
  const root = await makeProject({ "src/ui/pages/p/page.abide": page });
  const result = await check(root);
  expect(result.ok).toBe(false);
  const diag = result.diagnostics.find((d) => d.code === 2339);
  expect(diag).toBeDefined();
  expect(diag!.line).toBe(4);
});

test("a `{#for}` loop variable is typed from the iterable", async () => {
  const page =
    "<script>\n" + // 1
    "const nums = [1, 2, 3]\n" + // 2  number[]
    "</script>\n" + // 3
    "<ul>{#for n of nums}<li>{n.toUpperCase()}</li>{/for}</ul>\n"; // 4  n is number → error
  const root = await makeProject({ "src/ui/pages/p/page.abide": page });
  const result = await check(root);
  expect(result.ok).toBe(false);
  expect(result.diagnostics.some((d) => d.code === 2339 && d.line === 4)).toBe(true);
});

test("a `{#await}` then-value is typed from the awaited promise", async () => {
  const page =
    "<script>\n" + // 1
    "async function load() { return 42 }\n" + // 2  Promise<number>
    "</script>\n" + // 3
    "<div>{#await load()}…{:then value}<b>{value.toUpperCase()}</b>{/await}</div>\n"; // 4 value:number → error
  const root = await makeProject({ "src/ui/pages/p/page.abide": page });
  const result = await check(root);
  expect(result.ok).toBe(false);
  expect(result.diagnostics.some((d) => d.code === 2339 && d.line === 4)).toBe(true);
});

test("control-flow narrowing in `{#if}` makes a valid template clean", async () => {
  const page =
    "<script>\n" +
    "const value: string | number = 'x'\n" +
    "</script>\n" +
    "<p>{#if typeof value === 'string'}{value.toUpperCase()}{:else}{value.toFixed(2)}{/if}</p>\n";
  const root = await makeProject({ "src/ui/pages/p/page.abide": page });
  const result = await check(root);
  expect(result.diagnostics).toEqual([]);
  expect(result.ok).toBe(true);
});

test("type annotations in template expressions type-check (verbatim copy)", async () => {
  const page =
    "<script>\n" +
    "const raw: unknown = 'hello'\n" +
    "</script>\n" +
    "<p>{(raw as string).toUpperCase()}</p>\n"; // valid: annotation narrows unknown → string
  const root = await makeProject({ "src/ui/pages/p/page.abide": page });
  const result = await check(root);
  expect(result.diagnostics).toEqual([]);
  expect(result.ok).toBe(true);
});

// A local `props` shim so the mkdtemp project resolves it (no abide node_modules here); `deriveProps`
// reads the `props<T>()` type argument textually regardless.
const PROPS_SHIM = "export function props<T = Record<string, unknown>>(): T { return {} as T }\n";

test("cross-file: a wrong-typed prop passed to a props<T>() component is caught", async () => {
  const files = {
    "src/lib/props.ts": PROPS_SHIM,
    "src/ui/components/Card.abide":
      "<script>import { props } from '../../lib/props.ts'\nconst { title = '', count = 0 } = props<{ title?: string; count?: number }>()</script><div>{title}{count}</div>\n",
    "src/ui/pages/p/page.abide": "<script>\nimport Card from '../../components/Card.abide'\n</script>\n<Card title=\"ok\" count={\"nope\"} />\n", // 4: count expects number
  };
  const root = await makeProject(files);
  const result = await check(root);
  expect(result.ok).toBe(false);
  expect(result.diagnostics.some((d) => d.line === 4 && d.file.endsWith("pages/p/page.abide"))).toBe(true);
});

test("cross-file: an unknown prop on a closed props<T>() component is caught", async () => {
  const files = {
    "src/lib/props.ts": PROPS_SHIM,
    "src/ui/components/Card.abide": "<script>import { props } from '../../lib/props.ts'\nconst { title = '' } = props<{ title?: string }>()</script><div>{title}</div>\n",
    "src/ui/pages/p/page.abide": "<script>\nimport Card from '../../components/Card.abide'\n</script>\n<Card bogus=\"x\" />\n", // 4: bogus not in props
  };
  const root = await makeProject(files);
  const result = await check(root);
  expect(result.diagnostics.some((d) => d.code === 2353 && d.line === 4)).toBe(true);
});

test("cross-file: valid props type-check clean; a bare props() component is open", async () => {
  const files = {
    "src/lib/props.ts": PROPS_SHIM,
    "src/ui/components/Card.abide": "<script>import { props } from '../../lib/props.ts'\nconst { title = '', count = 0 } = props<{ title?: string; count?: number }>()</script><div>{title}{count}</div>\n",
    "src/ui/components/Loose.abide": "<script>import { props } from '../../lib/props.ts'\nconst { name = '' } = props()</script><div>{name}</div>\n",
    "src/ui/pages/p/page.abide": "<script>\nimport Card from '../../components/Card.abide'\nimport Loose from '../../components/Loose.abide'\n</script>\n<Card title=\"hi\" count={3} /><Loose name=\"x\" anything={123} />\n",
  };
  const root = await makeProject(files);
  const result = await check(root);
  expect(result.diagnostics).toEqual([]);
  expect(result.ok).toBe(true);
});

test("a wrong RPC-style argument in a template call is caught", async () => {
  // A typed function imported into the script, called from the TEMPLATE with a wrong arg type.
  const files = {
    "src/lib/getUser.ts": "export function getUser(args: { id: string }): string { return args.id }\n",
    "src/ui/pages/p/page.abide":
      "<script>\n" + // 1
      "import { getUser } from '../../../lib/getUser.ts'\n" + // 2
      "</script>\n" + // 3
      "<p>{getUser({ id: 123 })}</p>\n", // 4  id:number not string → TS2322/2769 on line 4
  };
  const root = await makeProject(files);
  const result = await check(root);
  expect(result.ok).toBe(false);
  expect(result.diagnostics.some((d) => d.line === 4)).toBe(true);
});
