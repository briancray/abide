export type ApiHandler = (
    req: Request,
    params: Record<string, string>,
) => Response | Promise<Response>
