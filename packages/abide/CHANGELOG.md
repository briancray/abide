# @abide/abide

## 0.101.0

### Minor Changes

- 128f192: Breaking: an rpc export named as its file answers at the file's path ([`9758128`](https://github.com/briancray/abide/commit/97581285b14d6d01688c963a4332729f6af30d3a))

### Patch Changes

- 128f192: the executable carries the app as bytecode ([`4a72909`](https://github.com/briancray/abide/commit/4a729091955a28df259005b79109ee2e00593046))
- 128f192: followers are filed by entry key, and an SSE event is read off its frame ([`7a137e7`](https://github.com/briancray/abide/commit/7a137e7224daf334c90539c75bb4f7ff25701dc8))
- 128f192: a request's signal aborts when its caller hangs up or its worker is replaced ([`7a57131`](https://github.com/briancray/abide/commit/7a571311b08e2c4d3b14c244395bc7cc29fad4d7))
- 128f192: a page loads only the framework modules it uses
- 128f192: disposed readers are counted rather than found, and the probe edge is cursored ([`ef1bafe`](https://github.com/briancray/abide/commit/ef1bafec810f06bea37a88c51713ac2b92e212e7))
- 128f192: answers of 64 KB or more are compressed off the event loop ([`f484e0d`](https://github.com/briancray/abide/commit/f484e0d140321d9cf2a171cb52dec0b0a3b2c227))

## 0.100.0

### Minor Changes

- 12e5725: Breaking: the rewrite. `@abide/abide` is now the isomorphic, type-safe framework for reactive async interfaces built from compiled `.abide` files — a new surface, not an upgrade of 0.58. Apps import `@abide/abide`, `@abide/abide/runtime` and `@abide/abide/server`; `abide scaffold <name>` writes a starter. The 0.58 line lives on the `og` branch.
