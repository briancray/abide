// THE BUILD OF THE APP UNDER A ROOT, ON DISK: where it lives (38.27), what is in it, whether there
// is one, and making one where there is not (38.100). `abide build` writes it, and `abide start`,
// `createApp`, the test preload and the CLI's own reads take it — every one through here, so the
// layout is spelled once and "is there a build" has one answer.
//
// THE COMPILATION IS THE MARKER. A build removes it before writing anything and writes it last, so a
// build that failed partway leaves no build — `abide start` builds again and says why, rather than
// booting what is left (38.100).
//
// 42.16 — UNDER `bun test`, THE BUILD IS ONE PER STATE OF THE APP'S SOURCES: its directory is named
// after a hash of what made it, so a build either matches the sources or does not exist, and every
// test process — every `--parallel` worker, every spawned child — reuses the one that does. Eight
// workers each building their own copy of a 1.3 s build waited 7–10 s apiece.

import { mkdir, rename, rm, utimes, writeFile } from 'node:fs/promises' // bun exposes no directory creation, rename, removal, mtime write or exclusive create of its own
import { dirname } from 'node:path' // bun exposes no path helpers of its own

import { ABIDE_DIRECTORY } from './ABIDE_DIRECTORY.ts'
import type { Compilation } from './abideModules.ts'
import type { AppSources } from './answerRequest.ts'
import type { Manifest } from './manifestOf.ts'
import { namesUnder } from './namesUnder.ts'
import { packageDirectory } from './packageDirectory.ts'
import { builtSources, serveApp, type ServedApp } from './servedApp.ts'

/** What builds the app under `root` into `out` where nobody has: spawned, or the CLI's own. */
export type Builder = (root: string, out: string) => Promise<unknown>

/** Where each part of the build in `out` is. */
export type BuildFiles = {
    /** The compilation — every `.abide` compiled, and the build's tables — and the marker. */
    compilation: string
    /** 38.5 — beside the bundle rather than in it: everything under `client` is the browser's. */
    manifest: string
    /** The browser bundle, each file beside its precompressed copies (38.5). */
    client: string
    /** 38.18 — every `public` directory, each file at its address. */
    published: string
}

// The CLI, spawned rather than imported: the compiler is not reachable from the server seam.
const ABIDE_BIN = Bun.fileURLToPath(
    new URL('../../bin/abide.ts', import.meta.url),
)
const POLL_MS = 50
// A test build no process has reused for this long is swept by the next one that builds.
const UNUSED_FOR_MS = 24 * 60 * 60 * 1000

// One lookup per app per test process, however many files in it call `createApp`.
const TEST_BUILDS = new Map<string, Promise<string>>()

/** Where the build of the app under `root` goes: `.abide` in its package. 38.27. */
export function buildDirectory(root: string): string {
    return `${packageDirectory(root)}/.abide`
}

export function buildFiles(out: string): BuildFiles {
    return {
        compilation: `${out}/compilation.json`,
        manifest: `${out}/manifest.json`,
        client: `${out}/client`,
        published: `${out}/public`,
    }
}

/**
 * The files a build into `out` writes, its previous marker removed first — so that from here until
 * `markBuild`, `out` holds no build.
 */
export async function unmarkedBuild(out: string): Promise<BuildFiles> {
    const files = buildFiles(out)
    await rm(files.compilation, { force: true })
    return files
}

/** Ends a build: its compilation, written whole and last, is what says there is one. */
export function markBuild(
    files: BuildFiles,
    compilation: Compilation,
): Promise<void> {
    return writeWhole(files.compilation, JSON.stringify(compilation))
}

/**
 * Writes `path` whole: to a name of its own beside it, then renamed over it.
 *
 * 38.66 — a reader, or a second build, finds the last complete file there and never a partial one.
 */
export async function writeWhole(
    path: string,
    content: string | Blob,
): Promise<void> {
    const partial = `${path}.${crypto.randomUUID()}.partial`
    await Bun.write(partial, content)
    await rename(partial, path)
}

/** What a build in `out` holds beside its compilation: the manifest, and every file it serves. */
export async function builtFiles(out: string): Promise<{
    manifest: Manifest
    client: Map<string, string>
    published: Map<string, string>
}> {
    const files = buildFiles(out)
    return {
        manifest: (await Bun.file(files.manifest).json()) as Manifest,
        client: pathsUnder(files.client),
        published: pathsUnder(files.published),
    }
}

