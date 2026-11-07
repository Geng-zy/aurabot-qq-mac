// 翻唱增强流程（src/song/pipeline.js）：按开关、音色档案、对唱与否走对的步骤；哪步失败就跳过那步。
import assert from 'node:assert/strict'
import { test, after } from 'node:test'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, existsSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, basename } from 'node:path'

const { runPipeline, ENHANCE_DEFAULTS, PIPELINE_MODELS, SCRIPT } = await import('../src/song/pipeline.js')
const root = mkdtempSync(join(tmpdir(), 'aurabot-pipeline-'))
after(() => rmSync(root, { recursive: true, force: true }))
let seq = 0

/** 一首歌的工作目录：人声 + 伴奏。 */
function song({ profile = false } = {}) {
  const dir = join(root, 'job' + seq++)
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, 'part_(vocals)_x.wav'), 'v')
  writeFileSync(join(dir, 'part_(other)_x.wav'), 'inst')
  const prof = join(dir, 'voice.profile.json')
  if (profile) writeFileSync(prof, JSON.stringify({ range: { center: 347 } }))
  return { dir, input: join(dir, 'part_(vocals)_x.wav'), output: join(dir, 'vocals_rvc.wav'), profile: profile ? prof : '' }
}

/** 假的命令执行：记下调用，并按命令造出它该产出的文件。 */
function fakeRun({ plan = { shift: 0 }, gender = { duet: true }, fail = [] } = {}) {
  const calls = []
  const run = async (cmd, args, o = {}) => {
    calls.push({ cmd, args, label: o.label, env: o.env || {} })
    if (fail.includes(o.label)) throw new Error(o.label + ' 失败')
    const at = (flag) => args[args.indexOf(flag) + 1]
    if (cmd === 'SEP') {
      const out = at('--output_dir')
      const stem = basename(args[0]).replace(/\.[^.]+$/, '')
      const model = at('--model_filename')
      if (model === PIPELINE_MODELS.dereverb) writeFileSync(join(out, `${stem}_(noreverb)_m.wav`), 'n')
      if (model === PIPELINE_MODELS.karaoke) { writeFileSync(join(out, `${stem}_(Vocals)_k.wav`), 'l'); writeFileSync(join(out, `${stem}_(Instrumental)_k.wav`), 'b') }
      if (model === PIPELINE_MODELS.gender) { writeFileSync(join(out, `${stem}_(female)_g.wav`), 'f'); writeFileSync(join(out, `${stem}_(male)_g.wav`), 'm') }
      return ''
    }
    if (args[0] === 'core.py') { writeFileSync(at('--output-path'), 'rvc'); return '' }
    if (args[0] === SCRIPT.blend) { writeFileSync(args[3], 'blend'); return '{"dereverb_used":1}' }
    if (args[0] === SCRIPT.key) return JSON.stringify(plan)
    if (args[0] === SCRIPT.gender) return JSON.stringify(gender)
    if (args[0] === SCRIPT.splice) { writeFileSync(args[1], 'spliced'); return '{}' }
    if (args[0] === SCRIPT.tone) return '{"tone_match":"song"}'
    if (cmd === 'RB') { writeFileSync(args.at(-1), 'shifted'); return '' }
    if (cmd === 'FF') { writeFileSync(args.at(-1), 'mixed'); return '' }
    return ''
  }
  return { run, calls }
}

const envFor = (s, extra = {}) => ({ python: 'PY', applio: '/applio', separator: (a) => ['SEP', a], separatorModels: '/sep', ffmpeg: 'FF', rubberband: 'RB', model: '/m.pth', index: '/m.index', profile: s.profile, ...extra })
const settings = (enhance = {}) => ({ indexRate: 0.3, volumeEnvelope: 0.5, protect: 0.33, enhance: { ...ENHANCE_DEFAULTS, ...enhance } })
const infers = (calls) => calls.filter((c) => c.args[0] === 'core.py')
const opt = (c, flag) => c.args[c.args.indexOf(flag) + 1]

test('没有音色档案：去混响 → 拆主唱伴唱 → 两条各换一遍（伴唱跟原来的音量）→ 合并；不定调、不校正音色', async () => {
  const s = song()
  const { run, calls } = fakeRun()
  const r = await runPipeline({ input: s.input, output: s.output, pitch: 12, env: envFor(s), settings: settings(), run })
  assert.equal(r.file, s.output)
  assert.ok(existsSync(s.output))
  assert.deepEqual(calls.map((c) => c.label), ['去混响', '去混响挑选', '主唱伴唱分离', 'Applio 换声', 'Applio 换声', '合并主唱伴唱'])
  const [lead, back] = infers(calls)
  assert.match(opt(lead, '--input-path'), /\(Vocals\)/)
  assert.equal(opt(lead, '--volume-envelope'), '0.5')
  assert.equal(opt(back, '--volume-envelope'), '0')
  assert.equal(opt(lead, '--pitch'), '12')
  assert.equal(opt(lead, '--index-rate'), '0.3')
  assert.equal(opt(lead, '--embedder-model'), 'contentvec')
  assert.equal(calls.find((c) => c.label === '去混响挑选').env.AURABOT_APPLIO, '/applio')
})

