// 面板的心智核心页面：心智设置按参数表生成（每项有默认值、依据、说明，高级项可收起），记忆页显示原始记录对照。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { Script } from 'node:vm'
import { GROUPS, PARAMS, defaults } from '../src/mind/params.js'

function setupPanel() {
  const source = readFileSync(new URL('../client/client.js', import.meta.url), 'utf8')
  const marker = '    exports.apply = apply'
  assert.ok(source.includes(marker))
  let loader
  new Script(source.replace(marker, '    exports.mindTest = { MindSettings, MindMemory, MindPeople, MindSelf, MindNow, MindInner, Meter, MindInput, Row, Switch, Select, Card, Range, Btn }\n' + marker)).runInNewContext({
    window: { innerWidth: 1200, __ModuleLoader__: { load: (value) => { loader = value } } },
  })
  let hook = 0
  const slots = []
  const React = {
    Component: class {}, Fragment: 'fragment',
    createElement: (type, props, ...children) => ({ type, props: props || {}, children }),
    useState: (initial) => {
      const i = hook++
      if (!(i in slots)) slots[i] = typeof initial === 'function' ? initial() : initial
      return [slots[i], (value) => { slots[i] = typeof value === 'function' ? value(slots[i]) : value }]
    },
    useRef: (initial) => {
      const i = hook++
      if (!(i in slots)) slots[i] = { current: initial }
      return slots[i]
    },
    useEffect() {}, useCallback: (fn) => fn, useMemo: (fn) => fn(),
  }
  const panel = loader.factory(() => React).mindTest
  const render = (component, props) => { hook = 0; return component(props) }
  return { panel, slots, render }
}

/** 树里所有某种组件的元素。 */
function findAll(node, type, out = []) {
  if (!node || typeof node !== 'object') return out
  if (Array.isArray(node)) { for (const x of node) findAll(x, type, out); return out }
  if (node.type === type) out.push(node)
  for (const c of node.children || []) findAll(c, type, out)
  return out
}
const textOf = (node) => (node == null ? '' : typeof node !== 'object' ? String(node) : Array.isArray(node) ? node.map(textOf).join('') : (node.children || []).map(textOf).join(''))

test('心智设置：每个参数一行，写着默认值和依据；高级项默认收起；按类型给开关、数字框或文字框', () => {
  const { panel, slots, render } = setupPanel()
  slots[0] = { ok: true, groups: GROUPS, params: PARAMS, values: defaults(), saved: { 'memory.reconsolidation': 0.2 } }
  slots[1] = false
  let rows = findAll(render(panel.MindSettings, { toast() {} }), panel.Row)
  const basic = PARAMS.filter((p) => !p.advanced)
  assert.deepEqual(rows.map((r) => r.props.label), basic.map((p) => p.label).filter((l, i, a) => a.indexOf(l) === i || true))
  for (const r of rows) assert.match(r.props.hint, /默认：.*依据：/)
  assert.match(rows.find((r) => r.props.label === '年龄').props.hint, /只有你能改/)
  const ctlOf = (label) => rows.find((r) => r.props.label === label).children[0]
  assert.equal(ctlOf('单一注意力').type, panel.Switch)
  assert.equal(ctlOf('记忆改写程度').type, panel.MindInput)
  assert.equal(ctlOf('记忆改写程度').props.number, true)
  assert.equal(ctlOf('时区').props.number, undefined)
  // 改过的那项有「恢复默认」
  assert.match(textOf(rows.find((r) => r.props.label === '记忆改写程度')), /恢复默认/)
  assert.doesNotMatch(textOf(rows.find((r) => r.props.label === '记性')), /恢复默认/)
  slots[1] = true
  rows = findAll(render(panel.MindSettings, { toast() {} }), panel.Row)
  assert.equal(rows.length, PARAMS.length, '打开高级后所有参数都在')
})

test('心智设置：心智核心没起来时说明原因', () => {
  const { panel, slots, render } = setupPanel()
  slots[0] = { ok: false, message: '心智核心没起来，看日志里的原因' }
  assert.match(JSON.stringify(render(panel.MindSettings, { toast() {} })), /心智核心没起来/)
})

