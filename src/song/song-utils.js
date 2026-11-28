// 做歌用的纯函数：混音参数、纯音乐/伴唱判断、候选排序、截取窗口、把错误翻译成人话。
// 从 song/studio.js 抽出来：这些不碰文件也不碰进程，单独放着便于测试与复用（session.js 与 studio.js 都用）。

export const VOCAL_MIN_DB = -50

export function mixArgs({ vocals, inst, vol, iv, out }) {
  const head = ['-y', '-hide_banner', '-loglevel', 'error', '-i', vocals]
  // 320k：发出去的是 QQ 语音条，QQ 还会再压一遍，源头码率高一点听着没那么「劣质」
  const tail = ['-ac', '2', '-ar', '44100', '-b:a', '320k', out]
  if (!inst) return [...head, '-af', `volume=${vol},alimiter=limit=0.95`, ...tail]
  return [...head, '-i', inst, '-filter_complex', `[0:a]volume=${vol}[v];[1:a]volume=${iv}[i];[v][i]amix=inputs=2:duration=longest:normalize=0,alimiter=limit=0.95`, ...tail]
}

const INSTRUMENTAL = /纯音乐|伴奏|钢琴|吉他|八音盒|音乐盒|古筝|琵琶|二胡|笛子|葫芦丝|小提琴|大提琴|口琴|萨克斯|instrumental|off ?vocal|karaoke|\binst\b|\bbgm\b|music box|piano/i

/** 搜索结果排序：标题像纯音乐（钢琴版、伴奏……）的放到最后，除非点歌时本来就这么说。其余保持网易云的顺序。 */
export function rankCandidates(list, query = '') {
  const want = INSTRUMENTAL.test(query)
  const bad = (s) => !want && INSTRUMENTAL.test(`${s.name} ${s.alias || ''}`)
  return [...list.filter((s) => !bad(s)), ...list.filter(bad)]
}

export function clipWindow(durationSec, maxSec, start = 'auto') {
  if (!(durationSec > maxSec)) return { start: 0, length: durationSec }
  if (start === 'head') return { start: 0, length: maxSec }
  const s = Math.max(0, Math.min(Math.round(durationSec * 0.3), Math.floor(durationSec - maxSec)))
  return { start: s, length: maxSec }
}

/** 翻唱出错翻译成人话（给点歌的人看）。 */
export function explainSongError(message) {
  const m = String(message || '')
  if (/size mismatch|Error\(s\) in loading state_dict|unexpected key|Missing key|KeyError: '(weight|config|params)'/i.test(m)) return '这个音色模型和内置的 RVC 不兼容（可能是 so-vits-svc 之类训练的，或者不是完整的模型文件）。可以在面板「本地接口」里接你自己的推理'
  if (/MPS backend out of memory|CUDA out of memory|OutOfMemoryError|not enough memory/i.test(m)) return '内存不够了（Apple 芯片的显卡和系统共用内存），关掉别的占内存的程序（别的 AI、大型软件）再试'
  if (/No module named|ModuleNotFoundError/i.test(m)) return '翻唱环境不完整，在面板「翻唱」页点「重新检查 / 修复安装」'
  if (/Permission denied|Errno 13|EACCES|EPERM|EBUSY/i.test(m)) {
    const file = (m.match(/'([^']+\.(?:ckpt|pth|onnx|yaml|json))'/i) || [])[1]?.replace(/\\\\/g, '\\')
    return `${file ? `读不了「${file}」` : '有个模型文件读不了'}：多半是文件权限不对（比如用 sudo 放进去的，属于 root），或者安全软件拦住了它。在终端里用 ls -l 看看文件属于谁；还不行就把这个文件移到废纸篓，在面板「翻唱」页重新下载`
  }
  return m
}

