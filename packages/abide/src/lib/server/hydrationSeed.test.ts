// rpc-core §5 — hydration seed record/replay + §5.2 output-shaping.
//
// An SSR page that reads an RPC records that (name, args, value) into the `#__abide-seed` script
// (first load) and the soft-nav envelope (`Abide-Nav`), so the client replays it from cache instead
// of re-fetching. Recorded/wire values are trimmed to the declared output schema.

import { expect, test } from "bun:test";
import { createTestApp } from "../test/createTestApp.ts";
import { parseSoftNav } from "../test/parseSoftNav.ts";
import { GET } from "../server/GET.ts";

// The seed script embeds JSON with `<` escaped to `<`; parse it back the way the client does.
function readSeedFromDocument(html: string): { reads?: Array<{ name: string; args: unknown; value: unknown }> } {
  const match = html.match(/<script type="application\/json" id="__abide-seed">(.*?)<\/script>/s);
  expect(match).not.toBeNull();
  return JSON.parse(match![1]!);
}

test("SSR document records the resolved read into #__abide-seed", async () => {
  const app = createTestApp({
    routes: { greet: GET(({ name }: { name: string }) => "hi " + name) },
    pages: {
      "/": "<script>import greet from '../../server/rpc/greet'</script><p>{await greet({name:'ada'})}</p>",
    },
  });

  const html = await (await app.fetch("/")).text();
  const seed = readSeedFromDocument(html);
  expect(seed.reads).toEqual([{ name: "greet", args: { name: "ada" }, value: "hi ada" }]);

  await app.stop();
});

test("a read-free page still emits an empty seed", async () => {
  const app = createTestApp({ pages: { "/": "<h1>static</h1>" } });

  const html = await (await app.fetch("/")).text();
  expect(readSeedFromDocument(html)).toEqual({});

  await app.stop();
});

test("the soft-nav envelope carries the recorded read", async () => {
  const app = createTestApp({
    routes: { greet: GET(({ name }: { name: string }) => "hi " + name) },
    pages: {
      "/": "<script>import greet from '../../server/rpc/greet'</script><p>{await greet({name:'bo'})}</p>",
    },
  });

  const response = await app.fetch("/", { headers: { "Abide-Nav": "/other" } });
  const envelope = (await parseSoftNav(response)) as { seed: { reads?: Array<{ name: string; args: unknown; value: unknown }> } };
  expect(envelope.seed.reads).toEqual([{ name: "greet", args: { name: "bo" }, value: "hi bo" }]);

  await app.stop();
});

test("output-shaping trims the seed value to the declared output schema", async () => {
  const app = createTestApp({
    routes: {
      me: GET(() => ({ id: 1, name: "ada", passwordHash: "secret" }), {
        schemas: { output: { type: "object", properties: { id: { type: "number" }, name: { type: "string" } } } },
      }),
    },
    pages: {
      "/": "<script>import me from '../../server/rpc/me'</script><p>{await me({})}</p>",
    },
  });

  const html = await (await app.fetch("/")).text();
  const seed = readSeedFromDocument(html);
  expect(seed.reads?.[0]?.value).toEqual({ id: 1, name: "ada" });
  expect(JSON.stringify(seed)).not.toContain("passwordHash");

  await app.stop();
});

test("output-shaping drops undeclared fields on the RPC wire", async () => {
  const app = createTestApp({
    routes: {
      me: GET(() => ({ id: 1, name: "ada", passwordHash: "secret" }), {
        schemas: { output: { type: "object", properties: { id: { type: "number" }, name: { type: "string" } } } },
      }),
    },
  });

  const body = await (await app.fetch("/rpc/me?args=" + encodeURIComponent("{}"))).json();
  expect(body).toEqual({ id: 1, name: "ada" });

  await app.stop();
});

test("with no output schema the RPC wire value is unshaped", async () => {
  const app = createTestApp({
    routes: { me: GET(() => ({ id: 1, name: "ada", extra: "kept" })) },
  });

  const body = await (await app.fetch("/rpc/me?args=" + encodeURIComponent("{}"))).json();
  expect(body).toEqual({ id: 1, name: "ada", extra: "kept" });

  await app.stop();
});
