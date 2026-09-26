<script setup>
import { computed, onMounted, ref } from 'vue'
import { CONSTITUENTS_SOURCE, getConstituents } from '../api/constituents.js'
defineProps({ instrument: { type: String, default: 'H30269' } })
const data = ref(null)
const loading = ref(false)
const error = ref(false)
const query = ref('')
const rows = computed(() => {
  const term = query.value.trim().toLowerCase()
  return (data.value?.members ?? []).filter(item => `${item.code} ${item.name}`.toLowerCase().includes(term))
})
async function load() {
  if (loading.value) return
  loading.value = true
  error.value = false
  try { data.value = await getConstituents() } catch { error.value = true }
  finally { loading.value = false }
}
onMounted(load)
</script>

<template>
  <section class="constituents" aria-label="指数成分股" :aria-busy="loading">
    <header><h3>{{ instrument === '512890' ? '标的指数成分股' : '指数成分股' }}</h3><button type="button" :disabled="loading" @click="load">{{ loading ? '读取中…' : error ? '重试' : '刷新' }}</button></header>
    <p class="caption">H30269 · 中证红利低波动指数</p>
    <p v-if="instrument === '512890'" class="caption">指数样本名单，非 ETF 实际持仓。</p>
    <p v-if="data?.date" class="caption">数据日期：{{ data.date }} · {{ data.count }} 只</p>
    <p v-if="error" class="status" role="status">读取失败{{ data ? '，保留上次数据。' : '，请重试。' }}</p>
    <p v-else-if="data && data.status !== 'ok'" class="status" role="status">{{ data.reason }}</p>
    <input v-model="query" class="search" type="search" aria-label="搜索成分股代码或名称" placeholder="搜索代码 / 名称" />
    <table v-if="rows.length">
      <thead><tr><th scope="col">代码</th><th scope="col">名称</th><th scope="col">市场</th></tr></thead>
      <tbody><tr v-for="item in rows" :key="item.code"><td class="code">{{ item.code }}</td><td>{{ item.name }}</td><td class="exchange">{{ item.exchange === 'SSE' ? '沪市' : '深市' }}</td></tr></tbody>
    </table>
    <p v-else class="empty">{{ loading ? '正在读取成分股…' : data?.count ? '没有匹配的成分股' : '暂无成分股数据' }}</p>
    <p class="caption">来源：<a :href="CONSTITUENTS_SOURCE" target="_blank" rel="noopener noreferrer">中证指数官方名单 ↗</a></p>
    <p class="caption">按证券代码排序。刷新读取最新已同步名单。</p>
  </section>
</template>

<style scoped>
.constituents { min-width: 0; padding: 12px 0; }
header { display: flex; justify-content: space-between; align-items: center; gap: 8px; }
h3 { color: #dfe5f1; font-size: 14px; font-weight: 600; }
button, .search { border: 1px solid #383d49; border-radius: 4px; background: #20232c; color: #b8c7dd; font: inherit; font-size: 11px; }
button { padding: 3px 7px; cursor: pointer; }
button:disabled { opacity: .6; cursor: default; }
.search { display: block; box-sizing: border-box; width: 100%; margin: 12px 0; padding: 7px 9px; }
.caption, .status, .empty { margin-top: 7px; color: #959baa; font-size: 11px; line-height: 1.7; }
.status { color: #dab57b; }
.empty { padding: 15px 0; text-align: center; }
table { width: 100%; border-collapse: collapse; font-size: 12px; }
th, td { padding: 8px 3px; border-bottom: 1px solid #252832; text-align: left; }
th { color: #8993a5; font-size: 11px; font-weight: 400; }
td { color: #d0d6e2; overflow-wrap: anywhere; }
.code { font-variant-numeric: tabular-nums; color: #a6b8c9; }
.exchange { color: #8993a5; font-size: 11px; white-space: nowrap; }
a { color: #8ba8cd; }
button:focus-visible, input:focus-visible, a:focus-visible { outline: 2px solid #67d5df; outline-offset: 2px; }
</style>
