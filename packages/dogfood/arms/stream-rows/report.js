const list = document.querySelector('#rows')
const count = document.querySelector('#count')

let regions = []
let pending = true

function render() {
    count.textContent = pending ? '…' : String(regions.length)
}

function append(region) {
    const row = document.createElement('li')
    const name = document.createElement('span')
    name.textContent = region.name
    const total = document.createElement('strong')
    total.textContent = region.total
    row.append(name, total)
    list.append(row)
}

// THE FRAMING, BY HAND. A chunk is not a line: two rows can arrive in one
// read and one row can be split across two, so the tail of the buffer is
// carried to the next chunk rather than parsed as if it were whole.
async function run() {
    list.replaceChildren()
    regions = []
    pending = true
    render()

    const answer = await fetch('/api/salesByRegion?year=2026')
    const decoder = new TextDecoder()
    let buffer = ''
    for await (const chunk of answer.body) {
        buffer += decoder.decode(chunk, { stream: true })
        const lines = buffer.split('\n')
        buffer = lines.pop() ?? ''
        for (const line of lines) {
            if (!line) continue
            const region = JSON.parse(line)
            regions.push(region)
            append(region)
        }
        render()
    }
    if (buffer.trim()) {
        const region = JSON.parse(buffer)
        regions.push(region)
        append(region)
    }
    // The accumulation is only whole here, which is the moment the count
    // has anything true to say.
    pending = false
    render()
}

document.querySelector('#again').addEventListener('click', run)

run()
