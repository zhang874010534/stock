import { nextTick, onBeforeUnmount, onMounted, ref } from 'vue'

export function useKlineFullscreen(panel, resize) {
  const expanded = ref(false)
  const inlineHeight = ref(null)
  let previousFocus
  let previousOverflow
  let previousPadding

  function restoreBody() {
    document.body.style.overflow = previousOverflow
    document.body.style.paddingRight = previousPadding
  }

  async function toggle() {
    if (!expanded.value) {
      inlineHeight.value = panel.value.getBoundingClientRect().height
      previousFocus = document.activeElement
      previousOverflow = document.body.style.overflow
      previousPadding = document.body.style.paddingRight
      const scrollbar = window.innerWidth - document.documentElement.clientWidth
      if (scrollbar > 0) document.body.style.paddingRight = `${parseFloat(getComputedStyle(document.body).paddingRight) + scrollbar}px`
      document.body.style.overflow = 'hidden'
      expanded.value = true
    } else {
      expanded.value = false
      restoreBody()
    }
    await nextTick()
    resize()
    if (expanded.value) panel.value.focus({ preventScroll: true })
    else previousFocus?.focus({ preventScroll: true })
  }

  function handleKeydown(event) {
    if (!expanded.value) return
    if (event.key === 'Escape') {
      event.preventDefault()
      event.stopPropagation()
      toggle()
    } else if (event.key === 'Tab') {
      const controls = [...panel.value.querySelectorAll('button:not(:disabled), summary, select:not(:disabled), input:not(:disabled), [tabindex="0"]')]
        .filter((element) => element.getClientRects().length > 0)
      const first = controls[0]
      const last = controls.at(-1)
      const active = document.activeElement
      if (!controls.includes(active) || (!event.shiftKey && active === last) || (event.shiftKey && active === first)) {
        event.preventDefault()
        const target = event.shiftKey ? last : first
        target?.focus()
      }
    }
  }

  onMounted(() => document.addEventListener('keydown', handleKeydown, true))
  onBeforeUnmount(() => {
    document.removeEventListener('keydown', handleKeydown, true)
    if (expanded.value) restoreBody()
  })

  return { expanded, inlineHeight, toggle }
}
