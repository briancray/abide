import { expect, test } from './fixtures.ts'

// SSR EMITTER — RAW SERVER BYTES.
//
// Every other attribute/class/style assertion in this suite runs against the HYDRATED DOM, so a pure
// server-emitter regression that client hydration silently heals would pass unnoticed. These tests fetch
// the fixture route with `request.get` (no browser, no JS) and assert the RAW SSR string, locking the
// emitter's element + attribute serialization at the integration layer (the unit oracle in
// `packages/abide/src/ui/internal/emit.oracle.test.ts` locks it in isolation). Fixture:
// `src/ui/pages/__e2e/ssr-emit/page.abide`.

test.describe('SSR emitter — raw server bytes', () => {
    let html = ''
    test.beforeAll(async ({ request }) => {
        const response = await request.get('/__e2e/ssr-emit')
        expect(response.ok()).toBeTruthy()
        html = await response.text()
        expect(html).toContain('data-testid="ssr-emit"')
    })

    test('static-only element serializes every static attr in source order (fast path)', () => {
        expect(html).toContain(
            '<a data-testid="static" id="lnk" href="/x" data-role="link" class="btn primary">go</a>',
        )
    })

    test('static class + class: directive merge into one class attribute (both branches)', () => {
        expect(html).toContain('<div data-testid="cls-on" class="base active">on</div>')
        expect(html).toContain('<div data-testid="cls-off" class="base">off</div>')
    })

    test('static style + style: directive merge into one style attribute', () => {
        expect(html).toContain(
            '<div data-testid="sty" style="color:red; font-weight: 700">styled</div>',
        )
    })

    test('quoted-interpolation attributes resolve with braces gone', () => {
        expect(html).toContain('<a data-testid="qi" class="a DYN" href="/x/42">qi</a>')
    })

    test('spread overrides a colliding static attr but keeps its source position', () => {
        expect(html).toContain(
            '<div data-testid="spread" id="spread-id" title="spr" role="r">spread</div>',
        )
    })

    test('attribute values are HTML-escaped (ampersand, quotes, angle brackets)', () => {
        expect(html).toContain(
            '<div data-testid="esc" title="a &amp; &quot;b&quot; &#39;c&#39; &lt;d&gt;">esc</div>',
        )
    })

    test('a null attribute is omitted and a bare boolean attribute is kept', () => {
        expect(html).toContain('<input data-testid="falsy" required>')
        expect(html).not.toContain('value=""')
    })

    test('a fully-static nested tree serializes byte-for-byte', () => {
        expect(html).toContain(
            '<section data-testid="nest"><header><h2>T</h2></header><p>B</p></section>',
        )
    })

    test('a block inside an element keeps its hydration anchors', () => {
        expect(html).toContain('<ul data-testid="blk"><!--[--><li>yes</li><!--]--></ul>')
    })
})

// The SSR bytes above must also be CLAIMABLE — hydration adopts them without a mismatch re-render.
test('the SSR fixture hydrates cleanly (server markup is claimed, not rebuilt)', async ({
    page,
}) => {
    await page.goto('/__e2e/ssr-emit')
    // The block's server node carries the anchors; after hydrate the list item is still present and the
    // static tree is intact — a hydration mismatch would have torn these down and rebuilt (or thrown).
    await expect(page.getByTestId('blk').getByText('yes')).toBeVisible()
    await expect(page.getByTestId('nest').getByRole('heading', { name: 'T' })).toBeVisible()
    await expect(page.getByTestId('cls-on')).toHaveClass('base active')
})
