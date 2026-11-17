import { parsePerson, privateChatOf } from '../channels/ids.js'
import { shortId } from '../mind/place.js'
import { defineTool, str } from '../tools/tools.js'

const clip = (s, max = 120) => [...String(s || '').replace(/\s+/g, ' ').trim()].slice(0, max).join('')
const matchText = (s) => String(s || '').normalize('NFKC').trim().toLowerCase()
const percent = (n) => Math.round(n * 100)

export function inspectionTools({ mind, window, platform, peopleHere, ownerPrivate, syncOwner }) {
  const { relations, memory } = mind
  const label = (p) => relations.REL_TYPES[p.type]
  const name = (p) => clip(p.name, 60) || shortId(p.id)

  return [
    defineTool({
      name: 'mind_relationship',
      description: '主动查看你和一个人是什么关系、你对他的印象。管理员私聊可按名字、曾用名或账号查其他已认识的人，也可以不填名字看看你熟悉的人。在其他聊天里只能看眼前说话人的简要关系。结果是你积累的印象，可能变化，也不一定是事实。',
      properties: { person: str('名字、曾用名、QQ 号或渠道:账号；不填则看可查的人') },
      execute: async ({ person }) => {
        syncOwner()
        const privateView = ownerPrivate()
        const people = privateView ? relations.list() : peopleHere().flatMap((id) => {
          const p = mind.person(id)
          return p && !p.noMemory ? [relations.get(id)] : []
        })
        const visible = people.filter((p) => !p.noMemory && (p.owner ? privateView : !mind.isPrivateHistoryWindow(privateChatOf(p.id))))
        const line = (p) => `- ${name(p)}${privateView ? `（${clip(p.id, 80)}）` : ''} · ${label(p)}`
        const ref = String(person || '').trim().replace(/^[@＠]\s*/, '').slice(0, 120)
        const query = matchText(ref)
        if (!query) {
          const head = privateView ? '【你比较熟悉的人】' : '【你和眼前的人】'
          return { ok: true, message: visible.length ? [head, ...visible.slice(0, 8).map(line)].join('\n') : '这里还没有可以查看的关系记录。' }
        }

        // 先按稳定账号找，避免不同渠道的同号或同名人物串在一起。
        const account = parsePerson(ref, platform)
        const accountId = account && mind.canon(`${account.platform}:${account.id}`)
        const qqId = /^\d+$/.test(query) ? mind.canon(`qq:${query}`) : ''
        const aliases = (p) => [p.name, ...(privateView ? p.aliases || [] : [])].map(matchText).filter(Boolean)
        let matches = visible.filter((p) => p.id === accountId)
        if (!matches.length && qqId) matches = visible.filter((p) => p.id === qqId)
        if (!matches.length) matches = visible.filter((p) => aliases(p).includes(query))
        if (!matches.length) matches = visible.filter((p) => aliases(p).some((a) => a.includes(query)))
        if (!matches.length) return { ok: false, message: '这里没有找到对应的关系记录。' }
        if (matches.length > 1) return { ok: false, message: ['找到几个人，请用完整名字或账号区分。', ...matches.slice(0, 8).map(line)].join('\n') }
        const [p] = matches
        if (!privateView) return { ok: true, message: `${name(p)}是你的${label(p)}。` }

        const r = p.rel
        const metrics = [['亲近', r.closeness], ['喜欢', r.liking], ['尊重', r.respect], ['信任', r.trust]]
        if (p.owner || !mind.identity().exclusive) metrics.push(['亲密', r.intimacy], ['承诺', r.commitment])
        if (p.owner && mind.identity().sexualDesire) metrics.push(['激情', r.passion])
        const summary = relations.describe([p.id], { nameOf: () => name(p), window, canSee: (source) => memory.sourceVisible(source, window) })
        return { ok: true, message: `${line(p)}\n${metrics.map(([key, value]) => `${key} ${percent(value)}`).join(' · ')}\n${summary.slice(0, 1200)}` }
      },
    }),
    defineTool({
      name: 'mind_check_self',
      description: '想确认自己此刻的心情、精力、困意和饥饿，或想看看有哪些约定和待跟进的事时用。只读取当前聊天可见的待办，适合自己决定接下来做什么。',
      execute: async () => {
        syncOwner()
        const { body, mood } = mind.feeling()
        const scope = { sourceWindow: window, audienceWindow: window }
        const intentions = memory.dueIntentions({ ...scope, within: 30 * 86400000 })
        const followups = memory.followups(scope).slice(0, 5)
        const lines = [
          `【此刻】${mood.label} · ${body.asleep ? '睡着' : '醒着'}`,
          `精力 ${percent(body.energy)}% · 困意 ${percent(body.sleepiness)}% · 饥饿 ${percent(body.hunger)}%`,
        ]
        if (intentions.length) lines.push('【未完成的约定】', ...intentions.map((e) => `- ${clip(e.gist)}`))
        if (followups.length) lines.push('【待跟进的事】', ...followups.map((e) => `- ${clip(e.gist)} [${e.id}]`))
        return { ok: true, message: lines.join('\n') }
      },
    }),
  ]
}
