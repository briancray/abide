export type ResolveContext = {
    req: Request
    url: URL
    route: string
    params: Record<string, string>
}
