// 通用 HTTP 语音后端（voice/http-synth.js）：模板替换与响应解析的独立回归。
// 全部用假 fetch + 假 saveAudio，不联网、不写磁盘（媒体用本地样本形状，提供方全模拟）。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { httpSynth, parseHeaderText, pickAudioFromJson } from '../src/voice/http-synth.js'

const AUDIO = Buffer.alloc(1200, 7) // >400 字节，够过「太短」判断
const saved = []
const saveAudio = (buf, rate) => { saved.push({ bytes: buf.length, rate }); return '/tmp/out.wav' }
const res = (body, { status = 200, ctype = 'audio/mpeg', text = '' } = {}) => ({
  ok: status >= 200 && status < 300,
  status,
  headers: { get: (k) => (String(k).toLowerCase() === 'content-type' ? ctype : null) },
  arrayBuffer: async () => body,
  text: async () => text,
})

test('GET：{text} 做 URL 编码替换', async () => {
  let seen = ''
  const r = await httpSynth('你好 世界', { urlTemplate: 'http://x/tts?t={text}', method: 'GET' }, {
    saveAudio, fetchImpl: async (url) => { seen = url; return res(AUDIO) },
  })
  assert.equal(seen, 'http://x/tts?t=' + encodeURIComponent('你好 世界'))
  assert.equal(r, '/tmp/out.wav')
  assert.equal(saved.at(-1).rate, 24000, '默认 24k')
})

test('POST：{text} 转义、{text_raw} 不转义、{reqid} 每次不同，默认补 content-type', async () => {
  const bodies = []
  const headers = []
  const cfg = { urlTemplate: 'http://x/tts', method: 'POST', body: '{"t":"{text}","raw":"{text_raw}","id":"{reqid}"}', headers: 'A: 1\n# 注释\n\nB:2' }
  const fetchImpl = async (_url, init) => { bodies.push(init.body); headers.push(init.headers); return res(AUDIO) }
  await httpSynth('他说"嗨"', cfg, { saveAudio, fetchImpl })
  await httpSynth('他说"嗨"', cfg, { saveAudio, fetchImpl })
  assert.match(bodies[0], /"t":"他说\\"嗨\\""/, '{text} 要按 JSON 字符串转义')
  assert.match(bodies[0], /"raw":"他说"嗨""/, '{text_raw} 不转义')
  assert.notEqual(bodies[0], bodies[1], '{reqid} 每次不同')
  assert.equal(headers[0]['content-type'], 'application/json', '没填就补 content-type')
  assert.deepEqual({ A: headers[0].A, B: headers[0].B }, { A: '1', B: '2' }, '解析请求头文本')
})

test('JSON 响应：从嵌套字段扒 base64 解开', async () => {
  const b64 = AUDIO.toString('base64')
  const got = await httpSynth('x', { urlTemplate: 'http://x/{text}' }, {
    saveAudio, fetchImpl: async () => res(Buffer.from(JSON.stringify({ code: 0, data: { audio_base64: b64 } })), { ctype: 'application/json' }),
  })
  assert.equal(got, '/tmp/out.wav')
  assert.equal(saved.at(-1).bytes, AUDIO.length, '解出来的字节数应与原始音频一致')
})

test('错误分支：没填地址 / GET 缺 {text} / POST 缺请求体 / 返回网页 / JSON 没音频 / 太短 / 太大', async () => {
  await assert.rejects(() => httpSynth('x', { method: 'GET' }, { saveAudio }), /没填地址/)
  await assert.rejects(() => httpSynth('x', { urlTemplate: 'http://x/tts', method: 'GET' }, { saveAudio }), /要有 \{text\}/)
  await assert.rejects(() => httpSynth('x', { urlTemplate: 'http://x/tts', method: 'POST' }, { saveAudio }), /要填请求体/)
  await assert.rejects(
    () => httpSynth('x', { urlTemplate: 'http://x/{text}' }, { saveAudio, fetchImpl: async () => res(Buffer.from('<html>no</html>'), { ctype: 'text/html' }) }),
    /返回了网页而不是音频/)
  await assert.rejects(
    () => httpSynth('x', { urlTemplate: 'http://x/{text}' }, { saveAudio, fetchImpl: async () => res(Buffer.from(JSON.stringify({ code: 5, message: 'quota' })), { ctype: 'application/json' }) }),
    /没找到音频数据.*quota/)
  await assert.rejects(
    () => httpSynth('x', { urlTemplate: 'http://x/{text}' }, { saveAudio, fetchImpl: async () => res(Buffer.alloc(10)) }),
    /音频太短/)
  await assert.rejects(
    () => httpSynth('x', { urlTemplate: 'http://x/{text}' }, { saveAudio, fetchImpl: async () => res(Buffer.alloc(31 * 1024 * 1024)) }),
    /太大/)
})

test('HTTP 非 2xx：带状态码与响应片段（便于面板显示真实原因）', async () => {
  await assert.rejects(
    () => httpSynth('x', { urlTemplate: 'http://x/{text}' }, { saveAudio, fetchImpl: async () => res(Buffer.alloc(0), { status: 502, text: 'bad gateway' }) }),
    /HTTP 502：bad gateway/)
})

test('纯函数：parseHeaderText / pickAudioFromJson', () => {
  assert.deepEqual(parseHeaderText('a: 1\nb:2\n#x\nbadline'), { a: '1', b: '2' })
  assert.equal(pickAudioFromJson({ data: 'x'.repeat(300) }).length, 300)
  assert.equal(pickAudioFromJson({ data: { audio: 'y'.repeat(250) } }).length, 250)
  assert.equal(pickAudioFromJson({ data: 'short' }), '', '太短的字符串不当作音频')
  assert.equal(pickAudioFromJson(null), '')
})