test('记忆页：显示清楚程度和种类；改写过的给你看原来记的', () => {
  const { panel, slots, render } = setupPanel()
  slots[0] = { ok: true, status: { counts: { perception: 12, memory: { live: 2, archived: 1 } } }, usage: { tokens: 34567 }, sleep: null, dreams: [{ at: 1, text: '梦见在海里', remembered: true }], pending: 1 }
  slots[1] = [{ id: 'a', at: Date.UTC(2026, 10, 9), gist: '甲好像周一喝了奶茶', kind: 'event', level: 'vague', original: { gist: '甲周一喝奶茶' }, emotion: { name: '开心' } }]
  const tree = render(panel.MindMemory, { toast() {} })
  const text = textOf(tree)
  assert.match(text, /甲好像周一喝了奶茶/)
  assert.match(text, /原来记的：甲周一喝奶茶/)
  assert.match(text, /只记得大概/)
  assert.match(text, /35K/)
  assert.match(text, /梦见在海里/)
  assert.match(text, /1 个聊天有还没记下的新消息/)
})

test('她现在：身体状态条、心情、此刻的感受（带对象）；三种投喂方法都写在页面上', () => {
  const { panel, slots, render } = setupPanel()
  slots[0] = {
    ok: true, now: '2026年11月10日 周二 10:00', ownerQQ: '1', hunger: true, feedOnlyByOwner: false,
    body: { energy: 0.4, sleepiness: 0.3, hunger: 0.7, asleep: false, groggy: false, shift: 0, lastMeal: { at: Date.now() - 3600000, food: '奶茶', by: 'qq:1' }, lastSleep: { hours: 7.5, quality: 0.94, wokenBy: '' } },
    mood: { v: 0.3, a: 0.1, label: '心情不错' },
    emotions: [{ name: '感激', intensity: 0.5, target: 'qq:1', targetName: '主人', why: '给我吃了奶茶', hidden: false, at: Date.now() }],
    history: [],
  }
  slots[1] = ''
  const tree = render(panel.MindNow, { toast() {} })
  const text = textOf(tree)
  assert.equal(findAll(tree, panel.Card)[0].props.title, '她现在：心情不错')
  assert.match(text, /有些感激/)
  assert.match(text, /对主人/)
  assert.match(text, /\/投喂 食物名/)
  assert.match(text, /在 QQ 里直接说/)
  assert.match(text, /点「投喂」/)
  assert.match(text, /你喂的：奶茶/)
  assert.match(findAll(tree, panel.Card).find((c) => c.props.title === '投喂').props.desc, /不涉及任何付款/)
  const meters = findAll(tree, panel.Meter).map((m) => m.props.label)
  assert.deepEqual(meters, ['精力', '困', '饿'])
})

test('内心：内心日记（标出深想和放空）、想要的、能做的事和动力、主动找你、等你批的权限、本地小模型状态', () => {
  const { panel, slots, render } = setupPanel()
  slots[0] = {
    ok: true, boredom: 0.6,
    diary: [
      { at: Date.now(), thought: '好想他', feel: { name: '思念' }, plan: '想找主人说话', by: 'local' },
      { at: Date.now() - 60000, thought: '他是不是不理我了', by: 'local', deep: { reason: '涉及主人和你们的关系', thought: '他只是在忙' } },
      { at: Date.now() - 120000, thought: '好无聊', by: 'deepseek', repeated: true },
    ],
    motivation: { wants: [{ id: 'w1', text: '想找主人说话', at: Date.now() }], needs: [{ id: 'companion', name: '陪伴和归属', deficit: 0.8, strength: 0.5 }], learned: { 'tophub:browse': { runs: 3, expect: 0.7 } }, log: [{ at: Date.now(), label: '读热榜', ok: true, summary: '看了 2 条热榜' }] },
    motives: [{ id: 'tophub:browse', label: '读热榜', motive: 0.62, available: true, why: '', wants: [] }, { id: 'diary:write', label: '写空间日记', motive: 0.1, available: false, why: '今天写够了', wants: [] }],
    outreach: { pending: { reason: '想他了' }, log: [{ at: Date.now(), reason: '想他了', kind: 'miss' }] },
    grants: { requests: [{ n: 1, key: 'qqSignature', what: '自己改 QQ 签名', why: '想写点心情', at: Date.now(), status: 'pending' }], granted: { qqAvatar: { at: 1 } } },
    local: { configured: false, reason: '没设本地小模型（Python 和模型文件夹）', running: false, lastError: '' },
    usage: { tokens: 42000 },
  }
  slots[1] = ''
  const tree = render(panel.MindInner, { toast() {} })
  const text = textOf(tree)
  for (const s of ['好想他', '深想（涉及主人和你们的关系）：他只是在忙', '在重复，放空了', '想找主人说话', '动力 0.62', '满意度 70%', '今天写够了', '刚找过你，还在等你回：想他了', '自己改 QQ 签名', '因为：想写点心情', 'qqAvatar ✕', '没装：没设本地小模型', '42K']) assert.ok(text.includes(s), '缺：' + s)
  assert.ok(findAll(tree, panel.Meter).some((m) => m.props.label === '陪伴和归属'))
})

