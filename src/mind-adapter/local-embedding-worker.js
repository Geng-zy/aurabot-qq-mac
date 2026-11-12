import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { parentPort, workerData } from 'node:worker_threads'

const { assetsDir } = workerData
const runtime = join(assetsDir, 'onnxruntime')

/** bge 用 BERT 那套 WordPiece：中文基本一字一个 token，英文按词再拆子词。 */
function buildTokenizer(vocabPath) {
  const vocab = new Map()
  readFileSync(vocabPath, 'utf8')
    .split('\n')
    .forEach((w, i) => {
      const t = w.replace(/\r$/, '')
      if (t || i === 0) vocab.set(t, i)
    })
  const cls = vocab.get('[CLS]') ?? 101
  const sep = vocab.get('[SEP]') ?? 102
  const unk = vocab.get('[UNK]') ?? 100

  function clean(s) {
    let out = ''
    for (const ch of String(s ?? '').normalize('NFD')) {
      if (/[\u0300-\u036f]/.test(ch)) continue
      const c = ch.toLowerCase()
      if (/\s/.test(c)) out += ' '
      else if (/[\u4e00-\u9fff]/.test(c)) out += ` ${c} `
      else if (/[\p{L}\p{N}]/u.test(c)) out += c
      else out += ` ${c} `
    }
    return out.replace(/\s+/g, ' ').trim()
  }

  function pieces(tok) {
    if (tok.length > 100) return [unk]
    if (vocab.has(tok)) return [vocab.get(tok)]
    const out = []
    let start = 0
    while (start < tok.length) {
      let end = tok.length
      let hit = null
      while (start < end) {
        const piece = (start > 0 ? '##' : '') + tok.slice(start, end)
        if (vocab.has(piece)) {
          hit = vocab.get(piece)
          break
        }
        end -= 1
      }
      if (hit == null) return [unk]
      out.push(hit)
      start = end
    }
    return out
  }

  return function encode(text, maxLen = 256) {
    const ids = [cls]
    for (const tok of clean(text).split(' ')) {
      if (!tok) continue
      for (const id of pieces(tok)) {
        ids.push(id)
        if (ids.length >= maxLen - 1) break
      }
      if (ids.length >= maxLen - 1) break
    }
    ids.push(sep)
    return ids
  }
}

let model
let ort
let tokenize
async function embed(text, query) {
  if (!model) {
    ort = await import(pathToFileURL(join(runtime, 'ort.wasm.bundle.min.mjs')).href)
    ort.env.wasm.numThreads = 1
    ort.env.wasm.wasmBinary = readFileSync(join(runtime, 'ort-wasm-simd-threaded.wasm'))
    tokenize = buildTokenizer(join(assetsDir, 'vocab.txt'))
    model = await ort.InferenceSession.create(readFileSync(join(assetsDir, 'model_int8.onnx')), { executionProviders: ['wasm'] })
  }
  const ids = tokenize(query ? '为这个句子生成表示以用于检索相关文章：' + text : text)
  const tensor = (values) => new ort.Tensor('int64', BigInt64Array.from(values, BigInt), [1, ids.length])
  const out = await model.run({
    input_ids: tensor(ids),
    attention_mask: tensor(ids.map(() => 1)),
    token_type_ids: tensor(ids.map(() => 0)),
  })
  const first = out[model.outputNames[0]]
  const dim = first?.dims.at(-1)
  if (!Number.isSafeInteger(dim) || dim < 1 || first.data.length < dim) throw new Error('离线模型返回的向量形状不正确')
  const pooled = Float32Array.from(first.data.subarray(0, dim))
  let norm = 0
  for (const value of pooled) norm += value * value
  if (!Number.isFinite(norm) || norm <= 0) throw new Error('离线模型返回无效向量')
  norm = Math.sqrt(norm)
  for (let i = 0; i < pooled.length; i++) pooled[i] /= norm
  return pooled
}

let queue = Promise.resolve()
parentPort.on('message', ({ id, text, query }) => {
  queue = queue.then(async () => {
    try {
      const vector = await embed(text, query)
      parentPort.postMessage({ id, vector }, [vector.buffer])
    } catch (error) {
      parentPort.postMessage({ id, error: error.message })
    }
  })
})
