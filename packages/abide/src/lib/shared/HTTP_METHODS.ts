/*
The canonical RPC/HTTP verbs abide understands. One source of truth so the `HttpMethod`
type, the loader's rpc-export detection, and the compiler's helper set can't drift on which
export names are rpc entrypoints.
*/
export const HTTP_METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD'] as const
