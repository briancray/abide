import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, rmSync } from "node:fs";
import { join } from "node:path";
import { appDataDir } from "./appDataDir.ts";

describe("appDataDir", () => {
  const original = Bun.env.ABIDE_DATA_DIR;
  const temp = join(import.meta.dir, `.appdata-test-${process.pid}`);

  beforeEach(() => {
    Bun.env.ABIDE_DATA_DIR = temp;
  });
  afterEach(() => {
    if (original === undefined) delete Bun.env.ABIDE_DATA_DIR;
    else Bun.env.ABIDE_DATA_DIR = original;
    rmSync(temp, { recursive: true, force: true });
  });

  test("honors ABIDE_DATA_DIR and creates the directory", () => {
    const dir = appDataDir();
    expect(dir).toBe(temp);
    expect(existsSync(dir)).toBe(true);
  });

  test("without an override, returns a platform per-user path under an abide subdir", () => {
    delete Bun.env.ABIDE_DATA_DIR;
    const dir = appDataDir();
    expect(dir.endsWith("abide")).toBe(true);
    expect(existsSync(dir)).toBe(true);
  });
});