/**
 * The build in `out` served to this process's imports, with the sources an `App` is booted over —
 * or `undefined` where `out` holds no build and `build` made none.
 *
 * 38.6 — what `abide start` boots: no compiler is loaded, and every `.abide` the app imports is
 * answered out of what the build compiled. 38.100 — AN APP NOBODY BUILT IS BUILT, by `build`,
 * rather than refused; `undefined` builds nothing, for a reader aimed at a build already there.
 */
export async function servedBuild(
    root: string,
    out: string,
    build: Builder | undefined,
): Promise<(ServedApp & { load: () => Promise<AppSources> }) | undefined> {
    const marker = buildFiles(out).compilation
    if (!(await Bun.file(marker).exists())) {
        if (build === undefined) return undefined
        await build(root, out)
        // A FRESH HANDLE: one taken before the build wrote the file reads it as empty.
        if (!(await Bun.file(marker).exists())) return undefined
    }
    // Read beside the table's import rather than after it; a boot that never loads drops it.
    const files = builtFiles(out)
    files.catch(() => {})
    const served = await serveApp(
        root,
        (await Bun.file(marker).json()) as Compilation,
    )
    return {
        ...served,
        load: async () =>
            builtSources({
                table: served.table,
                handlers: served.table.handlers,
                ...(await files),
            }),
    }
}

/** `abide build` of the app under `root` into `out`, run as the CLI. */
export async function spawnedBuild(root: string, out: string): Promise<void> {
    const child = Bun.spawn(
        [process.execPath, ABIDE_BIN, 'build', '--root', root, '--out', out],
        { stdout: 'ignore', stderr: 'pipe' },
    )
    const [exitCode, said] = await Promise.all([
        child.exited,
        new Response(child.stderr).text(),
    ])
    if (exitCode !== 0)
        throw new Error(
            `abide: could not build the app under ${root}.\n${said}`,
        )
}

/**
 * Where this process reads the build of the app under `root` from: its `buildDirectory`, or — `fresh`,
 * which `bun test` is (42.16) — the build of its sources as they stand, made if no process has.
 */
export async function processBuild(
    root: string,
    fresh = process.env.NODE_ENV === 'test',
): Promise<string> {
    if (!fresh) return buildDirectory(root)
    let built = TEST_BUILDS.get(root)
    if (built === undefined) {
        // UNDER `node_modules`, so a bare import in the built modules resolves as it does from the
        // app, and so it is ignored wherever `node_modules` is.
        built = sourceHash(root).then((key) =>
            sharedBuild(
                `${packageDirectory(root)}/node_modules/.cache/abide`,
                `build-${key}`,
                (out) => spawnedBuild(root, out),
            ),
        )
        TEST_BUILDS.set(root, built)
    }
    return built
}

/** Every file under `directory`, by the name below it to its path. */
function pathsUnder(directory: string): Map<string, string> {
    const paths = new Map<string, string>()
    for (const name of namesUnder(directory))
        paths.set(name, `${directory}/${name}`)
    return paths
}

/**
 * `builds/key`, made by `build` in exactly one process however many ask at once.
 *
 * THE FIRST TO CREATE `key.lock` BUILDS — an exclusive create is atomic, so one process wins — into
 * a staging directory renamed into place, so nothing reads a half-written build. The rest wait for
 * it, and take the lock over if the process holding it has ended.
 */
export async function sharedBuild(
    builds: string,
    key: string,
    build: (out: string) => Promise<void>,
): Promise<string> {
    const out = `${builds}/${key}`
    const lock = `${out}.lock`
    await mkdir(builds, { recursive: true })
    for (;;) {
        if (await isDirectory(out)) {
            const now = new Date()
            await utimes(out, now, now)
            return out
        }
        if (await claim(lock)) {
            try {
                if (!(await isDirectory(out))) await buildInto(out, build)
            } finally {
                await rm(lock, { force: true })
            }
            await sweep(builds, key)
            return out
        }
        if (await holderEnded(lock)) await rm(lock, { force: true })
        else await Bun.sleep(POLL_MS)
    }
}

