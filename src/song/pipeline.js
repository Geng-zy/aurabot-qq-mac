// 翻唱增强流程：分离好的人声 → 去混响 → 拆成两条（主唱 / 伴唱，或男女对唱时男声 / 女声）→ 自动定调、逐段挪八度 → 换声 → 合并 → 音色校正。
// 最早是主人在本地接口（local/song-convert.mjs）里一首首试听调出来的，这里做成插件内置、可配置、按音色档案工作。
//   - 去混响：anvuew 的温和版去混响模型；dereverb_blend.py 逐段比较，去完反而变噪的段落换回原人声
//   - 拆成两条：两个人同时唱、无缝换人混在一条里，RVC 一次只能跟一个音高，会破音。默认用 becruily 的 karaoke 模型拆主唱 / 伴唱；
//     点歌说了「对唱」时先用 Sucial 的模型分男声 / 女声，gender_check.py 确认真是男女对唱才这么拆
//   - 自动定调 / 挪八度（key_plan.py）：按音色档案里的音域定整首挪几个半音（伴奏用 rubberband 跟着挪），
//     离音域太远的段落挪整八度另换一遍再拼回去（octave_splice.py）。没有档案就不做
//   - 音色校正（tone_match.py）：按音色档案里的参照逐首校正频段。没有档案就不做
// 每一步出错都跳过那一步、照常出结果；只有换声本身失败才算翻唱失败。

