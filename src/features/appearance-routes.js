// 「她的形象」面板路由：导入几张参考图、选主图、看图写外貌描述。
// 从 modules/imagegen/index.js 抽出来：那边是生图模块的装配（工具、画作图库、内心邀约），
// 这一组路由只跟「参考图目录 + 看图模型」打交道，和生图服务本身无关。
//
// 依赖全部由调用方传入（api / looks / 看图判断 / 图片探测），所以这一组可以单独看、单独改。

import { DESCRIBE_SYSTEM, MAX_APPEARANCE } from './appearance.js'

/**
 * @param {object} api 内置模块 API（route / core.http / config / ask / dsh）
 * @param {object} o
 * @param {{list:Function, description:Function, read:Function, add:Function, remove:Function, setPrimary:Function, setDescription:Function, buffers:Function}} o.looks
 * @param {(buf: Buffer) => string} o.mimeOf
 * @param {(dsh: object, cfg: object, target: object|null) => Promise<boolean|null>} o.canSeeImages
 */
export function registerAppearanceRoutes(api, { looks, mimeOf, canSeeImages }) {
  api.route('/image/appearance', async () => ({ ok: true, list: looks.list(), description: looks.description(), max: MAX_APPEARANCE }))
  api.route('/image/appearance/image', async (req, res) => {
    const buf = looks.read(String(api.core.http.query(req).file || ''))
    if (!buf) return api.core.http.send(res, 404, '')
    api.core.http.send(res, 200, buf, String(mimeOf(buf) || 'image/png'))
  })
  api.route('/image/appearance/upload', async (req) => {
    if (req?.method !== 'POST') return { ok: false, message: '要用 POST 上传' }
    try { return await looks.add(await api.core.http.raw(req, 20 * 1024 * 1024)) } catch (error) { return { ok: false, message: error.message } }
  }, { access: 'panel' })
  api.route('/image/appearance/delete', async (req) => looks.remove(String((await api.core.http.body(req)).file || '')), { access: 'panel' })
  api.route('/image/appearance/primary', async (req) => looks.setPrimary(String((await api.core.http.body(req)).file || '')), { access: 'panel' })
  api.route('/image/appearance/description', async (req) => looks.setDescription(String((await api.core.http.body(req)).text || ''), 'owner'), { access: 'panel' })
  // 看图写一段外貌描述（要看得懂图的模型：表情起名单独挑了模型就用它，不然用聊天模型）
  api.route('/image/appearance/describe', async () => {
    const imgs = looks.buffers(4)
    if (!imgs.length) return { ok: false, message: '先导入几张她的图' }
    const pick = api.config().stickers?.captionModel
    const target = pick && pick.provider && pick.model ? { provider: pick.provider, model: pick.model } : null
    if ((await canSeeImages(api.dsh, api.config(), target).catch(() => null)) === false) return { ok: false, message: '现在用的模型看不了图：在「模型」页换一个能看图的，或者自己写描述' }
    try {
      const text = String(await api.ask({ system: DESCRIBE_SYSTEM, text: '这几张都是她。', images: imgs.map((b) => ({ data: b.toString('base64'), mediaType: String(mimeOf(b)) })), maxTokens: 600, ...(target ? { model: target } : {}) }) || '').trim()
      if (!text) return { ok: false, message: '模型没写出描述' }
      looks.setDescription(text, 'vision')
      return { ok: true, description: looks.description() }
    } catch (error) {
      return { ok: false, message: '没写成：' + error.message }
    }
  }, { access: 'panel' })
}

/**
 * 她的画作面板：图库列表、取单张、删除、开文件夹。
 * @param {object} api
 * @param {object} o { listPaintings, paintingPath, removePainting, openPaintFolder, dataDir, readFileSync, mimeOf }
 */
export function registerGalleryRoutes(api, { listPaintings, paintingPath, removePainting, openPaintFolder, dataDir, readFileSync, mimeOf }) {
  api.route('/image/gallery', async (req) => {
    const q = api.core.http.query(req)
    const limit = q && q.limit ? Number(q.limit) : api.config().imageGen.galleryShown
    return { ok: true, ...listPaintings({ limit }), dir: dataDir('imagegen') }
  })
  api.route('/image/gallery/image', async (req, res) => {
    const p = paintingPath(api.core.http.query(req).file)
    if (!p) return api.core.http.send(res, 404, '')
    const buf = readFileSync(p)
    api.core.http.send(res, 200, buf, String(mimeOf(buf) || 'image/png'))
  })
  api.route('/image/gallery/delete', async (req) => {
    const b = await api.core.http.body(req).catch(() => ({}))
    return removePainting(String((b && b.file) || ''))
  }, { access: 'panel' })
  api.route('/image/open-folder', async () => openPaintFolder(), { access: 'panel' })
}
