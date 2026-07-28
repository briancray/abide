// Turn a normalized `RpcMemoPolicy` into the `MemoOptions` the backing memo is CONSTRUCTED with.
//
// The companion half of `rpcMemoPolicy`, and the reason the client and server memos now agree by
// construction rather than by two authors keeping two `if` ladders in step: both sides build their
// options here, from the same policy. What each side adds on top is what genuinely differs — the
// server attaches `notify` (the broadcast sink) and `loader`, both sides attach `timeout`.
//
// `ttl: null` (Infinity) is left UNSET rather than written as `Infinity`: it is already the memo's
// default, and an explicit `Infinity` would have to survive a JSON round trip it cannot make.
//
// `crossRequest` is deliberately NOT here, and it is the one field that must not be: it chooses which
// STORE a server slot lives in, and a `crossRequest` memo fails closed outside a request scope
// (`guardSharedRead`). A browser has no request to cross, so the proxy reads `policy.crossRequest` for
// what it actually means there — whether to join the `(rpc,args)` broadcast channel — and the server
// memo names the option itself. Isomorphic retention travels; a storage choice does not.

import type { MemoOptions } from '../memo.ts'
import type { RpcMemoPolicy } from './rpcMemoPolicy.ts'

export function memoOptionsFor(policy: RpcMemoPolicy): MemoOptions {
    const options: MemoOptions = {}
    if (policy.ttl !== null) options.ttl = policy.ttl
    if (policy.tags !== undefined) options.tags = policy.tags
    if (policy.throttle !== undefined) options.throttle = policy.throttle
    if (policy.debounce !== undefined) options.debounce = policy.debounce
    return options
}
