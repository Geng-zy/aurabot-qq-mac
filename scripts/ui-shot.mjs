// 面板 UI 的截图与断言：一条命令把 28 个页面、三态、深浅色、窄屏都过一遍。
//
// 依赖：playwright-core（npm i --no-save playwright-core）+ 本机 Chrome；
// 预览服务由 scripts/ui-preview.mjs 起（本脚本自动拉起，用完关掉）。
//
// 产出：
//   docs/ui-baseline/pages/<id>.png        28 个页面的正常态
//   docs/ui-baseline/states/<page>-<mode>.png  五个代表页的加载/错误/空态
//   docs/ui-baseline/theme-dark.png / narrow.png
// 断言失败时退出码非 0，并打印哪一条没通过。
import { spawn } from 'node:child_process'
import { existsSync, mkdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const OUT = join(ROOT, 'docs/ui-baseline')
const PAGE_DIR = join(OUT, 'pages')
const STATE_DIR = join(OUT, 'states')
mkdirSync(PAGE_DIR, { recursive: true })
mkdirSync(STATE_DIR, { recursive: true })

async function loadPlaywright() {
  for (const p of ['playwright-core', '/tmp/pw/node_modules/playwright-core/index.mjs']) {
    try { return await import(p) } catch {}
  }
  throw new Error('缺 playwright-core：在 /tmp/pw 里 npm i --no-save playwright-core，或在本仓库 devDependency 里装。')
}

const PAGES = [
  'overview', 'now', 'mood', 'knowledge', 'persona', 'inner', 'selfmind', 'mindsettings', 'platforms',
  'connect', 'access', 'group', 'model', 'asr', 'diary', 'voice', 'stickers', 'imagegen', 'song', 'video',
  'logs', 'backup', 'security', 'browser', 'local', 'about', 'modules', 'market',
]

// 五个代表页 × 三态：空态文案随页面不同
const STATES = [
  { page: 'overview', empty: /还没有接上任何一个平台/ },
  { page: 'mindsettings', empty: /没有可调参数|心智核心没起来/ },
  { page: 'voice', empty: /还没有可用的语音引擎|说话（文字转语音）/ },
  { page: 'modules', empty: /模块|还没有/ },
  { page: 'logs', empty: /没有符合条件的日志/ },
]

const { chromium } = await loadPlaywright()
// 端口交给系统分配：写死端口会撞上上一次跑剩下的预览进程，拿到旧页面
const server = spawn(process.execPath, [join(ROOT, 'scripts/ui-preview.mjs'), '--port', '0'], { stdio: ['ignore', 'pipe', 'ignore'] })
const base = await new Promise((resolve, reject) => {
  let buf = ''
  const timer = setTimeout(() => reject(new Error('预览服务没在 20s 内报出地址')), 20000)
  server.stdout.on('data', (chunk) => {
    buf += String(chunk)
    const m = buf.match(/http:\/\/127\.0\.0\.1:\d+\//)
    if (m) { clearTimeout(timer); resolve(m[0]) }
  })
})
const wait = (ms) => new Promise((r) => setTimeout(r, ms))

async function up() {
  for (let i = 0; i < 60; i++) {
    try { const r = await fetch(base + 'state.json'); if (r.ok) return } catch {}
    await wait(150)
  }
  throw new Error('预览服务没起来')
}

const failures = []
const check = (name, ok, detail = '') => { if (!ok) failures.push(name + (detail ? '：' + detail : '')) }

try {
  await up()
  const browser = await chromium.launch({ channel: 'chrome', headless: true })
  const ctx = await browser.newContext({ viewport: { width: 1360, height: 900 }, deviceScaleFactor: 2 })
  const page = await ctx.newPage()
  const jsErrors = []
  page.on('pageerror', (e) => jsErrors.push(String(e)))

  const open = async (query) => {
    await page.goto(base + '?' + query, { waitUntil: 'domcontentloaded' })
    try {
      await page.waitForSelector('.ab-root', { state: 'visible', timeout: 15000 })
    } catch (error) {
      const body = (await page.textContent('body')) || ''
      throw new Error(`打开 ${query} 后没有可见的 .ab-root。页面文字：${body.slice(0, 160)}；JS 错误：${jsErrors.slice(0, 2).join(' | ')}`)
    }
    await wait(400)
  }

  // 1) 28 个页面正常态
  for (const id of PAGES) {
    jsErrors.length = 0
    await open(`page=${id}&state=live&mode=normal`)
    await page.screenshot({ path: join(PAGE_DIR, `${id}.png`) })
    check(`页面 ${id} 渲染没有 JS 错误`, jsErrors.length === 0, jsErrors[0])
    const title = await page.textContent('.ab-breadcrumb')
    check(`页面 ${id} 有面包屑`, Boolean(title && title.trim()))
  }

  // 2) 五个代表页的三态
  for (const { page: id, empty } of STATES) {
    // 加载态：请求挂住 → 骨架屏
    await open(`page=${id}&state=live&mode=loading`)
    await page.screenshot({ path: join(STATE_DIR, `${id}-loading.png`) })
    check(`${id} 加载态显示骨架屏`, (await page.locator('.ab-skel').count()) > 0)

    // 错误态：请求失败 → 就地错误块 + 重试
    await open(`page=${id}&state=live&mode=error`)
    await page.screenshot({ path: join(STATE_DIR, `${id}-error.png`) })
    check(`${id} 错误态显示错误块`, (await page.locator('.ab-errorblock').count()) > 0)
    check(`${id} 错误块有重试`, (await page.getByRole('button', { name: '重试' }).count()) > 0)

    // 空态：空数据
    await open(`page=${id}&state=empty&mode=normal`)
    await page.screenshot({ path: join(STATE_DIR, `${id}-empty.png`) })
    const text = await page.textContent('body')
    check(`${id} 空态是教学式的`, empty.test(text || ''), '文案没匹配到')
  }

  // 3) 深色与窄屏
  await open('page=overview&state=live&mode=normal&theme=dark')
  await page.screenshot({ path: join(OUT, 'theme-dark.png') })
  check('深色模式生效', await page.evaluate(() => document.body.hasAttribute('data-ds-dark-theme')))

  await page.setViewportSize({ width: 620, height: 900 })
  await open('page=overview&state=live&mode=normal')
  await page.screenshot({ path: join(OUT, 'narrow.png') })
  check('窄屏没有横向溢出', await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 2))

  await browser.close()
} finally {
  server.kill()
}

if (failures.length) {
  console.error('UI 断言没通过：\n- ' + failures.join('\n- '))
  process.exitCode = 1
} else {
  console.log(`UI 截图与断言通过：${PAGES.length} 页 + ${STATES.length} 页 × 3 态 + 深浅色 + 窄屏`)
}
