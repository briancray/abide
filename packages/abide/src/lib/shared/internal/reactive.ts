// Fine-grained reactivity substrate (rpc-core §7).
// Push-notify + pull-recompute, microtask-batched, glitch-free (topological).
// Signals family (Solid/reactively-style): reading in a tracking context subscribes;
// writes stale-propagate; computeds are lazy + memoized; effects re-run on a batched
// microtask flush and support a teardown return value.

// Node states. Ordered so higher = more stale; DISPOSED is terminal above DIRTY.
const CLEAN = 0;
const CHECK = 1;
const DIRTY = 2;
const DISPOSED = 3;

// The reaction currently executing (computed/effect). Reads register against it.
let currentObserver: Reactive | null = null;
// Sources read during the current run, collected in read order. `null` while the
// fast-path (reuse of the previous run's source list) still holds.
let currentSources: Reactive[] | null = null;
let currentSourcesIndex = 0;

// Effects awaiting a flush. Deduped by state transitions (an effect is enqueued only on
// the CLEAN -> stale edge).
let effectQueue: Reactive[] = [];
let flushScheduled = false;
let batchDepth = 0;

class Reactive {
  value: unknown;
  fn: (() => unknown) | null;
  state: number;
  isEffect: boolean;
  // Graph edges. `sources` = nodes we read; `observers` = nodes that read us.
  sources: Reactive[] | null;
  observers: Reactive[] | null;
  // Effect teardown returned from the last run.
  cleanup: (() => void) | null;

  // `derived` distinguishes computed/effect nodes (have `fn`) from signals (hold a
  // value). It is passed explicitly so a signal may legitimately hold a function value.
  constructor(payload: unknown, derived: boolean, isEffect: boolean) {
    this.isEffect = isEffect;
    this.sources = null;
    this.observers = null;
    this.cleanup = null;
    if (derived) {
      // Derived node (computed/effect): starts DIRTY, recomputed lazily on read/flush.
      this.fn = payload as () => unknown;
      this.value = undefined;
      this.state = DIRTY;
    } else {
      // Source node (signal): holds a value, always CLEAN.
      this.fn = null;
      this.value = payload;
      this.state = CLEAN;
    }
  }

  get(): unknown {
    if (currentObserver !== null) {
      // Track this read against the running reaction. Fast-path: if we still match the
      // previous run's source list at the current index, just advance.
      if (
        currentSources === null &&
        currentObserver.sources !== null &&
        currentObserver.sources[currentSourcesIndex] === this
      ) {
        currentSourcesIndex++;
      } else if (currentSources === null) {
        currentSources = [this];
      } else {
        currentSources.push(this);
      }
    }
    if (this.fn !== null) this.updateIfNecessary();
    return this.value;
  }

  // Untracked read that still pulls a fresh value for derived nodes.
  peekValue(): unknown {
    if (this.fn !== null) this.updateIfNecessary();
    return this.value;
  }

  set(next: unknown): void {
    if (this.value === next) return;
    this.value = next;
    const observers = this.observers;
    if (observers !== null) {
      for (let i = 0; i < observers.length; i++) observers[i]!.stale(DIRTY);
    }
  }

  // Mark this node (and, transitively, its observers) potentially out of date.
  // Direct dependents of a changed source go DIRTY; deeper dependents go CHECK and only
  // recompute if a source actually changes (glitch-free pull).
  stale(nextState: number): void {
    if (this.state >= nextState) return;
    if (this.state === CLEAN && this.isEffect) {
      effectQueue.push(this);
      scheduleFlush();
    }
    this.state = nextState;
    const observers = this.observers;
    if (observers !== null) {
      for (let i = 0; i < observers.length; i++) observers[i]!.stale(CHECK);
    }
  }

  updateIfNecessary(): void {
    if (this.state === CLEAN || this.state === DISPOSED) return;
    if (this.state === CHECK) {
      // Resolve each source; a source that actually changes flips us to DIRTY.
      const sources = this.sources;
      if (sources !== null) {
        for (let i = 0; i < sources.length; i++) {
          sources[i]!.updateIfNecessary();
          if ((this.state as number) === DIRTY) break;
        }
      }
    }
    if (this.state === DIRTY) this.update();
    this.state = CLEAN;
  }

