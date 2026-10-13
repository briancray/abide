import { expect, test } from 'bun:test'
import { closedTo, crossingOrigin } from '#server/crossingOrigin.ts'

// 36.2 — THE OWN ORIGIN IS THE REQUEST'S where no `APP_URL` names one, and a request with no
// `Origin` crosses nothing.
test('an Origin crosses only where it is not the own origin — 36.2', () => {
    const url = 'http://app.test/notes'
    expect(crossingOrigin(null, url)).toBeNull()
    expect(crossingOrigin('http://app.test', url)).toBeNull()
    expect(crossingOrigin('http://other.test', new URL(url))).toBe(
        'http://other.test',
    )
})

// 16.13, 18.2, 21.19 — ONE GATE FOR A HANDLER AND A SOCKET: closed to another origin unless
// `crossOrigin` names it or is `true`, and never closed to the own one. THE REVERT: drop the
// `crossing !== null` arm; the own origin reads closed to every handler that declared nothing.
test('closedTo admits the own origin and what crossOrigin names — 16.13, 18.2', () => {
    expect(closedTo(false, null)).toBe(false)
    expect(closedTo(false, 'http://other.test')).toBe(true)
    expect(closedTo(true, 'http://other.test')).toBe(false)
    expect(closedTo(['http://other.test'], 'http://other.test')).toBe(false)
    expect(closedTo(['http://third.test'], 'http://other.test')).toBe(true)
})
