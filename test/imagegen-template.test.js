// 生图的纯逻辑（features/imagegen-template.js）：模板填值、尺寸解析、按路径取图、模型能力。
// 以前这些只能靠跑一次真接口来验，现在给输入就能断言。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { fill, dimsOf, dotted, findImage, multiReference } from '../src/features/imagegen-template.js'

test('fill：认识的占位符替换，不认识的原样留着，null/undefined 不替换', () => {
  assert.equal(fill('{"p":"{prompt}","n":{n}}', { prompt: '猫', n: 2 }), '{"p":"猫","n":2}')
  assert.equal(fill('{a}-{b}', { a: '', b: 0 }), '-0', '空串与 0 要替换')
  assert.equal(fill('{a}-{b}', { a: null, b: undefined }), '{a}-{b}', '空值保留占位符')
  assert.equal(fill(undefined, {}), '', '空模板给空串')
})

test('dimsOf：兼容 x / × / *，不合规返回空宽高', () => {
  assert.deepEqual(dimsOf('1024x768'), { width: '1024', height: '768' })
  assert.deepEqual(dimsOf('1024 × 768'), { width: '1024', height: '768' })
  assert.deepEqual(dimsOf('512*512'), { width: '512', height: '512' })
  assert.deepEqual(dimsOf('big'), { width: '', height: '' })
  assert.deepEqual(dimsOf(null), { width: '', height: '' })
})

test('dotted：按 a.b.0.c 取，缺环节返回 null', () => {
  const obj = { data: [{ url: 'http://x/a.png' }] }
  assert.equal(dotted(obj, 'data.0.url'), 'http://x/a.png')
  assert.equal(dotted(obj, 'data.1.url'), null)
  assert.equal(dotted(null, 'a.b'), null)
  assert.equal(dotted(obj, ''), obj, '空路径返回原对象')
})

test('findImage：data:image / http 图片地址都能在嵌套结构里找到；非图片不误认', () => {
  assert.equal(findImage({ data: [{ url: 'http://x/a.png' }] }), 'http://x/a.png')
  assert.equal(findImage({ result: { image: 'data:image/png;base64,AAA' } }), 'data:image/png;base64,AAA')
  assert.equal(findImage({ a: { b: { c: { d: { e: 'http://x/deep.webp' } } } } }), 'http://x/deep.webp')
  // 深度上限 6：再深的嵌套不找（防止恶意/异常响应把递归拖爆）
  const deep = { a: { b: { c: { d: { e: { f: { g: 'http://x/deep.webp' } } } } } } }
  assert.equal(findImage(deep), null, '超过深度上限不找')
  assert.equal(findImage({ text: '这不是图片' }), null)
  assert.equal(findImage({ url: 'http://x/page.html' }), null, '非图片扩展名不算')
  assert.equal(findImage(null), null)
})

test('multiReference：只对 gpt-image 系列为真', () => {
  assert.equal(multiReference('gpt-image-1'), true)
  assert.equal(multiReference('GPT-Image'), true)
  assert.equal(multiReference('flux-dev'), false)
  assert.equal(multiReference(undefined), false)
})
