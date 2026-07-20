// §5 state-initializer record/replay — SERVER RECORDING (Stage 2, PR2, decision 10).
//
// An SSR page's `state(initial)` initials are recorded, in call order, into the hydration seed
// (`seed.states`) — the document's `#__abide-seed` script on first load and the soft-nav envelope on
// subsequent navigations — so the client seeds each cell with the value the server rendered with
// instead of re-evaluating a (possibly non-deterministic) initializer. Hydration behaviour is
// unchanged by this PR; only recording is added.

import { expect, test } from "bun:test";
import { createTestApp } from "../test/createTestApp.ts";
import { parseSoftNav } from "../test/parseSoftNav.ts";

function readSeedFromDocument(html: string): { reads?: unknown[]; states?: unknown[] } {
  const match = html.match(/<script type="application\/json" id="__abide-seed">(.*?)<\/script>/s);
  expect(match).not.toBeNull();
  return JSON.parse(match![1]!);
}

// The reactive text leaf renders as `<p>VALUE<!----></p>` (the `<!---->` is the client-skeleton anchor).
function readRenderedValue(html: string): string {
  const match = html.match(/<p>(.*?)<!---->/s);
  expect(match).not.toBeNull();
  return match![1]!;
}

test("SSR records a non-deterministic state initial into #__abide-seed, matching the rendered value", async () => {
  const app = createTestApp({
    pages: {
      "/": "<script>import { state } from 'abide/ui/state'; let t = state(Date.now())</script><p>{t}</p>",
    },
  });

  const html = await (await app.fetch("/")).text();
  const seed = readSeedFromDocument(html);

  // Exactly one state → one recorded initial.
  expect(Array.isArray(seed.states)).toBe(true);
  expect(seed.states!.length).toBe(1);
  expect(typeof seed.states![0]).toBe("number");
  // The recorded value is EXACTLY what the server rendered with (no desync): the seed value equals the
  // value the `{t}` leaf produced in the HTML.
  expect(String(seed.states![0])).toBe(readRenderedValue(html));

  await app.stop();
});

test("the soft-nav envelope carries the recorded state initials", async () => {
  const app = createTestApp({
    pages: {
      "/": "<script>import { state } from 'abide/ui/state'; let a = state(1); let b = state('two')</script><p>{a}{b}</p>",
    },
  });

  const response = await app.fetch("/", { headers: { "Abide-Nav": "/other" } });
  const envelope = (await parseSoftNav(response)) as { seed: { states?: unknown[] } };
  expect(envelope.seed.states).toEqual([1, "two"]);

  await app.stop();
});

test("a state-free page still emits an empty seed (no additive `states` key)", async () => {
  const app = createTestApp({ pages: { "/": "<h1>static</h1>" } });

  const html = await (await app.fetch("/")).text();
  expect(readSeedFromDocument(html)).toEqual({});

  await app.stop();
});

test("state initials are recorded RAW (pre-transform) so the client re-applies transform to match", async () => {
  const app = createTestApp({
    pages: {
      "/": "<script>import { state } from 'abide/ui/state'; let n = state(5, (v) => v + 1)</script><p>{n}</p>",
    },
  });

  const html = await (await app.fetch("/")).text();
  const seed = readSeedFromDocument(html);
  // Raw initial (5) is recorded, NOT the post-transform cell value (6) the server rendered — the client
  // calls `state(5, transform)` and re-applies the transform to reach 6.
  expect(seed.states).toEqual([5]);
  expect(readRenderedValue(html)).toBe("6");

  await app.stop();
});

test("a non-JSON-serializable state initial is recorded as null rather than crashing the render", async () => {
  const app = createTestApp({
    pages: {
      // BigInt is not JSON-serializable; recording it must not throw during seed serialisation.
      "/": "<script>import { state } from 'abide/ui/state'; let big = state(1n); let ok = state(7)</script><p>{ok}</p>",
    },
  });

  const response = await app.fetch("/");
  expect(response.status).toBe(200);
  const seed = readSeedFromDocument(await response.text());
  // Ordinal preserved: the non-serializable slot becomes null, the following slot keeps its value.
  expect(seed.states).toEqual([null, 7]);

  await app.stop();
});
