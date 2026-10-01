<script setup>
import { computed, reactive, ref, watch } from 'vue'
import { useDashboardData } from '../composables/useDashboardData.js'
import { CONSTITUENTS_SOURCE } from '../api/constituents.js'
import { INDUSTRY_SOURCE, industryDistribution, matchingSnapshot, membershipTimeline } from '../utils/constituentStructure.js'

defineProps({ instrument: { type: String, default: 'H30269' } })
const dashboard = useDashboardData()
const currentState = dashboard.states.constituents, historyState = dashboard.states.constituentHistory
const inputs = reactive({ current: null, history: null })
const loading = computed(() => currentState.loading || historyState.loading)
const error = computed(() => [currentState.error, historyState.error].filter(Boolean).join('；'))
watch(() => [currentState.data, historyState.data, loading.value, error.value], () => {
  if (loading.value || (error.value && (inputs.current || inputs.history))) return
  inputs.current = currentState.data; inputs.history = historyState.data
}, { immediate: true })
const selected = ref('current'), query = ref(''), industryFilter = ref('all')
const snapshotToolbar = ref(null)
function selectObservation(observedAt) {
  selected.value = observedAt
  snapshotToolbar.value?.scrollIntoView?.({ behavior: 'smooth', block: 'start' })
}
const history = computed(() => inputs.history)
const snapshots = computed(() => [...(history.value?.snapshots ?? [])].reverse())
const current = computed(() => matchingSnapshot(inputs.current, history.value) ?? inputs.current ?? snapshots.value[0] ?? null)
const snapshot = computed(() => selected.value === 'current' ? current.value : snapshots.value.find(item => item.observedAt === selected.value) ?? null)
watch(snapshots, values => { if (selected.value !== 'current' && !values.some(item => item.observedAt === selected.value)) selected.value = 'current' })
watch(selected, () => { industryFilter.value = 'all'; query.value = '' })
const distribution = computed(() => industryDistribution(snapshot.value))
const rows = computed(() => (snapshot.value?.members ?? []).filter(item => {
  const matchesIndustry = industryFilter.value === 'all' || (industryFilter.value === 'unknown' ? !item.industry : item.industry === industryFilter.value)
  return matchesIndustry && `${item.code} ${item.name}`.toLowerCase().includes(query.value.trim().toLowerCase())
}))
const events = computed(() => membershipTimeline(history.value))
const membershipEventCount = computed(() => events.value.filter(item => item.added.length || item.removed.length).length)
const mismatch = computed(() => Boolean(inputs.current?.members.length && history.value?.snapshots.length && !matchingSnapshot(inputs.current, history.value)))
const industryDates = computed(() => [...new Set(snapshot.value?.members.map(item => item.industryDate).filter(Boolean) ?? [])].sort())
const observedDates = computed(() => [...new Set(snapshot.value?.members.map(item => item.industryObservedAt).filter(Boolean) ?? [])].sort())
const formatTime = value => value ? new Intl.DateTimeFormat('zh-CN', { timeZone: 'Asia/Shanghai', dateStyle: 'short', timeStyle: 'medium' }).format(new Date(value)) : '尚未采集'
const dateRange = values => values.length ? values[0] === values.at(-1) ? values[0] : `${values[0]} — ${values.at(-1)}` : '暂无'
const filterKey = group => group.industry ?? 'unknown'
const hasWarning = computed(() => Boolean(error.value || mismatch.value || inputs.current?.status !== 'ok' || history.value?.membershipStatus !== 'ok' || history.value?.industryStatus !== 'ok'))
const refresh = () => dashboard.refresh(['constituents', 'constituentHistory'])
defineExpose({ loading, hasWarning })
for (const key of ['constituents', 'constituentHistory']) dashboard.ensure(key)
</script>

