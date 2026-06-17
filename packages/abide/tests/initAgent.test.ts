import { afterEach, describe, expect, test } from 'bun:test'
import { initAgent } from '../src/initAgent.ts'

const TEMP_ROOT = `${import.meta.dir}/.init-agent-test-tmp`
const claudeMd = `${TEMP_ROOT}/CLAUDE.md`

afterEach(async () => {
    await Bun.$`rm -rf ${TEMP_ROOT}`.quiet()
})

describe('initAgent', () => {
    test('creates CLAUDE.md pointing at the surface map', async () => {
        await initAgent({ cwd: TEMP_ROOT })
        const content = await Bun.file(claudeMd).text()
        expect(content).toContain('node_modules/@abide/abide/AGENTS.md')
    })

    test('is idempotent — re-running leaves one guide block', async () => {
        await initAgent({ cwd: TEMP_ROOT })
        await initAgent({ cwd: TEMP_ROOT })
        const matches = (await Bun.file(claudeMd).text()).match(/abide:agent-guide -->/g)
        // start + end marker = exactly two occurrences of the marker text
        expect(matches).toHaveLength(2)
    })

    test('preserves existing CLAUDE.md content when appending', async () => {
        await Bun.write(claudeMd, '# My rules\n\nuse tabs.\n')
        await initAgent({ cwd: TEMP_ROOT })
        const content = await Bun.file(claudeMd).text()
        expect(content).toContain('use tabs.')
        expect(content).toContain('node_modules/@abide/abide/AGENTS.md')
    })
})
