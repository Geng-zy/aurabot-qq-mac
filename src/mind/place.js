// 窗口（她在哪儿聊）和人的 id：心智核心不认识任何平台，只认一个约定——
//   窗口：「平台:private:对方」或「平台:group:群」，例如 qq:private:123、feishu:group:oc_xx、wechat:private:wxid_x；
//   人：「平台:账号」，例如 qq:123、wechat:wxid_x。
// 对接层也可以在 createMind({ place }) 里自己告诉核心「这个窗口是私聊还是群」，就不用照这个格式。
// 平台前缀只是为了不同平台的 id 不撞，核心不按平台做任何区别。

/**
 * @typedef {{ kind: 'private'|'group'|'other', id: string, platform: string }} Place
 */

/** 默认的窗口解析：认上面那个约定，认不出算 other（后台、系统之类）。 */
export function placeOf(window) {
  const w = String(window || '')
  const m = w.match(/^([^:]+):(private|group):(.+)$/)
  if (m) return { kind: m[2], id: m[3], platform: m[1] }
  return { kind: 'other', id: w, platform: '' }
}

/** 人的 id 去掉平台前缀，只在实在没有名字时拿来显示。 */
export function shortId(id) {
  const s = String(id || '')
  const i = s.indexOf(':')
  return i >= 0 ? s.slice(i + 1) : s
}

/** 把对接层给的 place 函数包一层：出错或给的不对就退回默认解析。 */
export function makePlace(custom) {
  return (window) => {
    if (typeof custom === 'function') {
      try {
        const p = custom(window)
        if (p && ['private', 'group', 'other'].includes(p.kind)) return { id: String(p.id ?? window), platform: String(p.platform || ''), kind: p.kind }
      } catch {}
    }
    return placeOf(window)
  }
}
