/*
JSON-RPC 2.0 response frame. Exactly one of `result` / `error` is set
per request. The `id` echoes the inbound request id (null when the
request id was malformed and the error is being returned).
*/
export type JsonRpcResponse =
    | {
          jsonrpc: '2.0'
          id: string | number | null
          result: unknown
      }
    | {
          jsonrpc: '2.0'
          id: string | number | null
          error: {
              code: number
              message: string
              data?: unknown
          }
      }
