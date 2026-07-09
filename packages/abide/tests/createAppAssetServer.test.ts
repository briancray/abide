import { afterAll, expect, test } from 'bun:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createAppAssetServer } from '../src/lib/server/runtime/createAppAssetServer.ts'

/*
The `appDir` seam that makes dev worker swaps safe: each worker serves `/_app/*`
from exactly the generation directory it was handed, never a shared `dist/_app`.
This encodes the property directly — two servers on two generation dirs each serve
ONLY their own chunks, so a rebuild's new generation can't invalidate a still-
draining worker's chunks (the stale-hash 500s this replaced). If the mapping ever
regresses to a shared dir, the cross-generation 404 assertion fails.
*/

const dirs: string[] = []
async function genDir(entry: string, body: string): Promise<string> {
    const dir = await mkdtemp(join(tmpdir(), 'abide-appdir-'))
    dirs.push(dir)
    await Bun.write(join(dir, entry), body)
    return dir
}

afterAll(async () => {
    await Promise.all(dirs.map((dir) => rm(dir, { recursive: true, force: true })))
})

// Drive one `/_app/<file>` request through a server and return [status, body].
async function get(
    serve: (req: Request, url: URL) => Promise<Response>,
    file: string,
): Promise<[number, string]> {
    const url = new URL(`http://localhost/_app/${file}`)
    const res = await serve(new Request(url), url)
    return [res.status, await res.text()]
}

test('serves /_app/<file> from its own appDir and 404s a miss', async () => {
    const dir = await genDir('client-aaaa1111.js', 'export const gen = "A"')
    const serve = await createAppAssetServer({ appDir: dir })

    const [okStatus, okBody] = await get(serve, 'client-aaaa1111.js')
    expect(okStatus).toBe(200)
    expect(okBody).toBe('export const gen = "A"')

    const [missStatus] = await get(serve, 'client-missing0.js')
    expect(missStatus).toBe(404)
})

test('two generation dirs serve only their own chunks — a rebuild never invalidates a draining worker', async () => {
    const dirA = await genDir('client-aaaa1111.js', 'export const gen = "A"')
    const dirB = await genDir('client-bbbb2222.js', 'export const gen = "B"')
    const serveA = await createAppAssetServer({ appDir: dirA })
    const serveB = await createAppAssetServer({ appDir: dirB })

    // Each server resolves its own generation's entry.
    expect(await get(serveA, 'client-aaaa1111.js')).toEqual([200, 'export const gen = "A"'])
    expect(await get(serveB, 'client-bbbb2222.js')).toEqual([200, 'export const gen = "B"'])

    // Crucially, neither sees the other's chunks: the "old" worker (A) 404s the new
    // build's entry instead of reading a shared dir — the isolation that removes the
    // overlap-window 500s. (The browser never requests across generations; this just
    // proves the dirs don't bleed.)
    const [crossStatus] = await get(serveA, 'client-bbbb2222.js')
    expect(crossStatus).toBe(404)
})
