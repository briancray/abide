import { relative, resolve } from 'node:path' // bun exposes no path helpers of its own

import { BuildRefusal } from './BuildRefusal.ts'
import { citedClauses } from './citedClauses.ts'
import { isIgnored } from './isIgnored.ts'
import { lineOf } from './lineOf.ts'
import { PositionedRefusal } from './PositionedRefusal.ts'

// EVERYTHING THE COMPILER HAS TO SAY, IN ONE PLACE: what a finding is, where it lands on the line an
// author wrote, which an author silenced, the order the lot is reported in, and the one line each is
// printed as. `abide build`, `abide dev`, `abide check`, `abide format` and `abide lsp` all read
// findings off this, so none of them decides for itself what a refusal does or how a warning reads.

/**
 * One thing the checker said, placed in the file the author wrote.
 *
 * 38.3 — line and column from 1.
 */
export type Diagnosis = {
    path: string
    line: number
    column: number
    code: number
    category: 'error' | 'warning' | 'suggestion' | 'message'
    message: string
}

/** A warning or a refusal at a projection offset. */
export type Finding = { at: number; message: string }

/**
 * Where everything a compile finds goes, each at the file it was found in.
 *
 * TWO MODES AND ONE CALL for a refusal: a build stops at one, so a throwing sink throws it; `abide
 * check` reports every one at its file and goes on (38.33), so a collecting sink keeps each as a
 * finding at the file's first line. A warning is kept either way — it does not stop a build — and so
 * is what the checker says (`checked`). Every stage takes this and nothing else, so no stage decides
 * for itself what a refusal does, and none spells a path its own way: a file is named relative to
 * `root` or absolutely, and kept absolute.
 */
export class Diagnostics {
    /** Every refusal kept, in the order met; empty in a throwing sink. */
    readonly refused: Diagnosis[] = []
    /** Every warning the compiler raised, in the order met (14, 32.14, 11.30, 18.15). */
    readonly warnings: Diagnosis[] = []
    /** What the checker said of each file (38.3). */
    readonly checked: Diagnosis[] = []
    /** What a file below the root is named relative to. */
    readonly root: string
    /** Whether a refusal is kept and the compile goes on, rather than thrown. */
    readonly collecting: boolean

    constructor(root: string, collecting: boolean) {
        this.root = root
        this.collecting = collecting
    }

    /** Every finding, in the order reported: the refusals, the warnings, then the checker's. */
    get findings(): Diagnosis[] {
        return [...this.refused, ...this.warnings, ...this.checked]
    }

    /**
     * Refuses at `file`, below the root or absolute: `thrown` is thrown, or kept. Handed the file's
     * `text`, a `PositionedRefusal` is placed on its line and column, and thrown as that line.
     */
    at(file: string, thrown: unknown, text?: string): void {
        const positioned =
            text !== undefined && thrown instanceof PositionedRefusal
        // 38.139 — A REFUSAL CITES ITS CLAUSE, and is printed as a line at its file. A throw that cites
        // none is a crash in the compiler, thrown as it was for its stack; and one a stage below
        // already filed is not filed again at the root.
        if (
            !this.collecting &&
            !positioned &&
            (thrown instanceof BuildRefusal ||
                !(thrown instanceof Error) ||
                citedClauses(thrown.message).length === 0)
        )
            throw thrown
        const diagnosis = diagnosisAt(
            resolve(this.root, file),
            positioned ? text : undefined,
            positioned ? thrown.offset : 0,
            'error',
            thrown instanceof Error ? thrown.message : String(thrown),
        )
        if (!this.collecting)
            throw new BuildRefusal(formatDiagnosis(diagnosis, process.cwd()))
        this.refused.push(diagnosis)
    }

    /**
     * What another stage kept, as this one takes it: every one kept, or every one thrown as one
     * error, each at its file — a build that stops names all it found rather than a first one and a
     * second run (11.37).
     */
    adopt(found: readonly Diagnosis[]): void {
        if (found.length === 0) return
        if (this.collecting) {
            this.refused.push(...found)
            return
        }
        const lines: string[] = []
        for (const one of found) lines.push(formatDiagnosis(one, process.cwd()))
        throw new BuildRefusal(lines.join('\n'))
    }

    /** Keeps `found` as warnings: the build goes on. */
    warn(found: readonly Diagnosis[]): void {
        this.warnings.push(...found)
    }

    /** Keeps what the checker said. */
    check(found: readonly Diagnosis[]): void {
        this.checked.push(...found)
    }
}

/** abide's own finding at `offset` into `text`, or at line 0 where the text was not handed in. */
export function diagnosisAt(
    path: string,
    text: string | undefined,
    offset: number,
    category: Diagnosis['category'],
    message: string,
): Diagnosis {
    return {
        path,
        ...(text === undefined ? { line: 0, column: 0 } : lineOf(text, offset)),
        code: 0,
        category,
        message,
    }
}

/**
 * Each of `findings`, at an offset `place` maps into the file at `path` the author wrote, as a
 * finding on its line — or on line 0 where the text was not handed in.
 *
 * 14.19 — `reads`: they are warnings on reactive reads, and one the line above silences with
 * `abide-ignore` and its clause is left out. No other finding is silenced so.
 */
export function placedFindings(
    path: string,
    text: string | undefined,
    findings: readonly Finding[],
    place: (at: number) => number,
    category: Diagnosis['category'],
    reads = false,
): Diagnosis[] {
    const placed: Diagnosis[] = []
    for (const finding of findings) {
        const offset = place(finding.at)
        if (
            reads &&
            text !== undefined &&
            isIgnored(text, offset, finding.message)
        )
            continue
        placed.push(diagnosisAt(path, text, offset, category, finding.message))
    }
    return placed
}

/** Orders findings by file, then line, then column. */
export function byPlace(one: Diagnosis, two: Diagnosis): number {
    return (
        one.path.localeCompare(two.path) ||
        one.line - two.line ||
        one.column - two.column
    )
}

/**
 * One finding as one `tsc`-style line.
 *
 * ONE LINE A FINDING, in the shape `tsc` and every editor's problem matcher already read:
 * `file:line:column - error TS2322: …`, the path relative to `from`. A finding with no line — a
 * whole-file or whole-app refusal — names the file alone.
 */
export function formatDiagnosis(diagnosis: Diagnosis, from: string): string {
    const path = relative(from, diagnosis.path) || diagnosis.path
    const where =
        diagnosis.line === 0
            ? path
            : `${path}:${diagnosis.line}:${diagnosis.column}`
    const code = diagnosis.code === 0 ? '' : ` TS${diagnosis.code}`
    return `${where} - ${diagnosis.category}${code}: ${diagnosis.message}`
}

/**
 * Writes each error and warning in `found` as its line, relative to where the command was run, and
 * answers how many of each — what every command that reports findings prints. A suggestion or a
 * message is neither, and is not written.
 */
export function printDiagnoses(
    found: readonly Diagnosis[],
    write: (line: string) => void,
): { errors: number; warnings: number } {
    let errors = 0
    let warnings = 0
    for (const diagnosis of found) {
        if (diagnosis.category === 'error') errors += 1
        else if (diagnosis.category === 'warning') warnings += 1
        else continue
        write(formatDiagnosis(diagnosis, process.cwd()))
    }
    return { errors, warnings }
}
