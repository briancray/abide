import type { ApiHandlerResult } from './ApiHandlerResult.ts'

export type ApiHandler = (
    req: Request,
    params: Record<string, string>,
) => ApiHandlerResult | Promise<ApiHandlerResult>
