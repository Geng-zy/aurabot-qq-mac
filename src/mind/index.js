// 心智核心入口。
// 规矩：本目录不引用 Aurabot 的任何代码；外部服务（时间、日志、模型、宿主的会话、聊天平台）都由对接层注入；不认识任何聊天平台。
// 第一阶段（骨架）：数据库、设置、身份（名字、小名、年龄生日、时区、专一）、人格卡版本、
// 感知记录（收到和发出的每条消息）、认识的人、版本管理、删除记录、快照备份。

import { join } from 'node:path'
import { appendFileSync, readFileSync, readdirSync, statSync, renameSync, rmSync, existsSync, mkdirSync } from 'node:fs'
import { openRecoverableStore, GENERATED_COLUMNS } from './store.js'
import { resolveSettings, paramOf, clampParam } from './params.js'
import { currentAge, dayKey, describeNow, isBirthday, validTimeZone } from './clock.js'
import { createBudget } from './budget.js'
import { createMemory } from './memory/index.js'
import { createSleep } from './memory/sleep.js'
import { createBody } from './body/index.js'
import { createEmotion } from './emotion/index.js'
import { createMotivation } from './motivation/index.js'
import { createInner } from './inner/index.js'
import { createPersonality } from './personality/index.js'
import { createSelf } from './self/index.js'
import { createRelations } from './relations/index.js'
import { makePlace, shortId } from './place.js'
import { createConversation } from './conversation.js'
import { publicPersonaStyle } from './self/public-style.js'

export { PARAMS, GROUPS, paramOf } from './params.js'
export { effortForScene, speechScene } from './conversation.js'
export { wantsMeal, wantsOwnerChat } from './motivation/index.js'
export { createEmbedClient, createRerankClient } from './memory/embed-client.js'
export { parseJson } from './memory/text.js'
export { placeOf, shortId } from './place.js'

const noopLog = { debug() {}, info() {}, warn() {}, error() {} }

/**
 * @param {{
 *   dir: string,                         // 数据目录，数据库放在 dir/mind.sqlite
 *   ownerId?: string,                    // 管理员的稳定 id，例如 'qq:12345'（平台:账号）
 *   publicName?: string,                 // 接入方明确可公开的角色名称
 *   place?: (window: string) => { kind: 'private'|'group'|'other', id?: string, platform?: string }, // 窗口是私聊还是群；不给就按「平台:private|group:id」认
 *   now?: () => number,                  // 取时间，默认系统时间
 *   log?: { debug: Function, info: Function, warn: Function, error: Function },
 *   memoryDb?: boolean,                  // 测试用：数据库放内存
 *   random?: () => number,               // 测试用：固定随机数
 *   model?: (request: { scene: string, system: string, text: string, maxTokens: number, signal?: AbortSignal }) => Promise<string | { text: string, tokens?: number }>,
 * }} opts
 */
import { createImport } from './import.js'
import { createForgetting } from './forgetting.js'
import { createIdentityMap } from './identity-map.js'
import { createPeopleGraph } from './people-graph.js'
import { createSettings } from './settings.js'
import { createVersions } from './versions.js'
import { createPeople } from './people.js'
import { createPerception } from './perception.js'
import { createDeletionLog } from './deletion-log.js'
import { createSnapshots } from './snapshots.js'
import { createIdentity } from './identity.js'
import { createPersona } from './persona.js'

