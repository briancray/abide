import { DELETE } from '@abide/abide/server/DELETE'
import { json } from '@abide/abide/server/json'

/*
DELETE — args arrive as URL search params (no body for GET/DELETE/HEAD).
json(undefined) emits 204 No Content (JSON has no encoding for undefined),
and the caller's `await deleteEcho({ message })` decodes it back to
undefined — the idiomatic "deleted, nothing to say" response.
*/
export const deleteEcho = DELETE(({ message }: { message: string }) => {
    void message
    return json(undefined)
})
