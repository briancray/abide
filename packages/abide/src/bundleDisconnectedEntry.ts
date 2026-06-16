// @ts-expect-error virtual module resolved by abideResolverPlugin
import Disconnected from './_virtual/bundle-disconnected-component.ts'

/*
Client entry for the bundle connect screen. Standalone — it mounts the
disconnected component (the user's src/bundle/disconnected.abide override or the
lib default, picked by the resolver) into #app, with no router or SSR hydration.
buildDisconnected bundles this into a single self-contained HTML file. A compiled
abide-ui component's default export is its mounter, so calling it mounts.
*/
const target = document.getElementById('app')
if (target) {
    Disconnected(target)
}
