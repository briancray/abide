// THE CLAIM. A performance claim is a ratio against hand-written code in the same
// substrate, and this is the only thing in the package that divides two durations.
//
// It returns a DISCRIMINATED result rather than a number, and that is the whole point
// of the type: two `underOneFrame` samples divide to 1.01x, which is `read-invoice`'s
// hand-typed "First paint 16.8 ms / 16.7 ms / 1.01x" — noise published as a claim, by
// the producer that exists to refuse it.

import type { Sample } from './Sample.ts'

export type Ratio =
    | {
          kind: 'ratio'
          case: string
          numerator: string
          denominator: string
          value: number
          workDisagreement: string[]
      }
    | {
          kind: 'underOneFrame'
          case: string
          numerator: string
          denominator: string
          workDisagreement: string[]
      }
    | {
          kind: 'underTheFloor'
          case: string
          numerator: string
          denominator: string
          floor: number
          workDisagreement: string[]
      }

export type RatioSpec = {
    // The A/A spread `batch()` measured for this case, on this machine, today.
    floor: number
    // How far two arms' work counters may diverge before the comparison is flagged.
    // Byte-identical page source ran 4.5x apart because one arm shipped a stylesheet
    // and the other was therefore not doing the work at all.
    workFactor?: number
}

const DEFAULT_WORK_FACTOR = 1.05

// An existence proof is believed AFTER the counters agree, not before. This was prose
// with nothing wired to it, and an arm you wrote yourself gets more of this, not less.
function disagreeingWork(
    numerator: Sample,
    denominator: Sample,
    factor: number,
): string[] {
    const one = numerator.work
    const two = denominator.work
    if (!one || !two) return []
    const flagged: string[] = []
    const counters = new Set([...Object.keys(one), ...Object.keys(two)])
    for (const counter of counters) {
        const left = one[counter] ?? 0
        const right = two[counter] ?? 0
        if (left === right) continue
        const larger = Math.max(left, right)
        const smaller = Math.min(left, right)
        if (smaller === 0 || larger / smaller > factor)
            flagged.push(
                `${counter}: ${numerator.arm} ${left}, ${denominator.arm} ${right}`,
            )
    }
    return flagged
}

export function ratio(
    numerator: Sample,
    denominator: Sample,
    spec: RatioSpec,
): Ratio {
    if (numerator.arm === denominator.arm)
        throw new Error(
            `ratio() was given "${numerator.arm}" twice — an arm measured against itself.`,
        )
    if (numerator.case !== denominator.case)
        throw new Error(
            `ratio() was given two cases: "${numerator.case}" and "${denominator.case}".`,
        )
    // Refusal 1. The same graph is 1.67x a hand-written signal under JSC and 0.21x
    // under V8 — inverted, not scaled, so there is no number to average.
    if (numerator.substrate !== denominator.substrate)
        throw new Error(
            `ratio("${numerator.case}") was given a ${numerator.substrate} arm and a ${denominator.substrate} arm. Both arms or neither.`,
        )
    if (numerator.n !== denominator.n)
        throw new Error(
            `ratio("${numerator.case}") was given n=${numerator.n} against n=${denominator.n}. A per-op figure at n=10,000 has different GC and cache behaviour than at n=10.`,
        )

    const workDisagreement = disagreeingWork(
        numerator,
        denominator,
        spec.workFactor ?? DEFAULT_WORK_FACTOR,
    )
    const shared = {
        case: numerator.case,
        numerator: numerator.arm,
        denominator: denominator.arm,
        workDisagreement,
    }
    if (numerator.underOneFrame || denominator.underOneFrame)
        return { kind: 'underOneFrame', ...shared }
    const value = numerator.nanoseconds / denominator.nanoseconds
    if (Math.abs(value - 1) <= spec.floor)
        return { kind: 'underTheFloor', ...shared, floor: spec.floor }
    return { kind: 'ratio', ...shared, value }
}
