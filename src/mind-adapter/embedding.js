// 向量/精排后端：远端 OpenAI 兼容服务或本地 int8 模型。
export function createEmbedding({ mind, opts, localEmbedding, createEmbedClient, createRerankClient, paramOf, createHash }) {
  const embedBackend = () => opts.getConfig()?.mind?.embedBackend === 'local' ? 'local' : 'remote'
  const embedUrl = () => String(mind.setting('memory.embedUrl') || '').trim().replace(/\/+$/, '')
  const localIdentity = 'local:bge-small-zh-v1.5-int8'
  const embedName = () => embedBackend() === 'local' ? localIdentity : String(mind.setting('memory.embedModel') || '').trim()
  const embedRemote = createEmbedClient({
    url: embedUrl,
    model: () => mind.setting('memory.embedModel'),
    key: () => opts.embedKey?.() || '',
    fetch: opts.fetch,
  })
  const rerankRemote = createRerankClient({
    url: () => mind.setting('memory.embedUrl'),
    model: () => mind.setting('memory.rerankModel'),
    key: () => opts.embedKey?.() || '',
    fetch: opts.fetch,
  })
  function embeddingStatus() {
    const backend = embedBackend()
    const error = backend === 'local' ? localEmbedding.probe() : ''
    return { backend, error, model: embedName() }
  }
  function connect(mem) {
    mem.connect({
      embeddingIdentity: () => {
        const name = embedName()
        const url = embedUrl()
        if (embedBackend() === 'local' || url === paramOf('memory.embedUrl').def) return name
        return 'endpoint:' + createHash('sha256').update(url + '\0' + name).digest('hex')
      },
      embeddingReady: () => !embeddingStatus().error,
      embed: async (texts, { query = false } = {}) => {
        if (embedBackend() !== 'local') return embedRemote(texts)
        const out = []
        for (const text of texts) out.push(await localEmbedding.embed(text, { query }))
        return out
      },
      rerank: (cue, candidates, options) => embedBackend() === 'local' ? [] : rerankRemote(cue, candidates, options),
    })
  }
  return { embeddingStatus, connect }
}
