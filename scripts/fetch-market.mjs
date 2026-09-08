import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { describeError, REQUEST_DELAY_MS, updateH30269 } from './fetch-h30269.mjs'
import { H30269, ETF512890 } from './lib/market-data.mjs'

export async function updateMarket({
  instruments = [H30269, ETF512890],
  updater = updateH30269,
  logger = console,
  delay = (ms) => new Promise((done) => setTimeout(done, ms)),
  requestDelayMs = REQUEST_DELAY_MS,
} = {}) {
  let failed = false
  let attempted = false
  const readyForBackfill = []
  async function update(instrument, phase) {
    if (attempted && requestDelayMs > 0) await delay(requestDelayMs)
    attempted = true
    logger.log(`${phase === 'recent' ? '更新近期行情' : '回补历史'} ${instrument.code} ${instrument.name}`)
    return updater({ instrument, phase, logger })
  }

  // 先保存所有标的的近期行情，再进行可延后的历史回补。
  for (const instrument of instruments) {
    try {
      const result = await update(instrument, 'recent')
      if (result.errors.length || !result.data) {
        failed = true
        logger.error(`${instrument.code} 近期行情更新失败，保留已有数据，本轮跳过该标的历史回补`)
      } else if (!result.data.backfill.completed) {
        readyForBackfill.push(instrument)
      }
    } catch (error) {
      failed = true
      logger.error(`${instrument.code} 近期行情更新失败：${describeError(error)}`)
    }
  }

  for (const instrument of readyForBackfill) {
    try {
      const result = await update(instrument, 'backfill')
      if (result.errors.length) {
        logger.warn(`::warning::${instrument.code} 历史回补失败，近期行情已保存，回补游标保留，下次继续`)
      }
    } catch (error) {
      // 文件读写或校验异常仍需报错，不能归为可延后的上游失败。
      failed = true
      logger.error(`${instrument.code} 历史回补处理异常：${describeError(error)}`)
    }
  }
  return { failed }
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  updateMarket().then(({ failed }) => {
    if (failed) process.exitCode = 1
  }).catch((error) => {
    console.error(describeError(error))
    process.exitCode = 1
  })
}
