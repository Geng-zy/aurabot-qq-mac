// 心智侧的模型调用包装：给心智模型调用加超时；按场景/性格算「想多深」。
// 从 mind-adapter/index.js 抽出来：那边是装配，这两件事是**调用策略**，
// 一个防挂死（编码/人格推断卡住不能把该窗口的队列永久占死），一个是自适应的深度选择。

import { effortForScene, speechScene } from '../mind/index.js'

/** 给原始 ask 套一层超时；没接模型就返回 undefined（心智层据此判断「没有模型」）。 */
export function withAskTimeout(rawAsk, timeoutMs = 120_000) {
  if (!rawAsk) return undefined
  return (request) => new Promise((resolve, reject) => {
    let settled = false
    const finish = (fn, value) => { if (settled) return; settled = true; clearTimeout(timer); fn(value) }
    const timer = setTimeout(() => {
      const error = new Error('心智模型调用超时')
      error.code = 'MIND_ASK_TIMEOUT'
      finish(reject, error)
    }, timeoutMs)
    timer.unref?.()
    try { Promise.resolve(rawAsk(request)).then((v) => finish(resolve, v), (e) => finish(reject, e)) } catch (error) { finish(reject, error) }
  })
}

/**
 * 按场景算思考深度。
 * @param {object} o
 * @param {object} o.mind 心智实例（要读 setting 与 body.state）
 * @param {object} o.EFFORT 场景 → 深度档位表
 */
export function createEffort({ mind, EFFORT }) {
  const effortFor = (scene) => effortForScene(scene, mind.setting, mind.body.state({ persist: false }), EFFORT[scene])
  const chatEffort = (text, appraisal, owner = false) => mind.setting('models.adaptiveDepth') ? effortFor(speechScene(text, appraisal, owner)) : ''
  return { effortFor, chatEffort }
}
