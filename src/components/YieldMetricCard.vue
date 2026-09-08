<script setup>
import { computed, onMounted, reactive } from 'vue'
import { getYield } from '../api/yields.js'

const props = defineProps({ instrument: { type: String, default: 'H30269' } })
const title = computed(() => props.instrument === '512890' ? '标的指数股息率' : '指数股息率')
const state = reactive({ dividend: { data: null, loading: true, error: false }, treasury: { data: null, loading: true, error: false } })
async function load(kind) {
  state[kind].loading = true
  state[kind].error = false
  try { state[kind].data = await getYield(kind) }
  catch { state[kind].error = true }
  finally { state[kind].loading = false }
}
const format = (data, digits) => data ? `${data.value.toFixed(digits)}%` : '—'
onMounted(() => { load('dividend'); load('treasury') })
</script>

<template>
  <article class="yield-card panel" aria-label="指数股息率和中国十年期国债收益率">
    <div class="yield-section" :aria-busy="state.dividend.loading">
      <h2>{{ title }}</h2>
      <p class="yield-value">{{ format(state.dividend.data, 2) }}</p>
      <p class="yield-description">H30269 · 总股本口径</p>
      <p class="yield-date">{{ state.dividend.data ? `数据日期：${state.dividend.data.date}` : state.dividend.loading ? '正在读取…' : '暂无数据' }}</p>
      <p v-if="state.dividend.error" class="yield-error" role="status">读取失败{{ state.dividend.data ? '，保留上次数据' : '' }} <button :disabled="state.dividend.loading" @click="load('dividend')">重试</button></p>
      <a href="https://oss-ch.csindex.com.cn/static/html/csindex/public/uploads/file/autofile/indicator/H30269indicator.xls" target="_blank" rel="noopener noreferrer">来源：中证指数</a>
    </div>
    <div class="yield-section treasury" :aria-busy="state.treasury.loading">
      <h3>中国十年期国债收益率</h3>
      <p class="yield-value treasury-value">{{ format(state.treasury.data, 4) }}</p>
      <p class="yield-description">中债国债到期收益率曲线 · 10年</p>
      <p class="yield-date">{{ state.treasury.data ? `数据日期：${state.treasury.data.date}` : state.treasury.loading ? '正在读取…' : '暂无数据' }}</p>
      <p v-if="state.treasury.error" class="yield-error" role="status">读取失败{{ state.treasury.data ? '，保留上次数据' : '' }} <button :disabled="state.treasury.loading" @click="load('treasury')">重试</button></p>
      <a href="https://yield.chinabond.com.cn/cbweb-cbrc-web/cbrc/showCbrc" target="_blank" rel="noopener noreferrer">来源：中债</a>
    </div>
    <p v-if="instrument === '512890'" class="yield-note">展示跟踪指数的股息率，不代表 ETF 实际分红收益率。</p>
  </article>
</template>

<style scoped>
.yield-card { min-width: 0; padding: 14px 17px 12px; }
h2, h3 { font-size: 13px; font-weight: 500; color: #dfe5f1; }
.yield-value { margin-top: 7px; font-family: var(--font-mono); font-size: 30px; font-weight: 600; line-height: 1.25; color: #68d5de; }
.yield-description, .yield-date, .yield-note, a, .yield-error { font-size: 11px; line-height: 1.6; }
.yield-description { margin-top: 2px; color: var(--color-text-muted); }
.yield-date { margin-top: 5px; color: #93a3bb; }
a { color: #8ba8cd; text-decoration: underline; text-underline-offset: 3px; }
.treasury { margin-top: 12px; padding-top: 12px; border-top: 1px solid #25364c; }
.treasury-value { font-size: 24px; color: #d9e4f8; }
.yield-note { margin-top: 10px; color: #93a3bb; }
.yield-error { color: #dab57b; margin-top: 4px; }
button { padding: 0 4px; color: #9bc5ff; background: none; border: 0; text-decoration: underline; }
</style>