<template>
  <section class="constituent-structure panel" aria-label="H30269成分股变化与行业结构" :aria-busy="loading">
    <header class="structure-heading"><div><h2>成分股变化与行业结构</h2><p>H30269 · 中证红利低波动指数{{ instrument === '512890' ? ' · ETF 标的指数' : '' }}</p></div><button type="button" :disabled="loading" @click="refresh">{{ loading ? '读取中…' : '重新读取成分股' }}</button></header>
    <p class="structure-note">{{ instrument === '512890' ? '展示标的指数样本，非 ETF 实际持仓。' : '展示指数样本名单。' }}行业占比按股票数量计算，不代表指数权重或资金配置比例。</p>
    <p v-if="error" class="structure-warning" role="status">读取失败{{ inputs.current || inputs.history ? '，保留上次分析及原日期。' : '，暂无可用分析。' }}{{ error }}</p>
    <p v-if="inputs.current?.status && inputs.current.status !== 'ok'" class="structure-warning">{{ inputs.current.reason }}</p>
    <p v-if="history?.membershipStatus && history.membershipStatus !== 'ok'" class="structure-warning">最近名单采集：{{ history.membershipReason }}</p>
    <p v-if="history?.industryStatus && history.industryStatus !== 'ok'" class="structure-warning">最近行业采集：{{ history.industryReason }}</p>
    <p v-if="mismatch" class="structure-warning">当前名单与历史记录尚未同步，当前行业分布待同步；可以选择已有历史观察。</p>
    <p v-if="!snapshot?.members.length" class="structure-note">{{ loading ? '正在读取名单与行业分类…' : '暂无可用名单。' }}</p>
    <template v-else>
      <div ref="snapshotToolbar" class="snapshot-toolbar"><label>名单观察<select v-model="selected" aria-label="选择成分股历史观察"><option value="current">当前已保存名单 · {{ current?.date ?? '暂无日期' }}</option><option v-for="item in snapshots" :key="item.observedAt" :value="item.observedAt">{{ item.date }} · 观察 {{ formatTime(item.observedAt) }}</option></select></label><p class="structure-note">名单来源日期：{{ snapshot.date }} · 行业来源日期：{{ dateRange(industryDates) }}<br/>行业采集观察：{{ observedDates.length ? formatTime(observedDates.at(-1)) : '未保存行业分类，不用当前分类回填历史' }}</p></div>
      <dl class="structure-summary"><div><dt>样本股票</dt><dd>{{ distribution.total }}<small>只</small></dd></div><div><dt>已匹配行业</dt><dd>{{ distribution.industryCount }}<small>个一级行业</small></dd></div><div><dt>分类覆盖</dt><dd>{{ distribution.classified }} / {{ distribution.total }}</dd><p>{{ distribution.unknown }} 只未分类{{ distribution.stale ? ` · ${distribution.stale} 只分类保留值` : '' }}</p></div><div><dt>名单历史</dt><dd>{{ snapshots.length }}<small>次观察</small></dd><p>{{ membershipEventCount }} 次观察到调入调出</p></div></dl>
      <div class="concentration-summary" aria-label="已分类行业数量集中度">
        <div><span>最大已分类行业数量占比</span><strong>{{ distribution.concentration ? `${(distribution.concentration.largest.share * 100).toFixed(1)}%` : '—' }}</strong><p>{{ distribution.concentration ? `${distribution.concentration.largest.industries.join('、')} · ${distribution.concentration.largest.count} 只${distribution.concentration.largest.industries.length > 1 ? '（各行业并列）' : ''}` : '尚无已分类股票' }}</p></div>
        <div><span>前3个已分类行业数量占比</span><strong>{{ distribution.concentration ? `${(distribution.concentration.topThree.share * 100).toFixed(1)}%` : '—' }}</strong><p>{{ distribution.concentration ? `${distribution.concentration.topThree.industries.join('、')} · 合计 ${distribution.concentration.topThree.count} 只${distribution.concentration.topThree.industries.length < 3 ? `（实际 ${distribution.concentration.topThree.industries.length} 个行业）` : ''}` : '尚无已分类股票' }}</p></div>
      </div>
      <p class="structure-note">数量占比以全部 {{ distribution.total }} 只为分母，未分类不参与行业排名。{{ distribution.unknown ? '分类覆盖不足，以上仅描述已匹配行业，不能完整反映行业集中程度。' : '' }}{{ distribution.stale ? '包含保留分类，请结合原分类日期查看。' : '' }}</p>
      <div class="structure-grid">
        <section aria-label="行业股票数量分布"><div class="structure-subheading"><h3>行业数量分布</h3><button type="button" :aria-pressed="industryFilter === 'all'" @click="industryFilter = 'all'">全部行业</button></div><p class="structure-note">中证一级行业 · 按官方行业指数样本归属匹配<br/>占比以全部 {{ distribution.total }} 只为分母，未匹配项单列。</p>
          <ul class="industry-bars"><li v-for="group in distribution.groups" :key="filterKey(group)"><button type="button" :aria-pressed="industryFilter === filterKey(group)" :aria-label="`${group.label}，${group.count}只，占比${(group.share * 100).toFixed(1)}%，筛选成分股`" @click="industryFilter = industryFilter === filterKey(group) ? 'all' : filterKey(group)"><span>{{ group.label }}</span><strong>{{ group.count }} 只 · {{ (group.share * 100).toFixed(1) }}%</strong><span class="industry-track" aria-hidden="true"><span :style="{ width: `${group.share * 100}%` }" :class="{ unknown: group.industry === null }" /></span></button></li></ul>
        </section>
        <section aria-label="按行业查看成分股"><div class="structure-subheading"><h3>{{ industryFilter === 'all' ? '样本名单' : industryFilter === 'unknown' ? '未分类股票' : industryFilter }}</h3><span>{{ rows.length }} / {{ distribution.total }} 只</span></div><input v-model="query" class="member-search" type="search" aria-label="搜索结构分析股票代码或名称" placeholder="搜索股票代码 / 名称" />
          <div class="member-table-scroll" tabindex="0" role="region" aria-label="成分股与行业名单，可滚动查看"><table><thead><tr><th scope="col">股票</th><th scope="col">行业</th><th scope="col">分类来源日期</th></tr></thead><tbody><tr v-for="item in rows" :key="`${item.exchange}:${item.code}`"><td>{{ item.name }}<small>{{ item.code }} · {{ item.exchange === 'SSE' ? '沪市' : '深市' }}</small></td><td>{{ item.industry ?? '未分类' }}<small v-if="item.industryStatus === 'stale'" class="structure-warning">保留分类</small></td><td><a v-if="item.industrySourceIndex" :href="CONSTITUENTS_SOURCE.replace('H30269cons.xls', `${item.industrySourceIndex}cons.xls`)" target="_blank" rel="noopener noreferrer" :aria-label="`${item.name}行业匹配依据，来源日期${item.industryDate}`">{{ item.industryDate }}</a><span v-else>—</span></td></tr></tbody></table><p v-if="!rows.length" class="structure-note">没有匹配的成分股。</p></div>
        </section>
      </div>
    </template>
    <section class="membership-timeline" aria-label="名单变化时间线"><div class="structure-subheading"><h3>名单变化时间线</h3><span>{{ membershipEventCount }} 次调入调出观察</span></div><p class="structure-note">{{ history?.snapshots.length ? `已保存 ${history.snapshots[0].date} — ${history.snapshots.at(-1).date} 的 ${history.snapshots.length} 次名单观察。` : '历史尚未积累。' }}首次记录是基线，之后比较相邻观察；不能据此确认官方调样生效日，也不能发现两次采集之间发生又撤销的变化。</p>
      <p v-if="!events.length" class="structure-empty">{{ history?.snapshots.length > 1 ? '已保存观察中尚未发现调入调出或名称、行业归属变化。' : '至少积累两次观察后才能比较名单变化。' }}</p>
      <ol v-else class="timeline-events"><li v-for="event in events" :key="event.observedAt"><header><strong>{{ event.fromDate }} → {{ event.date }}</strong><span>{{ event.sameSourceDate ? '同源日期修订' : '相邻名单变化' }} · 观察 {{ formatTime(event.observedAt) }}</span></header><div class="event-observations"><button type="button" :aria-label="`查看变更前名单，观察于${formatTime(event.fromObservedAt)}`" @click="selectObservation(event.fromObservedAt)">查看变更前名单</button><button type="button" :aria-label="`查看变更后名单，观察于${formatTime(event.observedAt)}`" @click="selectObservation(event.observedAt)">查看变更后名单</button></div><div class="event-changes"><div><h4>调入 {{ event.added.length }} 只</h4><p v-if="!event.added.length">无</p><p v-for="member in event.added" :key="member.code" class="member-added">{{ member.code }} {{ member.name }}</p></div><div><h4>调出 {{ event.removed.length }} 只</h4><p v-if="!event.removed.length">无</p><p v-for="member in event.removed" :key="member.code" class="member-removed">{{ member.code }} {{ member.name }}</p></div></div><p v-for="item in event.renamed" :key="`name:${item.code}`" class="structure-note">名称更新：{{ item.code }} {{ item.before }} → {{ item.after }}，不计为调入调出。</p><p v-for="item in event.industryChanges" :key="`industry:${item.code}`" class="structure-note">行业归属观察变化：{{ item.code }} {{ item.name }} {{ item.before }} → {{ item.after }}。</p></li></ol>
      <details v-if="snapshots.length" class="observation-list"><summary>查看已保存观察日期</summary><ul><li v-for="item in snapshots" :key="item.observedAt"><button type="button" @click="selectObservation(item.observedAt)">{{ item.date }} · 观察 {{ formatTime(item.observedAt) }}</button><span>{{ item.members.length }} 只 · {{ item.members.filter(member => member.industry).length }} 只已分类</span></li></ul></details>
    </section>
    <details class="structure-method"><summary>来源与历史口径</summary><p>名单来自<a :href="CONSTITUENTS_SOURCE" target="_blank" rel="noopener noreferrer">中证官方 H30269 样本文件</a>；行业匹配依据为<a :href="INDUSTRY_SOURCE" target="_blank" rel="noopener noreferrer">中证全指行业指数编制方案</a>及其 11 个一级行业指数样本文件。</p><p>行业指数经过自身选样筛选，未覆盖全部上市公司；未匹配股票计入未分类，不代表从 H30269 调出。各份行业文件可能日期不同，分类仅代表所保存来源的观察结果；采集失败保留值单独标注。历史观察只用当时已保存分类，不用今天的行业分类回填旧名单。</p><p>时间线按市场和股票代码比较，名称更新不计为调入调出。同一天的名单内容修订保留独立观察。初始旧名单来自项目中真实保存的 Git 快照，之前的官方历次调样不推断、不补造。</p><p>“重新读取”只读取已部署文件；后续后台采集会继续积累历史和行业分类。</p></details>
  </section>
