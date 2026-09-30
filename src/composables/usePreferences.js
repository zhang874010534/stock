import { computed, inject, nextTick, provide, reactive, ref, watch } from 'vue'
import { defaultPreferences, normalizePreferences, PREFERENCES_KEY } from '../utils/preferences.js'

const preferencesKey = Symbol('preferences')

export function createPreferences({ storage } = {}) {
  const storageError = ref(''), notice = ref('')
  let initial = defaultPreferences()
  const getStorage = () => storage ?? globalThis.localStorage
  try {
    const raw = getStorage()?.getItem(PREFERENCES_KEY)
    if (raw !== null && raw !== undefined) {
      const saved = JSON.parse(raw)
      initial = normalizePreferences(saved)
      if (saved?.schemaVersion !== 1) notice.value = '本机偏好版本不受支持，已使用默认设置。'
    }
  } catch { storageError.value = '无法读取本机偏好，已使用默认设置。' }
  const state = reactive(initial)
  function save() {
    try {
      const target = getStorage()
      if (!target) throw new Error('Storage unavailable')
      target.setItem(PREFERENCES_KEY, JSON.stringify(normalizePreferences(state)))
      storageError.value = ''
    } catch { storageError.value = '本机偏好保存失败，重新打开后可能无法保留设置。' }
  }
  const stop = watch(state, () => { notice.value = ''; save() }, { deep: true, flush: 'post' })
  async function reset() {
    const defaults = defaultPreferences()
    state.instrument = defaults.instrument
    state.charts = defaults.charts
    await nextTick()
    save()
    if (!storageError.value) notice.value = '已恢复默认证券和图表偏好。'
  }
  return { state, message: computed(() => storageError.value || notice.value), reset, stop }
}

export function providePreferences(preferences = createPreferences()) {
  provide(preferencesKey, preferences)
  return preferences
}

export function usePreferences() {
  return inject(preferencesKey, null) ?? createPreferences()
}
