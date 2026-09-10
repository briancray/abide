const status = document.querySelector('#status')
const shown = document.querySelector('#rows')

const REGIONS = [
    ['#north', 'north'],
    ['#south', 'south'],
]

const TIMEOUT = 2_000

let region = 'north'
let rows = 0
let failure = null

function render() {
    status.textContent = failure ?? ''
    shown.textContent = failure === null ? String(rows) : '—'
    for (const [button, one] of REGIONS) {
        document.querySelector(button).ariaSelected = String(one === region)
    }
}

// THE IDLE TIMER, WRITTEN BY HAND AND RESET PER CHUNK. Started once and
// never reset it is a wall clock, and a wall clock cuts the report that
// is working — `north` takes three seconds to produce three rows and
// every one of them arrives inside the bound.
async function read(one) {
    const stop = new AbortController()
    let timer = setTimeout(() => stop.abort(), TIMEOUT)
    try {
        const answer = await fetch(`/api/salesByRegion?region=${one}`, {
            signal: stop.signal,
        })
        for await (const chunk of answer.body) {
            clearTimeout(timer)
            timer = setTimeout(() => stop.abort(), TIMEOUT)
            if (one !== region) return
            const lines = new TextDecoder().decode(chunk).split('\n')
            rows += lines.filter(Boolean).length
            render()
        }
    } catch {
        if (one === region) failure = '504 Gateway Timeout'
    } finally {
        clearTimeout(timer)
        render()
    }
}

for (const [button, one] of REGIONS) {
    document.querySelector(button).addEventListener('click', () => {
        region = one
        rows = 0
        failure = null
        render()
        read(one)
    })
}

read(region)
