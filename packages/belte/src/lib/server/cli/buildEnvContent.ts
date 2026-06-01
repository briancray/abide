import { serializeEnv } from '../../shared/serializeEnv.ts'

/*
Generates the `.env` file content shipped alongside the CLI binary in
the download tarball. APP_URL is always present (derived from the
inbound request's origin); APP_TOKEN is included only when the inbound
request carried an Authorization: Bearer header, so an authenticated
download bakes the caller's credential into the binary's env.

Tokens forward verbatim — the framework doesn't issue or refresh; the
user's auth code at the actual RPC endpoints validates whatever value
arrives back in subsequent calls.
*/
export function buildEnvContent(appUrl: string, bearerToken: string | undefined): string {
    return serializeEnv({
        APP_URL: appUrl,
        ...(bearerToken ? { APP_TOKEN: bearerToken } : {}),
    })
}
