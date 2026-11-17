// 会话工具闸：非管理员收全局工具、群聊按发言人开合、卸载时回收。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createToolScope, isGuestSafeTool } from '../src/chat/tool-scope.js'

function fakeAgent(names = null) {
  const calls = []
  const agent = {
    calls,
    offCount: 0,
    ctx: {
      tools: {
        view: names ? () => ({ restrictableNames: new Set(names) }) : undefined,
        restrict(filter) {
          calls.push(filter)
          let open = true
          return () => { if (open) { open = false; agent.offCount += 1 } }
        },
      },
    },
  }
  return agent
}

test('白名单只留会话内交互工具', () => {
  assert.equal(isGuestSafeTool('todo_write'), true)
  assert.equal(isGuestSafeTool('ask_user_question'), true)
  assert.equal(isGuestSafeTool('bash'), false)
  assert.equal(isGuestSafeTool('mcp__fastctx__run'), false)
})

test('限制访客：有名单时只放行白名单，没名单时 allow 为空', () => {
  const scope = createToolScope()
  const agent = fakeAgent(['todo_write', 'bash', 'purge_status'])
  scope.restrictGuest(agent)
  assert.deepEqual(agent.calls.at(-1), { allow: ['todo_write'] })

  const unknown = fakeAgent(null)
  unknown.ctx.tools.restrict = (filter) => {
    if (!filter.allow) throw new Error('no names')
    unknown.calls.push(filter)
    return () => {}
  }
  scope.restrictGuest(unknown)
  assert.deepEqual(unknown.calls.at(-1), { allow: [] })
})

test('群聊闸：先收起，管理员开口放开，掺别人再收起，卸载时回收', () => {
  const scope = createToolScope()
  const agent = fakeAgent(['todo_write', 'bash'])
  scope.openGate('group:1', agent)
  scope.applyGate('group:1', false)
  assert.equal(agent.calls.length, 1)
  assert.deepEqual(agent.calls[0], { allow: ['todo_write'] })
  scope.applyGate('group:1', true)
  assert.equal(agent.offCount, 1)
  scope.applyGate('group:1', false)
  assert.equal(agent.calls.length, 2)
  scope.releaseAgent(agent)
  assert.equal(agent.offCount, 2)
  assert.equal(scope.gates.size, 0)
})
