// §11.5 baked type-derived schemas: `abide build` writes `dist/schemas.json`; `loadApp` prefers it
// over a live tsgo pass so a source-less/tsgo-less runtime enforces schemas at boot with no derivation.

import { afterEach, expect, test } from 'bun:test'
import { mkdir, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { build } from '../cli/build.ts'
import { loadApp, writeBakedSchemas } from './internal/loadApp.ts'

const tempDirs: string[] = []

afterEach(async () => {
    for (const dir of tempDirs) await rm(dir, { recursive: true, force: true })
    tempDirs.length = 0
    // Drop the shared parent so no empty `__baketmp__` lingers in the source tree.
    await rm(join(import.meta.dir, '__baketmp__'), { recursive: true, force: true })
})

// Materialise a minimal app dir with a single schemaless RPC under a UNIQUE path. Kept INSIDE the
// package tree (not /tmp) so `abide/server/*` resolves via the workspace and tsgo finds the project;
// the unique path also makes the RPC module a fresh import, not a mutated singleton from another test.
async function materializeApp(tag: string, rpcSource: string): Promise<string> {
    const dir = join(import.meta.dir, '__baketmp__', `${tag}-${crypto.randomUUID()}`)
    tempDirs.push(dir)
    await mkdir(join(dir, 'src/server/rpc'), { recursive: true })
    await writeFile(join(dir, 'src/server/rpc/thing.ts'), rpcSource)
    return dir
}

const THING_RPC = `import { GET } from 'abide/server/GET'
export default GET(({ id }: { id: number }) => ({ id, ok: true }))
`

test("writeBakedSchemas records each route's derived input/output as JSON Schema", async () => {
    const dir = await materializeApp('write', THING_RPC)
    // 'source': this test is `abide build`'s lane — it is PRODUCING the bake, so the source is
    // authoritative and no earlier bake may win.
    const loaded = await loadApp(dir, { schemas: 'source' })
    if (loaded.routes === undefined) throw new Error('expected routes')
    await writeBakedSchemas(dir, loaded.routes)

    const baked = (await Bun.file(join(dir, 'dist/schemas.json')).json()) as Record<
        string,
        { input?: unknown; output?: unknown }
    >
    expect(baked.thing?.input).toEqual({
        type: 'object',
        properties: { id: { type: 'number' } },
        required: ['id'],
    })
    expect(baked.thing?.output).toEqual({
        type: 'object',
        properties: { id: { type: 'number' }, ok: { type: 'boolean' } },
        required: ['id', 'ok'],
    })
})

test('loadApp prefers a baked dist/schemas.json over live derivation (no tsgo)', async () => {
    const dir = await materializeApp('read', THING_RPC)
    // A SENTINEL baked schema that live derivation would NEVER produce — if the route ends up with it,
    // loadApp used the baked file (not tsgo).
    // `as const` on the `type` fields: a widened `string` is not assignable to `JSONSchema['type']`
    // (`JSONSchemaType | JSONSchemaType[]`), which fails the assertion's overload resolution.
    const sentinel = {
        type: 'object' as const,
        properties: { id: { type: 'string' as const } }, // deliberately `string`, not the real `number`
        required: ['id'],
    }
    await mkdir(join(dir, 'dist'), { recursive: true })
    await writeFile(join(dir, 'dist/schemas.json'), JSON.stringify({ thing: { input: sentinel } }))

    const loaded = await loadApp(dir, { schemas: 'baked' })
    const thing = loaded.routes?.thing
    if (thing === undefined) throw new Error('expected thing route')
    expect(thing.__rpc.options.schemas?.input).toEqual(sentinel)
})

test('abide build writes dist/schemas.json with the derived schemas', async () => {
    const dir = await materializeApp('build', THING_RPC)
    // A minimal page so the client build has an entry to bundle.
    await mkdir(join(dir, 'src/ui/pages'), { recursive: true })
    await writeFile(join(dir, 'src/ui/pages/page.abide'), '<div>hi</div>')

    await build(dir)

    const baked = (await Bun.file(join(dir, 'dist/schemas.json')).json()) as Record<
        string,
        { input?: unknown }
    >
    expect(baked.thing?.input).toEqual({
        type: 'object',
        properties: { id: { type: 'number' } },
        required: ['id'],
    })
})
