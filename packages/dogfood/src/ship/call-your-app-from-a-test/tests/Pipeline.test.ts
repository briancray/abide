import { expect, test } from 'bun:test'
import { render } from '@abide/abide/server'
import Pipeline from '../lib/Pipeline.abide'

// bunfig.toml preloads `@abide/abide/test`, which makes the import a component.
test('the pipeline totals the deals still open', async () => {
    const html = new TextDecoder().decode(await render(Pipeline({})))
    expect(html).toContain('Hopper &amp; Co')
    expect(html).toContain('$12,400')
})
