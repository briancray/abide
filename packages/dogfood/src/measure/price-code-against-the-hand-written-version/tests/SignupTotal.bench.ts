import { reactive } from '@abide/abide'
import { type Batched, batch, claimOf, ratio } from '@abide/harness/report'
import { sumDays } from '../lib/sumDays.ts'

// The total as the card keeps it, and as a plain call.
const days = reactive(30)
const total = reactive(() => sumDays(days()))
let plainDays = 30

/** Both arms timed in interleaved batches, with the A/A floor between them. */
export function priced(): Batched {
    return batch({
        case: 'switch the range, read the total',
        emulated: null,
        arms: {
            handWritten: () => {
                plainDays = plainDays === 30 ? 90 : 30
                sumDays(plainDays)
            },
            abide: () => {
                days.set(days() === 30 ? 90 : 30)
                total()
            },
        },
    })
}

if (import.meta.main) {
    const measured = priced()
    const { abide, handWritten } = measured.samples
    if (abide && handWritten)
        console.log(
            claimOf(ratio(abide, handWritten, { floor: measured.floor })),
        )
}
