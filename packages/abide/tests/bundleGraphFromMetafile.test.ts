/* The post-DCE bundle-graph seam (ADR-0031 D2): walks a `Bun.build` metafile once into the
   surviving-module list + a child→importer chain reconstructor, the reusable substrate the
   side-crossing guard and the bundle-budget diagnostic both read. */
import { expect, test } from 'bun:test'
import type { BuildMetafile } from 'bun'
import { bundleGraphFromMetafile } from '../src/lib/shared/bundleGraphFromMetafile.ts'

const CWD = '/project'

/* Builds a metafile whose `inputs` keys are cwd-relative and whose import edges are absolute,
   mirroring what Bun emits — the exact shape the seam resolves against. */
function metafile(inputs: Record<string, { bytes: number; imports: string[] }>): BuildMetafile {
    const entries = Object.entries(inputs).map(([key, value]) => [
        key,
        {
            bytes: value.bytes,
            format: 'esm' as const,
            imports: value.imports.map((path) => ({
                path,
                kind: 'import-statement' as const,
            })),
        },
    ])
    return { inputs: Object.fromEntries(entries), outputs: {} } as BuildMetafile
}

test('resolves every surviving module to an absolute path with its byte size', () => {
    const graph = bundleGraphFromMetafile(
        metafile({
            'src/entry.ts': { bytes: 10, imports: ['/project/src/big.ts'] },
            'src/big.ts': { bytes: 999, imports: [] },
        }),
        CWD,
    )
    expect(graph.modules).toEqual([
        { path: '/project/src/entry.ts', bytes: 10 },
        { path: '/project/src/big.ts', bytes: 999 },
    ])
})

test('reconstructs the import chain root→target from the graph edges', () => {
    const graph = bundleGraphFromMetafile(
        metafile({
            'src/entry.ts': { bytes: 1, imports: ['/project/src/mid.ts'] },
            'src/mid.ts': { bytes: 1, imports: ['/project/src/leaf.ts'] },
            'src/leaf.ts': { bytes: 1, imports: [] },
        }),
        CWD,
    )
    expect(graph.importerChain('/project/src/leaf.ts')).toEqual([
        '/project/src/entry.ts',
        '/project/src/mid.ts',
        '/project/src/leaf.ts',
    ])
})

test('a graph root (nothing imports it) chains to just itself', () => {
    const graph = bundleGraphFromMetafile(
        metafile({ 'src/entry.ts': { bytes: 1, imports: [] } }),
        CWD,
    )
    expect(graph.importerChain('/project/src/entry.ts')).toEqual(['/project/src/entry.ts'])
})

test('first importer edge wins and a cycle terminates', () => {
    const graph = bundleGraphFromMetafile(
        metafile({
            'a.ts': { bytes: 1, imports: ['/project/b.ts'] },
            'b.ts': { bytes: 1, imports: ['/project/a.ts'] },
        }),
        CWD,
    )
    // a→b recorded first (a's edge), b→a second; chaining from b walks b→a and stops (cycle-safe).
    expect(graph.importerChain('/project/b.ts')).toEqual(['/project/a.ts', '/project/b.ts'])
})
