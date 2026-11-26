// chat 层的装配守卫：hub 交给每个工厂的参数，必须覆盖工厂解构出来的每一个名字。
//
// 抓过的真实故障：1.6.9 把群聊上下文拆成 group-context.js 时，hub 的调用点漏传了 `pending`，
// 而那边第一行就是 `pending.get(msg.chatId)` —— 线上表现为
//   [error] [core] 处理消息出错： Cannot read properties of undefined (reading 'get')
// 拆文件时少传一个依赖不会报错，只会在那行代码第一次被走到时炸。这条测试把它变成提交前就能发现的问题。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readdirSync, readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const CHAT = join(ROOT, 'src/chat')
const hubSrc = readFileSync(join(CHAT, 'hub.js'), 'utf8')

/** 收集 src/chat/*.js 里 export function createX({ ... }) 的解构参数名。 */
function factories() {
  const out = new Map()
  for (const f of readdirSync(CHAT).filter((n) => n.endsWith('.js'))) {
    const src = readFileSync(join(CHAT, f), 'utf8')
    for (const m of src.matchAll(/export function (create[A-Za-z0-9_]+)\(\{([\s\S]*?)\}\)/g)) {
      const names = m[2]
        .split(/[,\n]/)
        .map((s) => s.trim().replace(/:.*$/, '').trim())
        .filter((s) => /^[A-Za-z_$][\w$]*$/.test(s))
      out.set(m[1], { file: f, names })
    }
  }
  return out
}

/** 从 hub 里取出 `createX({ ... })` 实参里出现的键名。 */
function passedKeys(name) {
  const re = new RegExp(`${name}\\(\\{([\\s\\S]*?)\\n  \\}\\)`, 'g')
  const call = [...hubSrc.matchAll(re)][0]
  if (!call) return null
  return new Set([...call[1].matchAll(/(?:^|[,{\s])([A-Za-z_$][\w$]*)\s*(?=[:,}\n]|$)/g)].map((m) => m[1]))
}

test('hub 给每个 chat 工厂都传齐了它解构的参数', () => {
  const missing = []
  for (const [name, info] of factories()) {
    const passed = passedKeys(name)
    if (!passed) continue // hub 里没调用（比如只给别的模块用）
    const lack = info.names.filter((n) => !passed.has(n))
    if (lack.length) missing.push(`${info.file} → ${name} 缺：${lack.join('、')}`)
  }
  assert.deepEqual(missing, [], `这些工厂会因为少传参数拿到 undefined：\n${missing.join('\n')}`)
})

test('工厂解构出来的名字在函数体里真的用到了（防僵尸依赖）', () => {
  const unused = []
  for (const f of readdirSync(CHAT).filter((n) => n.endsWith('.js'))) {
    const src = readFileSync(join(CHAT, f), 'utf8')
    for (const m of src.matchAll(/export function (create[A-Za-z0-9_]+)\(\{([\s\S]*?)\}\)\s*\{([\s\S]*)$/g)) {
      const names = m[2].split(/[,\n]/).map((s) => s.trim().replace(/:.*$/, '').trim()).filter((s) => /^[A-Za-z_$][\w$]*$/.test(s))
      const body = m[3]
      for (const n of names) if (!new RegExp(`\\b${n}\\b`).test(body)) unused.push(`${f} → ${m[1]} 的 ${n}`)
    }
  }
  assert.deepEqual(unused, [], `这些参数传进来却没用到：\n${unused.join('\n')}`)
})
