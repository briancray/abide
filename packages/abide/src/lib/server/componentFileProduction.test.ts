// COMPONENTS-AS-`.abide`-FILES — PRODUCTION RESOLUTION (PR3 client bundle + PR4 SSR).
//
// A page that `import`s a real `.abide` component FROM DISK (resolved against its `pageDirs` dir),
// where the component itself imports a NESTED component and an RPC. Proves:
//   (1) SSR (`renderPage` via the app's `/` route) renders the composed HTML — the component's own
//       markup, the passed prop, the slot, and the nested component — resolved off the filesystem;
//   (2) the built client bundle (`buildClientBundle`) includes the component's AND nested component's
//       compiled mount code (Bun.build followed the rewritten import specifiers);
//   (3) an RPC imported ONLY inside the component still ships its client proxy spec (harvest folds in
//       the component modules' analyses).

import { afterAll, beforeAll, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createTestApp } from "../test/createTestApp.ts";
import { buildClientBundle } from "../server/internal/clientBundle.ts";
import { GET } from "../server/GET.ts";
import type { AppConfig } from "../server/internal/router.ts";

let fixtureDir: string;

// The page (source held inline; its dir is the on-disk fixture) imports the real component file.
const PAGE = `<script>import Card from "./Card.abide"</script><Card title="Hello"><p>slot-content</p></Card>`;

// The component: a prop + slot + a `state` counter (proves interactive mount code ships) + a NESTED
// component import + an RPC imported ONLY here (proves the harvest reaches component modules).
const CARD =
  `<script>` +
  `import { state } from "abide/ui/state";` +
  `import { props } from "abide/ui/props";` +
  `import Badge from "./Badge.abide";` +
  `import cardPing from "../../server/rpc/cardPing";` +
  `const { title } = props();` +
  `let count = state(7);` +
  `</script>` +
  `<section class="card"><h2>CARD_HEADING {title}</h2><Badge /><button onclick={() => count++}>{count}</button><div>{children()}</div></section>`;

const BADGE = `<span class="badge">BADGE_MARKER</span>`;

function config(): AppConfig {
  return {
    routes: { cardPing: GET(() => "pong") },
    pages: { "/": PAGE },
    pageDirs: { "/": fixtureDir },
  };
}

beforeAll(async () => {
  fixtureDir = await mkdtemp(join(tmpdir(), "abide-comp-fixture-"));
  await writeFile(join(fixtureDir, "Card.abide"), CARD);
  await writeFile(join(fixtureDir, "Badge.abide"), BADGE);
});

afterAll(async () => {
  await rm(fixtureDir, { recursive: true, force: true });
});

test("SSR (PR4): a page renders a `.abide` component resolved from disk, with prop + slot + nested component", async () => {
  const app = createTestApp(config());
  const response = await app.fetch("/");
  expect(response.status).toBe(200);
  const body = await response.text();

  // Component's own markup + the passed prop.
  expect(body).toContain("CARD_HEADING Hello");
  // The `state(7)` counter rendered its initial value.
  expect(body).toContain(">7<");
  // The slot content passed by the page.
  expect(body).toContain("slot-content");
  // The NESTED component (Badge) resolved relative to Card's own dir and rendered.
  expect(body).toContain("BADGE_MARKER");

  await app.stop();
});

test("client bundle (PR3): includes the component + nested-component mount code and the component-only RPC spec", async () => {
  const cfg = config();
  const bundle = await buildClientBundle(cfg);

  // The component's compiled client mount carries its template literal — its presence proves the
  // component module (not the raw `.abide`) was bundled via the rewritten import specifier.
  expect(bundle).toContain("CARD_HEADING");
  // The NESTED component was followed transitively (recursion) and bundled too.
  expect(bundle).toContain("BADGE_MARKER");
  // The RPC imported ONLY inside the component still ships its proxy spec (harvest folds in component
  // module analyses).
  expect(bundle).toContain("cardPing");
});
