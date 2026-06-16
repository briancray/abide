/*
Derives the mount base path from APP_URL. APP_URL carries both the app's
public origin (for absolute URLs) and, via its pathname, where the app is
mounted — `https://foo.com/v2` → `/v2`. Returns the pathname with any
trailing slash stripped; root (`/`), unset, or unparseable collapses to ''
(root mount, the zero-config default). A bare path value with no origin is
tolerated so `.env` can carry `APP_URL=/v2`.
*/
export function basePathFromAppUrl(appUrl: string | undefined): string {
    if (!appUrl) {
        return ''
    }
    let pathname: string
    try {
        pathname = new URL(appUrl).pathname
    } catch {
        pathname = appUrl.startsWith('/') ? appUrl : ''
    }
    return pathname.replace(/\/+$/, '')
}