  update(): void {
    const prevObserver = currentObserver;
    const prevSources = currentSources;
    const prevIndex = currentSourcesIndex;
    currentObserver = this;
    currentSources = null;
    currentSourcesIndex = 0;

    // Run teardown before re-running the effect body.
    if (this.isEffect && this.cleanup !== null) {
      const teardown = this.cleanup;
      this.cleanup = null;
      teardown();
    }

    const oldValue = this.value;
    let value: unknown;
    let threw = false;
    let error: unknown;
    try {
      value = this.fn!();
    } catch (caught) {
      threw = true;
      error = caught;
      value = undefined;
    }

    reconcileSources(this);
    currentObserver = prevObserver;
    currentSources = prevSources;
    currentSourcesIndex = prevIndex;

    if (threw) throw error;

    if (this.isEffect) {
      this.cleanup = typeof value === "function" ? (value as () => void) : null;
      // effects hold no value and have no observers to notify
      return;
    }

    // Memoize: only propagate when the derived value actually changed.
    if (oldValue !== value) {
      const observers = this.observers;
      if (observers !== null) {
        for (let i = 0; i < observers.length; i++) observers[i]!.state = DIRTY;
      }
    }
    this.value = value;
  }
}

// Rebuild this node's source subscriptions from the reads collected during its run.
function reconcileSources(node: Reactive): void {
  if (currentSources !== null) {
    // Drop stale tail (sources beyond the reused prefix) then append the new reads.
    removeSourceObservers(node, currentSourcesIndex);
    if (node.sources !== null && currentSourcesIndex > 0) {
      node.sources.length = currentSourcesIndex + currentSources.length;
      for (let i = 0; i < currentSources.length; i++) {
        node.sources[currentSourcesIndex + i] = currentSources[i]!;
      }
    } else {
      node.sources = currentSources;
    }
    for (let i = currentSourcesIndex; i < node.sources.length; i++) {
      const source = node.sources[i]!;
      if (source.observers === null) source.observers = [node];
      else source.observers.push(node);
    }
  } else if (node.sources !== null && currentSourcesIndex < node.sources.length) {
    // Fewer reads than last run: trim the unused tail.
    removeSourceObservers(node, currentSourcesIndex);
    node.sources.length = currentSourcesIndex;
  }
}

// Detach `node` from the observer lists of its sources at indices >= index.
function removeSourceObservers(node: Reactive, index: number): void {
  const sources = node.sources;
  if (sources === null) return;
  for (let i = index; i < sources.length; i++) {
    const observers = sources[i]!.observers;
    if (observers === null) continue;
    const at = observers.indexOf(node);
    if (at >= 0) {
      observers[at] = observers[observers.length - 1]!;
      observers.pop();
    }
  }
}

function scheduleFlush(): void {
  if (batchDepth > 0 || flushScheduled) return;
  flushScheduled = true;
  queueMicrotask(flush);
}

function flush(): void {
  flushScheduled = false;
  // Process until the queue drains, since effects may schedule further work.
  while (effectQueue.length > 0) {
    const batchOfEffects = effectQueue;
    effectQueue = [];
    for (let i = 0; i < batchOfEffects.length; i++) {
      const node = batchOfEffects[i]!;
      if (node.state !== DISPOSED) node.updateIfNecessary();
    }
  }
}

function disposeNode(node: Reactive): void {
  if (node.state === DISPOSED) return;
  if (node.cleanup !== null) {
    const teardown = node.cleanup;
    node.cleanup = null;
    teardown();
  }
  removeSourceObservers(node, 0);
  node.sources = null;
  node.observers = null;
  node.state = DISPOSED;
}

export interface Signal<T> {
  (): T;
  set(value: T): void;
  peek(): T;
}

export interface Computed<T> {
  (): T;
  peek(): T;
}

export function signal<T>(initial: T): Signal<T> {
  const node = new Reactive(initial, false, false);
  const read = (() => node.get() as T) as Signal<T>;
  read.set = (value: T) => node.set(value);
  read.peek = () => node.value as T;
  return read;
}

export function computed<T>(fn: () => T): Computed<T> {
  const node = new Reactive(fn, true, false);
  const read = (() => node.get() as T) as Computed<T>;
  read.peek = () => node.peekValue() as T;
  return read;
}

export function effect(fn: () => void | (() => void)): () => void {
  const node = new Reactive(fn, true, true);
  node.updateIfNecessary(); // runs synchronously to establish subscriptions
  return () => disposeNode(node);
}

export function batch(fn: () => void): void {
  batchDepth++;
  try {
    fn();
  } finally {
    batchDepth--;
    if (batchDepth === 0) flush();
  }
}

export function untrack<T>(fn: () => T): T {
  const prevObserver = currentObserver;
  currentObserver = null;
  try {
    return fn();
  } finally {
    currentObserver = prevObserver;
  }
}
