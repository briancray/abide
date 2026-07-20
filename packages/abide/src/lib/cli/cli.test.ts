import { afterAll, describe, expect, test } from "bun:test";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { rm } from "node:fs/promises";
import { serve, type ServeResult } from "./serve.ts";
import { build, scaffold } from "./main.ts";

const FIXTURE_DIR = join(import.meta.dir, "../server/__fixtures__/app");

// SSR HTML now carries the client skeleton's comment anchors; strip them for structural assertions.
function stripAnchors(html: string): string {
  return html.replace(/<!--\[-->|<!--\]-->|<!---->/g, "");
}

const running: ServeResult[] = [];
const tempDirs: string[] = [];

function tempPath(prefix: string): string {
  const dir = join(tmpdir(), `abide-${prefix}-${Bun.randomUUIDv7()}`);
  tempDirs.push(dir);
  return dir;
}

afterAll(async () => {
  for (const app of running) await app.stop();
  for (const dir of tempDirs) await rm(dir, { recursive: true, force: true });
  await rm(join(FIXTURE_DIR, "dist"), { recursive: true, force: true });
});

describe("serve — boots a file-based project on a real port", () => {
  test("SSR page and RPC respond over real HTTP", async () => {
    const app = await serve(FIXTURE_DIR, {});
    running.push(app);

    expect(app.url).toMatch(/^http:\/\/localhost:\d+$/);

    const home = await fetch(app.url + "/");
    expect(home.status).toBe(200);
    expect(home.headers.get("content-type")).toContain("text/html");
    expect(stripAnchors(await home.text())).toContain("<h1>hi x</h1>");

    const query = `?args=${encodeURIComponent(JSON.stringify({ name: "world" }))}`;
    const greet = await fetch(`${app.url}/rpc/greet${query}`);
    expect(greet.status).toBe(200);
    expect(await greet.json()).toBe("hi world");
  });

  test("non-dev mode does not inject the live-reload snippet", async () => {
    const app = await serve(FIXTURE_DIR, {});
    running.push(app);
    const html = await (await fetch(app.url + "/")).text();
    expect(html).not.toContain("__abide_dev_reload");
  });
});

describe("serve dev — live-reload wiring", () => {
  test("dev mode injects the live-reload snippet into served HTML", async () => {
    const app = await serve(FIXTURE_DIR, { dev: true });
    running.push(app);
    const html = await (await fetch(app.url + "/")).text();
    expect(html).toContain('id="__abide-dev-reload"');
    expect(html).toContain("__abide_dev_reload");
    expect(html).toContain("/__abide/sockets");
  });
});

describe("scaffold — writes a minimal starter project", () => {
  test("creates the expected files with sane contents", async () => {
    const root = await scaffold(tempPath("scaffold"), "myapp");

    const page = Bun.file(join(root, "src/ui/pages/page.abide"));
    expect(await page.exists()).toBe(true);
    expect(await page.text()).toContain("greet(");

    const rpc = Bun.file(join(root, "src/server/rpc/greet.ts"));
    expect(await rpc.exists()).toBe(true);
    expect(await rpc.text()).toContain("GET(");

    const appModule = Bun.file(join(root, "src/app.ts"));
    expect(await appModule.exists()).toBe(true);
    expect(await appModule.text()).toContain("middleware");

    const configModule = Bun.file(join(root, "src/server/config.ts"));
    expect(await configModule.exists()).toBe(true);

    const pkg = await Bun.file(join(root, "package.json")).json();
    expect(pkg.name).toBe("myapp");
    expect(pkg.dependencies.abide).toBeDefined();
    expect(pkg.scripts.dev).toBe("abide dev");
    expect(pkg.scripts.build).toBe("abide build");
    expect(pkg.scripts.start).toBe("abide start");

    expect(await Bun.file(join(root, "tsconfig.json")).exists()).toBe(true);
  });
});

describe("build — content-addressed client bundle", () => {
  test("writes a bundle into dist/_app/<hash>/", async () => {
    const outDir = await build(FIXTURE_DIR);
    expect(outDir).toContain(join("dist", "_app"));

    const bundle = Bun.file(join(outDir, "client.js"));
    expect(await bundle.exists()).toBe(true);
    expect((await bundle.text()).length).toBeGreaterThan(0);

    const index = await Bun.file(join(outDir, "index.json")).json();
    expect(index.entry).toBe("client.js");
    expect(typeof index.hash).toBe("string");
    expect(index.hash.length).toBeGreaterThan(0);
  });
});
