// 面板「获取可用模型」：查询已保存 Key 绑定的端点，草稿换地址时不继承旧 Key。

export function registerModelRoutes({ route, readBody, getConfig, getMind, listProviderModels, listModels, clearReasoningCache, clearVisionCache, askModel, ctx }) {
  const normEndpoint = (v) => String(v || '').trim().replace(/\/+$/, '')
  const normAsr = (v) => normEndpoint(v).replace(/\/audio\/(?:speech|transcriptions)$/i, '')
  const savedKeys = () => ({
    imageGen: () => getConfig().imageGen?.apiKey,
    asr: () => getConfig().voice?.asrApi?.apiKey,
    mind: () => getConfig().mind?.embedKey,
  })
  const savedEndpoints = () => {
    const cfg = getConfig()
    const mind = getMind()
    return {
      imageGen: () => normEndpoint(cfg.imageGen?.provider === 'custom' ? cfg.imageGen?.custom?.url : cfg.imageGen?.baseUrl),
      asr: () => normAsr(cfg.voice?.asrApi?.baseUrl || ({ siliconflow: 'https://api.siliconflow.cn/v1', openai: 'https://api.openai.com/v1' })[cfg.voice?.asrApi?.provider]),
      mind: () => mind ? normEndpoint(mind.mind.setting('memory.embedUrl')) : '',
    }
  }

  route('/models', async (req) => {
    try {
      if (new URL(req.url, 'http://x').searchParams.get('refresh') === '1') { clearReasoningCache(); clearVisionCache() }
      return { ok: true, list: await listModels() }
    } catch (error) {
      return { ok: false, message: error.message, list: [] }
    }
  })

  route('/model/ping', async (req) => {
    const b = await readBody(req)
    const t = Date.now()
    try {
      const text = await askModel(ctx, { cfg: { model: { provider: b.provider, model: b.model } }, module: 'model-ping', system: '只回复两个字：在呢', text: '在吗', maxTokens: 800 })
      return { ok: true, ms: Date.now() - t, text: text.slice(0, 40) }
    } catch (error) {
      return { ok: false, ms: Date.now() - t, message: error.message }
    }
  })

  route('/provider-models', async (req) => {
    const b = await readBody(req)
    const from = String(b.keyFrom || '')
    let baseUrl = String(b.baseUrl || '').trim()
    if (from === 'asr') baseUrl = normAsr(baseUrl)
    const mind = getMind()
    if (!baseUrl && from === 'mind' && mind) baseUrl = String(mind.mind.setting('memory.embedUrl') || '')
    if (!baseUrl && from === 'asr') baseUrl = savedEndpoints().asr()
    // 已保存的 Key 只用于它实际绑定的端点；草稿里换了地址就不继承。
    const sameEndpoint = from && baseUrl && normEndpoint(baseUrl) === savedEndpoints()[from]?.()
    const savedKey = sameEndpoint ? String(savedKeys()[from]?.() || '') : ''
    try {
      return await listProviderModels({ baseUrl, apiKey: String(b.apiKey || '').trim() || savedKey, kind: String(b.kind || '') })
    } catch (error) {
      return { ok: false, message: error.message }
    }
  })
}
