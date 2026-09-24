// 32.16 — `{#try}`: A RENDER-TIME BOUNDARY OVER A REGION. A failure replaces the whole body with the
// catch arm, on the server as it renders and in the browser as a binding re-runs — and a body whose
// failure clears comes back.

import { afterAll, expect, test } from 'bun:test'
import { compileFile, emitClient, parseAbide } from '#compiler'
import { TypeSession } from '#compiler/TypeSession.ts'
import { render } from '#server'
import { flushSync, NotLanded } from '#shared'
import { Mismatch } from '#ui/Mismatch.ts'
import { pageRegion } from '#ui/regions.ts'
import { Scope } from '#ui/Scope.ts'
import { BOUNDARY, inBoundary, TryBoundary } from '#ui/TryBoundary.ts'
import { removeTemporaryModules, temporaryModule } from './temporaryModule.ts'

const ROOT = new URL('./fixtures/typed/', import.meta.url).pathname
const session = await TypeSession.open(`${ROOT}tsconfig.json`)

afterAll(() => {
    session.close()
    removeTemporaryModules()
})

// The docs' own example (`examples/try-region`), with the rate's starting value a parameter.
const pageWith = (rate: string) => `<script>
import { reactive } from 'abide'

let rate = reactive('${rate}')

function convert(typed: string) {
    const value = Number(typed)
    if (!(value > 0)) throw new Error('Rate must be a positive number.')
    return (1240 * value).toFixed(2)
}
</script>

<input id="rate" bind:value={rate}>

{#try}
    <ul class="fields">
        <li><span>invoice</span><strong>#4310</strong></li>
        <li><span>converted</span><strong id="converted">\${convert(rate)}</strong></li>
    </ul>
{:catch problem}
    <p class="status">{problem.message}</p>
{:finally}
    <small id="after">rates are indicative</small>
{/try}`

async function served(
    source: string,
    beforeMount?: () => void,
): Promise<string> {
    const file = parseAbide(source)
    const reads = await session.reads(`${ROOT}src/try.abide`, file)
    const dir = temporaryModule({
        'Page.ts': compileFile(source, reads),
        'Page.client.ts': emitClient(file, reads),
    })
    const { default: Component } = await import(`${dir}/Page.ts`)
    let html = ''
    for await (const chunk of render(
        Component,
        '<!doctype html><html><head></head><body></body></html>',
    ))
        html += new TextDecoder().decode(chunk)
    document.body.innerHTML = html.slice(
        html.indexOf('<body>') + 6,
        html.indexOf('</body>'),
    )
    const { default: mount } = await import(`${dir}/Page.client.ts`)
    beforeMount?.()
    mount(pageRegion(document.body))
    flushSync()
    return html
}

const typed = (value: string): void => {
    const input = document.getElementById('rate') as HTMLInputElement
    input.value = value
    input.dispatchEvent(new Event('input'))
    flushSync()
}

// 32.16 ON THE SERVER — THE BODY, OR WHERE IT THROWS THE CATCH IN ITS PLACE, and `{:finally}` either
// way. THE REVERT: render the body without the `try` around it; the render throws and the page is
// lost rather than the region.
test('the server renders the body, or the catch where the body throws — 32.16', async () => {
    const good = await served(pageWith('1.09'))
    expect(good).toContain('<strong id="converted">$1351.60</strong>')
    expect(good).toContain('rates are indicative')
    expect(good).not.toContain('class="status"')

    const bad = await served(pageWith('nope'))
    expect(bad).toContain(
        '<p class="status">Rate must be a positive number.</p>',
    )
    expect(bad).toContain('rates are indicative')
    expect(bad).not.toContain('converted')
})

// 32.16 IN THE BROWSER — A BINDING THAT THROWS REPLACES THE WHOLE BODY, and one that stops throwing
// brings it back. THE REVERT: leave `Scope.watch` unwrapped under a boundary; the throw escapes the
// binding, the figure stays up beside nothing, and the catch never renders.
test('a failing binding swaps the body for the catch, and recovers — 32.16', async () => {
    await served(pageWith('1.09'))
    typed('0')
    expect(document.querySelector('.status')?.textContent).toBe(
        'Rate must be a positive number.',
    )
    expect(document.getElementById('converted')).toBeNull()
    expect(document.getElementById('after')).not.toBeNull()
    typed('2')
    expect(document.getElementById('converted')?.textContent).toBe('$2480.00')
    expect(document.querySelector('.status')).toBeNull()
})

// A PAGE THE SERVER PAINTED IN ITS CATCH hydrates without calling that a mismatch, and recovers.
test('a server-painted catch hydrates quietly and recovers — 32.16, 41.10', async () => {
    const warned: unknown[] = []
    const warn = console.warn
    console.warn = (...args: unknown[]) => void warned.push(args.join(' '))
    try {
        await served(pageWith('nope'))
        expect(document.querySelector('.status')?.textContent).toBe(
            'Rate must be a positive number.',
        )
        typed('1')
        expect(document.getElementById('converted')?.textContent).toBe(
            '$1240.00',
        )
    } finally {
        console.warn = warn
    }
    expect(
        warned.filter((line) => String(line).includes('abide:hydrate')),
    ).toEqual([])
})

