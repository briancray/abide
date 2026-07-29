// Isomorphic accessor for the current route info. The read LADDER — request scope, then the value the
// browser adopted, then the ambient's own answer for "nobody has said" — lives on the ADOPTED AMBIENT
// (`internal/routeAmbient.ts`), shared with `identity()` and `trace()`. This module is the public
// naming seam (`abide/shared/route`) and nothing else.
//
// On the CLIENT, reading it inside a binding subscribes, so route().params/name/url changes re-render
// dependents. It throws only when neither rung answers (called outside a request and before bootstrap).

import { routeAmbient } from './internal/routeAmbient.ts'
import type { RouteInfo } from './internal/routeInfo.ts'

export function route(): RouteInfo {
    return routeAmbient.read()
}
