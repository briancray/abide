import { describe, expect, test } from "bun:test";
import { batch, computed, effect, signal, untrack } from "./reactive.ts";

// Effect re-runs are deferred to a microtask flush; a macrotask tick guarantees the
// microtask queue has drained.
const tick = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

describe("signal", () => {
  test("reads the initial value", () => {
    const count = signal(1);
    expect(count()).toBe(1);
  });

  test("writes update the read value", () => {
    const count = signal(1);
    count.set(2);
    expect(count()).toBe(2);
  });

  test("peek reads without tracking", () => {
    const count = signal(5);
    let runs = 0;
    effect(() => {
      runs++;
      count.peek(); // must not subscribe
    });
    expect(runs).toBe(1);
    count.set(6);
    expect(count.peek()).toBe(6);
  });

  test("holds function values", () => {
    const fn = () => 42;
    const held = signal(fn);
    expect(held()).toBe(fn);
    expect(held()()).toBe(42);
  });
});

describe("computed", () => {
  test("derives from a signal", () => {
    const count = signal(2);
    const doubled = computed(() => count() * 2);
    expect(doubled()).toBe(4);
    count.set(3);
    expect(doubled()).toBe(6);
  });

  test("is lazy: does not run until read", () => {
    const count = signal(1);
    let runs = 0;
    const derived = computed(() => {
      runs++;
      return count();
    });
    expect(runs).toBe(0); // never read
    derived();
    expect(runs).toBe(1);
    count.set(2); // dep changed but not read
    expect(runs).toBe(1);
    derived();
    expect(runs).toBe(2);
  });

  test("is memoized: no recompute while deps unchanged", () => {
    const count = signal(1);
    let runs = 0;
    const derived = computed(() => {
      runs++;
      return count() * 10;
    });
    expect(derived()).toBe(10);
    expect(derived()).toBe(10);
    expect(derived()).toBe(10);
    expect(runs).toBe(1);
  });

  test("returns a ===-stable reference while deps unchanged", () => {
    const count = signal(1);
    const obj = computed(() => ({ value: count() }));
    const first = obj();
    const second = obj();
    expect(second).toBe(first);
    count.set(2);
    expect(obj()).not.toBe(first);
  });

  test("chained computeds propagate", () => {
    const count = signal(1);
    const doubled = computed(() => count() * 2);
    const plusOne = computed(() => doubled() + 1);
    expect(plusOne()).toBe(3);
    count.set(10);
    expect(plusOne()).toBe(21);
  });

  test("downstream does not recompute when an intermediate value is unchanged", () => {
    const count = signal(2);
    const isEven = computed(() => count() % 2 === 0);
    let runs = 0;
    const label = computed(() => {
      runs++;
      return isEven() ? "even" : "odd";
    });
    expect(label()).toBe("even");
    expect(runs).toBe(1);
    count.set(4); // still even -> isEven unchanged -> label must not recompute
    expect(label()).toBe("even");
    expect(runs).toBe(1);
    count.set(5); // now odd -> recompute
    expect(label()).toBe("odd");
    expect(runs).toBe(2);
  });
});

describe("effect", () => {
  test("runs immediately on creation", () => {
    const count = signal(1);
    let seen = 0;
    effect(() => {
      seen = count();
    });
    expect(seen).toBe(1);
  });

  test("re-runs when a dep changes (microtask-batched)", async () => {
    const count = signal(1);
    let seen = 0;
    let runs = 0;
    effect(() => {
      runs++;
      seen = count();
    });
    expect(runs).toBe(1);
    count.set(2);
    expect(runs).toBe(1); // deferred, not synchronous
    await tick();
    expect(runs).toBe(2);
    expect(seen).toBe(2);
  });

  test("does not re-run when an unread signal changes", async () => {
    const used = signal(1);
    const unused = signal(1);
    let runs = 0;
    effect(() => {
      runs++;
      used();
    });
    unused.set(2);
    await tick();
    expect(runs).toBe(1);
  });

  test("tracks dynamic dependencies", async () => {
    const toggle = signal(true);
    const a = signal("a");
    const b = signal("b");
    let seen = "";
    let runs = 0;
    effect(() => {
      runs++;
      seen = toggle() ? a() : b();
    });
    expect(seen).toBe("a");

    // While toggle is true, b is not a dep.
    b.set("b2");
    await tick();
    expect(runs).toBe(1);

    // Flip to the b branch.
    toggle.set(false);
    await tick();
    expect(runs).toBe(2);
    expect(seen).toBe("b2");

    // Now a is no longer a dep.
    a.set("a2");
    await tick();
    expect(runs).toBe(2);

    // b is now a dep.
    b.set("b3");
    await tick();
    expect(runs).toBe(3);
    expect(seen).toBe("b3");
  });
});

describe("batching", () => {
  test("N sequential writes coalesce into one effect run (microtask)", async () => {
    const count = signal(0);
    let runs = 0;
    effect(() => {
      runs++;
      count();
    });
    expect(runs).toBe(1);
    for (let i = 1; i <= 5; i++) count.set(i);
    await tick();
    expect(runs).toBe(2); // one re-run for the whole burst
    expect(count()).toBe(5);
  });

  test("batch() flushes synchronously at the end and coalesces", () => {
    const a = signal(1);
    const b = signal(2);
    let runs = 0;
    let sum = 0;
    effect(() => {
      runs++;
      sum = a() + b();
    });
    expect(runs).toBe(1);
    batch(() => {
      a.set(10);
      b.set(20);
      expect(runs).toBe(1); // no flush mid-batch
    });
    expect(runs).toBe(2); // exactly one flush after batch
    expect(sum).toBe(30);
  });

  test("nested batches flush once at the outermost boundary", () => {
    const count = signal(0);
    let runs = 0;
    effect(() => {
      runs++;
      count();
    });
    batch(() => {
      count.set(1);
      batch(() => {
        count.set(2);
      });
      expect(runs).toBe(1); // inner batch does not flush
      count.set(3);
    });
    expect(runs).toBe(2);
    expect(count()).toBe(3);
  });
});