import { existsSync, mkdirSync, readdirSync, renameSync } from 'node:fs'
import { basename, dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
export const SCRIPT = {
  blend: join(HERE, 'pipeline', 'dereverb_blend.py'),
  key: join(HERE, 'pipeline', 'key_plan.py'),
  splice: join(HERE, 'pipeline', 'octave_splice.py'),
  tone: join(HERE, 'pipeline', 'tone_match.py'),
  gender: join(HERE, 'pipeline', 'gender_check.py'),
  profile: join(HERE, 'pipeline', 'voice_profile.py'),
}

// 增强流程要用的分离模型（都在 audio-separator 的官方模型列表里，第一次用时自动下载到分离模型文件夹）
export const PIPELINE_MODELS = {
  dereverb: 'dereverb_mel_band_roformer_less_aggressive_anvuew_sdr_18.8050.ckpt',
  karaoke: 'bs_roformer_karaoke_frazer_becruily.ckpt',
  gender: 'model_chorus_bs_roformer_ep_267_sdr_24.1275.ckpt',
}

/** 默认开关和参数（插件配置 song.enhance 里可以逐项改）。 */
export const ENHANCE_DEFAULTS = {
  enabled: true, // 总开关：关掉就是最简单的「整条人声换一遍」
  dereverb: true,
  splitBacking: true, // 拆主唱 / 伴唱
  duetSplit: true, // 点歌说「对唱」时先分男女声
  autoKey: true, // 自动定调 + 逐段挪八度（要音色档案）
  toneMatch: true, // 音色校正（要音色档案）
  backEnvelope: 0, // 伴唱换声后的音量包络：0 = 完全跟原来的音量（背景里的和声、戏腔原本很轻，换完不会变得和主唱一样响）
}

/** 解析脚本最后一行 JSON 输出。 */
export const lastJson = (s) => { try { return JSON.parse(String(s).trim().split('\n').reverse().find((l) => l.startsWith('{')) || 'null') } catch { return null } }

/**
 * @param {object} o
 * @param {string} o.input 分离出来的人声（同一文件夹里有 (Instrumental)/(other) 伴奏）
 * @param {string} o.output 换声结果写到哪
 * @param {number} o.pitch 插件给的变调（她点歌时定的：原唱男声 +12、女声 0）
 * @param {boolean} [o.duet] 点歌时说了「对唱」
 * @param {object} o.env 环境：{ python, applio, separator(args)→[cmd,argv], separatorModels, ffmpeg, rubberband, model, index, profile }
 * @param {object} o.settings { indexRate, volumeEnvelope, protect, enhance: {...ENHANCE_DEFAULTS} }
 * @param {(cmd: string, args: string[], opts?: object) => Promise<string>} o.run 跑命令，返回输出（失败时抛错）
 * @param {object} [o.log]
 * @returns {Promise<{file: string, notes: string[], shift: number, octave: number}>}
 */
export async function runPipeline({ input, output, pitch, duet = false, env, settings, run, log }) {
  const en = { ...ENHANCE_DEFAULTS, ...(settings.enhance || {}) }
  const base = Math.round(Number(pitch) || 0)
  const notes = []
  const hasProfile = Boolean(env.profile && existsSync(env.profile))
  const pyEnv = { AURABOT_APPLIO: env.applio, ...(hasProfile ? { AURABOT_VOICE_PROFILE: env.profile } : {}) }
  const py = (script, args, label, extra = {}) => run(env.python, [script, ...args], { cwd: env.applio, env: { ...pyEnv, ...extra }, label })
  const separate = (args, label, cwd) => { const [cmd, argv] = env.separator(args); return run(cmd, argv, { cwd, label }) }

  const infer = (src, dst, p, envelope = settings.volumeEnvelope) => run(env.python, ['core.py', 'infer', '--input-path', src, '--output-path', dst,
    '--pth-path', env.model, '--index-path', env.index || '', '--pitch', String(p),
    '--index-rate', env.index ? String(settings.indexRate) : '0', '--volume-envelope', String(envelope), '--protect', String(settings.protect),
    '--f0-method', 'rmvpe', '--embedder-model', 'contentvec', '--export-format', 'WAV'], { cwd: env.applio, label: 'Applio 换声' })

  // 先按原调换一遍；要挪八度的段落按那几个八度各换一遍，再拼起来。拼不成就用原调那遍。
  async function inferFolded(src, dst, p, segs, envelope) {
    if (!segs?.length) return infer(src, dst, p, envelope)
    const baseOut = dst.replace(/\.wav$/i, '.base.wav')
    await infer(src, baseOut, p, envelope)
    try {
      const alts = []
      for (const o of [...new Set(segs.map((s) => s[2]))]) {
        const f = dst.replace(/\.wav$/i, `.oct${o}.wav`)
        await infer(src, f, p + o, envelope)
        alts.push(`${o}=${f}`)
      }
      await py(SCRIPT.splice, [dst, baseOut, JSON.stringify(segs), ...alts], '逐段挪八度')
    } catch (error) {
      log?.warn?.('逐段挪八度没做成，用原调：' + error.message)
      renameSync(baseOut, dst)
    }
  }

  let vocals = input
  // 1. 去混响
  if (en.enabled && en.dereverb) {
    try {
      const dir = join(dirname(input), 'dereverb')
      mkdirSync(dir, { recursive: true })
      await separate([input, '--model_filename', PIPELINE_MODELS.dereverb, '--model_file_dir', env.separatorModels, '--output_dir', dir,
        '--output_format', 'WAV', '--single_stem', 'noreverb'], '去混响', dir)
      // 按这次输入的文件名找（文件夹里可能留着别的结果）
      const stem = basename(input).replace(/\.[^.]+$/, '')
      const f = readdirSync(dir).find((n) => n.startsWith(stem + '_') && /\(noreverb\)/i.test(n))
      if (!f) throw new Error('去混响没产出文件')
      const out = join(dir, 'vocals_dereverb_blend.wav')
      notes.push('去混响 ' + JSON.stringify(lastJson(await py(SCRIPT.blend, [input, join(dir, f), out], '去混响挑选'))))
      vocals = out
    } catch (error) {
      log?.warn?.('去混响没做成，用原来的人声：' + error.message)
    }
  }

  // 2. 拆成两条
  let parts = null
  if (en.enabled && en.duetSplit && duet) {
    try {
      const dir = join(dirname(vocals), 'gender')
      mkdirSync(dir, { recursive: true })
      await separate([vocals, '--model_filename', PIPELINE_MODELS.gender, '--model_file_dir', env.separatorModels, '--output_dir', dir, '--output_format', 'WAV'], '男女声分离', dir)
      const files = readdirSync(dir)
      const female = files.find((n) => /\(female\)/i.test(n))
      const male = files.find((n) => /\(male\)/i.test(n))
      if (!female || !male) throw new Error('男女声分离没产出文件')
      const info = lastJson(await py(SCRIPT.gender, [join(dir, female), join(dir, male)], '判断男女对唱'))
      if (info?.duet) parts = { lead: join(dir, female), back: join(dir, male), dir, mode: 'gender' }
      notes.push((parts ? '男女对唱，分男女声 ' : '不是男女对唱 ') + JSON.stringify(info))
    } catch (error) {
      log?.warn?.('男女声分离没做成，改用主唱伴唱拆法：' + error.message)
    }
  }
  if (en.enabled && en.splitBacking && !parts) {
    try {
      const dir = join(dirname(vocals), 'karaoke')
      mkdirSync(dir, { recursive: true })
      await separate([vocals, '--model_filename', PIPELINE_MODELS.karaoke, '--model_file_dir', env.separatorModels, '--output_dir', dir, '--output_format', 'WAV'], '主唱伴唱分离', dir)
      const files = readdirSync(dir)
      const lead = files.find((n) => /\(vocals\)/i.test(n))
      const back = files.find((n) => /\(instrumental\)/i.test(n))
      if (!lead || !back) throw new Error('主唱伴唱分离没产出文件')
      parts = { lead: join(dir, lead), back: join(dir, back), dir, mode: 'karaoke' }
      notes.push('主唱伴唱分开')
    } catch (error) {
      log?.warn?.('主唱伴唱分离没做成，整条人声一起换：' + error.message)
    }
  }

  // 3. 自动定调 + 挪八度（要音色档案）
  let plan = null
  let shift = 0
  if (en.enabled && en.autoKey && hasProfile) {
    try {
      // 伴奏没法变调时只挪八度，整首不挪
      plan = lastJson(await py(SCRIPT.key, parts ? [parts.lead, String(base), parts.back] : [vocals, String(base)], '定调', env.rubberband ? {} : { AURABOT_KEY_SHIFT: '0' }))
      const k = Math.round(Number(plan?.shift) || 0)
      if (k !== 0) {
        // 插件把伴奏放在人声旁边（文件名带 (Instrumental) 或 (other)），混音时直接读它，所以原地变调；伴奏变调成功，人声才跟着挪
        const dir = dirname(input)
        const inst = readdirSync(dir).find((n) => /\((instrumental|other)\)/i.test(n) && /\.wav$/i.test(n))
        if (!inst) throw new Error('找不到伴奏文件')
        const src = join(dir, inst)
        const tmp = src.replace(/\.wav$/i, '.shifted.wav')
        await run(env.rubberband, ['-q', '-3', '-p', String(k), src, tmp], { cwd: dir, label: '伴奏变调' })
        renameSync(tmp, src)
        shift = k
      }
      const { lead, back, ...brief } = plan || {}
      notes.push('定调 ' + JSON.stringify(brief))
    } catch (error) {
      plan = null
      log?.warn?.('自动定调没做成，按原来的调唱：' + error.message)
    }
  }
  // key_plan 可能让人声整首再挪一个八度（只挪人声，伴奏不动）：她按歌手猜的 +12 不一定对
  const octave = Math.round(Number(plan?.octave) || 0)
  const p = base + shift + octave

  // 4. 换声 + 合并
  if (parts) {
    const leadOut = join(parts.dir, 'lead_rvc.wav')
    const backOut = join(parts.dir, 'back_rvc.wav')
    await inferFolded(parts.lead, leadOut, p, plan?.lead)
    // 男女对唱时两条都是主唱，照常用主唱的音量包络；拆的是伴唱时让它跟着原来的音量
    await inferFolded(parts.back, backOut, p, plan?.back, parts.mode === 'gender' ? settings.volumeEnvelope : en.backEnvelope)
    await run(env.ffmpeg, ['-hide_banner', '-loglevel', 'error', '-y', '-i', leadOut, '-i', backOut, '-filter_complex',
      'amix=inputs=2:duration=longest:normalize=0,alimiter=limit=0.97', output], { cwd: parts.dir, label: '合并主唱伴唱' })
  } else {
    await inferFolded(vocals, output, p, plan?.lead)
  }
  if (!existsSync(output)) throw new Error('换声没产出文件')

  // 5. 音色校正（要音色档案）
  if (en.enabled && en.toneMatch && hasProfile) {
    try {
      notes.push('音色 ' + JSON.stringify(lastJson(await py(SCRIPT.tone, [output], '音色校正'))))
    } catch (error) {
      log?.warn?.('音色校正没做成，用没校正的结果：' + error.message)
    }
  }
  return { file: output, notes, shift, octave }
}
