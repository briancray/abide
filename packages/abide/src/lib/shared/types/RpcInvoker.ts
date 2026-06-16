/* A verb invoker mirrors the verb's own call: a plain call decodes the body
   (throws HttpError on non-2xx), `.raw` returns the Response untouched. Shared
   by every name→callable RPC proxy (the CLI client, the test harness). */
export type RpcInvoker = ((args?: unknown) => Promise<unknown>) & {
    raw: (args?: unknown) => Promise<Response>
}
