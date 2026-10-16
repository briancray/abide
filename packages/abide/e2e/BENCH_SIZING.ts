// HOW MUCH OF A REPORT SPEC A RUN PAYS FOR. `reactive`, `shared` and `shapes` report and assert
// nothing, so the e2e gate runs each at ONE rep with no warm-up — enough that a bench which no
// longer builds, injects or batches fails something — and `bun run bench` sets `HARNESS_BENCH` for
// the batcher's own sizing, the reading the specs exist to print. One rep still has to clear
// 43.11's bar, so the smoke is the batcher working rather than bypassed; it is not a reading, and
// it is not printed.
export const BENCH_SIZING: { reps: number; warmup: number } | undefined =
    process.env.HARNESS_BENCH ? undefined : { reps: 1, warmup: 0 }
