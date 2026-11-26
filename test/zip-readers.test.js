// 两种内存 zip 读取者的分工：
//   readZip       —— 宽松，给模型权重包用（只要文件，不校验 CRC、不限大小）
//   readZipStrict —— 严格，给从网络下载的第三方 zip 用（拒绝加密/路径穿越、限总量、逐条校验 CRC 与长度）
// backup.js 的流式读取不在本测试范围（它从文件句柄读，另有 4GB/目录上限的检查）。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { crc32, deflateRawSync } from 'node:zlib'
import { readZip, readZipStrict, safeRelativePath } from '../src/core/zip.js'

/** 造一个 deflate 的 zip；mutate 可以在写完之后改字节（模拟损坏/加密位）。 */
function zip(files, mutate) {
  const locals = []
  const centrals = []
  let offset = 0
  for (const [name, text] of Object.entries(files)) {
    const data = Buffer.from(text)
    const path = Buffer.from(name)
    const body = deflateRawSync(data)
    const head = Buffer.alloc(30)
    head.writeUInt32LE(0x04034b50, 0)
    head.writeUInt16LE(20, 4)
    head.writeUInt16LE(0x0800, 6)
    head.writeUInt16LE(8, 8)
    head.writeUInt32LE(crc32(data), 14)
    head.writeUInt32LE(body.length, 18)
    head.writeUInt32LE(data.length, 22)
    head.writeUInt16LE(path.length, 26)
    const central = Buffer.alloc(46)
    central.writeUInt32LE(0x02014b50, 0)
    central.writeUInt16LE(20, 4)
    head.copy(central, 6, 4, 30)
    central.writeUInt32LE(offset, 42)
    locals.push(head, path, body)
    centrals.push(central, path)
    offset += head.length + path.length + body.length
  }
  const dir = Buffer.concat(centrals)
  const end = Buffer.alloc(22)
  const n = Object.keys(files).length
  end.writeUInt32LE(0x06054b50, 0)
  end.writeUInt16LE(n, 8)
  end.writeUInt16LE(n, 10)
  end.writeUInt32LE(dir.length, 12)
  end.writeUInt32LE(offset, 16)
  const buf = Buffer.concat([...locals, dir, end])
  if (mutate) mutate(buf)
  return buf
}

test('宽松读取者：按 want 只取需要的文件（模型包只挑 .pth/.index）', () => {
  const buf = zip({ 'a/model.pth': 'x', 'a/README.md': 'y', 'a/index.json': 'z' })
  const got = readZip(buf, (n) => /\.(pth|json)$/.test(n))
  assert.deepEqual(got.map((f) => f.name).sort(), ['a/index.json', 'a/model.pth'])
  assert.equal(got.find((f) => f.name === 'a/model.pth').data.toString(), 'x')
})

test('严格读取者：正常 zip 能解出全部文件', () => {
  const got = readZipStrict(zip({ 'a/b.js': 'hi' }), { validateName: safeRelativePath })
  assert.equal(got.length, 1)
  assert.equal(got[0].name, 'a/b.js')
  assert.equal(got[0].data.toString(), 'hi')
})

test('严格读取者：路径穿越 / 绝对路径 / 反斜杠一律拒绝', () => {
  for (const name of ['../evil.js', 'a/../../evil.js', '/etc/x', 'C:/x', 'a\\b.js']) {
    assert.throws(() => readZipStrict(zip({ [name]: 'x' }), { validateName: safeRelativePath }), /不安全/, name)
  }
})

test('严格读取者：加密条目拒绝', () => {
  const buf = zip({ 'a.js': 'x' }, (b) => { b.writeUInt16LE(0x0801, 6) }) // 置加密位（中央目录在 6 处？用本地头）
  // 本地头 bit0 与中央目录 bit0 都要置：这里直接改两处
  const local = buf.indexOf(Buffer.from([0x50, 0x4b, 0x03, 0x04]))
  buf.writeUInt16LE(0x0801, local + 6)
  const central = buf.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02]))
  buf.writeUInt16LE(0x0801, central + 8)
  assert.throws(() => readZipStrict(buf, { validateName: safeRelativePath }), /不能加密/)
})

test('严格读取者：内容被改过（CRC 不符）要报错', () => {
  const buf = zip({ 'a.js': 'hello world' })
  const dataAt = buf.indexOf(Buffer.from('hello'), 0, 'utf8')
  // deflate 后的字节不是明文，直接改压缩流让 inflate 出来不一样
  const local = buf.indexOf(Buffer.from([0x50, 0x4b, 0x03, 0x04]))
  const start = local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28)
  buf[start + 2] ^= 0xff
  assert.throws(() => readZipStrict(buf, { validateName: safeRelativePath }), /zip 校验失败|invalid|unexpected/i, `改了 ${dataAt} 附近的压缩流`)
})

test('严格读取者：解压后总大小超上限直接拒绝', () => {
  const buf = zip({ 'a.js': 'x'.repeat(2048) })
  assert.throws(() => readZipStrict(buf, { maxTotalBytes: 100 }), /解压后太大/)
})
