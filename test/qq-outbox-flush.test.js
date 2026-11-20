import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createOutboxFlush } from '../src/channels/qq/features/outbox-flush.js'

test('QQ 补发队列只在连接有效时 flush', async () => {
  let connected = false
  let calls = 0
  const flusher = createOutboxFlush({
    box: { async flush(_call, { isReady }) { calls++; assert.equal(isReady(), true); return { sent: 1, dropped: 0, left: 0 } } },
    call: async () => ({}),
    getConfig: () => ({ enabled: true, debug: false, dryRun: false }),
    isConnected: () => connected,
    isDisposed: () => false,
    getRevision: () => 1,
    canReplayDelivery: () => true,
    onSent: () => {},
    log: { info() {}, warn() {} },
  })
  await flusher.flush()
  assert.equal(calls, 0)
  connected = true
  await flusher.flush()
  assert.equal(calls, 1)
})
