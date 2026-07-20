import { PATCH } from 'abide/server/PATCH'

// A mutating RPC (PATCH) — partial update semantics.
export default PATCH(({ id = '', text = '' }: { id?: string; text?: string }) => ({
    id,
    text,
    verb: 'PATCH',
    patched: true,
}))
