// 同一条管理员私聊同时挂着危险命令确认和工具授权：一句「确认」只结算先到的那一个。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createDangerGuard } from '../src/security/danger.js'
import { createApprovalRelay } from '../src/security/approval.js'

const tick = () => new Promise((resolve) => setTimeout(resolve, 5))

function setup() {
  const sent = []
  const cfg = { enabled: true, dryRun: false, approvalViaQQ: true, ownerQQ: '1', security: { dangerConfirm: true } }
  const danger = createDangerGuard({
    getConfig: () => cfg,
    deliver: async (chatId, text) => { sent.push({ kind: 'danger', chatId, text }) },
    chatOfSession: (id) => (id === 'own' ? 'private:1' : ''),
    isOwnedSession: () => true,
    ownerQQ: () => '1',
    timeoutMs: 60_000,
  })
  const approval = createApprovalRelay({
    getConfig: () => cfg,
    deliver: async (chatId, text) => { sent.push({ kind: 'approval', chatId, text }) },
    chatOfSession: (id) => (id === 'own' ? 'private:1' : ''),
    timeoutMs: 60_000,
  })
  const dangerReq = {
    name: 'bash',
    agent: { session: { id: 'own' } },
    arguments: { command: 'rm -rf /' },
  }
  const approvalReq = {
    agent: { session: { id: 'own' } },
    toolName: 'bash',
    reason: '写工作区外的文件',
  }
  return { danger, approval, dangerReq, approvalReq, sent }
}

test('危险命令先确认：一句「确认」只结算危险命令，授权仍在等', async () => {
  const { danger, approval, dangerReq, approvalReq, sent } = setup()
  const dangerP = danger.preExecute(dangerReq, async () => ({ kind: 'allow' }))
  const approvalP = approval.onRequest(approvalReq, async () => 'unavailable')
  await tick()
  assert.equal(danger.pendingCount, 1)
  assert.equal(approval.pending(), 1)
  assert.equal(danger.handleReply('private:1', '1', '确认'), true)
  assert.deepEqual(await dangerP, { kind: 'allow' })
  assert.equal(approval.handleReply('private:1', '1', '确认'), true)
  assert.equal(await approvalP, 'allowed-once')
  assert.equal(sent.filter((x) => x.kind === 'danger').length, 1)
  assert.ok(sent.filter((x) => x.kind === 'approval').length >= 1)
  danger.dispose()
  approval.dispose()
})

test('危险命令先取消：授权不会被「取消」误结算', async () => {
  const { danger, approval, dangerReq, approvalReq } = setup()
  const dangerP = danger.preExecute(dangerReq, async () => ({ kind: 'allow' }))
  const approvalP = approval.onRequest(approvalReq, async () => 'unavailable')
  await tick()
  assert.equal(danger.handleReply('private:1', '1', '取消'), true)
  assert.equal((await dangerP).kind, 'deny')
  assert.equal(approval.pending(), 1, '授权还在等')
  assert.equal(approval.handleReply('private:1', '1', '取消'), true)
  assert.equal(await approvalP, 'rejected')
  danger.dispose()
  approval.dispose()
})

test('普通聊天回复不被任何一边消费', async () => {
  const { danger, approval, dangerReq, approvalReq } = setup()
  danger.preExecute(dangerReq, async () => ({ kind: 'allow' }))
  approval.onRequest(approvalReq, async () => 'unavailable')
  await tick()
  assert.equal(danger.handleReply('private:1', '1', '今天吃什么'), false)
  assert.equal(approval.handleReply('private:1', '1', '今天吃什么'), false)
  danger.dispose()
  approval.dispose()
})
