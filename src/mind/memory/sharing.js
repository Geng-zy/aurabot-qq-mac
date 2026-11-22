// 分享、撤回和隐私候选。
export function createSharing({ store, now, deps, place, ownerPrivate, shareSourceAllowed, insert, save, touchAudience, randomUUID: randomUUIDFn, keywordHits, row, visibleIn }) {
  const randomUUID = randomUUIDFn
  /** 只由宿主的管理员设置入口调用。单独保存管理员核准的说法，不把原经历的任何字段复制给接收方。 */
  function shareEpisode(id, { text, audience } = {}) {
    const original = row(id)
    if (!shareSourceAllowed(original)) throw new Error('只有未标为私密的管理员私聊经历可以分享')
    const gist = typeof text === 'string' ? text.trim() : ''
    if (!gist || gist.length > 300) throw new Error('请填写可以分享的内容，最多 300 字')
    const target = typeof audience === 'string' ? audience.trim() : ''
    if (!['group', 'private'].includes(place(target).kind) || ownerPrivate(target)) throw new Error('请选择一个要分享给的群或私聊')
    return store.tx(() => {
      const prior = store.prep("SELECT id FROM episodes WHERE kind = 'shared-note' AND gist = ? AND json_extract(json, '$.publicSource') = ? AND json_extract(json, '$.shareWith[0]') = ? AND coalesce(json_extract(json, '$.shareRevoked'), 0) = 0").get(gist, original.id, target)
      return prior?.id || insert({ id: 'share:' + randomUUID(), at: now(), gist, kind: 'shared-note', speaker: 'self', importance: 0.8,
        extra: { publicSource: original.id, shareWith: [target] } })
    })
  }

  function revokeShare(id, { record = true } = {}) {
    const e = row(id)
    if (e?.data.kind !== 'shared-note') return false
    if (e.data.shareRevoked) return true
    if (record) deps.recordShareRevoked?.(e.id)
    store.tx(() => {
      e.data.shareRevoked = true
      save(e)
      touchAudience()
    })
    return true
  }

  function sharesGram(a, b, n = 3) {
    const left = String(a || '').toLowerCase().replace(/\s+/g, '')
    const right = String(b || '').toLowerCase().replace(/\s+/g, '')
    if (left.length < n || right.length < n) return left && right ? left === right : false
    for (let i = 0; i + n <= left.length; i++) if (right.includes(left.slice(i, i + n))) return true
    return false
  }

  function privacyCandidates(text, ownerWindow, audience) {
    const rows = [...keywordHits(text)].filter(([, score]) => score >= 0.45).sort((a, b) => b[1] - a[1])
      .map(([id]) => row(id)).filter(Boolean)
    // 所有当前收件人看不到的经历都要参与比对，不能只挑管理员私聊/分享；第三方私聊秘密同样要拦。
    const hits = rows.filter((e) => (e.data.secret || e.data.privateOnly || e.data.kind === 'shared-note' || (e.window && String(e.window).includes(':private:'))) && !visibleIn(e, audience) && sharesGram(text, [e.gist, e.detail].filter(Boolean).join(' ')))
    const allowed = rows.filter((e) => ['shared-note', 'public-note'].includes(e.data.kind) && visibleIn(e, audience))
    return {
      private: hits.slice(0, 6).map((e) => [e.gist, e.detail].filter(Boolean).join('\n').slice(0, 450)),
      allowed: allowed.slice(0, 6).map((e) => e.gist),
    }
  }


  return { shareEpisode, revokeShare, privacyCandidates, sharesGram }
}
