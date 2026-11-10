// macOS 版：路径、下载源、安装参数、命令和兜底语音。
import assert from 'node:assert/strict'
import { test, after } from 'node:test'
import { mkdtempSync, rmSync, existsSync, statSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { deflateRawSync } from 'node:zlib'
import * as fsMod from 'node:fs'
const require_fs = () => fsMod

const root = mkdtempSync(join(tmpdir(), 'aurabot-macos-'))
process.env.AURABOT_DATA_DIR = root
after(() => rmSync(root, { recursive: true, force: true }))

const studio = await import('../src/song/studio.js')
// 装 uv、选镜像、解压这些通用的东西在 core/python.js（所有用 Python 的功能共用）
const py = await import('../src/core/python.js')
const { updateCommand } = await import('../src/core/update.js')
const { pickMacVoice } = await import('../src/voice/tts.js')
const { isSystemLink } = await import('../src/modules/diary/archive.js')

test('翻唱环境路径：env/bin 下的程序，不带扩展名', () => {
  const mac = studio.pathsOf('/Users/x/Aurabot/rvc')
  assert.equal(mac.python, '/Users/x/Aurabot/rvc/env/bin/python')
  assert.equal(mac.separatorExe, '/Users/x/Aurabot/rvc/env/bin/audio-separator')
  assert.equal(mac.ffmpeg, '/Users/x/Aurabot/rvc/bin/ffmpeg')
})

test('uv 下载源：按芯片挑 PyPI 官方的 uv 0.13.7 安装包，带校验值；没有对应包时为空', () => {
  const arm = py.uvSources('arm64')
  assert.match(arm[0].url, /uv-0\.13\.7-py3-none-macosx_11_0_arm64\.whl$/)
  assert.ok(arm[0].url.includes('mirrors.aliyun.com'), '先走国内镜像')
  assert.ok(arm.every((s) => s.sha256 === 'f91a229093163eefca89ea1b220a221d64c3beade05d03519a6584d1797a5a5f'))
  assert.match(py.uvSources('x64')[0].url, /macosx_10_12_x86_64\.whl$/)
  assert.deepEqual(py.uvSources('ppc'), [])
  assert.deepEqual(py.UV_SOURCES, py.uvSources())
})

test('安装参数：人声分离环境装 CPU 版（Apple 芯片走 MPS），版本固定', () => {
  assert.deepEqual(studio.installExtras(), ['audio-separator[cpu]==0.48.0', 'librosa==1.0.0', 'audioread==3.1.0', 'imageio-ffmpeg==0.8.1'])
})

test('安装位置：认 / 开头的路径，示例用主目录', () => {
  assert.equal(studio.checkRoot('/Users/x/rvc').ok, true)
  const bad = studio.checkRoot('rvc')
  assert.equal(bad.ok, false)
  assert.match(bad.message, /Aurabot\/rvc/)
})

/** 拼一个最小的 zip（deflate），测解压用。 */
function makeZip(files) {
  const locals = []
  const centrals = []
  let offset = 0
  for (const [name, text] of files) {
    const nameBuf = Buffer.from(name)
    const data = deflateRawSync(Buffer.from(text))
    const local = Buffer.alloc(30)
    local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(8, 8); local.writeUInt32LE(data.length, 18); local.writeUInt16LE(nameBuf.length, 26)
    const central = Buffer.alloc(46)
    central.writeUInt32LE(0x02014b50, 0); central.writeUInt16LE(8, 10); central.writeUInt32LE(data.length, 20); central.writeUInt16LE(nameBuf.length, 28); central.writeUInt32LE(offset, 42)
    locals.push(local, nameBuf, data)
    centrals.push(central, nameBuf)
    offset += 30 + nameBuf.length + data.length
  }
  const cd = Buffer.concat(centrals)
  const end = Buffer.alloc(22)
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(files.length, 10); end.writeUInt32LE(cd.length, 12); end.writeUInt32LE(offset, 16)
  return Buffer.concat([...locals, cd, end])
}

test('解压：不靠外部工具；建好子目录，程序加可执行权限，拒绝越界路径', () => {
  const dir = join(root, 'unzip')
  py.extractZip(makeZip([['uv-0.13.5.data/scripts/uv', 'bin'], ['pkg/readme.txt', 'hi']]), dir)
  const exe = join(dir, 'uv-0.13.5.data/scripts/uv')
  assert.equal(readFileSync(exe, 'utf8'), 'bin')
  assert.ok(statSync(exe).mode & 0o100, '程序要能运行')
  assert.equal(readFileSync(join(dir, 'pkg/readme.txt'), 'utf8'), 'hi')
  assert.throws(() => py.extractZip(makeZip([['../evil.txt', 'x']]), join(root, 'unzip2')), /越界/)
  assert.equal(existsSync(join(root, 'evil.txt')), false)
})

test('更新命令：用 DSH.app 自带的命令行', () => {
  assert.equal(updateCommand('a/b', 'main'), '"/Applications/DeepSeek Harness.app/Contents/Resources/runtime/cli/bin/dsh" plugin --profile desktop add github:a/b')
  assert.match(updateCommand('a/b', 'beta'), /github:a\/b#beta$/)
})

test('macOS 兜底语音：优先 Tingting，没有就用第一个中文（中国大陆）声音', () => {
  const list = [
    'Alex                en_US    # Hello',
    'Eddy (中文（中国大陆）)     zh_CN    # 你好！我叫Eddy。',
    'Meijia              zh_TW    # 你好，我叫美佳。',
    'Tingting (中文（中国大陆）)  zh_CN    # 你好，我叫婷婷。',
  ].join('\n')
  assert.equal(pickMacVoice(list), 'Tingting (中文（中国大陆）)')
  assert.equal(pickMacVoice(list.split('\n').slice(0, 3).join('\n')), 'Eddy (中文（中国大陆）)')
  assert.equal(pickMacVoice('Alex  en_US  # Hello'), '')
})

test('归档路径：放行系统自带（root 的）链接，用户建的链接不放行', () => {
  assert.equal(isSystemLink({ uid: 0 }), true)
  assert.equal(isSystemLink({ uid: 501 }), false)
})

test('自定义分离模型：有 extra-models.json 才走插件自带的 separator_run.py，否则直接调 audio-separator', () => {
  const { mkdirSync, writeFileSync } = require_fs()
  const p = studio.pathsOf(join(root, 'rvc-sep'))
  mkdirSync(p.separatorModels, { recursive: true })
  const args = ['in.wav', '--model_filename', 'm.ckpt']
  assert.deepEqual(studio.separatorCommand(p, args), [p.separatorExe, args])
  writeFileSync(join(p.separatorModels, 'extra-models.json'), '{}')
  const [cmd, argv] = studio.separatorCommand(p, args)
  assert.equal(cmd, p.python)
  assert.match(argv[0], /separator_run\.py$/)
  assert.deepEqual(argv.slice(1), args)
})

test('ffmpeg：安装目录里没有就用系统里的，都没有保持原样', () => {
  const p = studio.pathsOf('/x/rvc')
  assert.equal(studio.withSystemFfmpeg(p, { exists: () => true, find: () => '/opt/homebrew/bin/ffmpeg' }).ffmpeg, '/x/rvc/bin/ffmpeg')
  assert.equal(studio.withSystemFfmpeg(p, { exists: () => false, find: () => '/opt/homebrew/bin/ffmpeg' }).ffmpeg, '/opt/homebrew/bin/ffmpeg')
  assert.equal(studio.withSystemFfmpeg(p, { exists: () => false, find: () => '' }).ffmpeg, '/x/rvc/bin/ffmpeg')
})

test('本地原唱：按「歌名 - 歌手[专辑]」认文件；歌名对上就用，同名优先歌手对上的；不误配前缀相同的歌', async () => {
  const { mkdirSync, writeFileSync } = require_fs()
  const { findLocalSong, parseName } = await import('../src/song/local_music.js')
  const dir = join(root, 'music')
  mkdirSync(join(dir, 'sub'), { recursive: true })
  for (const n of ['小幸运 - 田馥甄[我的少女时代].flac', '演员 - 薛之谦[绅士].flac', '演员表 - 某人.mp3', 'sub/小幸运 - 翻唱者.mp3', 'note.txt']) writeFileSync(join(dir, n), 'x')
  assert.deepEqual(parseName('春娇与志明 - 街道办GDC&欧阳耀莹[春娇与志明].flac').title, '春娇与志明')
  assert.match(findLocalSong('小幸运', { dir }).path, /小幸运/)
  assert.match(findLocalSong('小幸运 田馥甄', { dir }).path, /田馥甄/)
  assert.match(findLocalSong('演员', { dir }).path, /演员 - 薛之谦/)
  assert.match(findLocalSong('演员表', { dir }).path, /演员表/)
  assert.equal(findLocalSong('不存在的歌', { dir }), null)
  const first = findLocalSong('演员', { dir }).path
  assert.equal(findLocalSong('演员', { dir, skip: ['local:' + first] }), null, '试过不行的不再用')
})

test('换声用的 Python：Applio 自己的 .venv 优先，没有就用翻唱环境', () => {
  const p = studio.pathsOf('/r')
  assert.equal(studio.applioPython(p, { exists: () => true }), '/r/Applio/.venv/bin/python')
  assert.equal(studio.applioPython(p, { exists: () => false }), '/r/env/bin/python')
})

test('rubberband：翻唱环境 bin/、PATH、Homebrew 依次找，找不到返回空', () => {
  const p = studio.pathsOf('/r')
  assert.equal(studio.findRubberband(p, { pathEnv: '/x', exists: (x) => x === '/r/bin/rubberband' || x === '/x/rubberband' }), '/r/bin/rubberband', '插件放的优先')
  assert.equal(studio.findRubberband(p, { pathEnv: '/usr/bin', exists: (x) => x === '/opt/homebrew/bin/rubberband' }), '/opt/homebrew/bin/rubberband')
  assert.equal(studio.findRubberband(p, { pathEnv: '/x', exists: (x) => x === '/x/rubberband' }), '/x/rubberband')
  assert.equal(studio.findRubberband(p, { pathEnv: '', exists: () => false }), '')
})

test('音色列表带出音色档案（<音色>.profile.json）', () => {
  const { mkdirSync, writeFileSync } = require_fs()
  const dir = join(root, 'models')
  mkdirSync(dir, { recursive: true })
  for (const n of ['a.pth', 'a.index', 'a.profile.json', 'b.pth']) writeFileSync(join(dir, n), 'x')
  const v = studio.listVoices(dir)
  assert.equal(v.find((x) => x.id === 'a').profile, join(dir, 'a.profile.json'))
  assert.equal(v.find((x) => x.id === 'b').profile, '')
})

test('图片和文件按路径直发：默认关（网关在 Docker 里读不到本机路径）；自己设过的照旧', async () => {
  const { normalize, DEFAULTS } = await import('../src/core/config.js')
  assert.equal(DEFAULTS.files.imageByPath, false)
  assert.equal(normalize({}).files.imageByPath, false)
  assert.equal(normalize({ files: { imageByPath: true } }).files.imageByPath, true)
})

test('一键安装的版本固定为本机跑通的组合：Python 3.13.18、Applio 3.7.1、Applio 自己的环境', async () => {
  const st = await import('../src/song/studio.js')
  assert.equal((await import('../src/core/python.js')).PY_VERSION, '3.13.18')
  assert.equal(st.APPLIO_COMMIT, '6f69726b140c615c8cc6831a7db8b7c5e48ba8af')
  assert.deepEqual(st.MAC_STACK.applioExtras, ['python-ffmpeg==2.0.12'])
})

test('一键安装自动备齐翻唱要的全部东西：默认 Leap Xe（固定版本、带校验）、增强模型、官方 rubberband', async () => {
  const st = await import('../src/song/studio.js')
  const { DEFAULTS } = await import('../src/core/config.js')
  assert.equal(DEFAULTS.song.separatorModel, st.LEAP_XE)
  assert.equal(st.INSTALL_STEPS[3], '准备 ffmpeg 和 rubberband')
  assert.equal(st.INSTALL_STEPS.length, 6)
  assert.match(st.RUBBERBAND_MAC.url, /^https:\/\/breakfastquay\.com\/.*rubberband-4\.0\.0-gpl-executable-macos\.tar\.bz2$/)
  assert.match(st.RUBBERBAND_MAC.sha256, /^[0-9a-f]{64}$/)
  const leap = st.SEPARATOR_FILES[st.LEAP_XE]
  assert.deepEqual(leap.map(([n]) => n), ['bs_leap_xe_voc.ckpt', 'leap_xe_config_voc.yaml'])
  assert.ok(leap.every(([, urls, sha]) => urls.every((u) => u.includes('/resolve/4e47d6662ae82eaa8b4ac4329fe66099a843b48e/Xe/')) && /^[0-9a-f]{64}$/.test(sha)))
})

test('清单外的分离模型：文件齐了还要登记进 extra-models.json 才算就绪；登记不覆盖已有的', async () => {
  const st = await import('../src/song/studio.js')
  const { writeFileSync, readFileSync } = await import('node:fs')
  const dir = mkdtempSync(join(tmpdir(), 'aurabot-sep-'))
  try {
    writeFileSync(join(dir, 'bs_leap_xe_voc.ckpt'), 'x')
    writeFileSync(join(dir, 'leap_xe_config_voc.yaml'), 'y')
    assert.equal(st.separatorReady(dir, st.LEAP_XE), false, '没登记')
    writeFileSync(join(dir, 'extra-models.json'), JSON.stringify({ 别的模型: { filename: 'a.ckpt' } }))
    assert.equal(st.registerExtraSeparator(dir, st.LEAP_XE), true)
    assert.equal(st.registerExtraSeparator(dir, st.LEAP_XE), false, '登记过就不再写')
    const list = JSON.parse(readFileSync(join(dir, 'extra-models.json'), 'utf8'))
    assert.ok(list['别的模型'], '原来的登记还在')
    assert.equal(list[st.EXTRA_SEPARATORS[st.LEAP_XE].key].filename, 'bs_leap_xe_voc.ckpt')
    assert.equal(st.separatorReady(dir, st.LEAP_XE), true)
    assert.equal(st.registerExtraSeparator(dir, 'model_bs_roformer_ep_317_sdr_12.9755.ckpt'), false, '清单里的模型不用登记')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('准备 uv：bin/ 里有就直接用；下载的文件校验对不上就不用、临时文件清掉', async () => {
  const { writeFileSync, mkdirSync } = require_fs()
  const base = mkdtempSync(join(tmpdir(), 'aurabot-uv-'))
  const saved = process.env.AURABOT_UV
  delete process.env.AURABOT_UV
  try {
    const bin = join(base, 'bin')
    mkdirSync(bin, { recursive: true })
    writeFileSync(join(bin, 'uv'), '#!/bin/sh\n')
    assert.equal(await py.ensurePinnedUv(bin), join(bin, 'uv'))

    const bin2 = join(base, 'rvc2', 'bin')
    const notes = []
    let tries = 0
    const download = async (url, dest) => { tries++; mkdirSync(join(dest, '..'), { recursive: true }); writeFileSync(dest, '不是 uv 安装包') }
    const r = await py.ensurePinnedUv(bin2, { note: (s) => notes.push(s), download }).catch((e) => e)
    assert.equal(tries, py.uvSources().length, '每个源都试过')
    assert.ok(notes.some((n) => /校验对不上/.test(n)), notes.join('\n'))
    assert.equal(existsSync(join(bin2, 'uv')), false, '校验不对的不放进 bin/')
    assert.equal(existsSync(join(base, 'rvc2', 'downloads-uv')), false, '临时下载文件夹删掉')
    // 下载都失败时：电脑上有 uv 就退回用它，没有就报错（看这台机器装没装）
    assert.ok(r instanceof Error ? /uv 下载失败/.test(r.message) : typeof r === 'string')
  } finally {
    if (saved !== undefined) process.env.AURABOT_UV = saved
    rmSync(base, { recursive: true, force: true })
  }
})

test('语音组件固定版本；所有功能共用同一个 Python，放在心智核心的目录里', () => {
  assert.match(studio.MAC_STACK.edgeTts, /^edge-tts==\d+\.\d+\.\d+$/)
  assert.match(py.PY_VERSION, /^3\.13\.\d+$/)
  assert.match(py.sharedPythonDir(), /Aurabot\/mind\/python$/)
  assert.match(py.sharedUvDir(), /Aurabot\/mind\/bin$/)
  const env = py.uvBaseEnv({ cache: '/tmp/c' })
  assert.equal(env.UV_PYTHON_INSTALL_DIR, py.sharedPythonDir())
  assert.equal(env.UV_PYTHON_BIN_DIR, join(py.sharedPythonDir(), 'bin'), '快捷方式也不往 ~/.local/bin 放')
  assert.equal(env.UV_PYTHON_PREFERENCE, 'only-managed')
})
