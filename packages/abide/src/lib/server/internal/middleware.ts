// The abide MIDDLEWARE ONION — request-pipeline composition (M2).
//
// A middleware is `(next) => Response`. It owns the call to the inner layer: invoking
// `next()` runs everything below it (the next middleware, and eventually the handler) and
// returns that layer's Response. A middleware may:
//   - return a Response WITHOUT calling next() — short-circuit; inner layers never run;
//   - await next() and then inspect/replace the returned Response — post-processing;
//   - simply `return next()` — passthrough.
//
// The request itself is NOT threaded through `next` — layers read it via request() off the
// active scope. This keeps `next()` argument-free and the onion symmetric.
//
// compose([outer, ..., inner], handler) builds the onion so the FIRST middleware is the
// outermost layer: it runs first on the way in and last on the way out.

export type Middleware = (next: () => Response | Promise<Response>) => Response | Promise<Response>;

export function compose(mws: Middleware[], handler: () => Response | Promise<Response>): () => Promise<Response> {
  return async (): Promise<Response> => {
    // Fold from the innermost middleware outward so each layer closes over the layer
    // beneath it. Start with the bare handler as the deepest `next`.
    let next: () => Response | Promise<Response> = handler;
    for (let i = mws.length - 1; i >= 0; i--) {
      const middleware = mws[i]!;
      const inner = next;
      next = () => middleware(inner);
    }
    return next();
  };
}
