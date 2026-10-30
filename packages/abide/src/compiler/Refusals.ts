import { resolve } from 'node:path' // bun exposes no path helpers of its own

import { formatDiagnosis } from './formatDiagnosis.ts'
import { diagnosisAt } from './lineOf.ts'
import { PositionedRefusal } from './PositionedRefusal.ts'
import type { Diagnosis } from './TypeSession.ts'

/**
 * Where everything the compile refuses goes, each at the file it was refused in.
 *
 * TWO MODES AND ONE CALL: a build stops at a refusal, so a throwing sink throws it; `abide
 * check` reports every one at its file and goes on (38.33), so a collecting sink keeps each as a
 * finding at the file's first line. Every stage takes this and nothing else, so no stage decides for
 * itself what a refusal does, and none spells a path its own way: a file is named relative to `root`
 * or absolutely, and kept absolute.
 */
export class Refusals {
    /** Every refusal kept, in the order met; empty in a throwing sink. */
    readonly found: Diagnosis[] = []
    /** What a file below the root is named relative to. */
    readonly root: string
    /** Whether a refusal is kept and the compile goes on, rather than thrown. */
    readonly collecting: boolean

    constructor(root: string, collecting: boolean) {
        this.root = root
        this.collecting = collecting
    }

    /**
     * Refuses at `file`, below the root or absolute: `thrown` is thrown, or kept. Handed the file's
     * `text`, a `PositionedRefusal` is placed on its line and column, and thrown as that line.
     */
    at(file: string, thrown: unknown, text?: string): void {
        const positioned =
            text !== undefined && thrown instanceof PositionedRefusal
        if (!this.collecting && !positioned) throw thrown
        const diagnosis = diagnosisAt(
            resolve(this.root, file),
            positioned ? text : undefined,
            positioned ? thrown.offset : 0,
            'error',
            thrown instanceof Error ? thrown.message : String(thrown),
        )
        if (!this.collecting)
            throw new Error(formatDiagnosis(diagnosis, process.cwd()))
        this.found.push(diagnosis)
    }

    /**
     * What another stage kept, as this one takes it: every one kept, or every one thrown as one
     * error, each at its file — a build that stops names all it found rather than a first one and a
     * second run (11.37).
     */
    adopt(found: readonly Diagnosis[]): void {
        if (found.length === 0) return
        if (this.collecting) {
            this.found.push(...found)
            return
        }
        const lines: string[] = []
        for (const one of found) lines.push(formatDiagnosis(one, process.cwd()))
        throw new Error(lines.join('\n'))
    }
}
