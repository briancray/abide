// trace() — the current W3C Trace Context `traceparent` (CO2.3). Format is
// `version-traceid-spanid-flags` (all hex): `00-<32 hex>-<16 hex>-<2 hex>`.
//
// On the server it reads the active request scope: the router seeds `scope.traceparent` from an
// incoming `traceparent` header when present, so a browser→server(→server) chain shares one trace
// id. When no header was propagated, the first `trace()` call generates one and caches it on the
// scope so every subsequent read within the same request returns the same value. Returns undefined
// when there is no active scope (bare scripts, client without an ambient request).

import { currentScope } from "../server/internal/scope.ts";

export function trace(): string | undefined {
  const scope = currentScope();
  if (scope === undefined) return undefined;
  if (scope.traceparent === undefined) {
    scope.traceparent = generateTraceparent();
  }
  return scope.traceparent;
}

// version 00, sampled flag 01. 16-byte trace id, 8-byte span id, lower-case hex.
function generateTraceparent(): string {
  return `00-${randomHex(16)}-${randomHex(8)}-01`;
}

function randomHex(bytes: number): string {
  const buffer = new Uint8Array(bytes);
  crypto.getRandomValues(buffer);
  let out = "";
  for (let i = 0; i < buffer.length; i++) {
    out += buffer[i]!.toString(16).padStart(2, "0");
  }
  return out;
}
