import { compile } from 'abide/compiler'
const whole = await Bun.file('./pages/streaming/page.abide').text()
for (const cut of [4441, 4626, 4663, 4700, 4737, 5069]) {
    const s = performance.now()
    try { compile(whole.slice(0, cut), { filename: 't.abide' }) } catch {}
    console.log(`cut ${cut}: ${(performance.now() - s).toFixed(0)}ms`)
}
