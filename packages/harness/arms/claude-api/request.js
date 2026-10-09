const ask = document.querySelector('#ask')
const reply = document.querySelector('#reply')

const QUESTION = 'Is invoice INV-4021 paid?'

ask.addEventListener('click', async () => {
    ask.disabled = true
    const answer = await fetch('/api/ask', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
            messages: [{ role: 'user', content: QUESTION }],
        }),
    })
    reply.textContent = await answer.text()
    reply.hidden = false
})
