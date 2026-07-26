import { type Channel, channel } from 'abide/shared/channel'

// A ROOMED channel (ADR 0023) owned by a shared module. `Args` names the room: each distinct args value
// gets its own hub, created lazily — exactly how a `memo` keeps one slot per args. Two RPCs drive it
// (publish into a room / read a room's tail), which is what the /channel rooms card demonstrates.
//
// This lives in a plain `.ts` rather than inline in the `.abide` demo for a mechanical reason: an
// `.abide` <script> cannot yet parse a type-argument list with a top-level comma (`channel<T, Args>`),
// so a two-parameter generic is only expressible outside a template today.
//
// Module-level, so PROCESS-GLOBAL — one set of rooms across all requests, like any module-level state.
export interface RoomNote {
    at: number
    text: string
}

export interface RoomArgs {
    room: string
}

export const notes: Channel<RoomNote, RoomArgs> = channel<RoomNote, RoomArgs>({ tail: 3 })

// Monotonic message counter, so a note carries a visible ordinal.
export const roomSequence = { next: 0 }
