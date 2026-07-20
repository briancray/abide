import { POST } from 'abide/server/POST'

// A mutating RPC (POST). Mutations never cache — each browser call runs the handler and returns its
// value. Args ride in the JSON body (the content-type also satisfies the CSRF gate).
export default POST(({ text = '' }: { text?: string }) => ({
    id: `note_${text.length}_${text.trim().slice(0, 8)}`,
    text,
    verb: 'POST',
    created: true,
}))
