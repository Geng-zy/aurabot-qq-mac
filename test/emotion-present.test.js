// 情绪的自然语言呈现（emotion/present.js）：喂一份假状态，验「怎么说」的五条规矩。
// 以前这段埋在 createEmotion 闭包里，只能连着 store/衰减/迁怒随机一起测。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createEmotionPresent } from '../src/mind/emotion/present.js'

const mk = ({ mood = { v: 0, a: 0, label: '平静' }, active = [], displacement = 1, rnd = () => 0 } = {}) =>
  createEmotionPresent({
    getState: () => ({ mood, active }),
    isOwner: (id) => id === 'owner',
    closeness: (id) => (id === 'friend' ? 0.9 : 0.1),
    displacement: () => displacement,
    random: () => rnd(),
  })

test('moodCue 按愉快度/唤醒度给词', () => {
  const p = mk()
  assert.equal(p.moodCue({ v: 0.6, a: 0 }), '心情很好')
  assert.equal(p.moodCue({ v: 0.3, a: -0.5 }), '很放松')
  assert.equal(p.moodCue({ v: 0, a: 0.6 }), '有点躁')
  assert.equal(p.moodCue({ v: -0.3, a: 0 }), '有点低落')
  assert.equal(p.moodCue({ v: -0.6, a: 0.4 }), '很烦躁')
})

test('prompt：不出现情绪名与强度，只给行为倾向；规则 1', () => {
  const p = mk({ active: [{ name: '愤怒', intensity: 0.8, def: { anger: true }, target: '' }] })
  const out = p.prompt({})
  assert.match(out, /^【此刻的你】/)
  assert.ok(!out.includes('愤怒'), '不能把情绪名说出来')
  assert.ok(!out.includes('0.8'), '不能把强度说出来')
  assert.match(out, /话会比平时短/)
})

test('prompt：target 区分「眼前的人」与「冲着别人」；publicOnly 不点名', () => {
  const active = [{ name: '生气', intensity: 0.5, def: { anger: true }, target: 'other' }]
  const p = mk({ active })
  assert.match(p.prompt({ people: ['other'] }), /和眼前这个人有关/)
  assert.match(p.prompt({ people: ['someone'] }), /冲着别人的/)
  assert.match(p.prompt({ people: ['someone'], publicOnly: true }), /和眼前的人无关/)
})

test('prompt/describe：忍着没表现的会被标注', () => {
  const p = mk({ active: [{ name: '难过', intensity: 0.6, def: {}, hidden: true }] })
  assert.match(p.prompt({}), /不太想表现出来/)
  assert.match(p.describe({}), /你忍着没表现出来/)
})

test('describe：心情 + 对象 + 程度 + 原因；跨会话不泄露第三方', () => {
  const active = [{ name: '高兴', intensity: 0.8, def: {}, target: 'friend', why: '他夸我', source: 'appraisal', window: 'qq:group:1' }]
  const p = mk({ mood: { v: 0.5, a: 0.2, label: '愉快' }, active })
  const same = p.describe({ people: ['friend'], window: 'qq:group:1', name: (id) => (id === 'friend' ? '小明' : id) })
  assert.match(same, /【心情】愉快/)
  assert.match(same, /对小明很高兴（他夸我）/, JSON.stringify(same))
  // 来自深层记忆（source='deep'）的情绪在别的会话里不点名，也不带原因
  const deep = [{ name: '高兴', intensity: 0.8, def: {}, target: 'friend', why: '他夸我', source: 'deep', window: 'qq:group:1' }]
  const p2 = mk({ mood: { v: 0.5, a: 0.2, label: '愉快' }, active: deep })
  const other = p2.describe({ people: [], window: 'qq:private:2', name: (id) => (id === 'friend' ? '小明' : id) })
  assert.ok(!other.includes('小明'), '换会话不点名')
  assert.match(other, /很高兴/, '但情绪本身还在')
})

test('describe：气冲着别人 + 很累时，迁怒按「倾向 ×（1−亲近度）」触发一次（随机可控）', () => {
  const active = [{ name: '愤怒', intensity: 0.9, def: { anger: true }, target: 'stranger' }]
  const worn = { energy: 0.1, sleepiness: 0.9 }
  assert.match(mk({ active, displacement: 1, rnd: () => 0 }).describe({ people: [], body: worn }), /气还没消，又累/)
  assert.match(mk({ active, displacement: 1, rnd: () => 0 }).prompt({ body: worn }), /语气可能比平时冲一点/)
  assert.ok(!/气还没消/.test(mk({ active, displacement: 0, rnd: () => 0 }).describe({ people: [], body: worn })), '倾向为 0 不迁怒')
  const close = mk({ active, displacement: 1, rnd: () => 0 }).describe({ people: ['friend'], body: worn, name: (x) => x })
  assert.match(close, /气还没消/, '亲近度只影响概率，这里随机固定为 0 仍触发')
})
