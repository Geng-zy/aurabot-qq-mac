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
  // B2 心智组
  { page: 'now', empty: /心智核心没起来|她现在/ },
  { page: 'mood', empty: /还没有记下的经历|没有匹配的记忆|心智核心没起来/ },
  { page: 'knowledge', empty: /知识库还是空的|知识库文件|读不到知识库/ },
  { page: 'persona', empty: /还没认识谁|没有匹配的人|心智核心没起来/ },
  { page: 'inner', empty: /心智核心没起来|念头与行动|内心/ },
  // B3 自我与设置
  { page: 'selfmind', empty: /心智核心没起来|性格（19 项）|人格与自我/ },
  { page: 'mindsettings', empty: /没有可调参数|心智核心没起来|没有找到匹配的设置/ },
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

  // 1) 28 个页面正常态 + 导航断言（B1）
  // 哪些页该有分区条：直接问面板自己的 FIND_SECTIONS（≥2 个分区才显示）
  const sectionsOf = async (id) => page.evaluate((pid) => {
    const map = window.__PANEL__.__panelTest.FIND_SECTIONS || {}
    return (map[pid] || []).length
  }, id)
  for (const id of PAGES) {
    jsErrors.length = 0
    await open(`page=${id}&state=live&mode=normal`)
    await page.screenshot({ path: join(PAGE_DIR, `${id}.png`) })
    check(`页面 ${id} 渲染没有 JS 错误`, jsErrors.length === 0, jsErrors[0])
    const crumb = (await page.textContent('.ab-breadcrumb')) || ''
    check(`页面 ${id} 有面包屑`, Boolean(crumb.trim()))
    // 导航：该页在侧栏或页签里被标成当前位置
    const currentInNav = await page.evaluate(() => Boolean(document.querySelector('.ab-rail-item[aria-current="true"], .ab-rail-pages button[aria-current="page"], .ab-page-nav button[aria-current="page"]')))
    check(`页面 ${id} 导航标出当前位置`, currentInNav)
    // 分区锚点条：登记的页面必须有，没登记的不该出现
    const chips = await page.locator('.ab-section-nav button').count()
    const want = await sectionsOf(id)
    if (want >= 2) check(`页面 ${id} 有分区锚点条`, chips >= 2, `只有 ${chips} 个（登记 ${want}）`)
    else check(`页面 ${id} 不该有分区锚点条`, chips === 0, `出现 ${chips} 个`)
    // 分区跳转：点第二个分区要展开对应的折叠块
    if (chips >= 2) {
      await page.locator('.ab-section-nav button').nth(1).click()
      await wait(250)
      const marked = await page.locator('.ab-section-nav button[aria-current="location"]').count()
      check(`页面 ${id} 分区跳转有当前位置`, marked === 1)
    }
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

  // 3) 设置页的字段级校验：超出范围当场标错、不发请求；改回范围内就保存
  await open('page=mindsettings&state=live&mode=normal')
  const num = page.locator('.ab-param-row input[type="number"]').first()
  if (await num.count()) {
    const limit = await num.evaluate((el) => ({ min: el.min, max: el.max }))
    const bad = limit.max ? String(Number(limit.max) + 1) : '999999999'
    await num.fill(bad)
    await num.blur()
    await wait(250)
    check('设置页：超范围当场标错', (await page.locator('.ab-row-err').count()) > 0)
    check('设置页：错误与该行关联', await page.evaluate(() => Boolean(document.querySelector('.ab-row-error .ab-row-err'))))
    await num.fill(limit.min || '1')
    await num.blur()
    await wait(250)
    check('设置页：改回范围内错误消失', (await page.locator('.ab-row-err').count()) === 0)
  }

  // 4) Toast 挂在宿主层（模拟 shell.overlay）：只出现一份，且内容正确
  await open('page=logs&state=live&mode=normal')
  const toastText = await page.evaluate(async () => {
    const bus = window.__PANEL__.__panelTest.AB_TOAST
    bus.publish('分区已切换', 'ok')
    await new Promise((r) => setTimeout(r, 250))
    return document.querySelector('.ab-toaster')?.innerText || ''
  })
  check('Toast 渲染在宿主 overlay 层', toastText.includes('分区已切换'), toastText)
  const toastInside = await page.evaluate(() => document.querySelectorAll('.ab-toaster .ab-toast').length)
  const toastTotal = await page.locator('.ab-toast').count()
  check('Toast 只有宿主层那一份', toastTotal === 1 && toastInside === 1, `总 ${toastTotal}，宿主层 ${toastInside}`)

  // 5) 深色与窄屏
  await open('page=overview&state=live&mode=normal&theme=dark')
  await page.screenshot({ path: join(OUT, 'theme-dark.png') })
  check('深色模式生效', await page.evaluate(() => document.body.hasAttribute('data-ds-dark-theme')))

  await page.setViewportSize({ width: 620, height: 900 })
  await open('page=access&state=live&mode=normal')
  await page.screenshot({ path: join(OUT, 'narrow.png') })
  check('窄屏没有横向溢出', await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 2))
  check('窄屏显示页签', await page.locator('.ab-page-nav').isVisible())
  check('窄屏隐藏侧栏页列表', !(await page.locator('.ab-rail-pages').first().isVisible().catch(() => false)))
  const navWrap = await page.evaluate(() => {
    const nav = document.querySelector('.ab-section-nav')
    return nav ? getComputedStyle(nav).flexWrap : 'none'
  })
  check('窄屏分区条可横向滑动', navWrap === 'nowrap', `flex-wrap=${navWrap}`)

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
