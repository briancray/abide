/*
Call signature shared by RemoteFunction and RawRemoteFunction. The base
signature keeps `args` required so a schema'd verb can't silently drop its
input; when `Args` admits undefined (no-input verbs) an intersected
optional-arg signature lets call sites write `fn()` instead of
`fn(undefined)`. Intersection rather than a bare conditional so the type
stays callable while `Args` is still generic (cache() invokes producers
before `Args` resolves). FormData is the multipart upload escape hatch —
see RemoteFunction.
*/
export type RemoteCallable<Args, Resolved> = ((args: Args | FormData) => Promise<Resolved>) &
    (undefined extends Args ? (args?: Args | FormData) => Promise<Resolved> : unknown)
