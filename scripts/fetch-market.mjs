import { updateH30269 } from './fetch-h30269.mjs'
import { H30269, ETF512890 } from './lib/market-data.mjs'

// Independent files and cursors: an upstream failure for one symbol must not skip the other.
for (const instrument of [H30269, ETF512890]) {
  try {
    console.log(`更新 ${instrument.code} ${instrument.name}`)
    const result = await updateH30269({ instrument })
    if (result.errors.length) process.exitCode = 1
  } catch (error) {
    console.error(`${instrument.code} 更新失败：${error.message}`)
    process.exitCode = 1
  }
}
