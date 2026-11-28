#!/usr/bin/env node
// 终验：把「清单完整」「Release 资产与记录同源」「版本一致」三件事做成可复跑的检查。
//
// 只读、不改仓库；任何一项不通过就以非 0 退出。
//   1. 全仓清单：每个需要人工结论的文件都有结论（测试/审计数据自动放行）
//   2. 记录里的 sha256 与 GitHub Release 资产的 digest 逐条比对
//   3. 最新 tag / package.json 版本 / Release 是否存在三者一致
//
// 用法：node scripts/verify-release.mjs [--skip-remote]

import { execFileSync } from 'node:child_process'
import { digestMatches, parseReleaseMap } from './lib/release-map.mjs'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const sleepMs = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms)
const skipRemote = process.argv.includes('--skip-remote')
const run = (cmd, args) => execFileSync(cmd, args, { cwd: ROOT, encoding: 'utf8' }).trim()

let failed = 0
const ok = (label, detail = '') => console.log(`✔ ${label}${detail ? '：' + detail : ''}`)
const bad = (label, detail) => { failed++; console.log(`✖ ${label}：${detail}`) }

// 1. 清单
try {
  const out = run(process.execPath, ['scripts/repo-inventory.mjs'])
  const pending = /待审：(\d+)/.exec(out)?.[1]
  const total = /自有代码文件：(\d+)/.exec(out)?.[1]
  if (pending === '0') ok('全仓清单', `${total} 个自有代码文件，0 待审`)
  else bad('全仓清单', `还有 ${pending} 个待审`)
} catch (error) {
  bad('全仓清单', error.message.split('\n')[0])
}

// 2. 记录 vs Release 资产
const log = readFileSync(join(ROOT, 'docs/ACCEPTANCE-LOG.md'), 'utf8')
// 记录里出现过两种措辞：早期的「候选包 /tmp/dsh-aurabot-qq-X.tgz」和后来的「Release dsh-aurabot-qq-X.tgz」。
// 两种都要认，否则新版本会被静默跳过（1.6.61–1.6.78 就是这样漏掉的）。
const pairTexts = [
  ...log.matchAll(/候选包\s+\/tmp\/dsh-aurabot-qq-(\d+\.\d+\.\d+)\.tgz[\s\S]{0,400}?sha256\s+([0-9a-f]{64})/g),
  ...log.matchAll(/Release\s+dsh-aurabot-qq-(\d+\.\d+\.\d+)\.tgz[\s\S]{0,400}?sha256\s+([0-9a-f]{64})/g),
].map((m) => [m[0], m[1], m[2]])
const pairs = pairTexts.filter(([, version], i, all) => all.findIndex((x) => x[1] === version) === i)
if (!pairs.length) bad('发布记录', 'docs/ACCEPTANCE-LOG.md 里没有「候选包 + sha256」')
else ok('发布记录', `${pairs.length} 个版本有哈希`)

if (skipRemote) console.log('· 跳过远端比对（--skip-remote）')
else {
  // 一次把 Releases 全拉下来：以前是「每个版本一次 gh api」，48 次连续调用会撞上次级限流，
  // 重试 3 次也救不回来（2026-11-29 00:21 真机就是这样整片变红、发布被卡住）。
  let remote = null
  let fetchError = null
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const text = run('gh', [
        'api', '--paginate', 'repos/Geng-zy/aurabot-qq-mac/releases?per_page=100',
        '--jq', '.[] | "\\(.tag_name) \\(.assets[0].digest // \"\")"',
      ])
      remote = parseReleaseMap(text)
      fetchError = null
      break
    } catch (error) {
      fetchError = error
      sleepMs(1500 * (attempt + 1))
    }
  }
  if (fetchError) {
    bad('远端 Release 列表', `${fetchError.message.split('\n')[0]}（一次批量调用，重试 3 次仍失败）`)
  } else if (remote.size === 0) {
    bad('远端 Release 列表', '一个 Release 都没读到')
  } else {
    ok('远端 Release 列表', `一次调用读到 ${remote.size} 个版本`)
    for (const [, version, sha] of pairs) {
      const remoteDigest = remote.get(`v${version}`) || ''
      const verdict = digestMatches(sha, remoteDigest)
      if (verdict.ok) ok(`v${version} 资产`, '与记录同哈希')
      else bad(`v${version} 资产`, verdict.reason)
    }
  }
}

// 3. 版本一致
try {
  const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')).version
  const tag = run('git', ['describe', '--tags', '--abbrev=0'])
  if (tag === `v${pkg}`) ok('版本一致', `package.json ${pkg} = tag ${tag}`)
  else bad('版本一致', `package.json ${pkg} ≠ 最近 tag ${tag}`)
} catch (error) {
  bad('版本一致', error.message.split('\n')[0])
}

console.log(failed ? `\n${failed} 项未通过` : '\n全部通过')
process.exit(failed ? 1 : 0)
