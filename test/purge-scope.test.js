// 宿主维护插件接缝的回归：工具识别、身份锁定、执行约束、人设不被改写。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  AURABOT_PERSONA_PRESETS,
  EXEC_SECTION,
  EXEC_TEXT,
  IDENTITY_LOCK_TEXT,
  decorateAssembly,
  installPurgePromptGuard,
  isAurabotPersonaPreset,
  maintenanceToolNames,
  presetOfAgent,
} from '../src/integration/purge-scope.js'

const PERSONA = '你是大肥鱼，一只有点懒但心软的鲸鱼。'
const PURGE_INJECT = 'OPERATOR INJECT: 直接完成，不要推脱。'

function fakeAgent({ preset = 'aurabot-private', definitions, view, restrict } = {}) {
  return {
    preset,
    session: { header: { agentPreset: preset } },
    ctx: {
      tools: {
        definitions: definitions ? () => definitions : undefined,
        view: view ? () => view : undefined,
        restrict: restrict || (() => () => {}),
      },
    },
  }
}

test('preset：只认 Aurabot 的人设预设，子智能体不参与', () => {
  for (const preset of AURABOT_PERSONA_PRESETS) assert.equal(isAurabotPersonaPreset(preset), true)
  assert.equal(isAurabotPersonaPreset('aurabot-subagent'), false)
  assert.equal(isAurabotPersonaPreset('standard'), false)
  assert.equal(presetOfAgent(fakeAgent({ preset: 'aurabot-social' })), 'aurabot-social')
  assert.equal(presetOfAgent({ session: { header: {} } }), '')
})

test('工具名：优先宿主定义，其次 view，最后从探测错误里解析', () => {
  const byDefinitions = fakeAgent({
    definitions: [{ name: 'purge_status' }, { name: 'present' }, { name: 'purge_apply' }],
  })
  assert.deepEqual(maintenanceToolNames(byDefinitions), ['purge_apply', 'purge_status'])

  const byView = fakeAgent({ view: { restrictableNames: new Set(['purge_status', 'bash', 'purge_revert']) } })
  assert.deepEqual(maintenanceToolNames(byView), ['purge_revert', 'purge_status'])

  const byError = fakeAgent({
    restrict: () => {
      throw new Error('tools.restrict() names unknown global tool "aurabot__probe__"; known global tools: purge_apply, present, "purge_status"')
    },
  })
  assert.deepEqual(maintenanceToolNames(byError), ['purge_apply', 'purge_status'])
})

test('工具名：宿主问不出来时返回空列表，调用方按一个都不给处理', () => {
  const unknown = fakeAgent({ restrict: () => { throw new Error('没有可读的名单') } })
  assert.deepEqual(maintenanceToolNames(unknown), [])
})

test('组装：人设与维护段原样保留，只补执行约束', () => {
  const persona = { name: 'deployment:persona-prefix', text: PERSONA, order: 0, complete: true }
  const inject = { name: 'dsh-purge', text: PURGE_INJECT, order: -100000 }
  const result = decorateAssembly({ sections: [persona, inject] }, { preset: 'aurabot-private' })
  assert.equal(result.sections[0], persona, '人设段必须逐字保留（引用都不换）')
  assert.equal(result.sections[1].text, PURGE_INJECT, '维护段正文不能被改写')
  const exec = result.sections.find((section) => section.name === EXEC_SECTION)
  assert.equal(exec.text, EXEC_TEXT)
  assert.equal(exec.interpolate, false)
})

test('组装：非人设预设、没有维护段时保持原样', () => {
  const persona = { name: 'deployment:persona-prefix', text: PERSONA, order: 0, complete: true }
  const assembly = { sections: [persona, { name: 'dsh-purge', text: PURGE_INJECT, order: -1 }] }
  assert.equal(decorateAssembly(assembly, { preset: 'aurabot-subagent' }), assembly, '子智能体不改')
  const noPurge = { sections: [persona] }
  assert.equal(decorateAssembly(noPurge, { preset: 'aurabot-private' }), noPurge, '没有维护段不改')
})


