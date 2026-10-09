const separately = document.querySelector('#separately')
const billing = document.querySelector('#billing')

// THE BRANCH IS A SECOND RENDER the checkbox's listener has to
// call, and the field it builds is torn down by hand when the box
// is cleared.
const form = { billSeparately: false }

function render() {
    billing.replaceChildren()
    if (!form.billSeparately) return
    const label = document.createElement('label')
    label.append('billing address')
    const field = document.createElement('input')
    field.id = 'address'
    field.placeholder = '12 Analytical Row, London'
    label.append(field)
    billing.append(label)
}

separately.addEventListener('change', (event) => {
    form.billSeparately = event.target.checked
    render()
})

render()
