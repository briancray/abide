import { expect, test } from './fixtures.ts'

// Drives the /templating/bindings page in a real browser: every template binding and directive is exercised
// through live inputs, and the two-way binds are asserted in both directions after hydration.

test.beforeEach(async ({ page }) => {
    await page.goto('/templating/bindings')
    await expect(page.locator('h1')).toHaveText('Bindings & directives')
})

test('{expr} renders reactive text and escapes HTML', async ({ page }) => {
    const out = page.locator('#escaped-out')
    // SSR'd value arrives as literal text, not parsed markup.
    await expect(out).toHaveText('<b>not bold</b>')
    await expect(out.locator('b')).toHaveCount(0)

    const input = page.locator('#escaped-input')
    await input.fill('<i>x</i> & y')
    await expect(out).toHaveText('<i>x</i> & y')
    await expect(out.locator('i')).toHaveCount(0)
})

test('{html(...)} renders raw markup and updates reactively', async ({ page }) => {
    await expect(page.locator('#raw-out #raw-strong')).toHaveText('bold')
    await page.locator('#raw-swap').click()
    await expect(page.locator('#raw-out #raw-em')).toHaveText('emphasis')
    await expect(page.locator('#raw-out #raw-strong')).toHaveCount(0)
})

test('name={expr} updates an attribute reactively', async ({ page }) => {
    const target = page.locator('#attr-target')
    await expect(target).toHaveAttribute('data-value', 'alpha')
    await page.locator('#attr-input').fill('omega')
    await expect(target).toHaveAttribute('data-value', 'omega')
})

test('on<event> native listeners fire', async ({ page }) => {
    const count = page.locator('#click-count')
    await expect(count).toHaveText('0')
    await page.locator('#click-btn').click()
    await page.locator('#click-btn').click()
    await expect(count).toHaveText('2')

    await page.locator('#input-evt').fill('typed text')
    await expect(page.locator('#typed-out')).toHaveText('typed text')
})

test('bind:value over a bare state var round-trips text (#14)', async ({ page }) => {
    const out = page.locator('#value-out')
    await expect(out).toHaveText('hello')
    // Editing the input writes back through the compiler-synthesized accessor into the bare state cell.
    await page.locator('#value-input').fill('world')
    await expect(out).toHaveText('world')
})

test('bind:checked round-trips a checkbox', async ({ page }) => {
    const out = page.locator('#checked-out')
    await expect(out).toHaveText('no')
    await page.locator('#checked-input').check()
    await expect(out).toHaveText('yes')
    await page.locator('#checked-input').uncheck()
    await expect(out).toHaveText('no')
})

// The regression this demo exists for is an SSR/hydrate DISAGREEMENT. `selected` used to be classified
// as a boolean by the server and fall through to the VALUE bind on the client, so the option rendered
// `<option value="pro" selected>` and then had `option.value = "true"` written over it on hydrate. The
// paint was correct; the bind broke it. Asserting the option's own `value` after hydration is what sees
// that — the visible output was right in both cases.
test('bind:selected mirrors the property without clobbering the option value', async ({ page }) => {
    const option = page.locator('#selected-option')
    await expect(page.locator('#selected-out')).toHaveText('yes')
    await expect(option).toHaveJSProperty('selected', true)
    // The option's own value survives the bind — `"true"` here is the regression. Reintroducing it
    // (dropping `selected` from the boolean set) reds this test: the bind stops mirroring `.selected`
    // at all and writes the stringified boolean over `.value` on the first change instead.
    await expect(option).toHaveJSProperty('value', 'pro')

    // Cell → property.
    await page.locator('#selected-toggle').click()
    await expect(page.locator('#selected-out')).toHaveText('no')
    await expect(option).toHaveJSProperty('selected', false)
    await expect(option).toHaveJSProperty('value', 'pro')
})

// The OTHER direction, which is its own test because it has its own failure mode. A bind's write-back
// listens for `change`, and an `<option>`'s selectedness changes because the user acted on its
// `<select>` — events bubble UP, so a listener on the option never sees it. Attaching to the option was
// silently one-way: the mirror worked, nothing errored, and the cell simply never moved. Asserting only
// the DOM would miss it, so this asserts the CELL through the rendered text.
test('bind:selected writes back when the user picks through the select', async ({ page }) => {
    const out = page.locator('#selected-out')
    await expect(out).toHaveText('yes')

    await page.locator('#selected-list').selectOption('free')
    await expect(out).toHaveText('no')

    await page.locator('#selected-list').selectOption('pro')
    await expect(out).toHaveText('yes')
    await expect(page.locator('#selected-option')).toHaveJSProperty('value', 'pro')
})

test('bind:group tracks the selected radio', async ({ page }) => {
    const out = page.locator('#group-out')
    await expect(out).toHaveText('green')
    // The bound radio starts checked.
    await expect(page.locator('input[value="green"]')).toBeChecked()
    await page.locator('input[value="blue"]').check()
    await expect(out).toHaveText('blue')
})

test('bind:group over checkboxes syncs an array', async ({ page }) => {
    const out = page.locator('#group-checkbox-out')
    // Two boxes start in the bound array.
    await expect(out).toHaveText('cheese, mushroom')
    await expect(page.locator('input[value="cheese"]')).toBeChecked()
    await expect(page.locator('input[value="mushroom"]')).toBeChecked()
    await expect(page.locator('input[value="onion"]')).not.toBeChecked()
    // Adding a box appends its value; removing one splices it out.
    await page.locator('input[value="onion"]').check()
    await expect(out).toHaveText('cheese, mushroom, onion')
    await page.locator('input[value="cheese"]').uncheck()
    await expect(out).toHaveText('mushroom, onion')
})

test('bind:value={{get,set}} runs through the derived accessor', async ({ page }) => {
    const input = page.locator('#derived-input')
    const out = page.locator('#derived-out')
    // Stored lowercase, displayed uppercase.
    await expect(input).toHaveValue('ABIDE')
    await expect(out).toHaveText('abide')
    await input.fill('HELLO')
    await expect(out).toHaveText('hello')
    await expect(input).toHaveValue('HELLO')
})

test('bind:element assigns a node reference cell', async ({ page }) => {
    // After hydration the cell holds the input DOM node.
    await expect(page.locator('#noderef-out')).toHaveText('INPUT')
})

test('bind:element attach fn runs on mount', async ({ page }) => {
    await expect(page.locator('#attach-target')).toHaveAttribute('data-attached', 'yes')
})

test('class:name={cond} toggles a class', async ({ page }) => {
    const target = page.locator('#class-target')
    await expect(target).not.toHaveClass(/highlight/)
    await page.locator('#class-input').check()
    await expect(target).toHaveClass(/highlight/)
    await page.locator('#class-input').uncheck()
    await expect(target).not.toHaveClass(/highlight/)
})

test('style:prop={value} sets one style property', async ({ page }) => {
    const target = page.locator('#style-target')
    await expect(target).toHaveCSS('color', 'rgb(102, 51, 153)') // rebeccapurple
    await page.locator('#style-input').fill('rgb(10, 20, 30)')
    await expect(target).toHaveCSS('color', 'rgb(10, 20, 30)')
})

test('{...spread} applies multiple attributes', async ({ page }) => {
    const target = page.locator('#spread-target')
    await expect(target).toHaveAttribute('data-role', 'spread-target')
    await expect(target).toHaveAttribute('title', 'spread-title')
    await expect(target).toHaveAttribute('aria-label', 'spread-label')
})
