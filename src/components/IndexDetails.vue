<script setup>
defineProps({ instrument: { type: String, default: 'H30269' } })

const methodologyUrl = 'https://oss-ch.csindex.com.cn/static/html/csindex/public/uploads/indices/detail/files/zh_CN/H30269_Index_Methodology_cn.pdf'
const factsheetUrl = 'https://oss-ch.csindex.com.cn/static/html/csindex/public/uploads/indices/detail/files/zh_CN/H30269factsheet.pdf'
</script>

<template>
  <section class="index-details" aria-label="指数速览">
    <div class="details-heading">
      <h3>{{ instrument === '512890' ? '标的指数速览' : '指数速览' }}</h3>
      <a :href="factsheetUrl" target="_blank" rel="noopener noreferrer" aria-label="更多：查看中证指数单张 PDF">更多 <span aria-hidden="true">›</span></a>
    </div>
    <p v-if="instrument === '512890'" class="details-caption">以下为 H30269 标的指数资料。</p>
    <dl class="details-list">
      <div class="details-row">
        <dt>指数说明</dt>
        <dd>从流动性较好、持续现金分红的证券中，结合股利支付情况及每股股息增长进行筛选，再选出高股息、低波动的 50 只证券。指数按股息率加权，呈现这类证券的整体表现。</dd>
      </div>
      <div class="details-row">
        <dt>指数全称</dt>
        <dd>中证红利低波动指数</dd>
      </div>
      <div class="details-row">
        <dt>指数代码</dt>
        <dd>H30269</dd>
      </div>
      <div class="details-row">
        <dt>成分股数量</dt>
        <dd>50 <span class="value-note">只 · 编制方案规定</span></dd>
      </div>
      <div class="details-row">
        <dt>总市值</dt>
        <dd><span aria-label="暂无总市值数据">—</span><span class="value-note">暂无数据</span></dd>
      </div>
      <div class="details-row">
        <dt>指数编制方式</dt>
        <dd><a :href="methodologyUrl" target="_blank" rel="noopener noreferrer" aria-label="查看中证红利低波动指数编制方案原文 PDF">查看原文 <span aria-hidden="true">↗</span></a></dd>
      </div>
    </dl>
    <p class="details-source">资料来源：中证指数。说明依据官方编制方案整理；成分股数量为方案样本数。</p>
  </section>
</template>

<style scoped>
.index-details { min-width: 0; padding: 4px 0 14px; }
.details-heading { display: flex; align-items: center; justify-content: space-between; gap: 12px; margin-bottom: 12px; }
.details-heading h3 { margin: 0; color: #dfe5f1; font-size: 14px; font-weight: 600; }
.details-heading a { color: #959baa; font-size: 11px; }
.details-heading a span { margin-left: 3px; font-size: 16px; }
.details-list { display: grid; gap: 12px; margin: 0; }
.details-row { display: grid; grid-template-columns: 78px minmax(0, 1fr); gap: 10px; align-items: baseline; font-size: 12px; line-height: 1.8; }
dt { color: #959baa; }
dd { margin: 0; color: #d0d6e2; overflow-wrap: anywhere; font-variant-numeric: tabular-nums; }
.value-note { margin-left: 5px; color: #8993a5; font-size: 10px; }
.details-caption, .details-source { color: #8993a5; font-size: 10px; line-height: 1.7; }
.details-caption { margin: -5px 0 12px; }
.details-source { margin: 16px 0 0; padding-top: 10px; border-top: 1px solid #252832; }
a { color: #8ba8cd; text-decoration: none; }
a:hover { color: #b8d2f3; text-decoration: underline; text-underline-offset: 3px; }
a:focus-visible { outline: 2px solid #67d5df; outline-offset: 3px; }
</style>
