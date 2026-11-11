// 她的形象：导入几张图（同一张不重复、最多 8 张、只认图片），主图排第一，删的移到废纸篓；有形象描述。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createAppearance, MAX_APPEARANCE } from '../src/features/appearance.js'

const png = (n) => Buffer.concat([Buffer.from('89504e470d0a1a0a0000000d49484452', 'hex'), Buffer.from([n, n + 1, n + 2])])

test('导入、去重、上限、主图、移到废纸篓、描述', async (t) => {
  const root = mkdtempSync(join(tmpdir(), 'aurabot-look-'))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  let now = 1000
  const a = createAppearance({ dir: join(root, 'looks'), trashDir: join(root, 'trash'), now: () => ++now })
  const first = await a.add(png(1))
  const second = await a.add(png(2))
  assert.equal((await a.add(png(1))).duplicate, true)
  await assert.rejects(a.add(Buffer.from('不是图片')), /只认/)
  assert.deepEqual(a.list().map((x) => x.primary), [true, false])
  assert.equal(a.list()[0].file, first.file)
  assert.equal(a.setPrimary(second.file).ok, true)
  assert.equal(a.list()[0].file, second.file, '主图排第一')
  assert.equal(a.buffers()[0].equals(png(2)), true)
  assert.equal(a.remove(second.file).ok, true)
  assert.equal(readdirSync(join(root, 'trash')).length, 1, '删的移到了废纸篓')
  assert.equal(a.list()[0].primary, true, '主图删了，剩下的那张顶上')
  assert.equal(a.remove('../../etc/passwd').ok, false)
  for (let i = 3; i < 3 + MAX_APPEARANCE - 1; i++) await a.add(png(i * 3))
  await assert.rejects(a.add(png(250)), /最多/)
  a.setDescription('银白色长发，蓝眼睛')
  assert.equal(a.description(), '银白色长发，蓝眼睛')
})

test('参考图：gpt-image 系列一次给几张（image[]），别的只给主图（image）', async (t) => {
  const { createImageGen } = await import('../src/features/imagegen.js')
  const { normalize } = await import('../src/core/config.js')
  const seen = []
  const old = globalThis.fetch
  globalThis.fetch = async (url, init) => {
    seen.push({ url, fields: [...init.body.keys()] })
    return { ok: true, status: 200, json: async () => ({ data: [{ b64_json: png(7).toString('base64') }] }) }
  }
  t.after(() => { globalThis.fetch = old })
  const run = async (model) => {
    const cfg = normalize({ imageGen: { enabled: true, provider: 'openai', baseUrl: 'https://img.example/v1', model, img2img: true } })
    const gen = createImageGen({ getConfig: () => cfg, log: { info() {}, warn() {}, debug() {} }, local: null })
    await gen.generate('自拍', { image: png(1), extra: [png(2), png(3)] })
    gen.dispose?.()
    return seen.at(-1).fields.filter((f) => f.startsWith('image'))
  }
  assert.deepEqual(await run('gpt-image-1'), ['image[]', 'image[]', 'image[]'])
  assert.deepEqual(await run('Kwai-Kolors/Kolors'), ['image'])
})
