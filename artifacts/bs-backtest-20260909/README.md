# 512890 波段信号回测存档

数据快照截止 2026-09-09。该目录保存行情、公式快照、逐日信号观察记录、回测脚本、逐笔交易和报告。

## 阅读入口

- [完整买卖条件回测](combined-report.md)：红线或 B 买入，波段卖或 S 清仓。
- [只按 S 卖出的对照](sell-comparison-report.md)。
- [波段卖减半、S 清仓的对照](partial-exit-report.md)：最新验证结果。
- `report.md` 和 `first-appearance-report.md` 为早期探索，买卖条件不同，保留用于追溯，不应混用其结果。

## 复现

在项目根目录运行（Node.js）：

```sh
node artifacts/bs-backtest-20260909/backtest-combined.mjs
node artifacts/bs-backtest-20260909/backtest-sell-comparison.mjs
node artifacts/bs-backtest-20260909/backtest-partial-exit.mjs
```

报告生成脚本为对应的 `make_*_report.py`，需要 Python 与 matplotlib；图中文字使用 Microsoft YaHei 字体。部分早期脚本依赖项目行情文件。对照脚本校验行情及当前项目公式哈希，公式变化后应使用对应版本复现。

当前规则按每日收盘时首次观察到的新信号，下一交易日开盘成交；信号消失不撤销交易，历史补画不能回溯成交。日线数据不能还原盘中出现后消失的信号。成本、参数、区间及样本限制见各报告与 summary JSON。
