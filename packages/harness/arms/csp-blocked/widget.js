document.querySelector('#add').addEventListener('click', () => {
    const widget = document.createElement('script')
    widget.src = 'https://widget.example/chat.js'
    document.addEventListener(
        'securitypolicyviolation',
        (event) => {
            document.querySelector('#refused').textContent =
                `${event.blockedURI} by ${event.violatedDirective}`
        },
        { once: true },
    )
    document.head.append(widget)
})