test('有音色档案：定调后伴奏跟着变调，人声按 插件变调 + 整首挪 + 撤回八度 换；要挪八度的段落另换再拼；最后校正音色', async () => {
  const s = song({ profile: true })
  const { run, calls } = fakeRun({ plan: { shift: -2, octave: -12, lead: [[1, 3, 12]], back: [] } })
  const r = await runPipeline({ input: s.input, output: s.output, pitch: 12, env: envFor(s), settings: settings(), run })
  assert.equal(r.shift, -2)
  assert.equal(r.octave, -12)
  assert.equal(readFileSync(join(s.dir, 'part_(other)_x.wav'), 'utf8'), 'shifted', '伴奏原地变调')
  const key = calls.find((c) => c.label === '定调')
  assert.equal(key.env.AURABOT_VOICE_PROFILE, s.profile)
  const pitches = infers(calls).map((c) => opt(c, '--pitch'))
  assert.deepEqual(pitches, ['-2', '10', '-2'], '主唱原调 -2、挪八度的段 +12、伴唱 -2')
  assert.ok(calls.some((c) => c.label === '逐段挪八度'))
  assert.equal(calls.at(-1).label, '音色校正')
})

test('找不到 rubberband：定调时告诉脚本整首不挪，只挪八度', async () => {
  const s = song({ profile: true })
  const { run, calls } = fakeRun({ plan: { shift: 0 } })
  await runPipeline({ input: s.input, output: s.output, pitch: 0, env: envFor(s, { rubberband: '' }), settings: settings(), run })
  assert.equal(calls.find((c) => c.label === '定调').env.AURABOT_KEY_SHIFT, '0')
  assert.ok(!calls.some((c) => c.cmd === 'RB'))
})

test('点歌说「对唱」且确认是男女对唱：按女声 / 男声两条换，两条都用主唱的音量包络；不是对唱就退回拆主唱伴唱', async () => {
  const s = song()
  const a = fakeRun({ gender: { duet: true } })
  await runPipeline({ input: s.input, output: s.output, pitch: 0, duet: true, env: envFor(s), settings: settings(), run: a.run })
  assert.deepEqual(a.calls.map((c) => c.label).slice(2, 4), ['男女声分离', '判断男女对唱'])
  assert.ok(!a.calls.some((c) => c.label === '主唱伴唱分离'))
  const [f, m] = infers(a.calls)
  assert.match(opt(f, '--input-path'), /\(female\)/)
  assert.match(opt(m, '--input-path'), /\(male\)/)
  assert.equal(opt(m, '--volume-envelope'), '0.5')
  const s2 = song()
  const b = fakeRun({ gender: { duet: false } })
  await runPipeline({ input: s2.input, output: s2.output, pitch: 0, duet: true, env: envFor(s2), settings: settings(), run: b.run })
  assert.ok(b.calls.some((c) => c.label === '主唱伴唱分离'))
})

test('总开关关掉（语音条也这么走）：只整条换一遍', async () => {
  const s = song({ profile: true })
  const { run, calls } = fakeRun()
  await runPipeline({ input: s.input, output: s.output, pitch: 3, env: envFor(s), settings: settings({ enabled: false }), run })
  assert.deepEqual(calls.map((c) => c.label), ['Applio 换声'])
  assert.equal(opt(calls[0], '--input-path'), s.input)
})

test('去混响、拆分、定调失败都跳过那步照常出结果；换声失败才算失败', async () => {
  const s = song({ profile: true })
  const { run, calls } = fakeRun({ fail: ['去混响', '主唱伴唱分离', '定调', '音色校正'] })
  const r = await runPipeline({ input: s.input, output: s.output, pitch: 0, env: envFor(s), settings: settings(), run, log: { warn: () => {} } })
  assert.equal(r.file, s.output)
  assert.equal(opt(infers(calls)[0], '--input-path'), s.input, '用原来的人声整条换')
  const s2 = song()
  await assert.rejects(runPipeline({ input: s2.input, output: s2.output, pitch: 0, env: envFor(s2), settings: settings({ enabled: false }), run: fakeRun({ fail: ['Applio 换声'] }).run }))
})

test('没有 .index 时特征检索比例传 0', async () => {
  const s = song()
  const { run, calls } = fakeRun()
  await runPipeline({ input: s.input, output: s.output, pitch: 0, env: envFor(s, { index: '' }), settings: settings({ enabled: false }), run })
  assert.equal(opt(calls[0], '--index-rate'), '0')
})
