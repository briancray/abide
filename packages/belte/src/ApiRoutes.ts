export type ApiHandler = (
    req: Request,
    params: Record<string, string>,
) => Response | Promise<Response>

export type ApiModule = Partial<Record<string, ApiHandler>>

export type ApiRoutes = Record<string, () => Promise<ApiModule>>
