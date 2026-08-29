// Registers a DOM as globals for `bun test`. Wired from the root bunfig.toml, so it
// runs once per test process and before any suite imports.
import { GlobalRegistrator } from '@happy-dom/global-registrator'

GlobalRegistrator.register({ url: 'http://localhost/' })
