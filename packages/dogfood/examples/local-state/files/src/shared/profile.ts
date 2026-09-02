// A `.ts` file has no sugar over a reactive value, so the two
// members are what you write here — and they are the same two
// the page's `handle = ''` is spelled over.
import { state } from 'abide'
import { getProfile } from '#server/rpc/users'

// Given a LOAD, so `pending()` is true until the row lands.
export const profile = state(getProfile())

// A transform SHAPES what is stored, which is where
// `Accepted` (what you type) and `Stored` (what is kept)
// come apart. A `schema` gates the input instead and
// leaves the two the same type.
export const handle = state('', {
    transform: (value) => value.trim().toLowerCase(),
})

export function save(): void {
    profile.set({ ...profile(), handle: handle() })
}
