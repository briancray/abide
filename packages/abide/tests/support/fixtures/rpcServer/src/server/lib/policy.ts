/* Opts-reachable policy values: an endpoint references these from `opts`, so the client rewrite must
   retain them (and this import). `crossOriginEnabled` is referenced via a shorthand, `allowCrossOrigin`
   through a module-level const. */
export const crossOriginEnabled = true
export const allowCrossOrigin = (_name: string): boolean => true
