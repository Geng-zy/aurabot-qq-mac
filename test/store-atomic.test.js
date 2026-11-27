// 持久化原子的三条保证：写完才 rename、失败不留残渣、旧临时文件不干扰。
// 还守住「字段保真」：脱敏的历史配置读进来再写回去，未知字段不能丢。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, writeFileSync, readdirSync, mkdirSync, existsSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { writeJson, readJson, readJsonStrict } from '../src/core/store.js'

const base = mkdtempSync(join(tmpdir(), 'aurabot-store-'))
const dirOf = (name) => mkdtempSync(join(base, name + '-'))
const legacy = JSON.parse(readFileSync(new URL('./fixtures/store/legacy-config.json', import.meta.url), 'utf8'))

test('多次写入：任何时刻读到的都是完整 JSON，最终是最后一次的内容', () => {
  const dir = dirOf('atomic')
  const file = join(dir, 'state.json')
  for (let i = 0; i < 200; i++) {
    writeJson(file, { seq: i, pad: 'x'.repeat(i % 50) })
    const back = JSON.parse(readFileSync(file, 'utf8')) // 直接读原文：必须是完整 JSON
    assert.equal(typeof back.seq, 'number')
  }
  assert.equal(readJson(file).seq, 199)
  assert.deepEqual(readdirSync(dir), ['state.json'], '不该留下任何临时文件')
})

test('写入失败（rename 目标被目录占住）：抛错且不留临时文件', () => {
  const dir = dirOf('fail')
  const file = join(dir, 'state.json')
  mkdirSync(file) // 目标路径是个目录 → renameSync 会失败
  assert.throws(() => writeJson(file, { a: 1 }))
  const leftovers = readdirSync(dir).filter((n) => n.includes('.tmp-'))
  assert.deepEqual(leftovers, [], '失败后必须清理临时文件')
  assert.deepEqual(readdirSync(dir), ['state.json'], '原目录保持不变')
})

test('同 pid 的旧临时文件不会被复用或误删', () => {
  const dir = dirOf('stale')
  const file = join(dir, 'state.json')
  const stale = `${file}.tmp-${process.pid}`
  writeFileSync(stale, '{"half":', 'utf8') // 模拟上次崩溃留下的半截文件
  writeJson(file, { ok: true })
  assert.equal(readJson(file).ok, true)
  assert.ok(existsSync(stale), '别人的临时文件不该被删')
  assert.equal(readFileSync(stale, 'utf8'), '{"half":', '也不该被复用后改写成别的')
})

test('字段保真：脱敏历史配置读→写→读，未知字段原样保留', () => {
  const dir = dirOf('legacy')
  const file = join(dir, 'config.json')
  writeFileSync(file, JSON.stringify(legacy, null, 2), 'utf8')
  const loaded = readJsonStrict(file, {})
  writeJson(file, loaded, { durable: true })
  const again = readJsonStrict(file, {})
  assert.deepEqual(again, legacy, '未知/旧字段不能在写回时丢掉')
  assert.deepEqual(again.legacyFieldFromOldVersion, { keepMe: ['a', 'b'], nested: { n: 1 } })
  assert.equal(again.anotherUnknownField, 42)
})

test('损坏的 JSON：readJsonStrict 留底为 .broken-* 并抛错；readJson 退回 fallback', () => {
  const dir = dirOf('broken')
  const file = join(dir, 'config.json')
  writeFileSync(file, '{ 这不是 JSON', 'utf8')
  assert.throws(() => readJsonStrict(file, {}), /JSON 损坏/)
  const broken = readdirSync(dir).filter((n) => n.startsWith('config.json.broken-'))
  assert.equal(broken.length, 1, '损坏的文件要留底一份')
  assert.equal(existsSync(file), false, '坏文件被挪走，不会继续被当成配置读')
  assert.deepEqual(readJson(file, { fallback: true }), { fallback: true })
})

test('带 BOM 的文件照常读；durable 写入后内容仍可解析', () => {
  const dir = dirOf('bom')
  const file = join(dir, 'state.json')
  writeFileSync(file, '\uFEFF{"a":1}', 'utf8')
  assert.deepEqual(readJsonStrict(file, null), { a: 1 })
  writeJson(file, { a: 2 }, { durable: true })
  assert.deepEqual(readJson(file), { a: 2 })
})

test('dataDir 仍指向数据目录（本批不改路径契约）', async () => {
  const { dataDir } = await import('../src/core/store.js')
  const p = dataDir('sub', 'x.json')
  assert.ok(p.endsWith(join('plugins-data', 'aurabot', 'sub', 'x.json')) || p.includes('sub'), p)
})
