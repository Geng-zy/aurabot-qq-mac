// macOS 适配：按系统选路径、下载源、安装参数、命令和兜底语音。Windows 的行为保持原样，这里一并钉住。
import assert from 'node:assert/strict'
import { test, after } from 'node:test'
import { mkdtempSync, rmSync, existsSync, statSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { deflateRawSync } from 'node:zlib'

const root = mkdtempSync(join(tmpdir(), 'aurabot-macos-'))
process.env.AURABOT_DATA_DIR = root
after(() => rmSync(root, { recursive: true, force: true }))

const studio = await import('../src/song/studio.js')
const { updateCommand } = await import('../src/core/update.js')
const { pickMacVoice } = await import('../src/voice/tts.js')
const { isSystemLink } = await import('../src/modules/diary/archive.js')

test('翻唱环境路径：Windows 用 Scripts\\*.exe，macOS 用 bin/ 不带扩展名', () => {
  const win = studio.pathsOf('C:\\rvc', 'win32')
  assert.match(win.python, /env[\\/]Scripts[\\/]python\.exe$/)
  assert.match(win.separatorExe, /Scripts[\\/]audio-separator\.exe$/)
  assert.match(win.ffmpeg, /bin[\\/]ffmpeg\.exe$/)
  const mac = studio.pathsOf('/Users/x/Aurabot/rvc', 'darwin')
  assert.equal(mac.python, '/Users/x/Aurabot/rvc/env/bin/python')
  assert.equal(mac.separatorExe, '/Users/x/Aurabot/rvc/env/bin/audio-separator')
  assert.equal(mac.ffmpeg, '/Users/x/Aurabot/rvc/bin/ffmpeg')
  assert.equal(studio.exeName('uv', 'win32'), 'uv.exe')
  assert.equal(studio.exeName('uv', 'darwin'), 'uv')
})

test('uv 下载源：按系统和芯片挑官方安装包，带校验值；没有对应包时为空', () => {
  const win = studio.uvSources('win32', 'x64')
  assert.equal(win[0].sha256, '1fb29fc46ba12033e2ef95a95ac79d649e71bbb1358419bbbcbd19d86026ef2f')
  assert.match(win.at(-1).url, /windows-msvc\.zip$/)
  const arm = studio.uvSources('darwin', 'arm64')
  assert.match(arm[0].url, /macosx_11_0_arm64\.whl$/)
  assert.ok(arm.every((s) => s.sha256 === 'a42c85fa8156e1e5e2cecdbc77bb818ea1dcf5f78b8e2a8f84c7fe4f16f0702e'))
  assert.match(studio.uvSources('darwin', 'x64')[0].url, /macosx_10_12_x86_64\.whl$/)
  assert.deepEqual(studio.uvSources('freebsd', 'x64'), [])
  // 老代码里导出的常量仍在，按当前系统取
  assert.deepEqual(studio.UV_SOURCES, studio.uvSources())
})

test('安装参数：macOS 装 CPU 版人声分离、不走 CUDA 的 PyTorch 源；Windows 不变', () => {
  assert.deepEqual(studio.installExtras('darwin'), ['audio-separator[cpu]'])
  assert.deepEqual(studio.installExtras('win32'), ['audio-separator[gpu]'])
  assert.deepEqual(studio.torchSource(false, 'darwin'), [])
  assert.deepEqual(studio.torchSource(true, 'darwin'), [])
  assert.equal(studio.torchSource(false, 'win32')[0], '--extra-index-url')
  assert.equal(studio.torchSource(true, 'win32')[0], '--find-links')
})

test('安装位置：macOS 认 / 开头的路径，示例用主目录；只有 Windows 列盘符', () => {
  assert.equal(studio.checkRoot('/Users/x/rvc', 'darwin').ok, true)
  const bad = studio.checkRoot('rvc', 'darwin')
  assert.equal(bad.ok, false)
  assert.match(bad.message, /Aurabot\/rvc/)
  assert.doesNotMatch(bad.message, /D:\\/)
  assert.equal(studio.checkRoot('/Users/x/rvc', 'win32').ok, false)
  assert.equal(studio.checkRoot('D:\\Aurabot\\rvc', 'win32').ok, true)
  assert.deepEqual(studio.listDrives('darwin'), [])
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

test('解压：不靠 PowerShell；建好子目录，程序加可执行权限，拒绝越界路径', { skip: process.platform === 'win32' }, () => {
  const dir = join(root, 'unzip')
  studio.extractZip(makeZip([['uv-0.13.5.data/scripts/uv', 'bin'], ['pkg/readme.txt', 'hi']]), dir)
  const exe = join(dir, 'uv-0.13.5.data/scripts/uv')
  assert.equal(readFileSync(exe, 'utf8'), 'bin')
  assert.ok(statSync(exe).mode & 0o100, '程序要能运行')
  assert.equal(readFileSync(join(dir, 'pkg/readme.txt'), 'utf8'), 'hi')
  assert.throws(() => studio.extractZip(makeZip([['../evil.txt', 'x']]), join(root, 'unzip2')), /越界/)
  assert.equal(existsSync(join(root, 'evil.txt')), false)
})

test('更新命令：Windows 是 PowerShell，macOS 用 DSH.app 自带的命令行', () => {
  assert.match(updateCommand('a/b', 'main', 'win32'), /^& ".*dsh\.cmd" plugin --profile desktop add github:a\/b$/)
  assert.equal(updateCommand('a/b', 'main', 'darwin'), '"/Applications/DeepSeek Harness.app/Contents/Resources/runtime/cli/bin/dsh" plugin --profile desktop add github:a/b')
  assert.equal(updateCommand('a/b', 'beta', 'linux'), 'dsh plugin --profile desktop add github:a/b#beta')
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

test('归档路径：放行系统自带（root 的）链接，用户建的链接和 Windows 一律不放行', () => {
  assert.equal(isSystemLink({ uid: 0 }, 'darwin'), true)
  assert.equal(isSystemLink({ uid: 501 }, 'darwin'), false)
  assert.equal(isSystemLink({ uid: 0 }, 'win32'), false)
})
