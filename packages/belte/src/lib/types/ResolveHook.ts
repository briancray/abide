import type { ResolveContext } from './ResolveContext.ts'
import type { ResolveResult } from './ResolveResult.ts'

export type ResolveHook = (ctx: ResolveContext) => ResolveResult | Promise<ResolveResult>
