import { POST } from 'abide/server/POST'

// A mutating RPC (POST). Mutations default to no retention (ttl:0) — each browser call runs the handler
// and returns its value; opt into caching with a `cache` TTL. Args ride in the JSON body (the
// content-type also satisfies the CSRF gate).
export default POST(({ text = '' }) => ({
    id: `note_${text.length}_${text.trim().slice(0, 8)}`,
    text,
    verb: 'POST',
    created: true,
}))