</template>

<style scoped>
.constituent-structure { padding: 18px 20px; min-width: 0; }
.structure-heading, .structure-subheading { display: flex; justify-content: space-between; align-items: center; gap: 12px; flex-wrap: wrap; }
h2 { font-size: 15px; } h3 { font-size: 13px; font-weight: 550; } h4 { font-size: 11px; font-weight: 500; }
.structure-heading p, .structure-subheading > span { color: #93a4bf; font-size: 11px; margin-top: 5px; }
button, select, .member-search { border: 1px solid #33435b; border-radius: 5px; color: #c7d8f2; background: #111d30; font: inherit; font-size: 11px; padding: 6px 9px; }
button { cursor: pointer; } button:disabled { opacity: .6; cursor: default; } button[aria-pressed="true"] { border-color: #67d5df; color: #89e3e9; }
button:focus-visible, input:focus-visible, select:focus-visible, summary:focus-visible, [tabindex="0"]:focus-visible { outline: 2px solid #67d5df; outline-offset: 2px; }
.structure-note, .structure-method { color: #93a4bf; font-size: 11px; line-height: 1.8; margin-top: 8px; overflow-wrap: anywhere; }
.structure-warning { color: #d5b57f; font-size: 11px; line-height: 1.8; margin-top: 8px; overflow-wrap: anywhere; }
.snapshot-toolbar { display: flex; flex-wrap: wrap; align-items: center; gap: 12px 24px; margin-top: 14px; font-size: 11px; color: #acbcd3; scroll-margin-top: calc(var(--header-height) + 16px); }
.snapshot-toolbar label { min-width: 0; max-width: 100%; } select { display: block; max-width: 100%; margin-top: 6px; }
.structure-summary { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 10px; margin: 14px 0 20px; }
.structure-summary > div { border: 1px solid #223049; border-radius: 8px; background: #0a1220; padding: 12px; }
.structure-summary dt { color: #acbcd3; font-size: 11px; } .structure-summary dd { margin: 9px 0 0; font: 600 23px var(--font-mono); color: #c7d8f2; }
.structure-summary small { display: inline-block; margin-left: 6px; font-size: 10px; font-weight: 400; color: #93a4bf; } .structure-summary p { color: #93a4bf; font-size: 10px; margin-top: 7px; }
.concentration-summary { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px; }
.concentration-summary > div { padding: 12px; border: 1px solid #223049; border-radius: 8px; background: #0a1220; min-width: 0; }
.concentration-summary span, .concentration-summary p { font-size: 11px; line-height: 1.8; color: #93a4bf; overflow-wrap: anywhere; }
.concentration-summary strong { display: block; margin: 7px 0; font: 600 23px var(--font-mono); color: #89e3e9; }
.structure-grid { margin-top: 20px; }
.event-observations { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; margin-top: 10px; color: #93a4bf; font-size: 11px; }
.structure-grid { display: grid; grid-template-columns: minmax(0, .85fr) minmax(0, 1.15fr); gap: 24px; }
.structure-grid > section { min-width: 0; } .industry-bars { padding: 0; margin-top: 12px; list-style: none; display: grid; gap: 6px; }
.industry-bars button { display: flex; flex-wrap: wrap; justify-content: space-between; gap: 8px; width: 100%; padding: 9px 10px; text-align: left; background: #0a1220; }
.industry-bars strong { font-size: 11px; font-family: var(--font-mono); font-weight: 400; }
.industry-track { width: 100%; height: 5px; border-radius: 3px; background: #1b2940; overflow: hidden; }
.industry-track > span { display: block; height: 100%; background: #67d5df; border-radius: 3px; } .industry-track > .unknown { background: #8993a5; }
.member-search { box-sizing: border-box; width: 100%; margin: 12px 0; padding: 8px 10px; }
.member-table-scroll { max-height: 500px; overflow: auto; border: 1px solid #223049; border-radius: 7px; }
table { width: 100%; border-collapse: collapse; font-size: 11px; } th, td { padding: 10px; border-bottom: 1px solid #223049; text-align: left; overflow-wrap: anywhere; } th { color: #93a4bf; background: #111d30; position: sticky; top: 0; font-weight: 400; } td { color: #c7d8f2; } td small { display: block; color: #93a4bf; font-size: 10px; margin-top: 5px; }
.membership-timeline { border-top: 1px solid #223049; padding-top: 18px; margin-top: 22px; } .structure-empty { padding: 16px 12px; background: #0a1220; border: 1px dashed #33435b; border-radius: 6px; color: #93a4bf; font-size: 11px; margin-top: 12px; }
.timeline-events { padding: 0; list-style: none; display: grid; gap: 10px; margin-top: 14px; } .timeline-events > li { border: 1px solid #223049; background: #0a1220; border-radius: 8px; padding: 14px; } .timeline-events header { display: flex; flex-wrap: wrap; justify-content: space-between; gap: 6px; font-size: 12px; color: #c7d8f2; } .timeline-events header span { color: #93a4bf; font-size: 10px; }
.event-changes { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 14px; margin-top: 12px; } .event-changes h4 { color: #acbcd3; } .event-changes p { margin-top: 6px; font-size: 11px; color: #93a4bf; } .event-changes .member-added { color: #ff8790; } .event-changes .member-removed { color: #63d0a7; }
.observation-list { margin-top: 14px; color: #acbcd3; font-size: 11px; } summary { cursor: pointer; } .observation-list ul { padding: 0; list-style: none; } .observation-list li { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; margin-top: 8px; } .observation-list span { color: #93a4bf; }
.structure-method { border-top: 1px solid #223049; padding-top: 12px; margin-top: 20px; } .structure-method p { margin-top: 7px; } a { color: #9bc5ff; text-decoration: underline; }
@media (max-width: 1050px) { .structure-summary { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
@media (max-width: 700px) { .constituent-structure { padding: 15px 12px; } .structure-grid { grid-template-columns: minmax(0, 1fr); gap: 20px; } .structure-summary dd { font-size: 20px; } th, td { padding: 8px 5px; } }
</style>
