// 向量进度：哪些还没用当前模型算过、算到哪了、能不能算。
export function createVectorState({ store, getEmbedModel, isEmbedConnected, isEmbeddingReady }) {
  const canEmbed = () => Boolean(isEmbedConnected()) && (isEmbeddingReady?.() ?? true)

  function staleVectorIds(limit = 500) {
    return store.prep(`SELECT e.id FROM episodes e LEFT JOIN vectors v ON v.id = e.id
      WHERE e.status = 'live' AND (v.id IS NULL OR v.model != ?) ORDER BY e.at DESC LIMIT ?`).all(getEmbedModel(), limit).map((r) => r.id)
  }

  function vectorProgress() {
    const model = getEmbedModel()
    const total = store.prep("SELECT COUNT(*) AS n FROM episodes WHERE status = 'live'").get().n
    const done = store.prep("SELECT COUNT(*) AS n FROM episodes e JOIN vectors v ON v.id = e.id WHERE e.status = 'live' AND v.model = ?").get(model).n
    return { done, total, model }
  }

  return { staleVectorIds, vectorProgress, canEmbed }
}
