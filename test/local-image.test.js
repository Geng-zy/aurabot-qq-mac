import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { createLocalImage } from '../src/features/local-image.js'
import { normalize } from '../src/core/config.js'

test('本地部署只补缺失环境和权重，重复提交不并发，下载失败可重试', async (t) => {
  const work = mkdtempSync(join(tmpdir(), 'aurabot-local-image-test-'))
  t.after(() => rmSync(work, { force: true, recursive: true }))
  const root = join(work, 'local')
  const python = join(root, 'env/bin/python')
  const call = []
  const write = (path) => { mkdirSync(dirname(path), { recursive: true }); writeFileSync(path, '') }
  const backend = createLocalImage({ root, legacy: join(work, 'legacy'), supported: true, mirror: () => 'off', uv: async () => 'test-uv',
    runImpl: async (cmd, args) => {
      call.push({ cmd, args })
      if (args[0] === 'venv') write(python)
      if (args[0] === 'pip') write(join(root, 'env/bin/mflux-generate-qwen-2.1-edit'))
      if (args[1]?.includes('snapshot_download')) throw new Error('模拟网络中断')
    },
  })
  t.after(backend.dispose)
  assert.equal(backend.status().ready, false)
  const pending = backend.install()
  assert.equal(backend.status().running, true)
  assert.equal((await backend.install()).ok, false)
  assert.match((await pending).message, /模拟网络中断/)
  assert.equal(backend.status().running, false)
  assert.equal(call.filter(({ cmd }) => cmd === 'test-uv').length, 2)
  const model = join(root, 'models/qwen-image-2.1/model_index.json')
  writeFileSync(model, Buffer.alloc(447))
  const bytes = backend.status().remainingBytes
  assert.equal(bytes, backend.status().modelBytes - 447)
  await backend.install()
  assert.equal(call.filter(({ cmd }) => cmd === 'test-uv').length, 2, '保留已装好的环境')
  assert.ok(call.at(-1).args.includes('processor/chat_template.jinja'))
  assert.ok(!call.at(-1).args.includes('model_index.json'))
  assert.ok(call.at(-1).args.includes('235fd28de40d745382e9d7a33f008c7735ec21c2'))
})

test('本地生图配置允许选内置后端并校验步数', () => {
  assert.equal(normalize({}).imageGen.localSteps, 20)
  const config = normalize({ imageGen: { provider: 'local', localSteps: 1000 } })
  assert.equal(config.imageGen.provider, 'local')
  assert.equal(config.imageGen.localSteps, 50)
})
