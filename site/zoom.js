// Screenshots open in a viewer: fitted first, a click on the image shows it at full size.
(() => {
  const box = document.querySelector('.zoom')
  const img = box.querySelector('img')
  const caption = box.querySelector('p')
  const links = [...document.querySelectorAll('.frame a')]
  let at = 0
  const show = (i) => {
    at = (i + links.length) % links.length
    const thumb = links[at].querySelector('img')
    box.classList.remove('full')
    img.src = links[at].href
    img.alt = thumb.alt
    caption.textContent = thumb.alt
  }
  img.addEventListener('load', () => {
    if (img.naturalWidth > img.clientWidth + 1) caption.textContent = img.alt + ' · ' + box.dataset.hint
  })
  links.forEach((a, i) => a.addEventListener('click', (e) => {
    if (e.ctrlKey || e.metaKey || e.shiftKey || e.button !== 0) return
    e.preventDefault()
    show(i)
    box.showModal()
  }))
  img.addEventListener('click', (e) => {
    e.stopPropagation()
    // full size only helps when the picture was actually scaled down
    if (box.classList.contains('full') || img.naturalWidth > img.clientWidth + 1) box.classList.toggle('full')
  })
  box.querySelector('.stage').addEventListener('click', () => box.close())
  box.querySelector('.close').addEventListener('click', () => box.close())
  box.querySelector('.prev').addEventListener('click', () => show(at - 1))
  box.querySelector('.next').addEventListener('click', () => show(at + 1))
  box.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowLeft') show(at - 1)
    if (e.key === 'ArrowRight') show(at + 1)
  })
})()
