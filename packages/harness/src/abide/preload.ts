// AN ABIDE APP'S WHOLE TEST PRELOAD, in one line of its bunfig.toml: a DOM with the measure lane's
// patches installed, THEN abide's own preload, which builds the app so a test imports its `.abide`
// files as modules (38.109). In that order, because a module abide's build loads may read the DOM.

import '../measure/preload.ts'
import '@abide/abide/test'
