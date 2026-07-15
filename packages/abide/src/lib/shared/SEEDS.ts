/*
The ONE hydration seed manifest (ADR-0048): every passive server→client warm-seed
partition — await resumes, async-cell values, doc snapshots, socket frames — rides a single
`globalThis.__abideSeeds` global, kind-partitioned. Each partition is a Record of ref-json
STRINGS decoded lazily at its read site, so the inline pre-bundle scripts (the SSR swap
script, the resume seed script) can write entries without the codec. The per-kind module
names (`RESUME`, `CELL_SEED`, `DOC_SEED`, `SOCKET_SEED`) are views onto these partitions,
so consumers keep their domain name while the wire carries one global.

Each partition initializes with its own `??=` — NOT one whole-object create — because the
vanilla scripts and the bundle race in either order and a script that ran first may have
created the root with only its own partition; whoever arrives later must fill the gaps and
adopt the same references. The live streamed-cell machinery (`STREAMED_CELLS`) and the head
collector buffer (`__abideResumeCache`) deliberately stay separate: they are apply-timing
phases (ADR-0040), not passive manifests.
*/
type SeedPartitions = {
    resume: Record<string, string>
    cells: Record<string, string>
    docs: Record<string, string>
    sockets: Record<string, string>
}

const globalScope = globalThis as { __abideSeeds?: Partial<SeedPartitions> }
globalScope.__abideSeeds ??= {}
const root = globalScope.__abideSeeds
root.resume ??= {}
root.cells ??= {}
root.docs ??= {}
root.sockets ??= {}

// @documentation plumbing
export const SEEDS: SeedPartitions = root as SeedPartitions
