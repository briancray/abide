// 38.142-38.145 — A NATIVE APP KEEPING ITSELF CURRENT: the feed `onLauncher`'s `update` names is
// read, a newer `.app` it signs is unzipped beside this one, and the two change places as the app
// quits — after `App.stop` (38.76), so nothing is running out of the bundle being replaced.
//
// STAGED BESIDE THE `.app`, on the same volume, so the swap is two renames rather than a copy a
// crash could leave half done.

import { readdir, rename, rm } from 'node:fs/promises' // bun exposes no directory listing, rename or removal of its own

import { log } from '#shared/log.ts'

import { ran } from './ran.ts'
import { FEED_FILE, verifiedFeed } from './updateFeed.ts'

/** An update read, checked and unzipped, waiting for the app to quit. */
export type Staged = {
    version: string
    required: boolean
    notes: string | undefined
    /** The `.app` it unzipped to. */
    app: string
}

/** What a check found: nothing newer, an update staged, or why it staged none. */
export type Checked =
    | { outcome: 'current' }
    | { outcome: 'staged'; staged: Staged }
    | { outcome: 'unreachable'; reason: string }
    | { outcome: 'refused'; reason: string }

/** The `.app` an executable at `executable` is inside, or `undefined` outside one. */
export function appOf(executable: string): string | undefined {
    return /^(.+\.app)\/Contents\/MacOS\/[^/]+$/.exec(executable)?.[1]
}

/** 38.142 — the longest a check waits, and the first wait after a feed that could not be read. */
export const CHECK_INTERVAL = 60 * 60 * 1000
export const RETRY_INTERVAL = 60 * 1000
/** 38.142 — how long after a check the app waking or coming to the front checks again. */
export const NUDGE_INTERVAL = 5 * 60 * 1000
const FEED_TIMEOUT = 30 * 1000
const ZIP_TIMEOUT = 10 * 60 * 1000

const logged = log.named('update')

export class NativeUpdater {
    feed: URL
    publicKey: string
    /** The `.app` this process runs from, which an update replaces. */
    app: string
    version: string
    staged: Staged | undefined
    checking: Promise<Checked> | undefined
    /** Told of an update the moment it is staged, and of `undefined` where one staged is lost. */
    onStaged: (staged: Staged | undefined) => void
    /**
     * 38.142 — WALL-CLOCK milliseconds, read off `Date.now()`: a timer's clock stops while the Mac
     * sleeps, so a check due by one is pushed back by every night the app sleeps through.
     */
    lastChecked: number
    due: number
    /** Feeds that could not be read in a row, each doubling the wait before the next try. */
    unreachableInARow: number
    /** Aborted as the app quits, so a check reading a feed does not hold the install up. */
    stopping: AbortController

    constructor(
        update: string,
        publicKey: string,
        app: string,
        version: string,
        onStaged: (staged: Staged | undefined) => void,
    ) {
        this.feed = new URL(
            FEED_FILE,
            update.endsWith('/') ? update : `${update}/`,
        )
        this.publicKey = publicKey
        this.app = app
        this.version = version
        this.staged = undefined
        this.checking = undefined
        this.onStaged = onStaged
        this.lastChecked = Number.NEGATIVE_INFINITY
        this.due = 0
        this.unreachableInARow = 0
        this.stopping = new AbortController()
    }

    /**
     * 38.142 — reads the feed, and stages what it names where it is newer than the app and than
     * what is staged; one check at a time, each logged.
     */
    check(): Promise<Checked> {
        this.checking ??= this.checked()
            // A fault past the feed — a staging folder that cannot be removed — is a check refused,
            // so it is reported (38.143) and the next is still scheduled.
            .catch((thrown: unknown): Checked => ({
                outcome: 'refused',
                reason:
                    thrown instanceof Error ? thrown.message : String(thrown),
            }))
            .then((checked) => {
                this.checking = undefined
                const now = Date.now()
                this.lastChecked = now
                this.unreachableInARow =
                    checked.outcome === 'unreachable'
                        ? this.unreachableInARow + 1
                        : 0
                this.due =
                    now +
                    (this.unreachableInARow === 0
                        ? CHECK_INTERVAL
                        : Math.min(
                              RETRY_INTERVAL *
                                  2 ** (this.unreachableInARow - 1),
                              CHECK_INTERVAL,
                          ))
                logged(
                    checked.outcome === 'staged'
                        ? `${this.version}: staged ${checked.staged.version}`
                        : checked.outcome === 'current'
                          ? `${this.version}: current`
                          : `${this.version}: ${checked.outcome} ${checked.reason}`,
                )
                return checked
            })
        return this.checking
    }

