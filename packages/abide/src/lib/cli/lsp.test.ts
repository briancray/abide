// Tests for `abide lsp` (C10.7, PR3) — the PERSISTENT, buffer-aware `.abide` language server.
//
// Real-process integration: spawn `node lsp.ts` (the server runs under node — the tsgo `API` can't open
// its pipe under Bun) and drive it over stdio. Asserts LIVE diagnostics — a template type error on
// `didOpen`, then CLEARED on `didChange` to a fixed buffer (no save) — proving the in-memory overlay +
// warm engine, not the disk-only stub.

import { test, expect, afterEach } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";

const LSP = fileURLToPath(new URL("./lsp.ts", import.meta.url));

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
    skipLibCheck: true,
    types: [],
  },
  include: ["src/**/*.ts"],
});

const cleanupDirs: string[] = [];
afterEach(() => {
  for (const dir of cleanupDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function frame(message: object): string {
  const body = JSON.stringify(message);
  return `Content-Length: ${Buffer.byteLength(body)}\r\n\r\n${body}`;
}

function parseFrames(text: string): Array<Record<string, unknown>> {
  const messages: Array<Record<string, unknown>> = [];
  let cursor = 0;
  while (cursor < text.length) {
    const headerEnd = text.indexOf("\r\n\r\n", cursor);
    if (headerEnd === -1) break;
    const match = /Content-Length:\s*(\d+)/i.exec(text.slice(cursor, headerEnd));
    if (match === null) break;
    const length = Number(match[1]);
    const bodyStart = headerEnd + 4;
    messages.push(JSON.parse(text.slice(bodyStart, bodyStart + length)));
    cursor = bodyStart + length;
  }
  return messages;
}

test("persistent lsp: live template diagnostics on didOpen, cleared on didChange (unsaved fix)", async () => {
  const root = mkdtempSync(join(tmpdir(), "abide-lsp-"));
  cleanupDirs.push(root);
  writeFileSync(join(root, "tsconfig.json"), TSCONFIG);
  const pagePath = join(root, "src/ui/pages/p/page.abide");
  mkdirSync(dirname(pagePath), { recursive: true });
  const bad = "<script>\nconst n = 5\n</script>\n<p>{n.toUpperCase()}</p>\n"; // number has no toUpperCase → TS2339 in the TEMPLATE
  writeFileSync(pagePath, bad);
  const fixed = "<script>\nconst n = 'hi'\n</script>\n<p>{n.toUpperCase()}</p>\n"; // string → clean
  const uri = pathToFileURL(pagePath).href;

  const proc = Bun.spawn(["node", LSP], { cwd: root, stdin: "pipe", stdout: "pipe", stderr: "pipe" });
  proc.stdin.write(
    frame({ jsonrpc: "2.0", id: 1, method: "initialize", params: { rootUri: pathToFileURL(root).href } }) +
      frame({ jsonrpc: "2.0", method: "textDocument/didOpen", params: { textDocument: { uri, languageId: "abide", version: 1, text: bad } } }) +
      frame({ jsonrpc: "2.0", method: "textDocument/didChange", params: { textDocument: { uri, version: 2 }, contentChanges: [{ text: fixed }] } }) +
      frame({ jsonrpc: "2.0", method: "exit" }),
  );
  proc.stdin.end();
  const out = await new Response(proc.stdout).text();
  await proc.exited;

  const publishes = parseFrames(out).filter((m) => m.method === "textDocument/publishDiagnostics");
  const diagsOf = (m: Record<string, unknown> | undefined) => (m?.params as { diagnostics?: Array<{ code: number; source: string }> } | undefined)?.diagnostics ?? [];

  // didOpen → the template type error is reported (mapped to the .abide, source "abide").
  const withError = publishes.find((p) => diagsOf(p).length > 0);
  expect(withError).toBeDefined();
  expect(diagsOf(withError).some((d) => d.code === 2339 && d.source === "abide")).toBe(true);
  expect((withError!.params as { uri: string }).uri).toBe(uri);

  // didChange to the fixed (UNSAVED) buffer → diagnostics cleared (last publish is empty).
  expect(diagsOf(publishes[publishes.length - 1])).toEqual([]);
}, 30_000);

test("hover returns the TS type at a template position; definition jumps template → script decl", async () => {
  const root = mkdtempSync(join(tmpdir(), "abide-lsp-"));
  cleanupDirs.push(root);
  writeFileSync(join(root, "tsconfig.json"), TSCONFIG);
  const pagePath = join(root, "src/ui/pages/p/page.abide");
  mkdirSync(dirname(pagePath), { recursive: true });
  const page = "<script>\nconst count: number = 5\n</script>\n<p>{count.toFixed(2)}</p>\n"; // `count` used in the TEMPLATE
  writeFileSync(pagePath, page);
  const uri = pathToFileURL(pagePath).href;
  const at = { line: 3, character: 6 }; // the `count` inside `{count.toFixed(2)}`

  const proc = Bun.spawn(["node", LSP], { cwd: root, stdin: "pipe", stdout: "pipe", stderr: "pipe" });
  proc.stdin.write(
    frame({ jsonrpc: "2.0", id: 1, method: "initialize", params: { rootUri: pathToFileURL(root).href } }) +
      frame({ jsonrpc: "2.0", method: "textDocument/didOpen", params: { textDocument: { uri, languageId: "abide", version: 1, text: page } } }) +
      frame({ jsonrpc: "2.0", id: 2, method: "textDocument/hover", params: { textDocument: { uri }, position: at } }) +
      frame({ jsonrpc: "2.0", id: 3, method: "textDocument/definition", params: { textDocument: { uri }, position: at } }) +
      frame({ jsonrpc: "2.0", method: "exit" }),
  );
  proc.stdin.end();
  const out = await new Response(proc.stdout).text();
  await proc.exited;
  const messages = parseFrames(out);

  // Hover: the type of `count` (a template reference) is `number`.
  const hover = messages.find((m) => m.id === 2);
  const value = (hover!.result as { contents?: { value?: string } } | null)?.contents?.value ?? "";
  expect(value).toContain("number");

  // Definition: the template `count` resolves to its script declaration (line 1, mapped back to .abide).
  const definition = messages.find((m) => m.id === 3);
  const locations = definition!.result as Array<{ uri: string; range: { start: { line: number } } }> | null;
  expect(locations).not.toBeNull();
  expect(locations![0]!.uri).toBe(uri);
  expect(locations![0]!.range.start.line).toBe(1);
}, 30_000);

test("completion returns member entries; signature-help resolves the call parameters", async () => {
  const root = mkdtempSync(join(tmpdir(), "abide-lsp-"));
  cleanupDirs.push(root);
  writeFileSync(join(root, "tsconfig.json"), TSCONFIG);
  const pagePath = join(root, "src/ui/pages/p/page.abide");
  mkdirSync(dirname(pagePath), { recursive: true });
  const page = "<script>\nconst count: number = 5\n</script>\n<p>{count.toFixed(2)}</p>\n";
  writeFileSync(pagePath, page);
  const uri = pathToFileURL(pagePath).href;

  const proc = Bun.spawn(["node", LSP], { cwd: root, stdin: "pipe", stdout: "pipe", stderr: "pipe" });
  proc.stdin.write(
    frame({ jsonrpc: "2.0", id: 1, method: "initialize", params: { rootUri: pathToFileURL(root).href } }) +
      frame({ jsonrpc: "2.0", method: "textDocument/didOpen", params: { textDocument: { uri, languageId: "abide", version: 1, text: page } } }) +
      frame({ jsonrpc: "2.0", id: 4, method: "textDocument/completion", params: { textDocument: { uri }, position: { line: 3, character: 10 } } }) + // after `count.`
      frame({ jsonrpc: "2.0", id: 5, method: "textDocument/signatureHelp", params: { textDocument: { uri }, position: { line: 3, character: 18 } } }) + // inside `toFixed(2)`
      frame({ jsonrpc: "2.0", method: "exit" }),
  );
  proc.stdin.end();
  const messages = parseFrames(await new Response(proc.stdout).text());
  await proc.exited;

  // Completion: `number` members are offered.
  const completion = messages.find((m) => m.id === 4);
  const items = (completion!.result as { items?: Array<{ label: string }> } | null)?.items ?? [];
  expect(items.some((i) => i.label === "toFixed")).toBe(true);

  // Signature help: the resolved signature of `toFixed` names its parameter.
  const signatureHelp = messages.find((m) => m.id === 5);
  const label = (signatureHelp!.result as { signatures?: Array<{ label: string }> } | null)?.signatures?.[0]?.label ?? "";
  expect(label).toContain("fractionDigits");
}, 30_000);

test("find-references returns both the script declaration and the template usage", async () => {
  const root = mkdtempSync(join(tmpdir(), "abide-lsp-"));
  cleanupDirs.push(root);
  writeFileSync(join(root, "tsconfig.json"), TSCONFIG);
  const pagePath = join(root, "src/ui/pages/p/page.abide");
  mkdirSync(dirname(pagePath), { recursive: true });
  const page = "<script>\nconst count: number = 5\n</script>\n<p>{count.toFixed(2)}</p>\n";
  writeFileSync(pagePath, page);
  const uri = pathToFileURL(pagePath).href;

  const proc = Bun.spawn(["node", LSP], { cwd: root, stdin: "pipe", stdout: "pipe", stderr: "pipe" });
  proc.stdin.write(
    frame({ jsonrpc: "2.0", id: 1, method: "initialize", params: { rootUri: pathToFileURL(root).href } }) +
      frame({ jsonrpc: "2.0", method: "textDocument/didOpen", params: { textDocument: { uri, languageId: "abide", version: 1, text: page } } }) +
      frame({ jsonrpc: "2.0", id: 6, method: "textDocument/references", params: { textDocument: { uri }, position: { line: 3, character: 6 }, context: { includeDeclaration: true } } }) +
      frame({ jsonrpc: "2.0", method: "exit" }),
  );
  proc.stdin.end();
  const messages = parseFrames(await new Response(proc.stdout).text());
  await proc.exited;

  const references = messages.find((m) => m.id === 6)!.result as Array<{ uri: string; range: { start: { line: number } } }>;
  expect(references.every((r) => r.uri === uri)).toBe(true);
  const lines = references.map((r) => r.range.start.line).sort();
  expect(lines).toContain(1); // the `const count` declaration in the <script>
  expect(lines).toContain(3); // the `{count…}` usage in the template
}, 30_000);

test("persistent lsp: answers initialize with full-change sync + publishes clean for a valid page", async () => {
  const root = mkdtempSync(join(tmpdir(), "abide-lsp-"));
  cleanupDirs.push(root);
  writeFileSync(join(root, "tsconfig.json"), TSCONFIG);
  const pagePath = join(root, "src/ui/pages/ok/page.abide");
  mkdirSync(dirname(pagePath), { recursive: true });
  const clean = "<script>\nconst greeting = 'hi'\n</script>\n<h1>{greeting.toUpperCase()}</h1>\n";
  writeFileSync(pagePath, clean);
  const uri = pathToFileURL(pagePath).href;

  const proc = Bun.spawn(["node", LSP], { cwd: root, stdin: "pipe", stdout: "pipe", stderr: "pipe" });
  proc.stdin.write(
    frame({ jsonrpc: "2.0", id: 1, method: "initialize", params: { rootUri: pathToFileURL(root).href } }) +
      frame({ jsonrpc: "2.0", method: "textDocument/didOpen", params: { textDocument: { uri, languageId: "abide", version: 1, text: clean } } }) +
      frame({ jsonrpc: "2.0", method: "exit" }),
  );
  proc.stdin.end();
  const out = await new Response(proc.stdout).text();
  await proc.exited;

  const messages = parseFrames(out);
  const init = messages.find((m) => m.id === 1);
  expect((init!.result as { capabilities?: { textDocumentSync?: { change?: number } } }).capabilities?.textDocumentSync?.change).toBe(1);
  const publish = messages.find((m) => m.method === "textDocument/publishDiagnostics");
  expect((publish!.params as { diagnostics: unknown[] }).diagnostics).toEqual([]);
}, 30_000);
