// THE LIST CASES, BUILT INTO ONE FILE A PAGE CAN BE INJECTED WITH. Same shape as
// `reactiveInjectable.ts`, and separate for the same reason that one is separate from
// the measure lane's: what this imports is abide's RUNTIME reconcile, and it only ever
// runs in a browser, because a duration whose op touched an emulated DOM is refused.
//
// TWO RATIOS PER CASE, not one. Against the careful hand-written floor — the fewest
// `insertBefore` calls the edit needs — a ratio says what the reconcile COSTS. Against
// the `innerHTML` rebuild it says what it BUYS. A row carrying only the first is the
// bill with no receipt, and a row carrying only the second is marketing.

import { batch, claimOf, ratio, type Sample } from 'harness/report'
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
    substrate: string
}

function run(): Row[] {
    const rows: Row[] = []
    for (const kase of listCases()) {
        const arms = kase.setup()
        const measured = batch({
            case: kase.name,
            arms: {
                vanilla: arms.vanilla,
                abide: arms.abide,
                careless: arms.careless,
            },
            emulated: null,
            // A browser clock is ~2,400x coarser than bun's, and a 200-row reorder is
            // far dearer than a signal write, so the default ceiling is not enough.
            budgetNanoseconds: 20_000_000_000,
        })
        const abide = measured.samples.abide as Sample
        const vanilla = measured.samples.vanilla as Sample
        const careless = measured.samples.careless as Sample
        rows.push({
            case: kase.name,
            distinguishes: kase.distinguishes,
            abide: abide.nanoseconds,
            vanilla: vanilla.nanoseconds,
            careless: careless.nanoseconds,
            costClaim: claimOf(
                ratio(abide, vanilla, { floor: measured.floor }),
            ),
            buysClaim: claimOf(
                ratio(abide, careless, { floor: measured.floor }),
            ),
            n: measured.n,
            floor: measured.floor,
            substrate: measured.substrate,
        })
        // The hosts are attached, and three per case over four cases is twelve 200-row
        // lists left in the document — which the NEXT case would then be laid out
        // behind.
        document.body.replaceChildren()
    }
    return rows
}

;(globalThis as unknown as { __LIST_BENCH__: () => Row[] }).__LIST_BENCH__ = run
