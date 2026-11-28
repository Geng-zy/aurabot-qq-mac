// Aurabot · 网页半边：DSH 侧栏入口和 AuraBot 工作台。
// 只读写宿主半边的 /aurabot/api/* 接口，不直接碰会话和 QQ。
// 工作台使用独立配色，随 DSH 切换浅色和深色。

window.__ModuleLoader__.load({
  id: 'dsh-aurabot-qq',
  factory: (require) => {
    var module = { exports: {} }
    var exports = module.exports
    const React = require('react')
    const { useState, useEffect, useRef, useCallback, useMemo, useId, Fragment } = React
    const h = React.createElement
    // DSH UI primitives 是宿主提供的可选能力：有就用宿主的 Button/Switch，没有就保留原生控件。
    let uiPrimitives
    let uiPrimitivesLoaded = false
    const primitives = () => {
      if (uiPrimitivesLoaded) return uiPrimitives
      uiPrimitivesLoaded = true
      try {
        if (typeof require === 'function') uiPrimitives = require('@deepseek-ai/dsh-client-ui-primitives') || null
      } catch (error) {
        uiPrimitives = null
      }
      if (!uiPrimitives || !uiPrimitives.Button || !uiPrimitives.Switch || !uiPrimitives.Toast) {
        throw new Error('AuraBot 需要 DSH 的 client-ui-primitives 才能显示界面')
      }
      return uiPrimitives
    }
    // DSH 的桌面判断优先；没有 primitives 时退回 navigator.platform（测试和旧宿主也能用）。
    const isMacLike = () => {
      try {
        const p = require('@deepseek-ai/dsh-client-ui-primitives')
        if (p && typeof p.isDarwinDesktop === 'function') return Boolean(p.isDarwinDesktop())
      } catch (error) {}
      return /Mac|iPhone|iPad/.test(navigator.platform)
    }
    const inject = ['slots']
    const PANEL_ID = 'aurabot'
    const API = '/aurabot/api'
    const PROJECT_REPO = 'https://github.com/Geng-zy/aurabot-qq-mac'
    const UPSTREAM_REPO = 'https://github.com/aureth-labs/dsh-aurabot-qq'
    const MODULE_REPOS = { mac: 'Geng-zy/aurabot-qq-mac-mods', upstream: 'aureth-labs/dsh-aurabot-qq-mods' }

    // ---------------- 小工具 ----------------
    const get = (p) => fetch(API + p, { cache: 'no-store' }).then((r) => r.json()).catch((e) => ({ ok: false, message: '连不上插件：' + e.message }))
    const clipboard = async (text) => {
      const p = primitives()
      return p.writeClipboard(text)
    }
    const post = (p, body) =>
      fetch(API + p, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body || {}) })
        .then((r) => r.json())
        .catch((e) => ({ ok: false, message: '连不上插件：' + e.message }))
    const clone = (o) => JSON.parse(JSON.stringify(o))
    const setPath = (obj, path, value) => {
      const next = clone(obj)
      let cur = next
      const ks = path.split('.')
      for (let i = 0; i < ks.length - 1; i++) cur = cur[ks[i]] = cur[ks[i]] || {}
      cur[ks[ks.length - 1]] = value
      return next
    }
    // ---------------- token 用量显示 ----------------
    /** token 数量用 K / M / B 表示：1234 → 1.2K；1234567 → 1.23M；1234567890 → 1.23B */
    const fmtTokens = (n) => {
      const v = Math.round(Number(n) || 0)
      if (v < 1000) return String(v)
      if (v < 1_000_000) return (v / 1000).toFixed(v < 100_000 ? 1 : 0) + 'K'
      if (v < 1_000_000_000) return (v / 1_000_000).toFixed(v < 10_000_000 ? 2 : 1) + 'M'
      return (v / 1_000_000_000).toFixed(2) + 'B'
    }
    /**
     * 花费：「0.05 元」——「元」放后面（中文习惯），货币符号（¥ / $）才放前面。
     * 小于 1 分保留 4 位并去掉多余的 0（0.008 元），别显示成 0.00。
     */
    const fmtCost = (n, currency = '元') => {
      const v = Number(n) || 0
      const text = v === 0 ? '0' : v < 0.01 ? v.toFixed(4).replace(/0+$/, '').replace(/\.$/, '') : v.toFixed(2)
      return /[\u3400-\u9fff]/.test(String(currency)) ? text + ' ' + currency : String(currency) + text
    }
    /** chatId → 好认的名字：group:602656027 → 「群 602656027」，system:diary → 「后台 · diary」 */
    const chatLabel = (k) => {
      if (!k || k === '（未知）') return '其他后台任务'
      const [kind, id] = String(k).split(':')
      if (kind === 'group') return '群 ' + id
      if (kind === 'private') return '私聊 ' + id
      if (kind === 'system') return '后台 · ' + String(id || '').replace(/^ext-/, '')
      return String(k)
    }
    // ---------------- DeepSeek 峰谷（服务端算好，前端只负责显示） ----------------
    const BJ_OFFSET = 8 * 3600_000
    const pad2 = (n) => String(n).padStart(2, '0')
    const bjPartsOf = (ms) => { const d = new Date(ms + BJ_OFFSET); return { y: d.getUTCFullYear(), m: d.getUTCMonth() + 1, d: d.getUTCDate(), dow: d.getUTCDay() } }
    const fmtNextChange = (at, now) => {
      const bj = new Date(at + BJ_OFFSET)
      const hm = pad2(bj.getUTCHours()) + ':' + pad2(bj.getUTCMinutes())
      const a = bjPartsOf(at)
      const n = bjPartsOf(now)
      const days = Math.round((Date.UTC(a.y, a.m - 1, a.d) - Date.UTC(n.y, n.m - 1, n.d)) / 86400_000)
      if (days <= 0) return hm
      if (days === 1) return '明天 ' + hm
      return ['周日', '周一', '周二', '周三', '周四', '周五', '周六'][a.dow] + ' ' + hm
    }

    const getPath = (obj, path) => path.split('.').reduce((o, k) => (o == null ? undefined : o[k]), obj)
    const pct = (v) => Math.round((Number(v) || 0) * 100)
    // 和 src/features/companion.js 的 moodEffects 严丝合缝：心情区间 → 贴表情系数
    const REACT_MOOD_BANDS = [['85 以上', 1.6], ['70–84', 1.25], ['50–69', 1], ['35–49', 0.5], ['35 以下', 0.3]]
    const cx = (...a) => a.filter(Boolean).join(' ')
    // 音调存的是 '+20Hz' 这种字符串，滑条要数字；合法范围 ±80Hz（再往上 edge-tts 服务端会夹）
    const pitchNum = (s) => {
      const m = /^([+-]?\d+)Hz$/i.exec(String(s || ''))
      return m ? Math.max(-80, Math.min(80, Number(m[1]))) : 0
    }
    const pitchText = (n) => (n < 0 ? '-' : '+') + Math.abs(n) + 'Hz'
    const pitchLabel = (n) => (n === 0 ? '正常（+0Hz）' : (n > 0 ? '+' : '') + n + ' Hz')
    const timeAgo = (t) => {
      if (!t) return '—'
      const s = Math.round((Date.now() - t) / 1000)
      if (s < 60) return '刚刚'
      if (s < 3600) return Math.floor(s / 60) + ' 分钟前'
      if (s < 86400) return Math.floor(s / 3600) + ' 小时前'
      return new Date(t).toLocaleDateString()
    }

    // ---------------- 样式（只注入一次） ----------------















































































































































    /* @include parts */

    // 稳定的面板测试钩子：面板测试直接取组件，不再靠源码字符串注入。
    exports.__panelTest = { visibleTabs, TABS, TAB_CONTENT, Overview, WorkspaceNav, PageNav, MindSettings, MindMemory, MindPeople, MindSelf, MindNow, MindInner, MindLocalModel, DrawChatPermissions, Meter, MindInput, Row, Switch, Select, Card, Range, Btn, Empty, Skeleton, ErrorBlock, SaveBar, Field, SectionNav, Toaster, AB_TOAST, FIND_SECTIONS, ListArea }
    exports.apply = apply
    exports.inject = inject
    exports.AurabotPage = AurabotPage
    exports.WhaleIcon = WhaleIcon
    return module.exports
  },
})
