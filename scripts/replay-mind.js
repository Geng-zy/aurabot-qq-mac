import { readFileSync, writeFileSync } from 'node:fs'
import { parseArgs } from 'node:util'
import { exampleMindReplay, replayMind } from '../src/mind/replay.js'
import { renderMindReplay } from './mind-replay-report.js'

const { values } = parseArgs({ options: {
  input: { type: 'string' },
  html: { type: 'string' },
  help: { type: 'boolean', short: 'h' },
  owner: { type: 'string' },
  'cost-per-million': { type: 'string' },
} })
if (values.help) {
  console.log('用法：npm run mind:replay -- [--input 事件.jsonl] [--html 报告.html] [--owner 平台:账号] [--cost-per-million 每百万 token 价格]')
  process.exit(0)
}
const cost = values['cost-per-million'] === undefined ? null : Number(values['cost-per-million'])
if (cost !== null && (!Number.isFinite(cost) || cost < 0)) throw new Error('每百万 token 价格必须为非负数字')
const events = values.input
  ? readFileSync(values.input, 'utf8').split(/\r?\n/).filter((line) => line.trim()).map((line) => JSON.parse(line))
  : exampleMindReplay()
const report = await replayMind(events, { ownerId: values.owner, costPerMillion: cost })
if (values.html) writeFileSync(values.html, renderMindReplay(report), { mode: 0o600 })
console.log(JSON.stringify(report, null, 2))
