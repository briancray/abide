// 42.16 — UNDER `bun test`, `createApp` BUILDS THE APP rather than reading whatever `abide build` last
// left, ONCE PER STATE OF ITS SOURCES: the build's directory is named after a hash of what made it,
// so a build either matches the sources or does not exist, and every test process — every
// `--parallel` worker, every spawned child — reuses the one that does. Eight workers each building
// their own copy of a 1.3 s build waited 7–10 s apiece.

import { mkdir, rename, rm, utimes, writeFile } from 'node:fs/promises' // bun exposes no directory creation, rename, removal, mtime write or exclusive create of its own
import { dirname } from 'node:path' // bun exposes no path helpers of its own
import { namesUnder } from './namesUnder.ts'
import { runBuild } from './runBuild.ts'

// The framework's own source is part of what made a build: a compiler change is a new build.
const FRAMEWORK = Bun.fileURLToPath(new URL('../..', import.meta.url))
const POLL_MS = 50
// A build no test process has reused for this long is swept by the next one that builds.
const UNUSED_FOR_MS = 24 * 60 * 60 * 1000

// One lookup per app per test process, however many files in it call `createApp`.
const TEST_BUILDS = new Map<string, Promise<string>>()

/**
 * The build of the app under `root` for its sources as they stand, made if no process has made it.
 *
 * UNDER `node_modules`, so a bare import in the built modules resolves as it does from the app, and
 * so it is ignored wherever `node_modules` is.
 */
export function testBuild(root: string): Promise<string> {
    let built = TEST_BUILDS.get(root)
    if (built === undefined) {
        built = sourceHash(root).then((key) =>
            sharedBuild(
                `${dirname(root)}/node_modules/.cache/abide`,
                `build-${key}`,
                (out) => runBuild(root, out),
            ),
        )
        TEST_BUILDS.set(root, built)
    }
    return built
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
 * The app's files, the package and lockfile above it, the framework's own source, and `root`
 * itself, since a build carries the paths it was made at.
 */
export async function sourceHash(root: string): Promise<string> {
    const app = dirname(root)
    const paths = [
        ...filesUnder(root),
        ...filesUnder(`${FRAMEWORK}src`),
        ...filesUnder(`${FRAMEWORK}bin`),
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
