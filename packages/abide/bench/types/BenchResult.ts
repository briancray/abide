/* One bench run: time to build the graph + initial flush, time for the targeted
   updates, and the total effect runs (a correctness check — must equal
   itemCount + updates for a path-granular system). */
export type BenchResult = { createMs: number; updateMs: number; runs: number }
