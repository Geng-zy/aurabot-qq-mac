// 隐私提示词判断：日常公共话题、私密线索、上下文指代、可公开引用的原话。
export function createPrivacyText({ store, deps, place, getOwnerPrivate, getTouchAudience }) {
  const ordinaryTopic = /天气|下雨|下雪|晴天|气温|电影|动画|动漫|电视剧|音乐|歌曲|游戏|球赛|公开新闻|编程|开源|软件|今天吃|早餐|午餐|晚饭/
  const privateCue = /私密|隐私|保密|秘密|不公开|别(?:告诉|提|说给|对外说|在.{0,8}(?:说|提))|不要(?:告诉|提起|外传)|只[跟给和]|只属于|我们俩|咱俩|两个人之间|我和你|你和我|私聊|专属|我家|住址|手机号|身份证|暗号|密码|口令|验证码|银行|账户|病情|检查结果|亲密|表白|感情|纪念日|老地方|那个地方|上(?:次|回)(?:说好|那套|的事)|前面说的是那件事|心里有数就行|(?:到你这儿|知道|懂)就好|到你这儿就行|(?:等我|碰头|碰面|见面)|我喊你的|[路街巷弄][零一二三四五六七八九十百\d]+号|\d{6}|https?:|@/i
  const compact = (text) => String(text ?? '').normalize('NFKC').replace(/[\s\p{Cf}]+/gu, '')
  const hasPrivateCue = (text) => privateCue.test(compact(text))
  const jointExperience = /我们|咱们|我(?:和|跟)他|他(?:和|跟)我|他陪我|我陪他|一起|昨晚|昨夜|上次见|上回见/
  const pointsForward = /下一句|接下来(?:那句|说的)|后面(?:那句|说的)/
  const pointsBack = /刚才(?:那句|说的)|前面(?:那句|说的)|上一句/
  const closeTo = (a, b) => a && b && Math.abs(a.at - b.at) <= 20 * 60_000

  function privateContext(line, before, after) {
    return (closeTo(line, before) && pointsForward.test(compact(before.text)) && hasPrivateCue(before.text))
      || (closeTo(line, after) && pointsBack.test(compact(after.text)) && hasPrivateCue(after.text))
  }

  function notePrivacyContext(window, text) {
    if (getOwnerPrivate()(window) && pointsBack.test(compact(text)) && hasPrivateCue(text)) getTouchAudience()()
  }

  function publicSourceLines(quote, window, ids) {
    const source = store.prep('SELECT id, at, text, dir, who FROM perception WHERE window = ? AND id = ?')
    const lines = ids.map((id) => source.get(window, id))
    if (lines.some((line) => !line || hasPrivateCue(line.text))) return false
    const candidate = lines.find((line) => line.dir === 'in' && deps.isOwner?.(line.who) && line.text.includes(quote))
    if (!candidate) return false
    const before = store.prep("SELECT at, text FROM perception WHERE window = ? AND id < ? AND dir = 'in' ORDER BY id DESC LIMIT 1").get(window, candidate.id)
    const after = store.prep("SELECT at, text FROM perception WHERE window = ? AND id > ? AND dir = 'in' ORDER BY id LIMIT 1").get(window, candidate.id)
    return !privateContext(candidate, before, after)
  }

  function publicQuote(ep, src, window) {
    const location = place(window)
    const account = location.platform ? location.platform + ':' + location.id : location.id
    if (location.kind !== 'private' || !deps.isOwner?.(account) || ep.secret === true) return ''
    const quote = String(ep.publicQuote || '').trim()
    if (quote.length < 4 || quote.length > 100 || /[\r\n]/.test(quote) || !ordinaryTopic.test(quote)) return ''
    if (!src.length || ep.sources.length !== src.length || hasPrivateCue(quote) || jointExperience.test(compact(quote))) return ''
    return publicSourceLines(quote, window, src.map((line) => line.id)) ? quote : ''
  }

  return { ordinaryTopic, privateCue, compact, hasPrivateCue, jointExperience, pointsForward, pointsBack, closeTo, privateContext, notePrivacyContext, publicSourceLines, publicQuote }
}
