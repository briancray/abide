import { Window } from 'happy-dom'

/*
Installs a real HTML-parser DOM (happy-dom) on globalThis and returns a reset,
mirroring `installMiniDom`'s contract. Unlike the mini-dom — a hand-rolled
recursive-descent parser with no namespaces or foreign content — happy-dom's
`innerHTML` runs a real HTML tree builder, so `<svg>`/`<math>` parse into their
foreign-content namespaces and `cloneNode` preserves them. This is the lane that
verifies the dimensions the mini-dom stubs out: namespaces and foreign content.

(happy-dom does NOT implement table fostering — `<table><tr>` keeps `<tr>` as a
direct child. That's fine for the framework's parity guarantee: both render sides
parse through the SAME parser, so they agree regardless of fostering.)
*/
export function installHappyDom(): () => void {
    const window = new Window()
    const target = globalThis as Record<string, unknown>
    const carriers = ['document', 'window', 'Node', 'NodeFilter', 'Event', 'DocumentFragment']
    const previous = Object.fromEntries(carriers.map((name) => [name, target[name]]))
    for (const name of carriers) {
        target[name] =
            name === 'window' ? window : (window as unknown as Record<string, unknown>)[name]
    }
    return () => {
        for (const name of carriers) {
            target[name] = previous[name]
        }
    }
}
