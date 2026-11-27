// 系统表情目录只有一份真相：面板列表与 <face:名字> 转换共用 faces.js 的索引，
// 并且一周（这里是一天）只从网关拉一次。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createFaces } from '../src/channels/qq/faces.js'

const log = { info() {}, warn() {}, debug() {}, error() {}, child() { return this } }

function fakeOnebot() {
  const calls = []
  return {
    calls,
    call: async (action, params, opts) => {
      calls.push({ action, params, opts })
      return { packs: [{ emojis: [
        { q_sid: '100', q_des: '/微笑' },
        { q_sid: '178', q_des: '/斜眼笑' },
        { q_sid: '9999', q_des: '/只有网关才有的表情' },
      ] }] }
    },
  }
}

test('list() 返回按编号升序的 [{id,name}]，并包含网关新增的条目', async () => {
  const ob = fakeOnebot()
  const faces = createFaces({ onebot: ob, log })
  const list = await faces.list()
  assert.ok(Array.isArray(list) && list.length > 0, '要返回目录')
  assert.deepEqual(Object.keys(list[0]).sort(), ['id', 'name'], '每项只有 id 与 name')
  const ids = list.map((f) => Number(f.id))
  assert.deepEqual(ids, [...ids].sort((a, b) => a - b), '按编号升序')
  assert.ok(list.some((f) => f.id === '9999' && f.name === '只有网关才有的表情'), '网关目录要合进来')
})

test('面板列表与文本转换共用同一份索引：只拉一次网关', async () => {
  const ob = fakeOnebot()
  const faces = createFaces({ onebot: ob, log })
  const [a, b] = await Promise.all([faces.list(), faces.list()])
  faces.idOf('斜眼笑')            // 文本转换也会触发 refresh()
  faces.nameOf('178')
  await new Promise((r) => setTimeout(r, 20))
  const fetched = ob.calls.filter((c) => c.action === 'fetch_sys_faces')
  assert.equal(fetched.length, 1, `缓存命中时不该重复拉目录，实际 ${fetched.length} 次`)
  assert.deepEqual(a, b, '两次 list() 结果一致')
  assert.equal(faces.idOf('斜眼笑'), 178, '文本转换能查到同一个编号')
  assert.equal(faces.nameOf('178'), '斜眼笑')
})

test('网关取不到时只用内置表，list() 不抛错（面板仍然能用）', async () => {
  const faces = createFaces({ onebot: { call: async () => { throw new Error('网关超时') } }, log })
  const list = await faces.list()
  assert.ok(list.length > 100, '内置整表兜底（329 条左右）')
  assert.ok(list.every((f) => /^\d+$/.test(f.id) && typeof f.name === 'string'))
})