async function buildInto(
    out: string,
    build: (out: string) => Promise<void>,
): Promise<void> {
    const staging = `${out}.tmp-${process.pid}`
    await rm(staging, { recursive: true, force: true })
    try {
        await build(staging)
        await rename(staging, out)
    } catch (thrown) {
        await rm(staging, { recursive: true, force: true })
        // TWO HOLDERS, where one took over a lock the other had just taken over: the first rename
        // stands, and it is the same build.
        if (await isDirectory(out)) return
        throw thrown
    }
}

/**
 * A hash of everything a build of the app under `root` is made from.
 *
 * The app's files, its package's manifest and tsconfig and the lockfile above them, the framework's
 * own source, and `root` itself, since a build carries the paths it was made at.
 */
export async function sourceHash(root: string): Promise<string> {
    const app = packageDirectory(root)
    const paths = [
        ...filesUnder(root),
        ...filesUnder(`${ABIDE_DIRECTORY}src`),
        ...filesUnder(`${ABIDE_DIRECTORY}bin`),
        `${app}/package.json`,
        `${app}/tsconfig.json`,
    ]
    const lockfile = await lockfileAbove(app)
    if (lockfile !== undefined) paths.push(lockfile)
    const contents = await Promise.all(
        paths.map((path) =>
            Bun.file(path)
                .bytes()
                .catch(() => undefined),
        ),
    )
    const hasher = new Bun.CryptoHasher('sha256')
    hasher.update(root)
    for (let at = 0; at < paths.length; at += 1) {
        const bytes = contents[at]
        if (bytes === undefined) continue
        hasher.update(paths[at] as string)
        hasher.update(bytes)
    }
    return hasher.digest('hex').slice(0, 16)
}

// Sorted, so the hash does not depend on the order a directory lists in. Dot entries and
// `node_modules` are skipped: neither is the app's source, and the builds live in one.
function filesUnder(directory: string): string[] {
    const found: string[] = []
    for (const name of namesUnder(directory))
        if (!`/${name}`.includes('/node_modules/'))
            found.push(`${directory}/${name}`)
    return found.sort()
}

async function lockfileAbove(directory: string): Promise<string | undefined> {
    for (let at = directory; ; at = dirname(at)) {
        for (const name of ['bun.lock', 'bun.lockb'])
            if (await Bun.file(`${at}/${name}`).exists()) return `${at}/${name}`
        if (dirname(at) === at) return undefined
    }
}

async function claim(lock: string): Promise<boolean> {
    try {
        await writeFile(lock, String(process.pid), { flag: 'wx' })
        return true
    } catch (thrown) {
        if ((thrown as { code?: string }).code === 'EEXIST') return false
        throw thrown
    }
}

async function holderEnded(lock: string): Promise<boolean> {
    const text = await Bun.file(lock)
        .text()
        .catch(() => undefined)
    // Gone is not ended: the holder finished, and the next pass finds its build.
    if (text === undefined) return false
    // Empty is a holder between creating the lock and writing its pid.
    return text !== '' && !isRunning(Number(text))
}

/** Removes builds unused for a day, and what an ended process left half-made. */
async function sweep(builds: string, kept: string): Promise<void> {
    const names = new Bun.Glob('*').scanSync({ cwd: builds, onlyFiles: false })
    const removals: Promise<void>[] = []
    const now = Date.now()
    for (const name of names) {
        if (name === kept) continue
        const staged = /\.tmp-(\d+)$/.exec(name)
        if (staged !== null) {
            if (!isRunning(Number(staged[1])))
                removals.push(
                    rm(`${builds}/${name}`, { recursive: true, force: true }),
                )
            continue
        }
        if (name.endsWith('.lock')) continue
        removals.push(
            Bun.file(`${builds}/${name}`)
                .stat()
                .then((found) =>
                    now - found.mtimeMs > UNUSED_FOR_MS
                        ? rm(`${builds}/${name}`, {
                              recursive: true,
                              force: true,
                          })
                        : undefined,
                )
                .catch(() => undefined),
        )
    }
    await Promise.all(removals)
}

async function isDirectory(path: string): Promise<boolean> {
    return (
        (
            await Bun.file(path)
                .stat()
                .catch(() => undefined)
        )?.isDirectory() === true
    )
}

function isRunning(pid: number): boolean {
    try {
        process.kill(pid, 0)
        return true
    } catch (thrown) {
        // EPERM is a process that exists and is someone else's.
        return (thrown as { code?: string }).code === 'EPERM'
    }
}
