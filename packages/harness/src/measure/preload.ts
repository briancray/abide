// Registers a DOM as globals for `bun test`, and installs the measure lane's patches
// beside it. Wired from the root bunfig.toml, so it runs once per test process and
// before any suite imports.
//
// The patches land HERE rather than around a case body. Removing them per case cannot
// be done in the browser arm at all — `addInitScript` runs at document-start and has
// no removal hook — and re-patching per case invalidates the inline caches on those
// members once per case, for the process. `arm()`/`disarm()` swap the record instead,
// so the prototype shape is fixed for the process lifetime.
import { GlobalRegistrator } from '@happy-dom/global-registrator'
import { install } from './install.ts'

GlobalRegistrator.register({ url: 'http://localhost/' })
install()
