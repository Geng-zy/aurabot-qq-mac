// 面板头像、侧栏背景和同步 QQ 头像。

import { existsSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

export function registerAvatarRoutes({
  route, readBody, send, avatarFile, avatarInfo, dataDir, root, mimeOf, log, onebot, ensureDir,
}) {
  route('/avatar', async (req, res) => {
    if (existsSync(avatarFile())) {
      const buf = readFileSync(avatarFile())
      return send(res, 200, buf, mimeOf(buf))
    }
    const p = join(root, 'assets', 'dafeiyu.jpg')
    if (!existsSync(p)) return send(res, 404, '')
    send(res, 200, readFileSync(p), 'image/jpeg')
  })

  route('/panel/sea', (req, res) => {
    const file = join(root, 'assets', 'panel-sea.jpg')
    if (!existsSync(file)) return send(res, 404, '')
    send(res, 200, readFileSync(file), 'image/jpeg')
  })

  route('/avatar/upload', async (req) => {
    const b = await readBody(req, 8 * 1024 * 1024)
    const buf = Buffer.from(String(b.data || '').replace(/^data:[^,]+,/, ''), 'base64')
    if (!buf.length || buf.length > 5 * 1024 * 1024) return { ok: false, message: '图片太大（最多 5MB）或是空的' }
    if (!mimeOf(buf).startsWith('image/')) return { ok: false, message: '只支持 PNG、JPG、GIF、WebP 图片' }
    ensureDir(dataDir())
    writeFileSync(avatarFile(), buf)
    log.info('换了面板头像')
    return { ok: true, message: '头像换好了', avatar: avatarInfo() }
  })

  route('/avatar/reset', async () => {
    try { unlinkSync(avatarFile()) } catch {}
    return { ok: true, message: '恢复成默认头像了', avatar: avatarInfo() }
  })

  route('/avatar/sync-qq', async () => {
    const buf = existsSync(avatarFile()) ? readFileSync(avatarFile()) : readFileSync(join(root, 'assets', 'dafeiyu.jpg'))
    try {
      await onebot.call('set_qq_avatar', { file: 'base64://' + buf.toString('base64') })
      return { ok: true, message: '已经设成机器人号的 QQ 头像' }
    } catch (error) {
      return { ok: false, message: 'QQ 头像没换成：' + error.message }
    }
  })
}
