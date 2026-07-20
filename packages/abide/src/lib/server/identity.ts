// Accessor for the current request's identity (auth.md AU3), plus authenticate/logout writes.
//
// The default identity is anonymous (generated id, authenticated:false), resolved at scope
// creation by the bearer/cookie ladder (auth.ts). `identity()` reads the live scope value;
// `set` authenticates — merges a partial into an authenticated principal and marks the scope
// dirty so the router re-seals the abide-identity cookie; `clear` reverts to a fresh anonymous
// principal and marks the scope so the router clears the cookie.

import { anonymousPrincipal, currentScope, type Principal, type RequestScope } from "./internal/scope.ts";
import { requireSecretForAuthedSet } from "./internal/auth.ts";

function activeScope(): RequestScope {
  const scope = currentScope();
  if (scope === undefined) {
    throw new Error("identity(): no active request scope — call it inside a request handler.");
  }
  return scope;
}

export const identity: {
  (): Principal;
  set(p: Partial<Principal>): void;
  clear(): void;
} = Object.assign(
  (): Principal => activeScope().identity,
  {
    set(p: Partial<Principal>): void {
      const scope = activeScope();
      // set() authenticates (AU3.3): default authenticated:true unless the caller opts out.
      const authenticated = p.authenticated ?? true;
      // Fail fast (AU5.3) before persisting an authenticated identity without a stable secret.
      requireSecretForAuthedSet(authenticated);
      Object.assign(scope.identity, p, { authenticated });
      scope.identityDirty = true;
      scope.identityCleared = false;
    },
    clear(): void {
      const scope = activeScope();
      scope.identity = anonymousPrincipal();
      scope.identityDirty = true;
      scope.identityCleared = true;
    },
  },
);
