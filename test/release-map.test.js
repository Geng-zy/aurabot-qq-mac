import assert from 'node:assert/strict'
import test from 'node:test'
import { digestMatches, parseReleaseMap } from '../scripts/lib/release-map.mjs'

// 回归：2026-11-29 00:21 真机 —— verify-release 逐个版本打 gh api（48 次）撞上次级限流，
// 整片变红、发布被卡住。修法是把 48 次压成 1 次批量拉取，这里钉住解析与比对。
test('解析 gh 批量输出：tag 与 digest 成对，空摘要保留为占位', () => {
  const map = parseReleaseMap([
    'v1.7.15 sha256:69ff95da84cec34c312b519a9c70212e2851705a36bd1a936633e170072a907e',
    'v1.0.0 sha256:aaaa',
    'v0.9.0 ',
    '',
  ].join('\n'))
  assert.equal(map.get('v1.7.15'), 'sha256:69ff95da84cec34c312b519a9c70212e2851705a36bd1a936633e170072a907e')
  assert.equal(map.get('v1.0.0'), 'sha256:aaaa')
  assert.equal(map.get('v0.9.0'), '', '没有资产的版本要留下空摘要，不能当成通过')
  assert.equal(map.size, 3)
})

test('空输入不炸，返回空表', () => {
  assert.equal(parseReleaseMap('').size, 0)
  assert.equal(parseReleaseMap(undefined).size, 0)
})

test('比对：同源通过；不同源报差异；远端为空明确失败', () => {
  const sha = '69ff95da84cec34c312b519a9c70212e2851705a36bd1a936633e170072a907e'
  assert.equal(digestMatches(sha, `sha256:${sha}`).ok, true)
  const mismatch = digestMatches(sha, 'sha256:0000')
  assert.equal(mismatch.ok, false)
  assert.match(mismatch.reason, /≠ 远端/)
  const missing = digestMatches(sha, '')
  assert.equal(missing.ok, false)
  assert.match(missing.reason, /远端没有/)
})
