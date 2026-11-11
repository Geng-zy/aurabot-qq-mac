// 「获取可用模型」：问服务的 /models，按用途筛；SiliconFlow 按子类型问；Key 错、没这个接口都说清楚。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { listModels, checkBase } from '../src/core/models-list.js'

const reply = (body, status = 200) => async (url, init) => { reply.last = { url, init }; return { ok: status < 400, status, json: async () => body } }

test('OpenAI 风格：按名字认用途，认不出的放 others；带 Bearer', async () => {
  const f = reply({ data: [{ id: 'gpt-4o' }, { id: 'text-embedding-3-small' }, { id: 'whisper-1' }, { id: 'dall-e-3' }] })
  const r = await listModels({ baseUrl: 'https://api.openai.com/v1/', apiKey: 'sk-x', kind: 'asr', fetch: f })
  assert.equal(reply.last.url, 'https://api.openai.com/v1/models')
  assert.equal(reply.last.init.headers.Authorization, 'Bearer sk-x')
  assert.deepEqual(r.models, ['whisper-1'])
  assert.deepEqual(r.others, ['dall-e-3', 'gpt-4o', 'text-embedding-3-small'])
  assert.deepEqual((await listModels({ baseUrl: 'https://api.openai.com/v1', kind: 'embedding', fetch: f })).models, ['text-embedding-3-small'])
  assert.deepEqual((await listModels({ baseUrl: 'https://api.openai.com/v1', kind: 'image', fetch: f })).models, ['dall-e-3'])
})

test('SiliconFlow：按子类型问，回来的全算', async () => {
  const f = reply({ data: [{ id: 'BAAI/bge-reranker-v2-m3' }, { id: 'netease-youdao/bce-reranker-base_v1' }] })
  const r = await listModels({ baseUrl: 'https://api.siliconflow.cn/v1', apiKey: 'k', kind: 'rerank', fetch: f })
  assert.equal(reply.last.url, 'https://api.siliconflow.cn/v1/models?sub_type=reranker')
  assert.deepEqual(r.models, ['BAAI/bge-reranker-v2-m3', 'netease-youdao/bce-reranker-base_v1'])
  assert.deepEqual(r.others, [])
})

test('Ollama 原生格式也认；没 Key 不带 Authorization', async () => {
  const f = reply({ models: [{ name: 'bge-m3:latest' }, { name: 'qwen3:8b' }] })
  const r = await listModels({ baseUrl: 'http://127.0.0.1:11434/v1', kind: 'embedding', fetch: f })
  assert.equal(reply.last.init.headers.Authorization, undefined)
  assert.deepEqual(r.models, ['bge-m3:latest'])
})

test('出错说人话：Key 不对、没有列模型的接口、地址不对', async () => {
  await assert.rejects(listModels({ baseUrl: 'https://x.example/v1', kind: 'image', fetch: reply({}, 401) }), /API Key 不对/)
  await assert.rejects(listModels({ baseUrl: 'https://x.example/v1', kind: 'image', fetch: reply({}, 404) }), /没有「列出模型」的接口/)
  assert.throws(() => checkBase('ftp://x'), /服务地址不对/)
  assert.throws(() => checkBase('https://user:pw@x.example/v1'), /服务地址不对/)
})
