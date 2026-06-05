import type { HttpVerb } from '../../../shared/types/HttpVerb.ts'

/*
One operation a socket exposes to the non-browser surfaces. A socket
always offers a `tail` (read recent / stream live) and, when
`clientPublish` is set, a `publish` (send a message). This is the shared
skeleton — name, kind, HTTP face — that the CLI manifest, the MCP tool
list, and the MCP dispatcher all read instead of re-deriving the naming
convention and existence rule independently. Each surface dresses it with
its own presentation (descriptions, input schema, annotations).
*/
export type SocketOperation = {
    kind: 'tail' | 'publish'
    // Command/tool name: the socket's command-name base plus `-tail` / `-publish`.
    name: string
    // Raw socket name, for the HTTP path and human-facing descriptions.
    socketName: string
    // HTTP face of the operation: `/__belte/sockets/<name>`.
    restUrl: string
    // GET for tail, POST for publish.
    method: HttpVerb
}
