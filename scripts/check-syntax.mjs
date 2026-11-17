// 全仓语法检查：node --check 每个 .js / .mjs 源文件。
// 用法：node scripts/check-syntax.mjs
import { readdirSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const ROOT = join(fileURLToPath(new URL('.', import.meta.url)), '..')
const TARGETS = ['src', 'scripts', 'client', 'test']
const SKIP = new Set(['node_modules', '.git', 'models', 'assets'])

function* walk(dir) {
  for (const name of readdirSync(dir)) {
    if (SKIP.has(name)) continue
    const full = join(dir, name)
    const stat = statSync(full)
    if (stat.isDirectory()) yield* walk(full)
    else if (/\.(?:js|mjs|cjs)$/.test(name)) yield full
  }
}

let failed = 0
let checked = 0
for (const folder of TARGETS) {
  let entries
  try { entries = walk(join(ROOT, folder)) } catch { continue }
  for (const file of entries) {
    checked += 1
    const result = spawnSync(process.execPath, ['--check', file], { encoding: 'utf8' })
    if (result.status !== 0) {
      failed += 1
      console.error(`✖ ${relative(ROOT, file)}\n${result.stderr || result.stdout}`)
    }
  }
}
if (failed) {
  console.error(`\n${failed} 个文件语法检查失败（共 ${checked} 个）`)
  process.exit(1)
}
console.log(`✓ ${checked} 个文件语法检查通过`)
