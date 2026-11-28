// 跑一个外部命令：带超时、可中断、把输出逐行喂给回调；失败时把最后两行塞进错误信息。
// 从 song/studio.js 抽出来：安装链、分离器、做歌流水线都要用它，单独成一个最小的依赖点。

import { spawn } from 'node:child_process'
import { basename } from 'node:path'

export function run(cmd, args, { cwd, env, log, onLine, timeoutMs = 30 * 60_000, signal, acceptedExitCodes = [0] } = {}) {
  return new Promise((resolve, reject) => {
    signal?.throwIfAborted()
    const child = spawn(cmd, args, { cwd, env: { ...process.env, ...env } })
    let tail = ''
    let interrupted
    let killTimer
    const feed = (buf) => {
      const s = String(buf)
      tail = (tail + s).slice(-4000)
      for (const line of s.split(/\r?\n|\r/)) if (line.trim()) onLine?.(line.trim())
    }
    child.stdout.on('data', feed)
    child.stderr.on('data', feed)
    const stop = (error) => {
      if (interrupted) return
      interrupted = error
      child.kill('SIGTERM')
      killTimer = setTimeout(() => child.kill('SIGKILL'), 1500)
      killTimer.unref?.()
    }
    const abort = () => stop(signal.reason)
    signal?.addEventListener('abort', abort, { once: true })
    const timer = setTimeout(() => stop(new Error(`${basename(cmd)} 执行超时`)), timeoutMs)
    const cleanup = () => {
      clearTimeout(timer)
      clearTimeout(killTimer)
      signal?.removeEventListener('abort', abort)
    }
    child.once('error', (error) => { cleanup(); reject(interrupted || error) })
    child.once('close', (code) => {
      cleanup()
      if (interrupted) reject(interrupted)
      else if (acceptedExitCodes.includes(code)) resolve(tail)
      else {
        log?.debug(`${basename(cmd)} 失败（code ${code}）：${tail.slice(-800)}`)
        reject(new Error(`${basename(cmd)} 退出码 ${code}：${tail.trim().split(/\r?\n/).slice(-2).join(' ').slice(0, 300)}`))
      }
    })
  })
}

/**
 * @param {object} deps
 * @param {() => object} deps.getConfig
 * @param {object} deps.log
 * @param {(chatId: string, file: string, note: string) => Promise<any>} deps.sendVoiceFile  把做好的语音发到聊天
 * @param {(chatId: string, text: string) => Promise<any>} [deps.sendText]  没接 say 时的兜底发送
 * @param {(o: { chatId: string, title: string, query: string, why: string, error: string }) => Promise<any>} [deps.say]
 *   翻唱失败时说的话由她本人决定（模块层接模型生成），失败提示不再是一句写死的模板
 */
