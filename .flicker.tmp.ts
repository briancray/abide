import { chromium } from 'playwright'
const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } })
await page.goto('http://localhost:3131/components/chart')
await page.waitForTimeout(800)
const svg = page.locator('svg[aria-label="Won revenue against target"]').first()
await svg.scrollIntoViewIfNeeded()
await svg.evaluate((s) => {
    ;(window as any).log = []
    s.addEventListener('pointerleave', () => (window as any).log.push('leave'))
    s.addEventListener('pointerenter', () => (window as any).log.push('enter'))
})
const box = (await svg.boundingBox())!
const x0 = box.x + box.width * 0.36 + 30,
    y = box.y + box.height / 2
for (let i = 0; i < 30; i++) {
    await page.mouse.move(x0 + (i % 2), y)
    await page.waitForTimeout(20)
}
console.log(await page.evaluate(() => (window as any).log.join(' ')))
await browser.close()
