const email = document.querySelector('#email')
const plan = document.querySelector('#plan')
const summary = document.querySelector('#summary')

// THE PAIR, WRITTEN OUT PER FIELD. Each one is a listener that
// reads `target.value` into the model and a line that seeds the
// input back from it — and the seeding half is the one that gets
// forgotten, because the page looks right until something else
// writes the state.
const form = { email: 'ada@example.com', plan: 'monthly' }

function render() {
    email.value = form.email
    plan.value = form.plan
    summary.textContent = `${form.email} on ${form.plan}`
}

email.addEventListener('input', (event) => {
    form.email = event.target.value
    render()
})

plan.addEventListener('change', (event) => {
    form.plan = event.target.value
    render()
})

render()
