import { POST } from 'abide/server'

/**
 * A file is an ARGUMENT, not a second calling convention.
 *
 * `File` in the type is the whole declaration: the client sends multipart because the args held
 * something JSON cannot carry, the server puts it back where it sat, and the published shape says so.
 * Nothing in the declaration or at the call site says "upload", and there is no second door to open.
 */
export const attach = POST(async ({ note, page }: { note: string; page: File }) => ({
    note,
    name: page.name,
    bytes: page.size,
}))
