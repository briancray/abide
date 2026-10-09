const transcript = document.querySelector('#transcript')
const ask = document.querySelector('#ask')
const status = document.querySelector('#status')

const QUESTION = 'Is invoice INV-4021 paid?'

function turn(label, text, mono) {
    const item = document.createElement('li')
    const name = document.createElement('span')
    const said = document.createElement('p')
    name.textContent = label
    said.textContent = text
    if (mono) said.className = 'font-mono text-chrome'
    item.append(name, said)
    transcript.append(item)
}

function show(event) {
    if (event.type === 'tool')
        turn('tool call', `${event.name} ${JSON.stringify(event.input)}`, true)
    else if (event.type === 'result')
        turn('your handler answered', event.text, true)
    else if (event.type === 'text') turn('assistant', event.text, false)
    else if (event.type === 'done') status.textContent = 'done'
}

// ONE EVENT PER LINE, split by hand as the chunks land.
ask.addEventListener('click', async () => {
    ask.disabled = true
    const answer = await fetch('/api/ask', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
            messages: [{ role: 'user', content: QUESTION }],
        }),
    })
    const reader = answer.body.pipeThrough(new TextDecoderStream()).getReader()
    let held = ''
    for (;;) {
        const { done, value } = await reader.read()
        if (done) break
        held += value
        const lines = held.split('\n')
        held = lines.pop()
        for (const line of lines) if (line) show(JSON.parse(line))
    }
})
