// 大文件下载口：只听 127.0.0.1、只给登记过的文件、口令作废后取不到。
import assert from 'node:assert/strict'
import { test, after } from 'node:test'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const { createFileRelay } = await import('../src/chat/file-relay.js')
const dir = mkdtempSync(join(tmpdir(), 'aurabot-relay-'))
after(() => rmSync(dir, { recursive: true, force: true }))

test('登记的文件能按地址取到，文件名带中文也行；别的口令 404', async () => {
  const file = join(dir, 'big.bin')
  writeFileSync(file, Buffer.alloc(3 * 1024 * 1024, 7))
  const relay = createFileRelay({ host: () => '127.0.0.1' })
  try {
    const url = await relay.offer(file, '大文件 1.zip')
    assert.match(url, /^http:\/\/127\.0\.0\.1:\d+\/f\/[a-f0-9]{32}\/%E5%A4%A7/)
    const r = await fetch(url)
    assert.equal(r.status, 200)
    assert.equal(Number(r.headers.get('content-length')), 3 * 1024 * 1024)
    assert.equal(Buffer.from(await r.arrayBuffer()).every((b) => b === 7), true)
    const wrong = url.replace(/\/f\/[a-f0-9]{32}/, '/f/' + '0'.repeat(32))
    assert.equal((await fetch(wrong)).status, 404)
    assert.equal((await fetch(url, { method: 'POST' })).status, 404)
  } finally {
    relay.close()
  }
})

test('只监听本机回环地址', async () => {
  const relay = createFileRelay({ host: () => '127.0.0.1' })
  try {
    const file = join(dir, 'a.txt')
    writeFileSync(file, 'x')
    await relay.offer(file)
    const { networkInterfaces } = await import('node:os')
    const lan = Object.values(networkInterfaces()).flat().find((i) => i && i.family === 'IPv4' && !i.internal)
    if (!lan) return // 这台机器没有局域网地址，跳过
    await assert.rejects(fetch(`http://${lan.address}:${relay.port}/`, { signal: AbortSignal.timeout(2000) }))
  } finally {
    relay.close()
  }
})

test('打开下载口的同时关闭，旧请求和新请求都不能再登记', async () => {
  const relay = createFileRelay()
  const pending = relay.offer(join(dir, 'race.txt'))
  relay.close()
  await assert.rejects(pending, /下载口已关闭/)
  await assert.rejects(relay.offer(join(dir, 'after.txt')), /下载口已关闭/)
  assert.equal(relay.port, 0)
  assert.equal(relay.size, 0)
})

test('收回或过期后取不到；默认地址是 host.docker.internal', async () => {
  const file = join(dir, 'b.txt')
  writeFileSync(file, 'hello')
  const relay = createFileRelay({ host: () => '127.0.0.1', ttlMs: 50 })
  try {
    const a = await relay.offer(file)
    relay.revoke(a)
    assert.equal((await fetch(a)).status, 404)
    const b = await relay.offer(file)
    await new Promise((r) => setTimeout(r, 80))
    assert.equal((await fetch(b)).status, 404)
    assert.equal(relay.size, 0)
  } finally {
    relay.close()
  }
  const def = createFileRelay()
  try {
    assert.match(await def.offer(file), /^http:\/\/host\.docker\.internal:\d+\/f\//)
  } finally {
    def.close()
  }
})
