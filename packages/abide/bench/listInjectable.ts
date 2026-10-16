// THE LIST CASES, BUILT INTO ONE FILE A PAGE CAN BE INJECTED WITH. Same shape as
// `reactiveInjectable.ts`, and separate for the same reason that one is separate from
// the measure lane's: what this imports is abide's RUNTIME reconcile, and it only ever
// runs in a browser, because a duration whose op touched an emulated DOM is refused.
//
// TWO RATIOS PER CASE, not one. Against the careful hand-written floor — the fewest
// `insertBefore` calls the edit needs — a ratio says what the reconcile COSTS. Against
// the `innerHTML` rebuild it says what it BUYS. A row carrying only the first is the
// bill with no receipt, and a row carrying only the second is marketing.

import {
    batch,
    claimOf,
    emulatedDom,
    ratio,
    type Sample,
} from '@abide/harness/report'
import { listCases } from './listCases.ts'

type Row = {
    case: string
    distinguishes: string
    abide: number
    vanilla: number
    careless: number
    costClaim: string
    buysClaim: string
    n: number
    floor: number
    buysN: number
    buysFloor: number
    substrate: string
    workDisagreement: string[]
    wrong: string[]
}

function run(): Row[] {
    const rows: Row[] = []
    for (const kase of listCases()) {
        const arms = kase.setup()
        // COUNTED APART FROM THE TIMING, because the observer would be inside the op.
        const work = arms.work()
        // TWO BATCHES, NOT ONE. `batch()` sizes n by the FASTEST arm, so all three arms in one
        // call run the rebuild at the n a single `insertBefore` needs: n=57,524 on the adjacent
        // swap, one rep in twenty seconds, and the case refused. Each ratio is between two arms
        // of comparable cost, each with its own interleave and its own A/A floor.
        // A browser clock is ~2,400x coarser than bun's, and a 200-row reorder is far dearer
        // than a signal write, so the default ceiling is not enough.
        const budgetNanoseconds = 20_000_000_000
        const against = batch({
            case: kase.name,
            arms: { vanilla: arms.vanilla, abide: arms.abide },
            emulated: emulatedDom(),
            work,
            budgetNanoseconds,
        })
        const over = batch({
            case: kase.name,
            arms: { abide: arms.abide, careless: arms.careless },
            emulated: emulatedDom(),
            work,
            budgetNanoseconds,
        })
        const abide = against.samples.abide as Sample
        const vanilla = against.samples.vanilla as Sample
        const careless = over.samples.careless as Sample
        const cost = ratio(abide, vanilla, { floor: against.floor })
        const buys = ratio(over.samples.abide as Sample, careless, {
            floor: over.floor,
        })
        rows.push({
            case: kase.name,
            distinguishes: kase.distinguishes,
            abide: abide.nanoseconds,
            vanilla: vanilla.nanoseconds,
            careless: careless.nanoseconds,
            costClaim: claimOf(cost),
            buysClaim: claimOf(buys),
            n: against.n,
            floor: against.floor,
            buysN: over.n,
            buysFloor: over.floor,
            substrate: against.substrate,
            // Against the FLOOR only: the rebuild creates every row by design, so its
            // disagreement is the receipt rather than a fault.
            workDisagreement: cost.workDisagreement,
            wrong: arms.verify(),
        })
        // The hosts are attached, and three per case over four cases is twelve 200-row
        // lists left in the document — which the NEXT case would then be laid out
        // behind.
        document.body.replaceChildren()
    }
    return rows
}

;(globalThis as unknown as { __LIST_BENCH__: () => Row[] }).__LIST_BENCH__ = run
