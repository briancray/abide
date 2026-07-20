// #demo platformLogout
import { identity } from "abide/server/identity"
import { POST } from "abide/server/POST"

// The inverse of login: `identity.clear()` reverts to a fresh anonymous principal and marks the
// scope so the router clears the `abide-identity` cookie. Subsequent reads see anonymous again.
export default POST(() => {
  identity.clear()
  const principal = identity()
  return {
    id: principal.id,
    authenticated: principal.authenticated,
    name: typeof principal.name === "string" ? principal.name : null,
  }
})
// #enddemo
