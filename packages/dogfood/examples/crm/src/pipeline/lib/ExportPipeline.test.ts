import { expect, spyOn, test } from 'bun:test'

import { mount } from '@abide/harness/abide'

import ExportPipeline from './ExportPipeline.abide'

test('the pipeline is saved as a CSV named for it', async () => {
    using _export = await mount(ExportPipeline({}))
    const saved: string[] = []
    const click = spyOn(
        HTMLAnchorElement.prototype,
        'click',
    ).mockImplementation(function (this: HTMLAnchorElement) {
        saved.push(this.download)
    })
    const made = spyOn(URL, 'createObjectURL')
    ;(document.querySelector('button') as HTMLButtonElement).click()
    click.mockRestore()
    expect(saved).toEqual(['pipeline.csv'])
    const blob = made.mock.calls[0]?.[0] as Blob
    made.mockRestore()
    expect(await blob.text()).toBe(
        'stage,deals\nlead,4\nqualified,3\nproposal,2\nwon,2',
    )
})
