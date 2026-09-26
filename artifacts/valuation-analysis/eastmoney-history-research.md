# 东方财富 / 天天基金历史估值接口调查

调查日期：2026-09-26。仅调查公开页面脚本与只读接口，未更换项目数据源。

## 结论

尚未验证到可获取 H30269 历史 PE/PB 的同来源接口。不能将这个结论表述为“东方财富不存在指数历史估值接口”。

## 已核实的入口

1. 当前快照接口：
   `https://fundztapi.eastmoney.com/FundSpecialApiNew/FundSpecialZSB30ZSIndex?IndexCode=H30269&Version=6.5.5&deviceid=-&pageIndex=1&pageSize=10000&plat=Iphone&product=EFund`
   实测成功，TotalCount=1，日期 2026-09-24，Petim=8.45845086，PB=0.7844。Datas 是单个对象，不是历史列表；pageSize=10000 并未返回历史。

2. 东方财富估值分析公开页面：
   `https://emdata.eastmoney.com/gzfx/detail.html`
   页面脚本 `https://emdata.eastmoney.com/static/script/gzfx_detail_c8883c2313356146b01d.js`
   实际调用 RPT_CUSTOM_DMSK_TREND，过滤字段 SECURITY_CODE、INDICATORTYPE、DATETYPE。
   INDICATORTYPE：1=PE，2=PB；DATETYPE：1=1年、2=3年、3=5年、4=10年，来自页面选项。

3. 东方财富 F10 H5 估值组件：
   `https://emh5.eastmoney.com/html/js/chunk-ea396d9e.6c6bf617.js`
   同样调用 RPT_CUSTOM_DMSK_TREND，另见 SECUCODE 过滤格式及 RPT_STOCKVALUATIONTANTILE 分位接口。

4. 天天基金网页版 H30269 详情：
   `https://zhishubao.1234567.com.cn/home/detail?code=H30269`
   脚本 `https://zhishubao.1234567.com.cn/js/detail.js`
   发现 /home/GetIndexFundCompare 和 push2 行情接口，没有在这份脚本中发现历史 PE/PB 请求。

## 历史接口实测

端点：`https://datacenter.eastmoney.com/api/data/v1/get`

```text
reportName=RPT_CUSTOM_DMSK_TREND
columns=ALL
filter=(SECURITY_CODE="600519")(INDICATORTYPE=1)(DATETYPE=1)
pageNumber=1
pageSize=5000
sortColumns=TRADE_DATE
sortTypes=-1
```

filter 需按 URL 查询参数编码。

- 600519 PE 对照成功：241 条，最新 2026-09-24，INDICATOR_VALUE=18.98901222。
- H30269 PE / PB：success=false，code=9501，message=查询不到对应的估值。
- PE 另核对小写 h30269、SECURITY_CODE=H30269.CSI、SECUCODE=H30269.CSI，均无数据。
- 股票代码带 .SH 放入 SECURITY_CODE 也无数据；去掉后对照成功，不能将代码格式错误与服务不可用混淆。

以上证明本次找到并实测的接口没有返回 H30269 数据，不证明所有东方财富产品都无该指数数据。不要把股票历史接口直接接到指数图表，也不要从分位摘要或行情涨跌推算历史 PE。

## 下一步最有价值的线索

取得能够展示 H30269 历史 PE 曲线的东方财富 / 天天基金页面分享链接，从该真实入口追踪数据源。如果只有 App 原生页面，需要实际网络请求记录才能继续定位；截图本身无法说明使用哪个接口。找到后仍需核验与当前 Petim/PB 快照的日期和计算口径是否一致。
