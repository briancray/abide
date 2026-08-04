import { expect, test } from './fixtures.ts'

// Drives /channel: the third primitive with NO transport at all — an in-process pub/sub hub owned by a
// browser module. Proves the three things the page claims: iterating IS the subscription, a non-void
// `Args` isolates rooms, and the memo probe vocabulary (live/chunks/invalidate) is implemented here too.

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

test('live() / chunks() / invalidate() — the shared read surface over a hub', async ({ page }) => {
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

// The server-side loop: the subscription is a plain `for await` in a .ts module, not a template block.
// Nothing on the client iterates — the buttons publish and read back what that loop kept. The loop is
// PROCESS-GLOBAL, so this test restarts it first to be order-independent.
test('for await in plain server code — iterate to subscribe, break to unsubscribe', async ({
    page,
}) => {
    await page.goto(PAGE)

    const log = page.getByTestId('loop-log')
    await page.getByTestId('loop-restart').click()
    await expect(page.getByTestId('loop-status')).toHaveText('subscribed')
    await expect(log.locator('li')).toHaveCount(0)

    await page.getByTestId('loop-say').click()
    await expect(log.locator('li')).toHaveCount(1)
    await page.getByTestId('loop-say').click()
    await expect(log.locator('li')).toHaveCount(2)

    // Publishing "stop" makes the loop `break` — leaving the loop IS unsubscribing.
    await page.getByTestId('loop-stop').click()
    await expect(page.getByTestId('loop-status')).toHaveText('unsubscribed')

    // A publish after the break reaches no one: the transcript must not grow.
    await page.getByTestId('loop-read').click()
    await expect(log.locator('li')).toHaveCount(2)

    // Re-entering the loop is a fresh subscription on the same channel.
    await page.getByTestId('loop-restart').click()
    await expect(page.getByTestId('loop-status')).toHaveText('subscribed')
    await expect(log.locator('li')).toHaveCount(0)
    await page.getByTestId('loop-say').click()
    await expect(log.locator('li')).toHaveCount(1)
})
