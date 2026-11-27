// 记忆的「模型与向量」调用：一次问模型（带预算）、把经历算成向量、把查询算成向量。
// 从 memory/index.js 抽出来：那边是记忆本身（入库、检索、复习、遗忘），
// 这边只是三种**对外调用**——都带预算/超时/失败退避，且都要读「当前接的是哪个模型」。
//
// 能力用 getter 注入：think/embed 是由 connect() 事后接上的（let 变量），直接传值会拿到 null。

/**
 * @param {object} o
 * @param {object} o.getThink / o.getEmbed / o.getEmbedModel / o.getEmbeddingIdentity / o.canEmbed 取值函数
 * @param {object} o.budget deps.budget（reserve）
 * @param {object} o.vectors 向量索引
 * @param {(id: string) => object|null} o.row 按 id 取一条记忆
 * @param {object} o.log
 * @param {(s: string) => number} o.estimateTokens
 * @param {(kind: string, ref: any, data?: object) => void} o.queueJob
 * @param {(gist: string) => string} o.hash
 */
export function createEmbeddingOps({ getThink, getEmbed, getEmbedModel, canEmbed, budget, vectors, row, log, estimateTokens, queueJob, hash }) {
  async function ask(scene, system, text, maxTokens = 1200) {
    const think = getThink()
    if (!think) throw new Error('没接模型')
    const est = estimateTokens(system) + estimateTokens(text) + maxTokens
    // 隐私判断是安全闸，不占用后台创作预算；否则预算耗尽会把所有出站都卡死。
    const finish = scene === 'privacy' ? () => {} : budget.reserve(scene, est)
    if (!finish) {
      const e = new Error('今天的后台预算用完了')
      e.code = 'BUDGET'
      e.budgetEstimate = est
      throw e
    }
    try {
      const r = await think({ scene, system, text, maxTokens })
      const out = typeof r === 'string' ? r : String(r?.text || '')
      const used = typeof r === 'object' && r?.tokens ? r.tokens : estimateTokens(system) + estimateTokens(text) + estimateTokens(out)
      finish(used)
      return out
    } finally { finish() }
  }

  // ---------- 向量 ----------
  async function embedEpisodes(ids) {
    const model = getEmbedModel()
    const list = ids.map(row).filter(Boolean).filter((e) => !vectors.has(e.id, model))
    if (!list.length || !canEmbed()) {
      for (const e of list) queueJob('embed', e.id)
      return 0
    }
    try {
      const vs = await getEmbed()(list.map((e) => e.gist))
      let written = 0
      if (getEmbedModel() !== model) return written
      list.forEach((e, i) => {
        if (row(e.id)?.gist !== e.gist || !vs[i]?.length) return
        vectors.put(e.id, model, vs[i], hash(e.gist))
        written++
      })
      return written
    } catch (error) {
      log.debug('算向量失败，稍后再算：', error.message)
      for (const e of list) if (row(e.id)) queueJob('embed', e.id)
      return 0
    }
  }
  async function embedText(text, timeoutMs = 4000) {
    if (!canEmbed() || !String(text || '').trim()) return null
    let timer
    try {
      const model = getEmbedModel()
      const r = await Promise.race([getEmbed()([text], { query: true }), new Promise((_, rej) => { timer = setTimeout(() => rej(new Error('超时')), timeoutMs) })])
      return model === getEmbedModel() ? r[0] || null : null
    } catch (error) {
      log.debug('线索算向量失败：', error.message)
      return null
    } finally { clearTimeout(timer) }
  }


  return { ask, embedEpisodes, embedText }
}
