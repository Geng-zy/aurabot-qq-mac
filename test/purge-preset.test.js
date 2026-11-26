// 预设的来源：宿主 header 只是「创建时的事实」，会话中途换过预设它就过期了。
// 我们建会话时自己记一份当前值，优先级高于 header —— 这条测试把顺序钉住。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { presetOfAgent, createPurgeScope } from '../src/integration/purge-scope.js'

const agentWith = ({ id = 's1', header = undefined, preset = undefined } = {}) => ({
  session: { id, header: header === undefined ? {} : { agentPreset: header } },
  ...(preset === undefined ? {} : { preset }),
})

test('自己记的预设优先于 header（header 是创建事实，可能已过期）', () => {
  const scope = createPurgeScope({ log: { debug() {} } })
  const agent = agentWith({ id: 's1', header: 'aurabot-private' })
  assert.equal(presetOfAgent(agent, (id) => scope.presetFor(id)), 'aurabot-private')
  scope.notePreset('s1', 'aurabot-social')
  assert.equal(presetOfAgent(agent, (id) => scope.presetFor(id)), 'aurabot-social',
    '会话中途换成 social 后，header 里的 private 不能再被当成当前预设')
})

test('没记过时退回 agent.preset，再退回 header', () => {
  const lookup = () => ''
  assert.equal(presetOfAgent(agentWith({ preset: 'aurabot-subagent', header: 'aurabot-private' }), lookup), 'aurabot-subagent')
  assert.equal(presetOfAgent(agentWith({ header: 'aurabot-private' }), lookup), 'aurabot-private')
  assert.equal(presetOfAgent(agentWith({}), lookup), '')
})

test('拿不到 id / 抛错都不影响：返回空串，调用方按「没有预设」处理', () => {
  const scope = createPurgeScope({})
  assert.equal(presetOfAgent(null, (id) => scope.presetFor(id)), '')
  assert.equal(presetOfAgent({ session: { get id() { throw new Error('boom') } } }, () => ''), '')
})

test('notePreset / forgetPreset：会话销毁后忘掉，别让表无限长', () => {
  const scope = createPurgeScope({})
  scope.notePreset('s9', 'aurabot-private')
  assert.equal(scope.presetFor('s9'), 'aurabot-private')
  scope.forgetPreset('s9')
  assert.equal(scope.presetFor('s9'), '')
})