// `{:finally}` STANDS AFTER THE REGION, not in either arm, so a swap leaves it where it was. THE
// REVERT: clone it into both arms; every swap rebuilds it and the node the reader was on is gone.
test('the finally markup is not rebuilt when the body fails — 32.16', async () => {
    await served(pageWith('1.09'))
    const after = document.getElementById('after')
    typed('0')
    expect(document.querySelector('.status')).not.toBeNull()
    expect(document.getElementById('after')).toBe(after)
    typed('2')
    expect(document.getElementById('after')).toBe(after)
})

// NEITHER A MISMATCH NOR A VALUE IN FLIGHT IS A FAILURE OF THE BODY, on the mount path or in a
// binding. THE REVERT: rethrow only `NotLanded` from a bound watch and only `Mismatch` from a mount;
// each case then reads the other one as the boundary's failure, and the catch arm shows it.
test('a mismatch or an unlanded value passes through the boundary — 2.13, 41.10', () => {
    const escaped = (run: () => unknown): unknown => {
        try {
            run()
        } catch (thrown) {
            return thrown
        }
        return undefined
    }
    const mounting = new TryBoundary()
    const unlanded = () => {
        throw new NotLanded({}, 'rate')
    }
    expect(escaped(() => inBoundary(mounting, unlanded))).toBeInstanceOf(
        NotLanded,
    )
    expect(mounting.failure.peek()).toBeUndefined()

    const binding = new TryBoundary()
    BOUNDARY.current = binding
    const scope = new Scope()
    BOUNDARY.current = undefined
    const mismatched = () => {
        throw new Mismatch('shape')
    }
    expect(escaped(() => scope.watch(mismatched))).toBeInstanceOf(Mismatch)
    expect(binding.failure.peek()).toBeUndefined()
})

// The same page with its body's evaluations COUNTED on the client, and a binding that can be told to
// disagree with what the server wrote.
const countedPage = (rate: string) =>
    pageWith(rate).replace(
        'function convert(typed: string) {',
        'function convert(typed: string) {\n    ;(globalThis as { converts?: number }).converts = ((globalThis as { converts?: number }).converts ?? 0) + 1',
    )
const counted = globalThis as { converts?: number }

// 32.16 AND 41.10 — THE ARM THE SERVER PAINTED IS THE ARM THE CLIENT HYDRATES. The open anchor of a
// region whose body threw on the server says so, so the catch's markup is ADOPTED — the very node the
// server sent — and the body is evaluated once, for the failure the catch binds and the retry that
// watches it. THE REVERT: write the plain open anchor in the server's catch; the client walks the
// catch as if it were the body, throws, rebuilds the catch and evaluates the body three times.
test('a server-painted catch is adopted, and the body is evaluated once — 32.16', async () => {
    let sent: Element | null = null
    await served(countedPage('nope'), () => {
        sent = document.querySelector('.status')
        counted.converts = 0
    })
    expect(sent).not.toBeNull()
    expect({
        adopted: document.querySelector('.status') === sent,
        evaluated: counted.converts,
    }).toEqual({ adopted: true, evaluated: 2 })
})

// 41.10 — A MISMATCH IN A BODY THE SERVER PAINTED WARNS, on `abide:hydrate`, and is rebuilt. The first
// run no longer guesses which arm it is standing on, so it has no reason to hydrate quietly. THE
// REVERT: the guess — a mount that throws on any disagreement, caught bare and refilled — rebuilds the
// body in silence.
test('a mismatch in a server-painted body warns — 41.10', async () => {
    const warned: string[] = []
    const warn = console.warn
    console.warn = (...args: unknown[]) => void warned.push(args.join(' '))
    try {
        await served(pageWith('1.09'), () => {
            const converted = document.getElementById('converted') as Element
            converted.replaceWith(document.createElement('em'))
        })
        expect(document.getElementById('converted')?.textContent).toBe(
            '$1351.60',
        )
    } finally {
        console.warn = warn
    }
    expect(warned.filter((line) => line.includes('abide:hydrate')).length).toBe(
        1,
    )
})

// A BODY THAT FAILED ON THE SERVER AND SUCCEEDS IN THE BROWSER is filled, not left in its catch: the
// one evaluation the caught anchor asks for is what finds that out, and it is not a mismatch. THE
// REVERT: leave the region painted when that evaluation succeeds; the body is hydrated over the
// catch, which 41.10 rebuilds — right in the end, and a warning about a disagreement there was not.
test('a body that only failed on the server is filled on the client, quietly — 32.16', async () => {
    const flagged = globalThis as { serverOnly?: boolean }
    flagged.serverOnly = true
    const warned: string[] = []
    const warn = console.warn
    console.warn = (...args: unknown[]) => void warned.push(args.join(' '))
    await served(
        pageWith('1.09').replace(
            'const value = Number(typed)',
            "if ((globalThis as { serverOnly?: boolean }).serverOnly) throw new Error('server only')\n    const value = Number(typed)",
        ),
        () => {
            expect(document.querySelector('.status')?.textContent).toBe(
                'server only',
            )
            flagged.serverOnly = false
        },
    ).finally(() => {
        console.warn = warn
    })
    expect(document.getElementById('converted')?.textContent).toBe('$1351.60')
    expect(document.querySelector('.status')).toBeNull()
    expect(warned.filter((line) => line.includes('abide:hydrate'))).toEqual([])
})
