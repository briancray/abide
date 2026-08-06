// Preloaded by `bunfig.toml` before any test file. Registering globally rather than per-suite is
// what lets a demo body run unchanged in a browser and under `bun test`: `document` is simply there.
//
// An emulator is fine for CORRECTNESS and for COUNTING work, which is what the suites assert. It is
// not fine for timing — absolute milliseconds out of happy-dom describe the emulator, not abide,
// which is why every bench arm is reported as a ratio and is run in a real browser.
import { GlobalRegistrator } from '@happy-dom/global-registrator'

GlobalRegistrator.register()