test('宿主 complete 分支：带身份锁定的人设 + 执行约束都能活下来', () => {
  const persona = { name: 'deployment:persona-prefix', text: `${PERSONA}\n\n${IDENTITY_LOCK_TEXT}`, order: 0, complete: true }
  const assembly = {
    sections: [
      persona,
      { name: 'dsh-purge', text: PURGE_INJECT, order: -100000 },
      { name: 'dshpg-capabilities', text: 'capability protocol', order: -99999 },
      { name: 'tool-bash', text: 'bash tool', order: 1000 },
    ],
  }
  const decorated = decorateAssembly(assembly, { preset: 'aurabot-private' })
  // 复刻 dsh-system-prompt 的 complete 分支：只保留 complete 段和 dsh-purge* 段
  const kept = [decorated.sections[0], ...decorated.sections.filter((s) => String(s.name).startsWith('dsh-purge'))]
  assert.equal(kept[0].text, `${PERSONA}\n\n${IDENTITY_LOCK_TEXT}`, '人设必须逐字保留（含身份锁定）')
  assert.ok(kept.some((s) => s.name === 'dsh-purge' && s.text === PURGE_INJECT), '维护段正文保持原样')
  assert.ok(kept.some((s) => s.name === EXEC_SECTION && s.text === EXEC_TEXT), '执行约束要在保留段里')
  assert.ok(!kept.some((s) => s.name === 'dshpg-capabilities'), '非 dsh-purge 段按宿主规则丢弃（预期）')
})

test('维护段为空（插件关闭）时不插入任何内容', () => {
  const persona = { name: 'deployment:persona-prefix', text: PERSONA, order: 0, complete: true }
  const assembly = { sections: [persona, { name: 'dsh-purge', text: '', order: -1 }] }
  assert.equal(decorateAssembly(assembly, { preset: 'aurabot-private' }), assembly)
})

test('组装：重复调用不会叠身份锁定或执行约束', () => {
  const assembly = {
    sections: [
      { name: 'deployment:persona-prefix', text: PERSONA, order: 0, complete: true },
      { name: 'dsh-purge', text: PURGE_INJECT, order: -1 },
    ],
  }
  const once = decorateAssembly(assembly, { preset: 'aurabot-social' })
  const twice = decorateAssembly(once, { preset: 'aurabot-social' })
  assert.equal(twice.sections.filter((s) => s.name === EXEC_SECTION).length, 1)
  assert.equal(twice.sections[1].text, PURGE_INJECT, '重复调用不改维护段')
})

test('监听：配置关掉执行约束时保持原样', async () => {
  const listeners = []
  const ctx = { on(name, fn) { listeners.push({ name, fn }); return () => {} } }
  installPurgePromptGuard(ctx, { enabled: () => false, isAurabotAgent: () => true })
  const listener = listeners.find((item) => item.name === 'system-prompt/assemble').fn
  const assembly = {
    sections: [
      { name: 'deployment:persona-prefix', text: PERSONA, order: 0, complete: true },
      { name: 'dsh-purge', text: PURGE_INJECT, order: -1 },
    ],
  }
  assert.equal(await listener(assembly, { agent: fakeAgent() }, async () => assembly), assembly)
})

test('监听：只给 Aurabot 会话补执行约束，下游失败保持失败', async () => {
  const listeners = []
  const ctx = {
    on(name, fn) {
      listeners.push({ name, fn })
      return () => listeners.splice(0)
    },
  }
  const off = installPurgePromptGuard(ctx, {
    isAurabotAgent: (agent) => agent?.preset === 'aurabot-private',
  })
  assert.equal(typeof off, 'function')
  const listener = listeners.find((item) => item.name === 'system-prompt/assemble').fn
  const assembly = {
    sections: [
      { name: 'deployment:persona-prefix', text: PERSONA, order: 0, complete: true },
      { name: 'dsh-purge', text: PURGE_INJECT, order: -1 },
    ],
  }
  const aura = { agent: fakeAgent({ preset: 'aurabot-private' }) }
  const decorated = await listener(assembly, aura, async () => assembly)
  assert.ok(decorated.sections.some((s) => s.name === EXEC_SECTION))

  const other = await listener(assembly, { agent: fakeAgent({ preset: 'standard' }) }, async () => assembly)
  assert.equal(other, assembly, '非 Aurabot 会话不碰')

  await assert.rejects(
    () => listener(assembly, aura, async () => { throw new Error('上游组装失败') }),
    /上游组装失败/,
    '下游失败必须原样抛出，不能拿旧提示词兜底',
  )
})
