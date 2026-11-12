// 随包的 ONNX WebAssembly 在专用线程中运行，安装时无需执行第三方脚本。
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { Worker } from 'node:worker_threads'

const REQUIRED = ['model_int8.onnx', 'vocab.txt', 'onnxruntime/ort.wasm.bundle.min.mjs', 'onnxruntime/ort-wasm-simd-threaded.wasm']

export function createEmbedder(assetsDir) {
  let worker
  let nextId = 0
  let failed = ''
  let closed = false
  const pending = new Map()

  function probe() {
    if (closed) return '离线向量已关闭'
    if (failed) return failed
    return REQUIRED.every((file) => existsSync(join(assetsDir, file))) ? '' : '插件包缺少离线向量模型或运行时'
  }

  function fail(error) {
    if (!closed) failed = '离线向量加载或运行失败：' + error.message
    for (const request of pending.values()) request.reject(error)
    pending.clear()
  }

  function openWorker() {
    const thread = new Worker(new URL('./local-embedding-worker.js', import.meta.url), { workerData: { assetsDir }, execArgv: [] })
    thread.on('message', ({ id, vector, error }) => {
      const request = pending.get(id)
      if (!request) return
      pending.delete(id)
      if (!pending.size) thread.unref()
      if (error) {
        failed = '离线向量加载或运行失败：' + error
        request.reject(new Error(failed))
      } else request.resolve(vector)
    })
    thread.on('error', fail)
    thread.on('exit', (code) => { if (!closed) fail(new Error('向量线程已退出（' + code + '）')) })
    return thread
  }

  async function embed(text, { query = false } = {}) {
    const problem = probe()
    if (problem) throw new Error(problem)
    worker ??= openWorker()
    worker.ref()
    return new Promise((resolve, reject) => {
      const id = ++nextId
      pending.set(id, { resolve, reject })
      try { worker.postMessage({ id, text: String(text || '').slice(0, 2000), query }) }
      catch (error) {
        pending.delete(id)
        if (!pending.size) worker.unref()
        reject(error)
      }
    })
  }

  function close() {
    if (closed) return
    closed = true
    fail(new Error('离线向量已关闭'))
    worker?.terminate().catch(() => {})
  }

  return { probe, embed, close }
}
