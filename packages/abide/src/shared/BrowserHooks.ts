// 37.16, 37.18, 37.21 — A HOOK A COMPONENT FILES IN THE BROWSER, for as long as it stands, and what
// it is handed: `onError`'s and `onRefusal`'s (37.22-37.25) are filed and handed by this one class,
// so the two cannot come apart on where they file, whom they hand first, or what a throw does.

import { namedLogger } from './log.ts'
import { SCOPING } from './reactive/scoping.ts'
import { owned, settingUp } from './reactive/watch.ts'

const LIFECYCLE_LOG = namedLogger('abide:lifecycle')

/** The hooks of one name filed in this browser, and the walk that hands them what they hear. */
export class BrowserHooks<Handed extends unknown[]> {
    // IN THE ORDER FILED, which is outermost first: a layout's setup runs before the page inside it.
    private readonly filed: { hook: (...handed: Handed) => unknown }[] = []
    private readonly name: string
    /** 37.21 — what a call that could never file throws. */
    private readonly misplaced: string
    /** Run before the first hook is filed — `onError`'s listeners. */
    private first: (() => void) | undefined

    constructor(
        name: string,
        misplaced: string,
        first: (() => void) | undefined = undefined,
    ) {
        this.name = name
        this.misplaced = misplaced
        this.first = first
    }

    /** Whether no hook is filed. */
    empty(): boolean {
        return this.filed.length === 0
    }

    /** Files `hook` while the calling component stands; returns what unfiles it. */
    file(hook: (...handed: Handed) => unknown): () => void {
        if (!settingUp()) {
            // ONLY A BROWSER COLLECTS A SETUP, so a server's render — in a process with a document
            // or without one — files nothing.
            if (SCOPING.provider?.serving() === true) return () => {}
            // 37.21 — ANYWHERE ELSE IT COULD NEVER FILE: a call outside a component's setup has
            // nothing to stand for.
            throw new Error(this.misplaced)
        }
        if (this.first !== undefined) {
            const first = this.first
            this.first = undefined
            first()
        }
        const entry = { hook }
        const filed = this.filed
        filed.push(entry)
        return owned(() => {
            const at = filed.indexOf(entry)
            if (at !== -1) filed.splice(at, 1)
        })
    }

    /**
     * 37.17, 37.18 — hands every hook filed what it hears, NEAREST FIRST, which is the last filed. A
     * hook that throws is written rather than handed on, where it would surface as uncaught.
     */
    hand(...handed: Handed): void {
        const filed = this.filed
        for (let at = filed.length - 1; at >= 0; at -= 1) {
            // A hook that unfiled one on its way leaves the walk past the end.
            const entry = filed[at]
            if (entry === undefined) continue
            try {
                entry.hook(...handed)
            } catch (thrown) {
                LIFECYCLE_LOG.error(`an ${this.name} hook threw`, thrown)
            }
        }
    }
}