    /**
     * 38.142 — checks where one is due by the wall clock, answering `undefined` where none is.
     * `nudged` — the Mac woke, or the app came to the front — makes one due `NUDGE_INTERVAL` after
     * the last.
     */
    checkWhenDue(
        nudged: boolean,
        now = Date.now(),
    ): Promise<Checked> | undefined {
        const due = nudged
            ? Math.min(this.due, this.lastChecked + NUDGE_INTERVAL)
            : this.due
        return now >= due ? this.check() : undefined
    }

    async checked(): Promise<Checked> {
        const { signal } = this.stopping
        const newest = this.staged?.version ?? this.version
        let answered: unknown
        try {
            const response = await fetch(this.feed, {
                cache: 'no-store',
                signal: AbortSignal.any([
                    signal,
                    AbortSignal.timeout(FEED_TIMEOUT),
                ]),
            })
            if (!response.ok)
                return {
                    outcome: 'unreachable',
                    reason: `${this.feed} answered ${response.status}`,
                }
            answered = await response.json()
        } catch (thrown) {
            return {
                outcome: 'unreachable',
                reason: `${this.feed} could not be read: ${(thrown as Error).message}`,
            }
        }
        const feed = await verifiedFeed(answered, this.publicKey)
        if (typeof feed === 'string')
            return { outcome: 'refused', reason: feed }
        // 38.142 — only forward: a feed rolled back to an older build leaves this one standing, and
        // one naming what is staged leaves that staged.
        if (Bun.semver.order(feed.version, newest) <= 0)
            return this.staged === undefined
                ? { outcome: 'current' }
                : { outcome: 'staged', staged: this.staged }
        const zip = await fetch(new URL(feed.file, this.feed), {
            signal: AbortSignal.any([signal, AbortSignal.timeout(ZIP_TIMEOUT)]),
        })
            .then((response) =>
                response.ok
                    ? response.bytes()
                    : Promise.reject(response.status),
            )
            .catch(() => undefined)
        if (zip === undefined || signal.aborted)
            return {
                outcome: 'unreachable',
                reason: `${new URL(feed.file, this.feed)} could not be read`,
            }
        // 38.143.
        if (
            new Bun.CryptoHasher('sha256').update(zip).digest('hex') !==
            feed.sha256
        )
            return {
                outcome: 'refused',
                reason: `${feed.file} is not the file the update feed signed`,
            }
        const staging = `${this.app}.update`
        try {
            await rm(staging, { recursive: true, force: true })
            await Bun.write(`${staging}/${feed.file}`, zip)
            await ran(['ditto', '-x', '-k', `${staging}/${feed.file}`, staging])
            const unzipped = (await readdir(staging)).find((entry) =>
                entry.endsWith('.app'),
            )
            if (unzipped === undefined)
                throw new Error(`${feed.file} holds no .app`)
            this.staged = {
                version: feed.version,
                required: feed.required,
                notes: feed.notes ?? undefined,
                app: `${staging}/${unzipped}`,
            }
        } catch (thrown) {
            await rm(staging, { recursive: true, force: true })
            // What was staged before was unpacked where this one failed to be.
            if (this.staged !== undefined) {
                this.staged = undefined
                this.onStaged(undefined)
            }
            return {
                outcome: 'refused',
                reason: `the update could not be unpacked beside ${this.app}: ${(thrown as Error).message}`,
            }
        }
        this.onStaged(this.staged)
        return { outcome: 'staged', staged: this.staged }
    }

    /**
     * 38.144 — puts the staged `.app` where this one is; answers whether it did. Where the second
     * rename fails the first is undone, so the app that ran is the app that is there.
     */
    async install(): Promise<boolean> {
        this.stopping.abort()
        await this.checking
        const staged = this.staged
        if (staged === undefined) return false
        const replaced = `${this.app}.replaced`
        await rm(replaced, { recursive: true, force: true })
        await rename(this.app, replaced)
        try {
            await rename(staged.app, this.app)
        } catch (thrown) {
            await rename(replaced, this.app)
            throw thrown
        }
        this.staged = undefined
        await rm(replaced, { recursive: true, force: true })
        await rm(`${this.app}.update`, { recursive: true, force: true })
        return true
    }
}
