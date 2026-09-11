// THE FRACTION, WITH A STATED DENOMINATOR. Not a timer — the engine lane's primary
// export is the number that says whether changing a layer can matter at all.
//
// Two reactive-core rewrites landed as no-ops because the path they improved is 0.055
// of a 1.45 ms op: the ceiling was 4% and both changes were inside the noise. A
// denominator that is optional is a denominator somebody omits, so it is required,
// and so is the threshold — "the expectation is that this layer is a few percent" is
// a prediction and gives nobody a reason to stop, where a frame or an interaction
// budget is a threshold and does.

import { THRESHOLDS } from '../report/THRESHOLDS.ts'
import type { Trace } from './Trace.ts'

export type SharesSpec = {
    // The numerator, by the name the code under test measured it under.
    layer: string
    // The denominator. The WHOLE op somebody waits on, not the layer's parent.
    of: string
    threshold: keyof typeof THRESHOLDS
}

export type Shares = {
    op: string
    layer: string
    layerNanoseconds: number
    opNanoseconds: number
    // The share, which is also the CPU ceiling: an optimisation is capped by the
    // fraction of the op it touches. One number, not two — the sketch returned the
    // fraction twice, once as `layer` and once as `ceilingCpu`.
    ceilingCpu: number
    // What a user would experience. ZERO whenever the op is under one frame: click ->
    // paint is frame quantised, so removing 4.3% of an op that gets rounded up to the
    // next frame boundary changes observed latency by exactly nothing. CPU is for
    // seeing which way the headroom runs and is never quoted as latency.
    ceilingObserved: number
    threshold: keyof typeof THRESHOLDS
    underOneFrame: boolean
    overTheThreshold: boolean
}

function measuresNamed(
    trace: Trace,
    name: string,
): { startNanoseconds: number; endNanoseconds: number }[] {
    const found: { startNanoseconds: number; endNanoseconds: number }[] = []
    for (const measure of trace.measures)
        if (measure.name === name) found.push(measure)
    return found
}

export function shares(trace: Trace, spec: SharesSpec): Shares {
    // `within` is WITHDRAWN, and it is refused rather than ignored. It was there to
    // compose — a fraction of click -> paint times a fraction of navigation -> paint
    // — but the reconcile does not run inside navigation -> paint; hydration does.
    // Multiplying a fraction of an INTERACTION op by a fraction of a FIRST-LOAD op
    // produces a number describing no op at all, and the two chains never meet.
    if ('within' in spec)
        throw new Error(
            `shares("${spec.of}") was given a \`within\`. Composition is sound down ONE nesting chain, and first load and interaction are two: a first-load ceiling and an interaction ceiling are separate numbers, and neither bounds the other.`,
        )

    const denominators = measuresNamed(trace, spec.of)
    if (denominators.length !== 1)
        throw new Error(
            `shares("${spec.of}") found ${denominators.length} measures named "${spec.of}" in the trace of "${trace.op}". The denominator is one op somebody waits on.`,
        )
    const numerators = measuresNamed(trace, spec.layer)
    if (numerators.length === 0)
        throw new Error(
            `shares("${spec.of}") found no measure named "${spec.layer}". The code under test emits the marks; the sampler at ~1 ms cannot resolve a layer inside a 1.45 ms op.`,
        )

    const op = denominators[0] as {
        startNanoseconds: number
        endNanoseconds: number
    }
    // CONTAINMENT IS CHECKED, not assumed — the assumption the withdrawn `within`
    // violated silently. A layer that also runs OUTSIDE the op — a second flush, an
    // idle pass — is a throw, not a smaller fraction.
    let layerNanoseconds = 0
    for (const run of numerators) {
        if (
            run.startNanoseconds < op.startNanoseconds ||
            run.endNanoseconds > op.endNanoseconds
        )
            throw new Error(
                `shares("${spec.of}") found "${spec.layer}" running outside it. A layer that runs outside the op is a throw, not a smaller fraction.`,
            )
        layerNanoseconds += run.endNanoseconds - run.startNanoseconds
    }

    const opNanoseconds = op.endNanoseconds - op.startNanoseconds
    if (opNanoseconds <= 0)
        throw new Error(
            `shares("${spec.of}") measured the op at ${opNanoseconds} ns. There is no fraction of zero.`,
        )
    const ceilingCpu = layerNanoseconds / opNanoseconds
    const underOneFrame = opNanoseconds < THRESHOLDS.frame
    return {
        op: spec.of,
        layer: spec.layer,
        layerNanoseconds,
        opNanoseconds,
        ceilingCpu,
        ceilingObserved: underOneFrame ? 0 : ceilingCpu,
        threshold: spec.threshold,
        underOneFrame,
        overTheThreshold: opNanoseconds >= THRESHOLDS[spec.threshold],
    }
}