export function createMind(opts) {
  const log = opts.log || noopLog
  const now = opts.now || (() => Date.now())
  const file = opts.memoryDb ? ':memory:' : join(opts.dir, 'mind.sqlite')
  const { store, recovered } = openRecoverableStore(file)
  if (recovered) log.warn('心智数据库已从快照恢复：', recovered.snapshot)
  const deletionLog = opts.memoryDb ? '' : join(opts.dir, 'deletions.jsonl')
  const place = makePlace(opts.place)

  // 同平台 id 归一在 identity-map.js
  const identityMap = createIdentityMap({ store, opts })
  const { sameMap, canon, getOwnerId, setOwnerId, keepOwnerPrivate, privateOwners } = identityMap

  // 设置在 settings.js（惰性：它要在「管理员日常原话」开关变化时通知记忆）
  let settingsApi = null
  const settingsOf = () => (settingsApi ||= createSettings({
    store, now, resolveSettings, paramOf, clampParam, validTimeZone, getMemory: () => memory,
  }))
  const savedSettings = (...a) => settingsOf().savedSettings(...a)
  const settings = (...a) => settingsOf().settings(...a)
  const setting = (...a) => settingsOf().setting(...a)
  const updateSettings = (...a) => settingsOf().updateSettings(...a)
  const resetSetting = (...a) => settingsOf().resetSetting(...a)
  const tz = (...a) => settingsOf().tz(...a)

  // 她是谁在 identity.js（惰性：要读设置与 id 归一表）
  let identityApi = null
  const identityOf = () => (identityApi ||= createIdentity({
    store, now, settings: (...a) => settings(...a), canon, getOwnerId, setOwnerId, getMemory: () => memory,
  }))
  const identity = (...a) => identityOf().identity(...a)
  const setOwner = (...a) => identityOf().setOwner(...a)
  const isOwner = (...a) => identityOf().isOwner(...a)
  const wakeWords = (...a) => identityOf().wakeWords(...a)

  // 人格卡与自我在 persona.js（惰性：要用到 id 归一、管理员判断与版本）
  let personaApi = null
  const personaOf = () => (personaApi ||= createPersona({
    store, opts, now, place, isOwner: (id) => isOwner(id), canon, privateOwners,
    addVersion: (...a) => addVersion(...a), log,
  }))
  const personaCard = (...a) => personaOf().personaCard(...a)
  const lastOwnerPersona = (...a) => personaOf().lastOwnerPersona(...a)
  const publicPersona = (...a) => personaOf().publicPersona(...a)
  const setPersonaCard = (...a) => personaOf().setPersonaCard(...a)
  const isOwnerWindow = (...a) => personaOf().isOwnerWindow(...a)
  const isPrivateHistoryWindow = (...a) => personaOf().isPrivateHistoryWindow(...a)

  // 版本历史在 versions.js
  const { addVersion, listVersions, deleteVersion, deleteVersions, getVersion, pinVersion, restorePersona } = createVersions({
    store, now, setting: (...a) => setting(...a), setPersonaCard: (...a) => setPersonaCard(...a), getMemory: () => memory,
  })

  // 认识的人在 people.js（惰性：它要读 id 归一表、管理员身份与记忆）
  let peopleApi = null
  const peopleOf = () => (peopleApi ||= createPeople({
    store, canon, sameMap, isOwner: (id) => isOwner(id), setOwnerId: (v) => setOwnerId(v),
    memory: { get touchAudience() { return () => memory.touchAudience() } }, log, now,
  }))
  const person = (...a) => peopleOf().person(...a)
  const notePerson = (...a) => peopleOf().notePerson(...a)
  const listPeople = (...a) => peopleOf().listPeople(...a)
  const savePerson = (...a) => peopleOf().savePerson(...a)
  const linkPerson = (...a) => peopleOf().linkPerson(...a)
  const idsOf = (...a) => peopleOf().idsOf(...a)

  // 感知记录在 perception.js（惰性：要用到管理员身份、私密窗口判断与记忆）
  let perceptionApi = null
  const perceptionOf = () => (perceptionApi ||= createPerception({
    store, now, canon, notePerson: (...a) => notePerson(...a), isOwner: (id) => isOwner(id),
    isOwnerWindow: (w) => isOwnerWindow(w), isPrivateHistoryWindow: (w) => isPrivateHistoryWindow(w),
    getOwnerId, getMemory: () => memory, log, place,
  }))
  const perceive = (...a) => perceptionOf().perceive(...a)
  const noteAddressed = (...a) => perceptionOf().noteAddressed(...a)
  const lastOwnerMessageAt = (...a) => perceptionOf().lastOwnerMessageAt(...a)
  const said = (...a) => perceptionOf().said(...a)
  const history = (...a) => perceptionOf().history(...a)

  // 批量导入在 import.js（惰性创建：person/savePerson 在后面才定义）
  let importApi = null
  const importOf = () => (importApi ||= createImport({ store, person: (id) => person(id), savePerson: (...a) => savePerson(...a), now, log }))
  const importBatch = (...a) => importOf().importBatch(...a)
  const imported = (...a) => importOf().imported(...a)
  const importDone = (...a) => importOf().importDone(...a)
  const vectorOf = (...a) => importOf().vectorOf(...a)
  const episode = (...a) => importOf().episode(...a)

  // 关系星图在 people-graph.js（惰性：relations 后面才装配）
  let peopleGraphApi = null
  const peopleGraph = (...a) => (peopleGraphApi ||= createPeopleGraph({ store, relations })).peopleGraph(...a)

  // 删除记录在 deletion-log.js（惰性：要用到记忆与「忘掉一个人」）
  let deletionApi = null
  const deletionOf = () => (deletionApi ||= createDeletionLog({
    store, getMemory: () => memory, forgetPerson: (...a) => forgetPerson(...a),
    historyOfPerson: (id) => store.prep('SELECT DISTINCT window FROM perception WHERE who = ?').all(id).map((row) => row.window),
    place, log, now, deletionLog,
  }))
  const recordDeletion = (...a) => deletionOf().recordDeletion(...a)
  const writeDeletion = (...a) => deletionOf().writeDeletion(...a)
  const applyDeletionLog = (...a) => deletionOf().applyDeletionLog(...a)
  const deletions = (...a) => deletionOf().deletions(...a)

  // 「忘掉一个人」在 forgetting.js（惰性创建：它要碰记忆、情绪、会话、内心，这些都还没装配）
  let forgettingApi = null
  const forgettingOf = () => (forgettingApi ||= createForgetting({
    store, canon, isOwner, person: (id) => person(id), savePerson: (...a) => savePerson(...a),
    now, log,
    getMemory: () => memory, getEmotion: () => emotion,
    getConversation: () => conversation, getInner: () => inner,
    recordDeletion: (...a) => recordDeletion(...a), writeDeletion: (...a) => writeDeletion(...a),
    addVersion: (...a) => addVersion(...a), GENERATED_COLUMNS,
  }))
  const forgetPerson = (...a) => forgettingOf().forgetPerson(...a)
  const setNoMemory = (...a) => forgettingOf().setNoMemory(...a)
  const forgottenList = (...a) => forgettingOf().forgottenList(...a)
  const restorePerson = (...a) => forgettingOf().restorePerson(...a)

  // 快照与备份在 snapshots.js
  const { snapshot, backupBytes, exportTo } = createSnapshots({ store, opts, now })

  // ---------- 记忆 ----------
  const budget = createBudget({ store, today: () => dayKey(now(), tz()), setting })
  // ---------- 人格、自我、关系 ----------
  const self = createSelf({
    store, now, setting, log, identity: () => identity(), personaCard: () => personaCard(), setPersonaCard: (...a) => setPersonaCard(...a), addVersion: (...a) => addVersion(...a), listVersions: (...a) => listVersions(...a), getVersion,
    // 对管理员的称呼：管理员一开始设的叫法；她改了以后关系里「你叫他」也跟着改
    ownerName: () => String(opts.ownerName?.() || ''),
    dayKey: (at) => dayKey(at, tz()),
    onOwnerCall: (call) => { const o = identity().ownerId; if (o) relations.edit(o, { call }) },
  })
  const personality = createPersonality({ store, now, setting, tz, log, isOwner: (id) => isOwner(id), addVersion: (...a) => addVersion(...a), listVersions: (...a) => listVersions(...a), getVersion, goals: () => self.goals() })
  const relations = createRelations({ store, now, setting, log, place, identity: () => identity(), isOwner, isOwnerWindow, person: (id) => person(id), savePerson, listPeople: () => listPeople(), trustBase: () => personality.value('trust') })
  // ---------- 身体和情绪 ----------
  const body = createBody({ store, now, setting, tz, log })
  const emotion = createEmotion({ store, now, setting, log, random: opts.random, identity: () => identity(), isOwner: (id) => isOwner(id), person: (id) => person(id), closeness: (id) => relations.closeness(id), trait: (id) => personality.value(id), body: () => body.state({ persist: false }) })
  /** 此刻的身体和心情（记忆、说话方式都看它）。 */
  function feeling() {
    const b = body.state({ persist: false })
    const e = emotion.state(b)
    return { body: b, mood: e.mood, emotions: e.active }
  }

  const memory = createMemory({
    store, now, setting, log, budget, tz,
    random: opts.random,
    identity: () => identity(),
    person: (id) => person(id),
    recordDeletion: (id, kind) => recordDeletion(id, kind),
    recordPrivacy: (id, enabled) => writeDeletion(id, 'private', enabled),
    recordShareRevoked: (id) => writeDeletion(id, 'share-revoked', true),
    onDeleted: (episode) => {
      personality.forgetEvidence(episode)
      self.invalidateStory(episode.id)
      relations.forgetKnowledge(episode.window, episode.data.sources)
      emotion.forgetEvent(episode.id)
      for (const id of episode.data.sources || []) emotion.forgetEvent('perception:' + id)
    },
    // 惦记别人的事问不问、问几次：她有多心疼人（同情心）和她跟这个人多亲近
    place,
    isPrivateHistoryWindow,
    isOwner: (id) => isOwner(id),
    nameOf: (pid) => person(pid)?.name || shortId(pid),
    // 认识满一年、两年……：只算管理员和挺熟的人
    firstMet: () => listPeople().filter((p) => p.firstSeen && (isOwner(p.id) || (Number(p.rel?.closeness) || 0) >= 0.4)).map((p) => ({ id: p.id, firstSeen: p.firstSeen, owner: isOwner(p.id) })),
    care: (pid) => 0.5 * personality.value('compassion') + 0.5 * (isOwner(pid) ? 0.9 : relations.closeness(pid)),
    onRecalled: (list, { window } = {}) => emotion.rekindle(list, { window }),
  })
  // 记得多牢、心境一致都看此刻真实的心情和精力
  memory.connect({
    think: opts.model,
    state: () => { const f = feeling(); return { valence: f.mood.v, energy: f.body.energy } },
    // 记经历时顺带：人格的状态记录（她这次比平时更……）、对人的看法、对群的了解
    encodeExtra: (window) => personality.encodeAsk() + '\n' + relations.encodeAsk(window),
    onEncoded: ({ window, rows, parsed, evidence }) => {
      const shareableHabits = place(window).kind === 'group' && !(Array.isArray(parsed.episodes) && parsed.episodes.some((e) => e?.secret === true))
      personality.observe(parsed, { window, rows, shareableHabits, evidence })
      relations.observe(parsed, { window, rows })
      if (setting('emotion.appraise') !== false) {
        const lastReply = rows.findLast((r) => r.dir === 'out')?.id || 0
        for (const item of evidence) {
          if (!item.emotion || !item.sources.length || item.sources.some((id) => id <= lastReply)) continue
          const source = rows.find((r) => r.id === item.sources[0] && r.dir === 'in')
          if (source && !item.sources.some((id) => emotion.hasEvent('perception:' + id))) emotion.feel([{
            name: item.emotion.name, valence: item.emotion.valence, intensity: item.emotion.intensity, target: source.who,
            importance: item.importance, why: item.secret ? '' : '刚才看到的消息',
          }], { window, source: 'observation', eventId: item.id })
        }
      }
    },
  })
  const sleeper = createSleep(memory, {
    store, now, setting, log, tz, random: opts.random, identity: () => identity(),
    nightly: () => [
      ['personality', () => personality.nightly()],
      ['relations', () => relations.nightly()],
      ['story', () => self.updateStory({
        ask: (scene, system, text, maxTokens) => memory.ask(scene, system, text, maxTokens),
        isVisible: (id) => memory.visibleForRecall(memory.row(id)),
        episodes: ({ rebuild = false } = {}) => store.prep("SELECT id, at, gist, json FROM episodes WHERE status IN ('live', 'archived') AND at >= ? ORDER BY at DESC LIMIT 200").all(rebuild ? 0 : now() - 7 * 86400000)
          .map((r) => ({ id: r.id, at: r.at, gist: r.gist, ...JSON.parse(r.json) }))
          .filter((e) => (e.importance || 0) >= 0.7 || (e.emotion?.intensity || 0) >= 0.7)
          .sort((a, b) => a.at - b.at),
      })],
    ],
  })

  /** 她是谁（放进系统提示词开头）：当前版本的人格卡、她自己写的价值观等、自我故事摘要、不知不觉的变化和小习惯。 */
  function selfPrompt({ publicOnly = false } = {}) {
    // 对外人格只允许固定词表的公开画像；性格漂移来自含私聊的观察，不能拼进群/对外提示词。
    const parts = [self.prompt({ publicPersona: publicOnly ? publicPersona() : null, isVisible: (id) => memory.visibleForRecall(memory.row(id)) })]
    if (!publicOnly) parts.push(personality.selfText({ shareableOnly: true, isVisible: (id) => memory.visibleForRecall(memory.row(id)) }))
    return parts.filter((x) => String(x || '').trim()).join('\n\n')
  }

  // ---------- 动机和内心活动 ----------
  // 尽责性里的「勤快」越低越容易分心拖着（Steel 2007 的 Γ）
  const motivation = createMotivation({ store, now, setting, log, today, budget, random: opts.random, distractScale: () => 1.5 - personality.value('productiveness'), trait: (id) => personality.value(id) })
  const inner = createInner({
    store, now, setting, tz, log, random: opts.random, memory, emotion, body, motivation, budget, place,
    ownerCall: () => self.ownerCall(), isOwnerWindow,
    identity: () => identity(), isOwner: (id) => isOwner(id), person: (id) => person(id),
  })
  if (opts.model) inner.connect({ ask: ({ scene, system, text, maxTokens }) => memory.ask(scene, system, text, maxTokens) })
  const conversation = createConversation({
    memory, emotion, body, relations, feeling, setting, isOwner, isOwnerWindow, history, perceive, person, selfPrompt, personaCard, publicPersona, goals: self.goals, canon,
    now, random: opts.random || Math.random, speak: opts.model, log,
  })
  applyDeletionLog()

  // ---------- 给她看的「此刻」 ----------
  function nowText() {
    return describeNow(now(), tz())
  }
  function today() {
    return dayKey(now(), tz())
  }

  function status() {
    const id = identity()
    return {
      identity: id,
      now: nowText(),
      today: today(),
      counts: {
        perception: store.prep('SELECT COUNT(*) AS n FROM perception').get().n,
        episodes: store.prep("SELECT COUNT(*) AS n FROM episodes WHERE status = 'live'").get().n,
        people: store.prep('SELECT COUNT(*) AS n FROM people').get().n,
        versions: store.prep('SELECT COUNT(*) AS n FROM versions').get().n,
        vectors: store.prep('SELECT COUNT(*) AS n FROM vectors').get().n,
        memory: memory.counts(),
      },
      integrity: store.check(),
      recovered,
    }
  }

  // 启动时主动清掉过期的恢复区，不能只在打开面板列表时才清理。
  try { forgottenList() } catch (error) { log?.debug?.('恢复区过期清理失败：', error.message) }
  // 运行期间也每天清理一次；unref 不阻止进程退出。
  const pruneTimer = setInterval(() => {
    try { forgottenList() } catch (error) { log?.debug?.('恢复区每日清理失败：', error.message) }
  }, 24 * 3600_000)
  pruneTimer.unref?.()

  return {
    // 设置
    settings, setting, updateSettings, resetSetting, savedSettings,
    // 身份
    identity, setOwner, isOwner, isPrivateHistoryWindow, wakeWords,
    // 同一个人在不同平台的 id；窗口是私聊还是群
    canon, linkPerson, idsOf, place,
    // 人格卡与版本
    personaCard, publicPersona, setPersonaCard, restorePersona, addVersion, listVersions, getVersion, deleteVersion, deleteVersions, pinVersion,
    // 人
    person, notePerson, listPeople,
    forgetPerson, setNoMemory, forgottenList, restorePerson, peopleGraph,
    // 感知
    perceive, noteAddressed, lastOwnerMessageAt, said, history, conversation,
    // 导入
    importBatch, imported, importDone, vectorOf, episode,
    // 删除、备份
    recordDeletion, deletions, snapshot, exportTo, backupBytes,
    // 记忆、睡觉、预算
    memory, sleep: sleeper.sleep, sleeper, budget,
    // 身体、情绪
    body, emotion, feeling,
    // 动机、内心活动
    motivation, inner,
    // 人格、自我、关系
    personality, self, relations, selfPrompt, savePerson,
    // 其他
    nowText, today, status,
    close: () => { clearInterval(pruneTimer); conversation.close(); store.close() },
    _store: store,
  }
}

export function mindFileExists(dir) {
  return existsSync(join(dir, 'mind.sqlite')) && statSync(join(dir, 'mind.sqlite')).size > 0
}
