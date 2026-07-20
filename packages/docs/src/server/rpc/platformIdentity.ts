// #demo platformIdentity
import { GET } from "abide/server/GET"
import { identity } from "abide/server/identity"

// Read the current request principal. `identity()` is never null — the framework resolves an
// anonymous principal by default (via the bearer/cookie ladder) and a sealed authenticated one
// once `identity.set()` has run and the rolling `abide-identity` cookie rides subsequent requests.
export default GET(() => {
  const principal = identity()
  return {
    id: principal.id,
    authenticated: principal.authenticated,
    name: typeof principal.name === "string" ? principal.name : null,
  }
})
// #enddemo
