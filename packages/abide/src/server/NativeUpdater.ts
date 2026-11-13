// 38.142-38.145 — A NATIVE APP KEEPING ITSELF CURRENT: the feed `onLauncher`'s `update` names is
// read, a newer `.app` it signs is unzipped beside this one, and the two change places as the app
// quits — after `App.stop` (38.76), so nothing is running out of the bundle being replaced.
//
// STAGED BESIDE THE `.app`, on the same volume, so the swap is two renames rather than a copy a
// crash could leave half done.

import { readdir, rename, rm } from 'node:fs/promises' // bun exposes no directory listing, rename or removal of its own

import { FEED_FILE, ran, verifiedFeed } from './updateFeed.ts'

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

export class NativeUpdater {
    feed: URL
    publicKey: string
    /** The `.app` this process runs from, which an update replaces. */
    app: string
    version: string
    staged: Staged | undefined
    checking: Promise<Checked> | undefined
    /** Told of an update the moment it is staged. */
    onStaged: (staged: Staged) => void

    constructor(
        update: string,
        publicKey: string,
        app: string,
        version: string,
        onStaged: (staged: Staged) => void,
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
    }

    /** Reads the feed, and stages what it names where it is newer; one check at a time. */
    check(): Promise<Checked> {
        if (this.staged !== undefined)
            return Promise.resolve({ outcome: 'staged', staged: this.staged })
        this.checking ??= this.checked().finally(() => {
            this.checking = undefined
        })
        return this.checking
    }

    async checked(): Promise<Checked> {
        let answered: unknown
        try {
            const response = await fetch(this.feed, { cache: 'no-store' })
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
        // 38.142 — only forward: a feed rolled back to an older build leaves this one standing.
        if (Bun.semver.order(feed.version, this.version) <= 0)
            return { outcome: 'current' }
        const zip = await fetch(new URL(feed.file, this.feed))
            .then((response) =>
                response.ok
                    ? response.bytes()
                    : Promise.reject(response.status),
            )
            .catch(() => undefined)
        if (zip === undefined)
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
