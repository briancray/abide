import { PUT } from 'abide/server/PUT'

// A mutating RPC (PUT) — full replacement semantics. Same call surface as POST from the browser.
export default PUT(({ id = '', text = '' }: { id?: string; text?: string }) => ({
    id,
    text,
    verb: 'PUT',
    replaced: true,
}))
