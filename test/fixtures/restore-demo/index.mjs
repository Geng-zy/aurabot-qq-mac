export default {
  id: 'restore-demo',
  name: '恢复演示模块',
  version: '1.0.0',
  api: 1,
  setup(api) {
    api.route('/ping', async () => ({ ok: true, pong: true }))
    return {}
  },
}
