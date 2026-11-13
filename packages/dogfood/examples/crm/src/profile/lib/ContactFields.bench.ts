import { reactive } from '@abide/abide'
import { batch, type Batched } from '@abide/harness/report'

// The field as the card keeps it, holding `length` characters.
function typing(length: number): () => void {
    const typed = 'a'.repeat(length - 1)
    // Two values a keystroke apart, differing in the last character.
    const keystrokes = [`${typed}b`, `${typed}c`]
    const email = reactive(keystrokes[0] as string)
    email()
    let at = 0
    return () => {
        at ^= 1
        email.set(keystrokes[at] as string)
        email()
    }
}

// The most a keystroke may take in 1,000 characters, in milliseconds.
export const CEILINGS = { priced: { 'of 1,000 characters': 1 } }

/** A keystroke into a field of 100 characters, and of 1,000. */
export function priced(): Batched {
    return batch({
        case: 'type into the field, read what a save would send',
        emulated: null,
        arms: {
            'of 100 characters': typing(100),
            'of 1,000 characters': typing(1000),
        },
    })
}
