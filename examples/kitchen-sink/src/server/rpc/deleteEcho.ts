import { DELETE } from '@belte/belte/server/DELETE'
import { json } from '@belte/belte/server/json'

/*
DELETE — args arrive as URL search params (no body for GET/DELETE/HEAD).
json(undefined) emits 204 No Content (JSON has no encoding for undefined),
and the caller's `await deleteEcho({ message })` decodes it back to
undefined — the idiomatic "deleted, nothing to say" response.
*/
export const deleteEcho = DELETE<{ message: string }>(({ message }) => {
    void message
    return json(undefined)
})