test('关系页：每个人的关系类型、亲近 / 喜欢 / 信任，称呼和印象；展开看老梗、别碰、心结；对群的了解', () => {
  const { panel, slots, render } = setupPanel()
  const rel = { closeness: 0.7, liking: 0.8, respect: 0.5, trust: 0.6, intimacy: 0, commitment: 0, passion: 0, debt: 1, call: '阿二', callMe: '鱼鱼', topics: [{ text: '鸽子王' }], limits: [{ text: '别提前任' }], moments: [], knots: [{ text: '放鸽子' }], flirts: [], n: 5, lastContact: Date.now() }
  slots[0] = { ok: true, exclusive: true, list: [{ id: 'qq:2', name: '甲', aliases: ['老甲'], typeLabel: '好朋友', owner: false, rel, tom: { likes: [{ text: '猫' }], habits: [], mood: null, note: '爱开玩笑' } }], groups: [{ id: '9', name: '测试群', style: ['爱互怼'], rules: ['不许刷屏'] }] }
  slots[2] = 'qq:2'
  const tree = render(panel.MindPeople, { toast() {} })
  const text = textOf(tree)
  assert.match(text, /好朋友 · QQ 2/)
  assert.match(text, /亲近 70 · 喜欢 80 · 尊重 50 · 信任 60 · 人情 她欠 1/)
  assert.match(text, /她叫对方「阿二」/)
  assert.match(text, /爱开玩笑/)
  assert.match(text, /老梗：鸽子王/)
  assert.match(text, /别碰：别提前任/)
  assert.match(text, /没解开的结：放鸽子/)
  assert.match(text, /爱互怼；规矩：不许刷屏/)
  assert.match(findAll(tree, panel.Card)[0].props.desc, /「专一」开着/)
})

test('人格与自我页：19 项特质分组显示本来和现在、推断依据；没确认时提示确认；习惯、她写下的、故事、各种版本、她看到的「她是谁」', () => {
  const { panel, slots, render } = setupPanel()
  const traits = ['sociability', 'assertiveness'].map((id, i) => ({ id, group: 'E', label: ['爱社交', '果断敢说'][i], base: 0.5, cur: i ? 0.62 : 0.5, shadow: null, band: i ? 5 : 4, baseBand: 4, text: i ? '不同意就直说' : '看情况', evidence: [] }))
  slots[0] = {
    ok: true,
    identity: { name: '小鱼', nickname: '' },
    profile: { values: '讲义气', hobbies: '唱歌', looks: '', goals: [{ text: '想更爱说话' }], story: { text: '我是这样长大的', chapters: [{ at: Date.now(), title: '第一次唱歌' }] } },
    personality: { confirmed: false, inferred: { why: { sociability: '话不多' } }, shadowMode: false, traits, habits: [{ id: 'h1', sit: '被开玩笑', act: '反怼回去', active: true, count: 4 }], alerts: [{ at: Date.now(), text: '「果断敢说」连着 3 步往高走', read: false }] },
    versions: { persona: [{ id: 2, at: Date.now(), by: 'self', reason: '她自己改的：想通了', data: { chars: 100 } }, { id: 1, at: Date.now(), by: 'migration', reason: '迁移', data: { chars: 90 } }], self: [{ id: 3, at: Date.now(), by: 'self', reason: '她自己改的：更顺口', data: { what: 'name', before: '大鱼', after: '小鱼' } }], traits: [] },
    prompt: '你是小鱼。',
  }
  slots[1] = { sociability: 0.5, assertiveness: 0.5 }
  const tree = render(panel.MindSelf, { toast() {} })
  const text = textOf(tree)
  assert.match(text, /连着 3 步往高走/)
  assert.match(text, /确认这就是她/)
  assert.match(text, /是从人格卡推出来的/)
  const rows = findAll(tree, panel.Row)
  const soc = rows.find((r) => r.props.label === '爱社交')
  assert.match(soc.props.hint, /依据：话不多/)
  assert.match(rows.find((r) => r.props.label === '果断敢说').props.hint, /从第 4 档变到第 5 档/)
  assert.match(text, /现在 62/)
  assert.match(text, /被开玩笑时，反怼回去/)
  assert.match(rows.find((r) => r.props.label === '想变成的样子').props.hint, /想更爱说话/)
  assert.match(text, /我是这样长大的/)
  assert.match(text, /第一次唱歌/)
  assert.match(text, /她自己 · 100 字/)
  assert.match(text, /「大鱼」→ 「小鱼」/)
  assert.match(text, /你是小鱼。/)
})
