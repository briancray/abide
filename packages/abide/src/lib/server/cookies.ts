// Accessor for the current request's cookies. Throws outside a request scope.

import { currentScope } from "./internal/scope.ts";

export function cookies(): Bun.CookieMap {
  const scope = currentScope();
  if (scope === undefined) {
    throw new Error("cookies(): no active request scope — call it inside a request handler.");
  }
  return scope.cookies;
}
