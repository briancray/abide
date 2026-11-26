import { rpc } from '@abide/abide/server'

import { LOADS } from './lib/LOADS.server.ts'
import { NOTES } from './lib/NOTES.server.ts'

/** Saves the note on a deal. */
export default rpc(
    ({ id, note }: { id: string; note: string }) => {
        LOADS.saves = (LOADS.saves ?? 0) + 1
        NOTES[id] = note
    },
    { methods: ['POST'], description: 'Saves the note on a deal.' },
)
