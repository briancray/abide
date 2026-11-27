import { expect, test } from 'bun:test'

import { config, ownOrigin } from '#server/config.ts'
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

// 36.2, 36.24, 36.25 — `APP_ORIGINS` OPENS THE GATE TO EACH ORIGIN IT LISTS, a bare host taking
// `APP_URL`'s scheme, and the own origin is the request's where it is listed. THE REVERT: compare to
// `APP_URL`'s origin alone; `nas.local` reads crossing and a listed request answers `APP_URL`'s.
test('APP_ORIGINS lists more own origins, a bare host taking APP_URL scheme — 36.2, 36.24, 36.25', () => {
    process.env.APP_URL = 'https://app.test/media'
    process.env.APP_ORIGINS = 'nas.local, 192.168.1.5:3000 ,http://old.test'
    config.invalidate()
    try {
        const listed = 'https://nas.local/media/notes'
        expect(crossingOrigin('https://app.test', listed)).toBeNull()
        expect(crossingOrigin('https://nas.local', listed)).toBeNull()
        expect(crossingOrigin('https://192.168.1.5:3000', listed)).toBeNull()
        expect(crossingOrigin('http://old.test', listed)).toBeNull()
        expect(crossingOrigin('http://nas.local', listed)).toBe(
            'http://nas.local',
        )
        expect(ownOrigin(listed)).toBe('https://nas.local')
        expect(ownOrigin('http://localhost:3000/media')).toBe(
            'https://app.test',
        )
    } finally {
        delete process.env.APP_URL
        delete process.env.APP_ORIGINS
        config.invalidate()
    }
})
