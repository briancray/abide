import { afterAll, describe, expect, test } from "bun:test";
import { join } from "node:path";
import { rm } from "node:fs/promises";
import { bundled } from "../ui/bundled.ts";
import { onMenu } from "./onMenu.ts";
import { emitMenu } from "./emitMenu.ts";
import { bundle } from "../cli/main.ts";
import type { BundleWindow } from "./BundleWindow.ts";
import type { BundleMenu } from "./BundleMenu.ts";
import type { BundleMenuItem } from "./BundleMenuItem.ts";

const FIXTURE_DIR = join(import.meta.dir, "../server/__fixtures__/app");

afterAll(async () => {
  await rm(join(FIXTURE_DIR, "dist"), { recursive: true, force: true });
});

describe("bundled() — desktop-bundle runtime probe (BU5)", () => {
  test("false by default, true when the env marker is set", () => {
    expect(bundled()).toBe(false);

    Bun.env.ABIDE_BUNDLED = "1";
    try {
      expect(bundled()).toBe(true);
    } finally {
      delete Bun.env.ABIDE_BUNDLED;
    }
    expect(bundled()).toBe(false);
  });

  test("true when the global marker is set", () => {
    const g = globalThis as { __ABIDE_BUNDLED__?: unknown };
    g.__ABIDE_BUNDLED__ = true;
    try {
      expect(bundled()).toBe(true);
    } finally {
      delete g.__ABIDE_BUNDLED__;
    }
    expect(bundled()).toBe(false);
  });
});

describe("onMenu / emitMenu — menu event registry (BU4)", () => {
  test("registers a named handler, emitMenu fires it, unsubscribe stops it", () => {
    let fired = 0;
    const off = onMenu("new", () => {
      fired++;
    });

    emitMenu("new");
    expect(fired).toBe(1);

    emitMenu("other");
    expect(fired).toBe(1); // different name, not fired

    off();
    emitMenu("new");
    expect(fired).toBe(1); // unsubscribed
  });

  test("multiple handlers for the same name all fire", () => {
    let a = 0;
    let b = 0;
    const offA = onMenu("save", () => {
      a++;
    });
    const offB = onMenu("save", () => {
      b++;
    });

    emitMenu("save");
    expect(a).toBe(1);
    expect(b).toBe(1);

    offA();
    offB();
  });

  test("onMenu(handler) catch-all fires on every emit", () => {
    const seen: string[] = [];
    const off = onMenu(() => {
      seen.push("emit");
    });

    emitMenu("one");
    emitMenu("two");
    expect(seen.length).toBe(2);

    off();
    emitMenu("three");
    expect(seen.length).toBe(2);
  });
});

describe("BundleWindow / BundleMenu / BundleMenuItem — declarative shapes (BU3/BU4)", () => {
  test("constructs a well-typed window with a menu", () => {
    const items: BundleMenuItem[] = [
      { label: "New", emit: "new", shortcut: "Cmd+N" },
      { separator: true },
      { label: "Docs", navigate: "/docs" },
    ];
    const menu: BundleMenu = { label: "File", items };
    const window: BundleWindow = {
      title: "My App",
      width: 1024,
      height: 768,
      menu,
      config: { theme: "dark" },
    };

    expect(window.title).toBe("My App");
    expect(window.menu?.items.length).toBe(3);
    expect(window.menu?.items[0]).toEqual({ label: "New", emit: "new", shortcut: "Cmd+N" });
    expect(window.menu?.items[1]).toEqual({ separator: true });
  });
});

describe("abide bundle — produces a dist/bundle/ launcher (BU1)", () => {
  test("writes launch.ts + window.json without opening a window", async () => {
    // Guard against any accidental window-open in CI.
    Bun.env.ABIDE_BUNDLE_NO_WINDOW = "1";
    try {
      const outDir = await bundle(FIXTURE_DIR);
      expect(outDir).toContain(join("dist", "bundle"));

      const launcher = Bun.file(join(outDir, "launch.ts"));
      expect(await launcher.exists()).toBe(true);
      const source = await launcher.text();
      expect(source.length).toBeGreaterThan(0);
      expect(source).toContain("openWindow");
      expect(source).toContain("best-effort");

      const window = await Bun.file(join(outDir, "window.json")).json();
      expect(window).toBeDefined();
    } finally {
      delete Bun.env.ABIDE_BUNDLE_NO_WINDOW;
    }
  });
});