describe("glitch-freedom (diamond)", () => {
  test("effect observes a consistent state and runs once per batch", async () => {
    const source = signal(1);
    const left = computed(() => source() + 1);
    const right = computed(() => source() * 2);
    const seen: string[] = [];
    let runs = 0;
    effect(() => {
      runs++;
      // Invariant: left and right always derive from the SAME source value.
      // left = source+1, right = source*2  => right - 2*(left-1) === 0
      const l = left();
      const r = right();
      seen.push(`${l},${r}`);
      expect(r - 2 * (l - 1)).toBe(0);
    });
    expect(runs).toBe(1);
    expect(seen).toEqual(["2,2"]);

    source.set(5);
    await tick();
    expect(runs).toBe(2); // once, not twice (one per changed branch would be a glitch)
    expect(seen).toEqual(["2,2", "6,10"]);
  });

  test("deep diamond stays consistent under batch", () => {
    const a = signal(1);
    const b = computed(() => a() * 2);
    const c = computed(() => a() * 3);
    const d = computed(() => b() + c());
    let runs = 0;
    let last = 0;
    effect(() => {
      runs++;
      last = d();
    });
    expect(last).toBe(5);
    expect(runs).toBe(1);
    batch(() => {
      a.set(2);
      a.set(3);
      a.set(4);
    });
    expect(runs).toBe(2);
    expect(last).toBe(20); // 4*2 + 4*3
  });
});

describe("untrack", () => {
  test("reads without subscribing", async () => {
    const tracked = signal(1);
    const hidden = signal(1);
    let runs = 0;
    let combined = 0;
    effect(() => {
      runs++;
      combined = tracked() + untrack(() => hidden());
    });
    expect(combined).toBe(2);

    hidden.set(10); // untracked -> no re-run
    await tick();
    expect(runs).toBe(1);

    tracked.set(5); // tracked -> re-run, reads latest hidden
    await tick();
    expect(runs).toBe(2);
    expect(combined).toBe(15);
  });

  test("returns the inner value", () => {
    const s = signal(7);
    expect(untrack(() => s() * 2)).toBe(14);
  });

  test("restores tracking after the untracked read", async () => {
    const a = signal(1);
    const b = signal(1);
    let runs = 0;
    effect(() => {
      runs++;
      untrack(() => a());
      b(); // must still be tracked
    });
    expect(runs).toBe(1);
    b.set(2);
    await tick();
    expect(runs).toBe(2);
  });
});

describe("teardown / dispose", () => {
  test("teardown runs before each re-run and on dispose", async () => {
    const count = signal(0);
    const events: string[] = [];
    const dispose = effect(() => {
      const value = count();
      events.push(`run:${value}`);
      return () => events.push(`cleanup:${value}`);
    });
    expect(events).toEqual(["run:0"]);

    count.set(1);
    await tick();
    // cleanup of the previous run precedes the new run
    expect(events).toEqual(["run:0", "cleanup:0", "run:1"]);

    dispose();
    expect(events).toEqual(["run:0", "cleanup:0", "run:1", "cleanup:1"]);
  });

  test("disposed effect stops re-running", async () => {
    const count = signal(0);
    let runs = 0;
    const dispose = effect(() => {
      runs++;
      count();
    });
    expect(runs).toBe(1);
    dispose();
    count.set(1);
    await tick();
    expect(runs).toBe(1);
  });

  test("dispose during a pending flush prevents the run", async () => {
    const count = signal(0);
    let runs = 0;
    const dispose = effect(() => {
      runs++;
      count();
    });
    count.set(1); // enqueues the effect
    dispose(); // dispose before the microtask flush
    await tick();
    expect(runs).toBe(1);
  });
});

describe("no-leak after dispose", () => {
  test("disposing unsubscribes from all sources", async () => {
    const a = signal(1);
    const b = signal(1);
    let runs = 0;
    const dispose = effect(() => {
      runs++;
      a();
      b();
    });
    expect(runs).toBe(1);
    dispose();
    a.set(2);
    b.set(2);
    await tick();
    expect(runs).toBe(1);
  });

  test("a computed only read by a disposed effect is not kept live", async () => {
    const source = signal(1);
    let computeRuns = 0;
    const derived = computed(() => {
      computeRuns++;
      return source() * 2;
    });
    let effectRuns = 0;
    const dispose = effect(() => {
      effectRuns++;
      derived();
    });
    expect(effectRuns).toBe(1);
    expect(computeRuns).toBe(1);

    dispose();
    source.set(5);
    await tick();
    // Nothing observes the graph anymore, so no work happens on the flush.
    expect(effectRuns).toBe(1);
    // The computed is lazy and untriggered; a fresh read still yields the current value.
    expect(derived()).toBe(10);
    expect(computeRuns).toBe(2);
  });
});
