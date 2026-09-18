<script setup>
import { computed, onMounted, ref } from 'vue'
import { getValuation, VALUATION_SOURCE } from '../api/valuations.js'
import MetricCard from './MetricCard.vue'

const props = defineProps({ instrument: { type: String, default: '512890' } })
const prefix = computed(() => props.instrument === '512890' ? '标的指数' : '指数')
const data = ref(null)
const loading = ref(true)
const error = ref(false)
async function load() {
  loading.value = true
  error.value = false
  try { data.value = await getValuation() }
  catch { error.value = true }
  finally { loading.value = false }
}
onMounted(load)
</script>

<template>
  <MetricCard v-for="kind in ['pe', 'pb']" :key="kind"
    :title="`${prefix} ${kind.toUpperCase()}`" :value="data ? `${data[kind].toFixed(2)} 倍` : '—'"
    :description="kind === 'pe' ? '市盈率 · 东方财富口径' : '市净率 · 东方财富口径'"
    :accent="kind === 'pe' ? 'cyan' : 'purple'"
    :period="data ? `数据日期：${data.date}` : loading ? '正在读取…' : '暂无数据'"
    :aria-busy="loading">
    <div class="valuation-details">
      <a :href="VALUATION_SOURCE" target="_blank" rel="noopener noreferrer">来源：东方财富 / 天天基金</a>
      <p>H30269 · {{ kind === 'pe' ? 'TTM 口径待确认' : '加权口径待确认' }}</p>
      <p v-if="error" class="valuation-error" role="status">读取失败{{ data ? '，保留上次数据' : '' }} <button :disabled="loading" @click="load">重试</button></p>
    </div>
  </MetricCard>
</template>

<style scoped>
.valuation-details { margin-top: 8px; color: #93a3bb; font-size: 11px; line-height: 1.7; }
a, button { color: #8ba8cd; text-decoration: underline; text-underline-offset: 3px; }
button { border: 0; background: none; padding: 0 4px; }
.valuation-error { color: #dab57b; }
</style>
