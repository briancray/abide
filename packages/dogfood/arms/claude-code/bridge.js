const paired = document.querySelector('#paired')
const command = document.querySelector('#command')
const connecting = document.querySelector('#connecting')
const reply = document.querySelector('#reply')
const answer = document.querySelector('#answer')
const status = document.querySelector('#status')

const QUESTION = 'What does an invoice record, in one sentence?'

async function* linesOf(response) {
    const reader = response.body
        .pipeThrough(new TextDecoderStream())
        .getReader()
    let held = ''
    for (;;) {
        const { done, value } = await reader.read()
        if (done) return
        held += value
        const lines = held.split('\n')
        held = lines.pop()
        for (const line of lines) if (line) yield JSON.parse(line)
    }
}

document.querySelector('#connect').addEventListener('click', async () => {
    connecting.hidden = true
    for await (const pairing of linesOf(await fetch('/api/bridge'))) {
        paired.hidden = !pairing.paired
        command.hidden = pairing.paired
        command.textContent = pairing.command ?? ''
    }
})

document.querySelector('#ask').addEventListener('click', async () => {
    const asked = await fetch('/api/ask', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
            messages: [{ role: 'user', content: QUESTION }],
        }),
    })
    if (!asked.ok) {
        status.textContent = await asked.text()
        return
    }
    status.textContent = ''
    answer.textContent = ''
    for await (const event of linesOf(asked)) {
        if (event.type !== 'text') continue
        reply.hidden = false
        answer.textContent += event.text
    }
})
