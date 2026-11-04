import { type FSWatcher, watch } from 'node:fs' // bun exposes no file watcher of its own

import { type AppChecker, openChecker } from './compileApp.ts'

/**
 * An app's checker kept for as long as a server runs, opened when first asked for and told what its
 * watchers see move.
 *
 * `abide dev` and `abide lsp` keep one each, because spawning a checker is most of what a compile
 * costs. WHAT KEEPING ONE TAKES is here rather than in either: one whose project moved
 * (`AppChecker.current`) is closed and another opened, and one a question threw from is dropped —
 * the checker's own process dying is a throw too, and a session nobody can tell apart from a dead
 * one is not one to keep. `heard` is told every move after the checker is, so what it schedules
 * reads a checker that already knows.
 */
export class KeptChecker {
    readonly root: string
    private readonly heard: (path: string | undefined) => void
    private readonly watchers: FSWatcher[] = []
    private readonly watched = new Set<string>()
    private checker: Promise<AppChecker> | undefined
    private readonly open: (root: string) => Promise<AppChecker>

    constructor(
        root: string,
        heard: (path: string | undefined) => void = () => {},
        open: (root: string) => Promise<AppChecker> = openChecker,
    ) {
        this.root = root
        this.heard = heard
        this.open = open
        this.watch(root, true)
    }

    /** A checker on the project as it stands: the one kept where it still is, or a fresh one. */
    async live(): Promise<AppChecker> {
        const kept = this.checker
        if (kept !== undefined) {
            const checker = await kept.catch(() => undefined)
            if (checker?.current()) return checker
            if (this.checker === kept) await this.drop()
        }
        this.checker ??= this.open(this.root)
        return this.checker
    }

    /** `question` asked of a live checker; a throw drops it, so the next question opens another. */
    async run<Answer>(
        question: (checker: AppChecker) => Promise<Answer>,
    ): Promise<Answer> {
        try {
            return await question(await this.live())
        } catch (thrown) {
            await this.drop()
            throw thrown
        }
    }

    /** Watches `directory` too — a linked package's, outside the root — once for the session. */
    watch(directory: string, recursive = false): void {
        if (this.watched.has(directory)) return
        this.watched.add(directory)
        this.watchers.push(
            watch(directory, { recursive }, (_event, filename) =>
                this.saw(
                    filename === null ? undefined : `${directory}/${filename}`,
                ),
            ),
        )
    }

    /** Records a move at `path`, or one nobody could place, then tells `heard`. */
    saw(path: string | undefined): void {
        void this.checker?.then(
            (checker) => checker.saw(path),
            () => {},
        )
        this.heard(path)
    }

    /** Stops watching and closes the checker. */
    async close(): Promise<void> {
        for (const watcher of this.watchers) watcher.close()
        this.watchers.length = 0
        await this.drop()
    }

    private async drop(): Promise<void> {
        const dropped = this.checker
        this.checker = undefined
        try {
            await (await dropped)?.close()
        } catch {
            // Already gone, which is what closing it was for.
        }
    }
}
