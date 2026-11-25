// 本地脚本：状态、模板、信任、打开目录和单项试跑。

export function registerLocalRoutes({ route, readBody, getConfig, setConfig, local, openFolder, localAudioFile, localImageBuffer }) {
  route('/local/status', async () => ({ ok: true, dir: local.dir(), list: local.status() }))
  route('/local/template', async (req) => {
    const slot = String((await readBody(req)).slot || '')
    if (!local.pathOf || !['tts', 'image', 'song', 'asr', 'video'].includes(slot)) return { ok: false, message: '没有这一项' }
    return local.template(slot)
  })
  route('/local/trust', async (req) => {
    const slot = String((await readBody(req)).slot || '')
    const r = local.trust?.(slot)
    if (!r?.ok) return r || { ok: false, message: '没有这一项' }
    const cur = getConfig()
    setConfig({ ...cur, local: { ...cur.local, hashes: { ...(cur.local?.hashes || {}), [slot]: r.hash } } })
    return { ok: true, message: '脚本已确认；以后改了脚本要重新确认', hash: r.hash }
  })
  route('/local/open', async () => openFolder(local.dir()))
  route('/local/test', async (req) => {
    const slot = String((await readBody(req)).slot || '')
    try {
      if (slot === 'tts') {
        const file = await local.call('tts', { text: '你好呀，我是大肥鱼，这是本地语音测试。' }, { readResult: localAudioFile })
        return { ok: true, message: `念好了：${file}` }
      }
      if (slot === 'image') {
        const buf = await local.call('image', { prompt: '一条胖乎乎的蓝色小鱼，可爱，插画', size: getConfig().imageGen.size || '1024x1024' }, { readResult: localImageBuffer })
        return { ok: true, message: `画好了（${Math.round(buf.length / 1024)} KB）`, image: buf.toString('base64') }
      }
      return { ok: false, message: '这一项没法单独试：翻唱换声去 QQ 里点首歌，语音识别发条语音条试试' }
    } catch (error) {
      return { ok: false, message: '出错了：' + error.message }
    }
  })
}
