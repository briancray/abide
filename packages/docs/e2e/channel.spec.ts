import { expect, test } from '@playwright/test'

// Drives /channel: the third primitive with NO transport at all — an in-process pub/sub hub owned by a
// browser module. Proves the three things the page claims: iterating IS the subscription, a non-void
// `Args` isolates rooms, and the memo probe vocabulary (peek/chunks/invalidate) is implemented here too.

const PAGE = '/channel'

test('publish + {#for await} — iterating the channel is the subscription', async ({ page }) => {
    await page.goto(PAGE)

    const log = page.getByTestId('ch-log')
    await expect(log.locator('li')).toHaveCount(0)

    await page.getByTestId('ch-send').click()
    await expect(log.locator('li')).toHaveCount(1)
    await expect(log.locator('li').first()).toHaveText('message 1')

    await page.getByTestId('ch-send').click()
    await expect(log.locator('li')).toHaveCount(2)
    await expect(log.locator('li').nth(1)).toHaveText('message 2')
})

test('Args names the room — a publish to one room is invisible to the other', async ({ page }) => {
    await page.goto(PAGE)

    const log = page.getByTestId('room-log')
    await expect(page.getByTestId('room-name')).toHaveText('red')

    await page.getByTestId('room-post-red').click()
    await expect(log.locator('li')).toHaveCount(1)

    // Published into blue while watching red — the red subscription must not see it.
    await page.getByTestId('room-post-blue').click()
    await expect(log.locator('li')).toHaveCount(1)

    // Switching rooms re-subscribes and replays THAT room's tail.
    await page.getByTestId('room-switch').click()
    await expect(page.getByTestId('room-name')).toHaveText('blue')
    await expect(log.locator('li')).toHaveCount(1)
    await expect(log.locator('li').first()).toContainText('blue')
})

// The key ladder: `publish`'s key is a positional that exists only when the callable declared an input.
// Rung 1 (void channel) publishes the message alone; rung 2 (keyed memo) puts the key first and hits one
// slot. Same verb, same surface, two arities — which is the page's claim.
test('the key positional — a void channel publishes the message alone, a keyed memo keys first', async ({
    page,
}) => {
    await page.goto(PAGE)

    const log = page.getByTestId('ladder-log')
    await expect(log.locator('li')).toHaveCount(0)
    await page.getByTestId('ladder-ping').click()
    await expect(log.locator('li')).toHaveCount(1)
    await expect(log.locator('li').first()).toHaveText('ping 1')

    // Rung 2: the key selects the slot, so `a` must be untouched by a publish into `b`.
    await expect(page.getByTestId('ladder-a')).toHaveText('a (loaded)')
    await expect(page.getByTestId('ladder-b')).toHaveText('b (loaded)')
    await page.getByTestId('ladder-publish').click()
    await expect(page.getByTestId('ladder-b')).toHaveText('b (published 1)')
    await expect(page.getByTestId('ladder-a')).toHaveText('a (loaded)')
})

test('peek() / chunks() / invalidate() — the shared read surface over a hub', async ({ page }) => {
    await page.goto(PAGE)

    await page.getByTestId('probe-publish').click()
    await page.getByTestId('probe-publish').click()
    await page.getByTestId('probe-read').click()

    await expect(page.getByTestId('probe-peek')).toHaveText('message 2') // latest
    await expect(page.getByTestId('probe-chunks')).toContainText('message 1, message 2') // tail

    // invalidate clears the retained tail without detaching subscribers.
    await page.getByTestId('probe-clear').click()
    await expect(page.getByTestId('probe-chunks')).toHaveText('—')
})
