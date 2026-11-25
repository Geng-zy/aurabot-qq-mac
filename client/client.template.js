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
    const CSS = `
/* AuraBot workspace */
.ab-root{
  --ab-bg:#f2f3ee;--ab-card:#fffefa;--ab-card-2:#eef2eb;--ab-text:#212c27;--ab-sub:#4e6057;--ab-dim:#596b60;
  --ab-deep:#205b4a;--ab-sea:#2e7763;--ab-sky:#588b78;--ab-foam:#e9f2eb;--ab-foam-2:#dbece1;
  --ab-line:#e0e6dd;--ab-line-2:#c9d6cc;--ab-hover:#edf3ed;--ab-ok:#277a5c;--ab-warn:#99651e;--ab-err:#af4440;
  --ab-rail:#e8eee6;--ab-rail-label:#465b50;--ab-rail-active:#d8e8df;
  --ab-rail-ink:#243e34;--ab-rail-border:#cddbd1;--ab-rail-mark:#306a57;--ab-rail-mark-bg:#dce9df;--ab-rail-accent:#2e7763;
  --ab-shadow:0 1px 2px #18382a06,0 8px 26px #18382a06;--ab-radius:18px;
  --ab-quick:140ms;--ab-reveal:220ms;--ab-ease:cubic-bezier(.2,.75,.25,1);
  width:100%;height:100%;overflow:auto;box-sizing:border-box;container-type:inline-size;overscroll-behavior:contain;
  background:var(--ab-bg);color:var(--ab-text);font:13px/1.6 "Inter","PingFang SC",system-ui,sans-serif
}
body[data-ds-dark-theme] .ab-root{
  --ab-bg:#141b19;--ab-card:#1c2522;--ab-card-2:#242f2a;--ab-text:#edf2ec;--ab-sub:#b1c2b8;--ab-dim:#a0b4a9;
  --ab-deep:#afdec8;--ab-sea:#68b89e;--ab-sky:#82c6ae;--ab-foam:#263a32;--ab-foam-2:#304940;
  --ab-line:#303b35;--ab-line-2:#46564e;--ab-hover:#2a3630;--ab-ok:#91d9b2;--ab-warn:#ecc289;--ab-err:#f3a09b;
  --ab-rail:#191f1d;--ab-rail-label:#aebfb5;--ab-rail-active:#2a4037;
  --ab-rail-ink:#edf4ed;--ab-rail-border:#334039;--ab-rail-mark:#b6e5ce;--ab-rail-mark-bg:#29463b;--ab-rail-accent:#85c8ac;
  --ab-shadow:0 10px 28px #00000013;color-scheme:dark
}
.ab-root :focus-visible{outline:2px solid var(--ab-sky);outline-offset:3px}
.ab-root h1,.ab-root h2{letter-spacing:-.025em;color:inherit}
.ab-icon{display:block;width:18px;height:18px;flex:none;fill:none;stroke:currentColor;stroke-width:1.65;stroke-linecap:round;stroke-linejoin:round}
.ab-workspace{display:grid;grid-template-columns:188px minmax(0,1fr);min-height:100%;align-items:start}
.ab-rail{
  position:sticky;top:0;height:100vh;height:100dvh;max-height:100dvh;box-sizing:border-box;
  padding:calc(20px + var(--dsh-frame-top-clearance,0px)) 12px 16px;display:flex;flex-direction:column;gap:17px;
  background:var(--ab-rail);color:var(--ab-rail-ink);border-inline-end:1px solid var(--ab-rail-border);overflow:auto
}
.ab-wordmark,.ab-rail-item,.ab-build{font:inherit;color:inherit;border:0;background:none;cursor:pointer}
.ab-wordmark{display:flex;align-items:center;gap:9px;padding:0 4px;min-height:39px;text-align:left}
.ab-wordmark b{font-size:17px;letter-spacing:-.045em}
.ab-brand-mark{width:32px;height:32px;border:1px solid var(--ab-rail-border);border-radius:11px;display:grid;place-items:center;color:var(--ab-rail-mark);background:var(--ab-rail-mark-bg)}
.ab-work-nav{display:grid;gap:5px}
.ab-rail-item{display:flex;align-items:center;gap:9px;width:100%;min-height:41px;padding:7px 9px;border-radius:9px;text-align:left;color:var(--ab-rail-label);font-weight:530;white-space:nowrap}
.ab-rail-item .ab-icon{width:16px;height:16px}
.ab-rail-item:hover,.ab-rail-item.on{background:var(--ab-rail-active);color:var(--ab-rail-ink)}
.ab-rail-item.on{font-weight:650;box-shadow:inset 2px 0 var(--ab-rail-accent)}
.ab-rail-label{display:flex;align-items:center;justify-content:space-between;gap:5px;flex:1}
.ab-rail-label .ab-icon{width:13px;height:13px;opacity:.75;transform:rotate(-90deg);transition:transform var(--ab-reveal) var(--ab-ease)}
.ab-rail-item[aria-expanded=true] .ab-rail-label .ab-icon{transform:none}
.ab-nav-collapse{display:grid;grid-template-rows:0fr;opacity:0;transition:grid-template-rows var(--ab-reveal) var(--ab-ease),opacity var(--ab-quick) ease}
.ab-nav-collapse[data-expanded=true]{grid-template-rows:1fr;opacity:1}
.ab-nav-clip{min-height:0;overflow:clip}
.ab-stage-collapse{display:none}
.ab-rail-pages{display:grid;gap:2px;margin:4px 0 7px 15px;padding-inline-start:8px;border-inline-start:1px solid var(--ab-rail-border)}
.ab-rail-pages button{display:flex;align-items:center;gap:6px;min-height:29px;width:100%;padding:4px 8px;border:0;border-radius:6px;background:none;color:var(--ab-rail-label);text-align:left;font:inherit;font-size:12px;cursor:pointer;overflow-wrap:anywhere}
.ab-rail-pages button:hover,.ab-rail-pages button[aria-current]{background:var(--ab-rail-active);color:var(--ab-rail-ink)}
.ab-rail-pages button[aria-current]{font-weight:650}
.ab-build{display:flex;align-items:center;justify-content:space-between;margin-top:auto;padding:10px 6px 0;border-top:1px solid var(--ab-rail-border);font-size:11px;color:var(--ab-rail-label)}
.ab-build .ab-icon{width:13px;height:13px}
.ab-build:hover{color:var(--ab-rail-ink)}
.ab-stage{width:100%;max-width:1320px;margin:0 auto;padding:var(--dsh-frame-top-clearance,0px) clamp(20px,3.2cqi,48px) 36px;box-sizing:border-box;min-width:0}
.ab-standalone{max-width:800px;margin:0 auto;padding:calc(20px + var(--dsh-frame-top-clearance,0px)) 20px 28px}
.ab-topbar{position:sticky;top:var(--dsh-frame-top-clearance,0px);z-index:20;display:flex;justify-content:space-between;align-items:center;gap:12px;min-height:52px;background:var(--ab-bg);border-bottom:1px solid var(--ab-line);margin-bottom:13px}
.ab-breadcrumb,.ab-top-actions{display:flex;align-items:center;gap:9px;min-width:0}
.ab-breadcrumb{color:var(--ab-sub);font-size:12px}
.ab-breadcrumb b{color:var(--ab-text);overflow-wrap:anywhere}
.ab-breadcrumb .ab-icon{width:15px;height:15px;color:var(--ab-deep)}
.ab-top-actions{flex:none}
.ab-page-nav{display:none;gap:4px;flex-wrap:wrap;padding:0 0 7px;margin-bottom:12px;border-bottom:1px solid var(--ab-line)}
.ab-page-nav button{display:flex;align-items:center;gap:5px;min-height:32px;padding:4px 10px;border:0;border-radius:7px;background:none;color:var(--ab-sub);font:inherit;cursor:pointer}
.ab-page-nav button:hover{color:var(--ab-text);background:var(--ab-hover)}
.ab-page-nav button[aria-current]{font-weight:680;color:var(--ab-deep);background:var(--ab-foam-2)}
.ab-rail-pages button:focus-visible,.ab-page-nav button:focus-visible{outline-offset:-2px}
.ab-unsaved-dot{width:6px;height:6px;display:inline-block;border-radius:50%;background:#e0a75b;flex:none}
.ab-content{display:grid;gap:12px;min-width:0}
.ab-content>*{min-width:0}
.ab-page-title{font-size:clamp(22px,2.5cqi,28px);margin:0;font-weight:720;line-height:1.25}
.ab-card-head{display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:6px 12px;margin-bottom:10px}
.ab-card-head.with-desc{margin-bottom:4px}
.ab-card-head>*{min-width:0}
.ab-find,.ab-run{position:relative}
.ab-find-btn,.ab-run-btn{display:flex;align-items:center;gap:7px;min-height:34px;padding:5px 10px;border:1px solid var(--ab-line-2);border-radius:9px;background:var(--ab-card);color:var(--ab-text);font:inherit;font-size:12px;cursor:pointer;white-space:nowrap}
.ab-find-btn:hover,.ab-run-btn:hover{background:var(--ab-hover)}
.ab-find-btn{color:var(--ab-sub);min-width:clamp(175px,23cqi,260px);text-align:left}
.ab-find-btn kbd{margin-inline-start:auto}
.ab-find-btn .ab-icon,.ab-run-btn .ab-icon{width:14px;height:14px}
.ab-finder,.ab-run-pop{position:absolute;right:0;top:calc(100% + 8px);z-index:25;width:380px;max-width:85cqi;box-sizing:border-box;padding:8px;border:1px solid var(--ab-line-2);border-radius:13px;background:var(--ab-card);box-shadow:0 12px 35px #09181033}
.ab-finder .ab-input{width:100%}
.ab-finder-list{margin-top:6px;max-height:320px;overflow:auto;display:grid;gap:2px}
.ab-finder-item,.ab-run-option{display:flex;align-items:center;justify-content:space-between;gap:8px;width:100%;text-align:left;border:0;background:none;border-radius:8px;padding:7px 10px;color:var(--ab-text);font:inherit;cursor:pointer}
.ab-finder-item small,.ab-run-option small{color:var(--ab-sub);font-size:11.5px}
.ab-finder-item{display:grid;justify-content:start;gap:1px;line-height:1.4;overflow-wrap:anywhere}
.ab-finder-title{font-weight:630}
.ab-finder-item.on,.ab-finder-item:hover,.ab-run-option:hover,.ab-run-option[aria-pressed=true]{background:var(--ab-foam)}
.ab-finder-empty{padding:12px 10px;color:var(--ab-dim);font-size:12px}
.ab-run-pop{width:255px}
.ab-run-power{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:6px 8px 10px;margin-bottom:4px;border-bottom:1px solid var(--ab-line)}
.ab-run-option b,.ab-run-option small{display:block}
.ab-run-option:disabled{opacity:.65;cursor:wait}
.ab-mode-indicator{width:12px;height:12px;border:1px solid var(--ab-line-2);border-radius:50%;flex:none}
.ab-run-option[aria-pressed=true] .ab-mode-indicator{background:var(--ab-sea);border-color:var(--ab-sea);box-shadow:inset 0 0 0 2px var(--ab-card)}
.ab-pill{display:inline-flex;align-items:center;gap:6px;padding:2px 10px;border-radius:999px;font-size:12px;background:var(--ab-card-2);border:1px solid var(--ab-line);color:var(--ab-sub)}
.ab-dot{display:inline-block;width:7px;height:7px;border-radius:50%;background:var(--ab-dim);flex:none}
.ab-dot.ok{background:var(--ab-ok)}.ab-dot.warn{background:var(--ab-warn)}.ab-dot.err{background:var(--ab-err)}
.ab-grid{display:grid;gap:12px}
.ab-grid>*{min-width:0}
.ab-g2{grid-template-columns:repeat(auto-fit,minmax(min(100%,300px),1fr))}
.ab-g4{grid-template-columns:repeat(auto-fit,minmax(min(100%,150px),1fr))}
.ab-card{background:var(--ab-card);border:1px solid var(--ab-line);border-radius:14px;padding:16px 18px}
.ab-card h3{margin:0 0 4px;font-size:14px;font-weight:620;display:flex;align-items:center;gap:8px}
.ab-card .ab-desc{color:var(--ab-sub);font-size:12.5px;margin:0 0 12px}
.ab-card.ab-fold,.ab-fold-summary,.ab-anchor{scroll-margin-top:calc(64px + var(--dsh-frame-top-clearance,0px))}
.ab-card.ab-fold{padding:0;border-radius:12px;box-shadow:none}
.ab-fold-summary{display:flex;align-items:center;gap:9px;min-height:40px;padding:7px 13px;box-sizing:border-box;list-style:none;border-radius:11px;cursor:pointer;color:var(--ab-text);font-size:13px;font-weight:640}
.ab-fold-summary::-webkit-details-marker{display:none}
.ab-fold-summary .ab-icon{width:14px;height:14px;color:var(--ab-dim);transform:rotate(-90deg);transition:transform var(--ab-reveal) var(--ab-ease)}
.ab-fold-summary span{min-width:0;overflow-wrap:anywhere}
.ab-fold-summary:hover{background:var(--ab-hover)}
.ab-fold[open]>.ab-fold-summary{border-bottom:1px solid var(--ab-line);border-radius:11px 11px 0 0}
.ab-fold[open]>.ab-fold-summary .ab-icon{transform:none}
.ab-fold-body{padding:10px clamp(12px,2cqi,18px);min-width:0}
.ab-fold-body>.ab-card-head{justify-content:flex-end}
.ab-fold-body>.ab-desc{max-width:none;margin-bottom:8px}
.ab-fold-footer{display:flex;justify-content:flex-end;margin-top:10px}
.ab-about-project h3{font-size:clamp(17px,3cqi,23px)}
.ab-about-project .ab-desc{margin-top:6px}
.ab-about-project p{margin:0 0 16px}
.ab-about-links{display:flex;flex-wrap:wrap;gap:8px}
.ab-about-origin{display:grid;gap:12px;margin:0}
.ab-about-origin div+div{border-top:1px solid var(--ab-line);padding-top:12px}
.ab-about-origin dt{font-weight:600}
.ab-about-origin dd{margin:3px 0 0;color:var(--ab-sub);overflow-wrap:anywhere}
.ab-stat{padding:14px 16px}
.ab-stat .n{font-size:24px;font-weight:650;color:var(--ab-deep);font-variant-numeric:tabular-nums}
.ab-stat .l{color:var(--ab-sub);font-size:12px}
.ab-row{display:flex;align-items:center;gap:6px clamp(12px,2cqi,24px);min-height:32px;padding:8px 0;border-top:1px solid var(--ab-line);overflow-wrap:anywhere}
.ab-row:first-child{border-top:0}
.ab-row>.ab-label{flex:1 1 0;min-width:0;line-height:1.4}
.ab-row>.ab-label>b{display:block;color:var(--ab-text);font-weight:630}
.ab-row>.ab-label>small{display:block;color:var(--ab-sub);font-size:12px;line-height:1.5;margin-top:2px}
.ab-row>.ab-ctl{display:flex;align-items:center;justify-content:flex-end;gap:6px;flex-wrap:wrap;min-width:0;max-width:50%}
.ab-row.ab-block{flex-direction:column;align-items:stretch;gap:8px}
.ab-row.ab-block>.ab-label{max-width:none}
.ab-row.ab-block>.ab-ctl{max-width:none;justify-content:flex-start;flex:auto}
.ab-row>.ab-ctl:empty{display:none}
.ab-row>.ab-ctl>*{min-width:0;max-width:100%}
.ab-row:has(>.ab-ctl>.wide,>.ab-ctl .ab-range)>.ab-ctl{flex:0 1 min(46%,350px)}
.ab-row:has(>.ab-ctl textarea,>.ab-ctl .ab-choices){flex-direction:column;align-items:stretch}
.ab-row:has(>.ab-ctl textarea,>.ab-ctl .ab-choices)>.ab-ctl{max-width:none;justify-content:flex-start;flex:auto}
.ab-row input:not([type=checkbox],[type=range]),.ab-row .ab-sel-btn{min-height:32px}
.ab-row .ab-input.sm{width:80px}
.ab-row .ab-sel{width:230px;min-width:0}
.ab-row .ab-sel-pop{inset-inline: auto 0;width:max-content;max-width:min(320px,85cqi);box-sizing:border-box}
.ab-row .ab-sel-opt{white-space:normal}
.ab-row .ab-sel-opt .tx{min-width:0}
.ab-input,.ab-select,.ab-textarea{border:1px solid var(--ab-line-2);border-radius:8px;padding:6px 10px;background:var(--ab-card);color:var(--ab-text);font:inherit;outline:none;min-width:0;box-sizing:border-box}
.ab-input:focus,.ab-select:focus,.ab-textarea:focus{border-color:var(--ab-sea);box-shadow:0 0 0 3px var(--ab-foam-2)}
.ab-input{width:240px;max-width:100%}.ab-input.sm{width:90px}.ab-input.wide{width:100%}
.ab-textarea{width:100%;min-height:90px;resize:vertical;line-height:1.55;font-family:var(--dsh-font-family-code,ui-monospace,monospace);font-size:12.5px}
.ab-switch-row{display:flex;align-items:center;gap:10px}
.ab-seg{display:inline-flex;border:1px solid var(--ab-line-2);border-radius:9px;overflow:hidden}
.ab-seg button{border:0;background:transparent;padding:6px 14px;font:inherit;color:var(--ab-sub);cursor:pointer;border-left:1px solid var(--ab-line)}
.ab-seg button:first-child{border-left:0}
.ab-seg button.on{background:var(--ab-foam-2);color:var(--ab-deep);font-weight:600}
.ab-seg.off{opacity:.45}
.ab-seg.off button{cursor:not-allowed}
.ab-note{padding:10px 12px;border-radius:10px;background:var(--ab-foam);color:var(--ab-text);font-size:12.5px;border:1px solid var(--ab-foam-2)}
.ab-note.warn{background:rgba(191,135,0,.08);border-color:rgba(191,135,0,.25)}
.ab-note.err{background:rgba(207,34,46,.07);border-color:rgba(207,34,46,.25)}
.ab-steps{counter-reset:s;display:flex;flex-direction:column;gap:10px}
.ab-step{display:flex;gap:12px;align-items:flex-start}
.ab-step:before{counter-increment:s;content:counter(s);flex:none;width:22px;height:22px;border-radius:50%;background:var(--ab-foam-2);color:var(--ab-deep);font-weight:650;display:flex;align-items:center;justify-content:center;font-size:12px}
.ab-step.done:before{content:"✓";background:var(--ab-ok);color:#fff}
.ab-step > div{flex:1;min-width:0}
.ab-kv{display:grid;grid-template-columns:auto 1fr;gap:6px 14px;font-size:12.5px}
.ab-kv span:nth-child(odd){color:var(--ab-sub)}
.ab-stickers{display:grid;grid-template-columns:repeat(auto-fill,minmax(112px,1fr));gap:10px}
.ab-shots{display:grid;grid-template-columns:repeat(auto-fill,minmax(168px,1fr));gap:10px}
.ab-shot{border:1px solid var(--ab-line);border-radius:12px;padding:6px;background:var(--ab-card);display:flex;flex-direction:column;gap:6px;position:relative}
.ab-shot img{width:100%;aspect-ratio:16/9;object-fit:cover;border-radius:8px;background:var(--ab-card-2);display:block}
.ab-shot .cap{font-size:11px;color:var(--ab-dim);line-height:1.35;max-height:2.7em;overflow:hidden}
.ab-shot .x{position:absolute;top:10px;right:10px;opacity:0;transition:opacity .15s}
.ab-shot:hover .x{opacity:1}
.ab-sticker{border:1px solid var(--ab-line);border-radius:12px;padding:8px;background:var(--ab-card);display:flex;flex-direction:column;gap:6px;position:relative}
.ab-sticker img{width:100%;aspect-ratio:1;object-fit:contain;border-radius:8px;background:var(--ab-card-2)}
.ab-sticker .nm,.ab-sticker .tg{border:1px dashed transparent;background:transparent;text-align:center;width:100%;outline:none;padding:2px 4px;border-radius:6px;box-sizing:border-box}
.ab-sticker .nm{font-size:12px;color:var(--ab-text)}
.ab-sticker .tg{font-size:11px;color:var(--ab-dim);min-height:16px}
.ab-sticker:hover .nm,.ab-sticker:hover .tg{border-color:var(--ab-line)}
.ab-sticker .nm:focus,.ab-sticker .tg:focus{background:var(--ab-card-2);border-style:solid;border-color:var(--ab-line)}
.ab-sticker.pick{cursor:pointer}
.ab-sticker.on{border-color:var(--ab-sea);box-shadow:0 0 0 2px var(--ab-foam-2)}
.ab-sticker .ck{position:absolute;top:6px;left:6px;z-index:2;width:20px;height:20px;border-radius:7px;border:1.5px solid var(--ab-line-2);background:var(--ab-card);display:flex;align-items:center;justify-content:center;font-size:12px;font-weight:700;line-height:1;color:#fff;transition:background .12s,border-color .12s}
.ab-sticker.on .ck{background:var(--ab-sea);border-color:var(--ab-sea)}
.ab-sticker.pick .nm,.ab-sticker.pick .tg{pointer-events:none}
.ab-stickers.picking .ab-sticker .x{display:none}
.ab-progress{height:6px;border-radius:999px;background:var(--ab-card-2);border:1px solid var(--ab-line);overflow:hidden;flex:1 1 140px;min-width:110px}
.ab-progress > i{display:block;height:100%;border-radius:999px;background:linear-gradient(90deg,var(--ab-sky),var(--ab-sea));transition:width .3s}
.ab-sticker .x{position:absolute;top:4px;right:4px;opacity:0;transition:opacity .15s}
.ab-sticker:hover .x{opacity:1}
.ab-list{display:flex;flex-direction:column}
.ab-li{display:flex;flex-wrap:wrap;gap:7px 16px;align-items:flex-start;padding:10px 0;border-top:1px solid var(--ab-line)}
.ab-li:first-child{border-top:0}
.ab-li .meta{flex:0 1 12em;color:var(--ab-dim);font-size:11.5px;overflow-wrap:anywhere}
.ab-li .body{flex:1 1 16rem;min-width:0;white-space:pre-wrap;overflow-wrap:anywhere}
.ab-li>.ab-flex{flex:0 1 auto;flex-wrap:wrap;max-width:100%}
.ab-platform-row .meta{display:flex;align-items:center;gap:6px;flex:1 1 15em}
.ab-platform-caps{display:flex;flex-wrap:wrap;gap:4px;flex:1 1 16rem;align-items:center}
.ab-platform-chip{font-size:10.5px;line-height:1.8;padding:0 7px;border:1px solid var(--ab-line);border-radius:999px;background:var(--ab-foam);color:var(--ab-sub)}
.ab-platform-actions{display:flex;gap:6px;flex-wrap:wrap;margin-left:auto}
.ab-badge.ok{background:var(--ab-ok)}
.ab-logs{font-family:var(--dsh-font-family-code,ui-monospace,monospace);font-size:12px;max-height:520px;overflow:auto;border-radius:10px;background:var(--ab-card-2);padding:8px 0}
.ab-log{display:flex;gap:10px;padding:2px 12px;align-items:baseline}
.ab-log:hover{background:var(--ab-hover)}
.ab-log .t{color:var(--ab-dim);flex:none}
.ab-log .a{flex:none;color:var(--ab-sea);min-width:62px}
.ab-log .m{flex:1;min-width:0;white-space:pre-wrap;word-break:break-word}
.ab-log.warn .m{color:var(--ab-warn)}.ab-log.error .m{color:var(--ab-err)}.ab-log.debug .m{color:var(--ab-dim)}
.ab-persona{display:grid;grid-template-columns:240px minmax(0,1fr);gap:12px}
.ab-persona>*{min-width:0}
.ab-pm{display:grid;gap:12px;min-width:0;overflow-wrap:anywhere}
.ab-pm-head{display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap}
.ab-pm-count{color:var(--ab-sub);font-size:12.5px}
.ab-pm-face{flex:none;display:flex;align-items:center;justify-content:center;width:36px;height:36px;border-radius:50%;overflow:hidden;font-weight:620;font-size:14px;color:#fff;background:var(--ab-sea)}
.ab-pm-face img{width:100%;height:100%;object-fit:cover;display:block}
.ab-pm-face.big{width:64px;height:64px;font-size:24px}
.ab-pm-split{display:grid;grid-template-columns:272px minmax(0,1fr);gap:12px;align-items:start}
.ab-pm-list{display:flex;flex-direction:column;border:1px solid var(--ab-line);border-radius:14px;background:var(--ab-card);overflow:visible;position:sticky;top:64px;z-index:1;max-height:calc(100vh - 96px)}
.ab-pm-search{position:relative;z-index:2;padding:10px;border-bottom:1px solid var(--ab-line)}
.ab-pm-search input{width:100%;box-sizing:border-box}
.ab-pm-search .ab-sel{flex:1 1 100px;min-width:0;max-width:100%}
.ab-pm-search .ab-sel-pop{box-sizing:border-box;min-width:max(100%,160px);max-width:min(320px,calc(100vw - 32px))}
.ab-pm-search .ab-sel:last-child .ab-sel-pop{left:auto;right:0}
.ab-pm-search .ab-sel-opt .tx{white-space:normal;overflow-wrap:anywhere}
.ab-pm-rows{overflow-y:auto;min-height:0;padding:4px}
.ab-pm-row{display:flex;align-items:center;gap:10px;width:100%;padding:8px;border:0;border-radius:10px;background:none;color:inherit;font:inherit;text-align:left;cursor:pointer}
.ab-pm-row:hover{background:var(--ab-card-2)}
.ab-pm-row.on{background:var(--ab-foam-2)}
.ab-pm-row .who{min-width:0;flex:1}
.ab-pm-row .name{display:flex;align-items:center;gap:6px;font-size:13.5px;font-weight:600}
.ab-pm-row .name span:first-child{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.ab-pm-row .line{color:var(--ab-sub);font-size:12px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;margin-top:1px}
.ab-pm-own{flex:none;padding:0 6px;border-radius:999px;font-size:11px;font-weight:500;color:var(--ab-deep);background:var(--ab-foam-2)}
.ab-pm-detail{display:grid;gap:12px;min-width:0}
.ab-pm-hero{display:flex;gap:14px;align-items:flex-start;padding:18px;border:1px solid var(--ab-line);border-radius:14px;background:linear-gradient(120deg,var(--ab-foam-2),transparent 70%),var(--ab-card)}
.ab-pm-hero .body{min-width:0;flex:1}
.ab-pm-hero h3{margin:0;font-size:18px;font-weight:640}
.ab-pm-hero .meta{color:var(--ab-sub);font-size:12px;margin-top:2px}
.ab-pm-hero .quote{margin:10px 0 0;font-size:14px;line-height:1.65;white-space:pre-wrap}
.ab-pm-hero .quote.empty{color:var(--ab-dim)}
.ab-pm-traits{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,180px),1fr));gap:10px}
.ab-pm-trait{padding:12px 14px;border:1px solid var(--ab-line);border-radius:12px;background:var(--ab-card);min-width:0}
.ab-pm-trait .k{color:var(--ab-sub);font-size:12px}
.ab-pm-trait .v{margin-top:3px;font-size:13.5px;line-height:1.55}
.ab-pm-trait .v.empty{color:var(--ab-dim)}
.ab-pm-form{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,220px),1fr));gap:10px 14px}
.ab-pm-form label{display:block;min-width:0;color:var(--ab-sub);font-size:12px}
.ab-pm-form textarea{display:block;width:100%;box-sizing:border-box;margin-top:4px;font-family:inherit}
.ab-pm-form .full{grid-column:1/-1}
.ab-pm-fact{display:flex;gap:10px;padding:10px 0;border-top:1px solid var(--ab-line);min-width:0}
.ab-pm-fact:first-child{border-top:0;padding-top:2px}
.ab-pm-fact.old{opacity:.6}
.ab-pm-dot{flex:none;width:7px;height:7px;margin-top:7px;border-radius:50%;background:var(--ab-line-2)}
.ab-pm-dot.t0{background:var(--ab-gold,#d4a44c)}.ab-pm-dot.t3{background:var(--ab-deep)}.ab-pm-dot.t2{background:var(--ab-sea)}
.ab-pm-fact .main{min-width:0;flex:1}
.ab-pm-fact .text{font-size:13.5px;line-height:1.55;white-space:pre-wrap}
.ab-pm-fact.old .text{text-decoration:line-through}
.ab-pm-fact .sub{display:flex;gap:6px;flex-wrap:wrap;align-items:center;margin-top:3px;color:var(--ab-sub);font-size:12px}
.ab-pm-tag{padding:0 6px;border-radius:999px;font-size:11px;background:var(--ab-card-2);border:1px solid var(--ab-line)}
.ab-pm-tag.warn{color:var(--ab-warn)}
.ab-pm-acts{flex:none;display:flex;gap:4px;opacity:0;transition:opacity .12s}
.ab-pm-fact:hover .ab-pm-acts,.ab-pm-fact:focus-within .ab-pm-acts,.ab-pm-tl-item:hover .ab-pm-acts,.ab-pm-tl-item:focus-within .ab-pm-acts{opacity:1}
.ab-pm-link{border:0;background:none;padding:2px 4px;color:var(--ab-sub);font:inherit;font-size:12px;cursor:pointer;border-radius:6px}
.ab-pm-link:hover{background:var(--ab-card-2);color:var(--ab-text,inherit)}
.ab-pm-link.danger:hover{color:var(--ab-err)}
.ab-pm-groups{display:grid;grid-template-columns:repeat(auto-fill,minmax(min(100%,300px),1fr));gap:12px}
.ab-pm-group{display:flex;flex-direction:column;gap:8px;padding:16px;border:1px solid var(--ab-line);border-radius:14px;background:var(--ab-card);min-width:0}
.ab-pm-group .top{display:flex;align-items:baseline;justify-content:space-between;gap:8px}
.ab-pm-group .name{font-size:12.5px;color:var(--ab-sub)}
.ab-pm-group .vibe{font-size:16px;font-weight:620;line-height:1.4}
.ab-pm-group .vibe.empty{color:var(--ab-dim);font-weight:500;font-size:14px}
.ab-pm-group .chips{display:flex;flex-wrap:wrap;gap:5px}
.ab-pm-chip{padding:1px 8px;border-radius:999px;font-size:12px;color:var(--ab-deep);background:var(--ab-foam-2)}
.ab-pm-group .note{font-size:13px;line-height:1.55;color:var(--ab-sub)}
.ab-pm-group .foot{display:flex;align-items:center;justify-content:space-between;margin-top:auto;padding-top:4px;color:var(--ab-dim);font-size:12px}
.ab-pm-filters{display:flex;gap:8px;flex-wrap:wrap}
.ab-pm-filters .ab-select{max-width:100%}
.ab-pm-tl{position:relative;padding-left:20px}
.ab-pm-tl:before{content:"";position:absolute;left:5px;top:6px;bottom:6px;width:1px;background:var(--ab-line-2)}
.ab-pm-tl-day{position:relative;margin:14px 0 6px;color:var(--ab-sub);font-size:12px;font-weight:600}
.ab-pm-tl-day:first-child{margin-top:0}
.ab-pm-tl-item{position:relative;display:flex;gap:8px;padding:6px 0;min-width:0}
.ab-pm-tl-item:before{content:"";position:absolute;left:-18px;top:13px;width:7px;height:7px;border-radius:50%;background:var(--ab-card);box-shadow:0 0 0 2px var(--ab-sea)}
.ab-pm-tl-item .main{min-width:0;flex:1}
.ab-pm-tl-item .text{font-size:13.5px;line-height:1.6}
.ab-pm-tl-item .from{color:var(--ab-dim);font-size:12px;margin-top:1px}
.ab-pm-tl-item.feel:before{left:-20px;top:14px;width:11px;height:11px;background:var(--ab-deep);box-shadow:0 0 0 3px var(--ab-foam-2)}
.ab-pm-tl-item.feel .text{font-size:16px;font-weight:600;color:var(--ab-deep)}
@media (max-width:760px){
.ab-pm-split{grid-template-columns:minmax(0,1fr)}
.ab-pm-list{position:static;max-height:none}
.ab-pm-split.open .ab-pm-list{display:none}
.ab-pm-acts{opacity:1}
}
@media (min-width:761px){.ab-pm-back{display:none}}
.ab-memory-entry .ab-flex{margin-top:5px}
.ab-plist{display:flex;flex-direction:column;gap:6px}
.ab-pitem{text-align:left;border:1px solid var(--ab-line);background:var(--ab-card);border-radius:10px;padding:10px 12px;cursor:pointer;color:var(--ab-text);font:inherit}
.ab-pitem:hover{border-color:var(--ab-line-2)}
.ab-pitem.on{border-color:var(--ab-sea);box-shadow:0 0 0 3px var(--ab-foam)}
.ab-pitem .nm{font-weight:600;display:flex;align-items:center;gap:6px}
.ab-pitem .tg{color:var(--ab-dim);font-size:11.5px;margin-top:2px}
.ab-badge{font-size:10.5px;padding:0 6px;border-radius:999px;background:var(--ab-sea);color:#fff;font-weight:500}
.ab-psecs{display:flex;flex-direction:column;gap:10px;margin-top:12px}
.ab-psec{--c:var(--ab-sea);position:relative;overflow:hidden;border:1px solid var(--ab-line);border-radius:14px;background:var(--ab-card);background:radial-gradient(120% 140% at 0 0,color-mix(in srgb,var(--c) 7%,transparent),transparent 46%),var(--ab-card);transition:border-color .2s,box-shadow .2s}
.ab-psec:before{content:"";position:absolute;left:0;top:14px;bottom:14px;width:3px;border-radius:0 3px 3px 0;background:var(--c);background:linear-gradient(180deg,var(--c),color-mix(in srgb,var(--c) 18%,transparent))}
.ab-psec:hover{border-color:color-mix(in srgb,var(--c) 22%,var(--ab-line))}
.ab-psec:focus-within{border-color:var(--c);border-color:color-mix(in srgb,var(--c) 38%,var(--ab-line));box-shadow:0 0 0 3px var(--ab-foam);box-shadow:0 0 0 4px color-mix(in srgb,var(--c) 8%,transparent),0 6px 18px -10px color-mix(in srgb,var(--c) 45%,transparent)}
.ab-psec-head{display:flex;align-items:center;gap:4px;padding:10px 8px 0 18px}
.ab-psec-head:before{content:"";flex:none;width:6px;height:6px;border-radius:50%;background:var(--c);margin-right:8px;opacity:.9}
.ab-psec-title{flex:1;min-width:0;border:0;background:transparent;font:inherit;font-weight:600;font-size:13.5px;letter-spacing:.02em;color:var(--ab-text);color:color-mix(in srgb,var(--c) 42%,var(--ab-text));padding:4px 0;outline:none}
.ab-psec-title::placeholder{color:var(--ab-dim);font-weight:400}
.ab-psec-fixed{flex:1;min-width:0;font-weight:620;font-size:13.5px;padding:4px 0}
.ab-psec-fixed small{font-weight:400;color:var(--ab-dim);margin-left:8px;font-size:11.5px}
.ab-psec-n{font-size:11px;color:var(--ab-dim);font-variant-numeric:tabular-nums;margin-right:4px}
.ab-psec-act{display:flex;align-items:center;gap:2px;opacity:.5;transition:opacity .12s}
.ab-psec:hover .ab-psec-act,.ab-psec:focus-within .ab-psec-act{opacity:1}
.ab-ibtn{width:26px;height:26px;display:inline-flex;align-items:center;justify-content:center;border:0;border-radius:7px;background:transparent;color:var(--ab-sub);cursor:pointer;padding:0}
.ab-ibtn svg{width:14px;height:14px;fill:none;stroke:currentColor;stroke-width:1.8;stroke-linecap:round;stroke-linejoin:round}
.ab-ibtn:hover{background:var(--ab-hover);color:var(--ab-text)}
.ab-ibtn.danger:hover{color:var(--ab-err)}
.ab-ibtn:disabled{opacity:.3;cursor:default;background:transparent}
.ab-aibtn{display:inline-flex;align-items:center;gap:5px;height:26px;padding:0 10px;margin-left:2px;border:0;border-radius:7px;background:var(--ab-foam);color:var(--ab-deep);font:inherit;font-size:12px;cursor:pointer;transition:background .12s}
.ab-aibtn:hover,.ab-aibtn.on{background:var(--ab-foam-2)}
.ab-psec .ab-aibtn{background:transparent;color:var(--ab-sub);opacity:.5;transition:opacity .12s,background .12s,color .12s}
.ab-psec:hover .ab-aibtn,.ab-psec:focus-within .ab-aibtn{opacity:1}
.ab-psec .ab-aibtn:hover,.ab-psec .ab-aibtn:disabled{background:color-mix(in srgb,var(--c) 10%,transparent);color:color-mix(in srgb,var(--c) 65%,var(--ab-text));opacity:1}
.ab-aibtn svg{width:13px;height:13px;fill:none;stroke:currentColor;stroke-width:1.8;stroke-linecap:round;stroke-linejoin:round}
.ab-psec textarea{display:block;width:100%;box-sizing:border-box;border:0;background:transparent;resize:vertical;outline:none;padding:6px 16px 12px 30px;font:inherit;font-size:13px;line-height:1.75;color:var(--ab-text)}
.ab-psec textarea::placeholder{color:var(--ab-dim)}
.ab-psec.cmp{border-color:var(--c);border-color:color-mix(in srgb,var(--c) 45%,var(--ab-line));box-shadow:0 0 0 3px var(--ab-foam);box-shadow:0 0 0 4px color-mix(in srgb,var(--c) 10%,transparent)}
.ab-chip.on{border-style:solid;border-color:var(--ab-sea);background:var(--ab-foam-2);color:var(--ab-deep);font-weight:600}
.ab-chip .n{margin-left:6px;font-size:11px;color:var(--ab-dim);font-weight:400}
.ab-tf-who{margin-top:8px;font-size:12px;color:var(--ab-sub);line-height:1.6}
.ab-psec.cmp textarea{cursor:default}
.ab-compare{display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin:0 12px 12px;padding:8px 8px 8px 12px;border-radius:10px;background:var(--ab-foam)}
.ab-compare-tag{font-size:11.5px;font-weight:600;color:var(--ab-deep);padding:1px 8px;border-radius:999px;background:var(--ab-card);border:1px solid var(--ab-foam-2)}
.ab-psec-add{display:flex;align-items:center;gap:6px;flex-wrap:wrap;margin-top:12px}
.ab-chip{border:1px dashed var(--ab-line-2);background:transparent;color:var(--ab-sub);border-radius:999px;padding:3px 12px;font:inherit;font-size:12px;cursor:pointer;transition:border-color .12s,color .12s,background .12s}
.ab-chip:hover{border-color:var(--ab-sea);color:var(--ab-deep);background:var(--ab-foam)}
.ab-chip.solid{border-style:solid}
.ab-mood{height:10px;border-radius:999px;background:var(--ab-card-2);overflow:hidden;border:1px solid var(--ab-line)}
.ab-mood > i{display:block;height:100%;border-radius:999px;background:linear-gradient(90deg,var(--ab-sky),var(--ab-sea))}
.ab-savebar{position:sticky;bottom:12px;margin-top:16px;display:flex;align-items:center;gap:12px;padding:10px 14px;border-radius:12px;background:var(--ab-card);border:1px solid var(--ab-sea);box-shadow:0 6px 24px rgba(0,0,0,.12);z-index:6}
.ab-savebar .msg{flex:1;color:var(--ab-deep);font-weight:560}
.ab-empty{padding:28px 12px;text-align:center;color:var(--ab-dim)}
.ab-empty .big{font-size:28px;margin-bottom:4px}
.ab-table{width:100%;border-collapse:collapse;font-size:12.5px}
.ab-table th{text-align:left;color:var(--ab-sub);font-weight:500;padding:6px 8px;border-bottom:1px solid var(--ab-line)}
.ab-table td{padding:6px 8px;border-bottom:1px solid var(--ab-line)}
.ab-flex{display:flex;align-items:center;gap:8px;flex-wrap:wrap}
.ab-spacer{flex:1}
.ab-muted{color:var(--ab-sub)}
.ab-small{font-size:12px}
.ab-section-title{font-size:12px;font-weight:600;color:var(--ab-dim);letter-spacing:.06em;margin:18px 2px 8px}
/* token 用量面板：指标卡 + 小标签 + 数字右对齐，别糊成一坨 */
.ab-utiles{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:10px}
.ab-utile{background:var(--ab-foam);border:1px solid var(--ab-line);border-radius:var(--ab-radius);padding:10px 12px}
.ab-utile .k{font-size:11.5px;color:var(--ab-sub);letter-spacing:.02em}
.ab-utile .v{font-size:23px;font-weight:700;color:var(--ab-deep);line-height:1.25;font-variant-numeric:tabular-nums}
.ab-utile .s{font-size:11.5px;color:var(--ab-sub);margin-top:2px;font-variant-numeric:tabular-nums}
.ab-utile.hi{border-color:rgba(30,120,200,.35);background:linear-gradient(160deg,rgba(30,120,200,.10),transparent 70%)}
.ab-utile.pick{cursor:pointer;transition:border-color .15s,transform .15s}
.ab-utile.pick:hover{border-color:rgba(30,120,200,.45);transform:translateY(-1px)}
.ab-utile.pick:focus-visible{outline:2px solid var(--ab-sea);outline-offset:2px}
.ab-utile-cur{font-size:11px;color:var(--ab-sea);font-weight:600}
.ab-upills{display:flex;gap:8px;flex-wrap:wrap;margin-top:12px}
.ab-upill{background:var(--ab-foam);border:1px solid var(--ab-line);border-radius:999px;padding:3px 10px;font-size:11.5px;color:var(--ab-sub);font-variant-numeric:tabular-nums}
.ab-upill b{color:var(--ab-deep);font-weight:600}
.ab-upill.warn{background:rgba(191,135,0,.08);border-color:rgba(191,135,0,.25);color:var(--ab-text)}
.ab-table.num th:not(:first-child),.ab-table.num td:not(:first-child){text-align:right}
.ab-table.num td:not(:first-child){font-variant-numeric:tabular-nums}
.ab-table.num .money{font-weight:600;color:var(--ab-deep)}
.ab-table.num tbody tr:last-child td{border-bottom:0}
.ab-sel{position:relative;display:inline-block;min-width:200px;max-width:100%}
.ab-sel-btn{width:100%;display:flex;align-items:center;gap:8px;border:1px solid var(--ab-line-2);border-radius:9px;padding:6px 10px;background:var(--ab-card);color:var(--ab-text);font:inherit;cursor:pointer;text-align:left}
.ab-sel-btn:hover{border-color:var(--ab-sky)}
.ab-sel-btn:focus-visible,.ab-sel.open .ab-sel-btn{outline:none;border-color:var(--ab-sea);box-shadow:0 0 0 3px var(--ab-foam-2)}
.ab-sel-btn .v{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.ab-sel-btn .chev{flex:none;color:var(--ab-dim);transition:transform .15s}
.ab-sel.open .chev{transform:rotate(180deg)}
.ab-sel-pop{position:absolute;z-index:40;top:calc(100% + 6px);left:0;min-width:100%;max-height:300px;overflow:auto;padding:5px;border-radius:12px;background:var(--ab-card);border:1px solid var(--ab-line-2);box-shadow:0 12px 32px rgba(0,0,0,.16)}
.ab-sel-opt{display:flex;align-items:flex-start;gap:8px;padding:7px 10px;border-radius:8px;cursor:pointer;color:var(--ab-text);white-space:nowrap}
.ab-sel-opt .ck{width:14px;flex:none;color:var(--ab-sea);font-weight:700}
.ab-sel-opt .tx{flex:1;min-width:0}
.ab-sel-opt .ds{display:block;font-size:11.5px;color:var(--ab-dim);margin-top:1px;white-space:normal}
.ab-sel-opt.act{background:var(--ab-hover)}
.ab-sel-opt.on{background:var(--ab-foam);color:var(--ab-deep);font-weight:560}
.ab-sel-group{font-size:11px;color:var(--ab-dim);padding:6px 10px 2px;letter-spacing:.04em}
.ab-choices{display:grid;grid-template-columns:repeat(auto-fill,minmax(170px,1fr));gap:8px;width:100%}
.ab-choice{border:1px solid var(--ab-line-2);border-radius:12px;padding:10px 12px;background:var(--ab-card);cursor:pointer;text-align:left;font:inherit;color:var(--ab-text);transition:border-color .12s,box-shadow .12s}
.ab-choice:hover{border-color:var(--ab-sky)}
.ab-choice.on{border-color:var(--ab-sea);box-shadow:0 0 0 3px var(--ab-foam);background:linear-gradient(var(--ab-foam),var(--ab-foam)),var(--ab-card)}
.ab-choice b{display:flex;align-items:center;gap:6px;font-weight:600}
.ab-choice small{display:block;color:var(--ab-dim);font-size:11.5px;margin-top:3px;line-height:1.45}
.ab-tab .dirty{width:6px;height:6px;border-radius:50%;background:var(--ab-warn)}
.ab-kbd{font-family:var(--dsh-font-family-code,monospace);font-size:11px;padding:0 5px;border:1px solid var(--ab-line-2);border-radius:5px;color:var(--ab-dim)}
.ab-spin{display:inline-block;width:12px;height:12px;border:2px solid currentColor;border-right-color:transparent;border-radius:50%;animation:abSpin .7s linear infinite;vertical-align:-2px}
@keyframes abSpin{to{transform:rotate(360deg)}}
.ab-drop{border:2px dashed var(--ab-line-2);border-radius:12px;padding:22px 16px;text-align:center;color:var(--ab-sub);cursor:pointer;transition:border-color .15s,background .15s}
.ab-drop:hover,.ab-drop:focus-visible{border-color:var(--ab-sky);outline:none}
.ab-drop.over{border-color:var(--ab-sea);background:var(--ab-foam);color:var(--ab-deep)}
.ab-wiz-bar{display:flex;gap:6px;margin-top:12px}
.ab-wiz-bar .seg{flex:1;border:0;background:transparent;padding:0;cursor:default;text-align:left;font:inherit;color:var(--ab-dim)}
.ab-wiz-bar .seg:before{content:"";display:block;height:4px;border-radius:999px;background:var(--ab-line-2);margin-bottom:6px}
.ab-wiz-bar .seg.done{cursor:pointer;color:var(--ab-sub)}.ab-wiz-bar .seg.done:before{background:var(--ab-sky)}
.ab-wiz-bar .seg.on{color:var(--ab-deep);font-weight:600}.ab-wiz-bar .seg.on:before{background:var(--ab-sea)}
.ab-wiz-bar .seg span{font-size:11.5px}
@media (max-width:640px){.ab-wiz-bar .seg span{display:none}}
.ab-range{display:flex;align-items:center;gap:10px;width:min(100%,320px)}
.ab-range input[type=range]{flex:1;min-width:0;accent-color:var(--ab-sea)}
.ab-range .val{min-width:48px;text-align:right;font-variant-numeric:tabular-nums;color:var(--ab-deep);font-weight:600}
/* ---------- 美化 ---------- */
.ab-pill{background:var(--ab-card);box-shadow:0 1px 1px rgba(15,40,80,.04)}
.ab-grid{gap:12px}
.ab-card{border-radius:var(--ab-radius);padding:18px 20px;box-shadow:var(--ab-shadow);transition:box-shadow .15s}
.ab-card h3{margin:0;font-size:16px;font-weight:670;color:var(--ab-text);overflow-wrap:anywhere}
.ab-card .ab-desc{max-width:78ch;margin:0 0 14px;line-height:1.65;overflow-wrap:anywhere}
.ab-card:has(>.ab-row){padding-block:12px 4px;padding-inline:clamp(12px,2cqi,20px);border-radius:12px;box-shadow:none}
.ab-card:has(>.ab-row)>.ab-card-head{margin-bottom:7px}
.ab-card:has(>.ab-row)>.ab-card-head h3{font-size:15px;line-height:1.4}
.ab-card:has(>.ab-row)>.ab-card-head h3::before{content:"";width:3px;height:14px;flex:none;border-radius:2px;background:var(--ab-sea)}
.ab-card:has(>.ab-row)>.ab-desc{max-width:none;margin-bottom:9px;line-height:1.5}
.ab-row .ab-choices{grid-template-columns:repeat(auto-fit,minmax(min(100%,125px),1fr));gap:6px}
.ab-row .ab-choice{padding:6px 9px;border-radius:8px}
.ab-row .ab-choice small{margin-top:1px}
.ab-stat{position:relative;overflow:hidden;padding:13px 15px;background:var(--ab-card-2);box-shadow:none}
.ab-stat .ic{position:absolute;right:14px;top:12px;font-size:22px;opacity:.9}
.ab-stat .n{font-size:28px;line-height:1.2}
.ab-range{max-width:440px}
.ab-range .val{min-width:0;padding:1px 9px;border-radius:999px;background:var(--ab-foam);font-size:12px;white-space:nowrap}
.ab-range input[type=range]{height:4px}
.ab-input,.ab-select,.ab-textarea,.ab-sel-btn{border-radius:10px;transition:border-color .12s,box-shadow .12s}
.ab-input:hover,.ab-textarea:hover{border-color:var(--ab-sky)}
.ab-textarea{font-family:inherit;font-size:13px}


.ab-link-btn{display:inline-flex;align-items:center;gap:6px;padding:3px 10px;border-radius:8px;border:1px solid var(--ab-line-2);color:var(--ab-text);text-decoration:none;font-size:12px}
.ab-danger{color:var(--ab-err)}
.ab-note{border-radius:12px;padding:11px 14px;line-height:1.6}
.ab-choice{border-radius:14px;padding:12px 14px}
.ab-choice.on b{color:var(--ab-deep)}
.ab-li{padding:12px 0}
.ab-sticker{border-radius:14px;transition:transform .12s,box-shadow .12s}
.ab-sticker:hover{transform:translateY(-2px);box-shadow:var(--ab-shadow)}
.ab-pitem{border-radius:12px;transition:border-color .12s,box-shadow .12s}
.ab-mood{height:12px}

.ab-logs{border-radius:12px;border:1px solid var(--ab-line)}
.ab-savebar{border-radius:14px;backdrop-filter:blur(8px)}
.ab-overview,.ab-now{display:grid;grid-template-columns:minmax(0,1fr);gap:16px;min-width:0}
.ab-cover{
  min-height:226px;display:grid;grid-template-columns:minmax(0,1fr) auto;align-items:center;gap:16px;overflow:hidden;
  padding:24px clamp(22px,4.6cqi,56px);border-radius:22px;color:#f9fcf2;
  background:linear-gradient(92deg,#123b35e8 0%,#10382f79 52%,#123c2c04),url('/aurabot/api/panel/sea') right 51%/cover,#17493f;
  box-shadow:0 8px 28px #123a2f24
}
.ab-cover h1{font-size:clamp(34px,4.9cqi,59px);line-height:1.1;margin:9px 0 10px;letter-spacing:-.035em;overflow-wrap:anywhere}
.ab-cover-meta{display:flex;align-items:center;gap:7px;flex-wrap:wrap;color:#edf6eb;font-size:12px;font-weight:600}
.ab-cover-meta .ab-dot{background:#c7d0c6}.ab-cover-meta .ab-dot.ok{background:#a5edbb}.ab-cover-meta .ab-dot.err{background:#ffa79e}.ab-cover-meta .ab-dot.warn{background:#f4cd96}
.ab-cover-copy p{display:flex;gap:8px 13px;flex-wrap:wrap;margin:0 0 17px;color:#dfede5;font-size:13px;overflow-wrap:anywhere}
.ab-cover-copy strong{color:#f7fcf0;font-weight:650}
.ab-cover-link,.ab-cover-portrait{cursor:pointer;font:inherit}
.ab-cover-link{display:inline-flex;align-items:center;gap:12px;min-height:36px;padding:5px 13px;border:1px solid #e4f1dca3;border-radius:8px;background:#eaf3e9;color:#1c3d32;font-weight:670;text-align:left}
.ab-cover-link:hover{background:#fffdf1}
.ab-cover-link .ab-icon{width:16px;height:16px}
.ab-cover-portrait{
  display:grid;place-items:center;width:clamp(96px,14cqi,174px);aspect-ratio:1;padding:9px;margin-right:clamp(0px,2cqi,36px);
  border:1px solid #fff4d8b0;border-radius:50%;background:#f6f3db34;box-shadow:0 0 0 7px #f6f3db22,0 18px 44px #0a2d2a44
}
.ab-cover-portrait img{width:100%;height:100%;min-width:0;aspect-ratio:1;object-fit:cover;object-position:50% 18%;border-radius:50%;clip-path:circle(50%);background:#f5f1df}
.ab-cover-portrait:hover{box-shadow:0 0 0 9px #f6f3db44,0 18px 44px #0a2d2a44}
.ab-section-heading{display:flex;align-items:center;justify-content:space-between;gap:8px;margin-bottom:10px}
.ab-section-heading h2{margin:0;color:var(--ab-text);font-size:16px;line-height:1.4;font-weight:700}
.ab-section-heading>span{color:var(--ab-sub);font-size:11.5px;text-align:right}
.ab-inline-link{display:flex;align-items:center;gap:5px;padding:3px 0;border:0;background:none;color:var(--ab-deep);font:inherit;font-size:12px;cursor:pointer}
.ab-inline-link:hover{text-decoration:underline}
.ab-inline-link .ab-icon{width:14px;height:14px}
.ab-inline-link[aria-expanded=true] .ab-icon{transform:rotate(180deg)}
.ab-metrics{display:grid;grid-template-columns:repeat(5,minmax(0,1fr));margin:14px 0 0}
.ab-metric{min-width:0;padding:0 13px;border-inline-start:1px solid var(--ab-line);overflow-wrap:anywhere}
.ab-metric:first-child{border-inline-start:0;padding-inline-start:0}
.ab-metric dt{color:var(--ab-sub);font-size:12px}
.ab-metric dd{margin:2px 0 0;font-size:clamp(22px,2.9cqi,33px);font-weight:680;line-height:1.15;letter-spacing:-.035em;font-variant-numeric:tabular-nums}
.ab-overview-pair,.ab-now-detail{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:16px}
.ab-now-detail{align-items:start}
.ab-data-list{list-style:none;padding:0;margin:0}
.ab-data-list li+li{border-top:1px solid var(--ab-line)}
.ab-data-list li>div,.ab-data-list button{display:flex;align-items:center;gap:8px;min-height:40px;width:100%;box-sizing:border-box}
.ab-data-list button{padding:6px 0;border:0;background:none;color:inherit;font:inherit;text-align:left;cursor:pointer}
.ab-data-list button:hover{background:var(--ab-hover)}
.ab-data-list b{font-weight:620;flex:none}
.ab-data-list small{color:var(--ab-sub);font-size:11.5px;margin-left:auto;text-align:right;overflow-wrap:anywhere}
.ab-data-list .ab-icon{width:15px;height:15px;color:var(--ab-deep)}
.ab-recent .ab-logs{max-width:100%}
.ab-recent .ab-log{padding-block:4px}
.ab-recent .ab-log .m{white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.ab-scroll-table{overflow-x:auto}
.ab-now-lead{display:grid;grid-template-columns:minmax(0,.9fr) minmax(0,1.1fr);gap:16px;align-items:stretch}
.ab-now-mood{display:flex;flex-direction:column;padding:24px 23px;border:1px solid var(--ab-line-2);border-radius:var(--ab-radius);box-shadow:var(--ab-shadow);background:linear-gradient(145deg,var(--ab-foam-2),var(--ab-card) 88%);color:var(--ab-deep)}
.ab-now-heading{display:flex;align-items:center;gap:8px}
.ab-now-heading h1{font-size:clamp(25px,3.1cqi,37px);line-height:1.25;margin:0;font-weight:710}
.ab-now-heading .ab-icon{width:20px;height:20px}
.ab-now-label{display:flex;align-items:baseline;flex-wrap:wrap;gap:5px 9px;margin:13px 0 15px;color:var(--ab-sub);font-size:12px}
.ab-now-label strong{padding:3px 9px;border-radius:7px;background:var(--ab-foam-2);color:var(--ab-deep);font-size:13px;font-weight:650}
.ab-now-date{font-size:12px;color:var(--ab-sub);margin:7px 0 0}
.ab-now-mood dl{display:flex;gap:22px;margin:auto 0 0;padding-top:13px;border-top:1px solid var(--ab-line-2)}
.ab-now-mood dt{font-size:11.5px;color:var(--ab-sub)}
.ab-now-mood dd{font-size:19px;font-variant-numeric:tabular-nums;font-weight:650;margin:0}
.ab-vital+.ab-vital{margin-top:12px}
.ab-vital-label{display:flex;align-items:center;gap:7px;margin-bottom:4px}
.ab-vital-label b{font-weight:570}
.ab-vital-label .ab-icon{color:var(--ab-deep);width:15px;height:15px}
.ab-vital-label span{margin-left:auto;font-weight:620;color:var(--ab-sub);font-size:12px;font-variant-numeric:tabular-nums}
.ab-vital-meter{height:6px;background:var(--ab-card-2);border-radius:999px;overflow:hidden}
.ab-vital-meter i{display:block;height:100%;border-radius:inherit;background:var(--ab-sea)}
.ab-vital.warn .ab-vital-meter i{background:var(--ab-warn)}
.ab-body-foot{display:flex;align-items:center;justify-content:flex-end;gap:8px 12px;flex-wrap:wrap;margin-top:15px}
.ab-body-foot span{margin-right:auto;color:var(--ab-sub);font-size:11.5px}
.ab-feed-form{display:flex;gap:8px;align-items:center}
.ab-feed-form .ab-input{flex:1;width:auto}
.ab-feed-help{margin-top:12px;padding-top:9px;border-top:1px solid var(--ab-line);color:var(--ab-sub);font-size:12px}
.ab-feed-help summary{cursor:pointer;width:fit-content}
.ab-feed-help ul{padding-left:18px}
.ab-quiet{display:flex;align-items:center;gap:8px;min-height:67px;color:var(--ab-sub);font-size:13px}
.ab-quiet .ab-icon,.ab-feeling-mark{color:var(--ab-deep)}
.ab-feeling-list,.ab-emotion-history ol{margin:0;padding:0;list-style:none}
.ab-feeling-list li,.ab-emotion-history li{display:flex;align-items:flex-start;gap:9px;padding:8px 0}
.ab-feeling-list li+li,.ab-emotion-history li+li{border-top:1px solid var(--ab-line)}
.ab-feeling-list p{margin:3px 0 0}
.ab-feeling-mark{display:grid;place-items:center;width:28px;height:28px;border-radius:8px;background:var(--ab-foam);flex:none}
.ab-feeling-mark .ab-icon{width:14px;height:14px}
.ab-emotion-history li{flex-wrap:wrap}
.ab-emotion-history li span,.ab-emotion-history li small{color:var(--ab-sub);font-size:12px}
.ab-memory-totals{margin:0;grid-template-columns:repeat(4,minmax(0,1fr))}
.ab-memory-totals .ab-metric dd{font-size:24px}
.ab-memory-head{display:grid;grid-template-columns:minmax(0,1fr) minmax(230px,.57fr);gap:14px;align-items:stretch}
.ab-memory-summary{display:grid;gap:11px}
.ab-memory-summary .ab-row{padding:5px 0 0}
.ab-memory-summary .ab-ctl{justify-content:flex-end}
.ab-memory-head .ab-privacy{display:flex;flex-direction:column;justify-content:center}
.ab-memory-head .ab-privacy .ab-param-row .ab-ctl{align-self:center}
@container (max-width:820px){.ab-memory-head{grid-template-columns:minmax(0,1fr)}}
.ab-privacy{border-left:3px solid var(--ab-sea)}
.ab-card.ab-settings-tools{padding:10px 12px;border-radius:12px;box-shadow:none}
.ab-settings-nav{display:flex;flex-wrap:wrap;gap:3px;margin-top:8px;padding-top:7px;border-top:1px solid var(--ab-line)}
.ab-settings-nav button{min-height:28px;padding:3px 8px;border:0;border-radius:6px;background:none;color:var(--ab-sub);font:inherit;cursor:pointer}
.ab-settings-nav button:hover{background:var(--ab-hover);color:var(--ab-text)}
.ab-settings-nav button[aria-current=true]{background:var(--ab-foam-2);color:var(--ab-deep);font-weight:650}
.ab-settings-toolbar{display:flex;flex-wrap:wrap;justify-content:space-between;align-items:center;gap:7px 14px}
.ab-settings-toolbar .ab-input{max-width:360px;flex:1 1 180px}
.ab-param-row>.ab-label:has(>.ab-param-details)>small{display:inline}
.ab-param-details{display:inline;margin-inline-start:8px;color:var(--ab-sub);font-size:11.5px;overflow-wrap:anywhere}
.ab-param-details[open]{display:block;margin:4px 0 0}
.ab-param-details summary{display:inline;cursor:pointer;color:var(--ab-deep)}
.ab-param-details summary::before{content:"› ";font-weight:650}
.ab-param-details[open] summary::before{content:"⌄ "}
.ab-param-details p{margin:3px 0 0}
.ab-privacy .ab-row{border-top:0;padding:2px 0}
.ab-privacy .ab-param-row>.ab-ctl{flex:none}
.ab-people{display:grid;gap:16px}
.ab-allowlist{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));column-gap:16px}
.ab-allowlist>:not(.ab-row){grid-column:1/-1}
@container (max-width:660px){.ab-allowlist{grid-template-columns:minmax(0,1fr)}}
.ab-people-tools,.ab-people-search,.ab-person-head,.ab-person-meta,.ab-person-actions{display:flex;align-items:center}
.ab-people-tools{gap:12px;flex-wrap:wrap}
.ab-people-search{flex:1 1 240px;gap:9px;min-width:0;color:var(--ab-sub)}
.ab-people-search .ab-input{width:100%}
.ab-people-tools .ab-seg{flex:none}
.ab-people-grid,.ab-people-groups{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,350px),1fr));gap:13px;align-items:start}
.ab-person{display:grid;gap:13px;align-content:start;min-width:0;border:1px solid var(--ab-line);border-radius:16px;background:var(--ab-card);padding:clamp(14px,2cqi,22px);box-shadow:var(--ab-shadow)}
.ab-person.owner,.ab-person.expanded{grid-column:1/-1}
.ab-person.owner{border-color:color-mix(in srgb,var(--ab-sea) 39%,var(--ab-line));background:linear-gradient(120deg,var(--ab-foam),var(--ab-card) 72%)}
.ab-person-head{gap:12px;min-width:0}
.ab-person-head h2{margin:0;font-size:17px;line-height:1.25;overflow-wrap:anywhere}
.ab-person.owner h2{font-size:clamp(19px,2.55cqi,26px)}
.ab-person-id{flex:1;min-width:0}
.ab-person-mark{display:grid;place-items:center;width:39px;height:39px;flex:none;border:1px solid var(--ab-line-2);border-radius:12px;background:var(--ab-card-2);color:var(--ab-deep);font-weight:650}
.ab-person.owner .ab-person-mark{width:48px;height:48px;background:var(--ab-foam-2);border-color:transparent;font-size:20px}
.ab-person-meta{gap:4px 9px;flex-wrap:wrap;color:var(--ab-sub);font-size:11.5px;overflow-wrap:anywhere}
.ab-person-meta>span{min-width:0}
.ab-person-tag{display:inline-flex;align-items:center;min-height:18px;padding:1px 7px;border-radius:6px;background:var(--ab-card-2);color:var(--ab-sub);font-size:11px;font-weight:620}
.ab-person.owner .ab-person-tag{background:var(--ab-foam-2);color:var(--ab-deep)}
.ab-person-scores{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,70px),1fr));gap:6px;margin:0}
.ab-person-scores>div{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:5px;align-items:center;padding:6px 8px;border-radius:8px;background:color-mix(in srgb,var(--ab-card-2) 76%,var(--ab-card))}
.ab-person-scores dt{color:var(--ab-sub);font-size:11.5px}
.ab-person-scores dd{margin:0;color:var(--ab-deep);font-variant-numeric:tabular-nums;font-weight:670}
.ab-person-scores .track{grid-column:1/-1;height:3px;border-radius:4px;background:var(--ab-line-2);overflow:hidden}
.ab-person-scores .track>i{display:block;height:100%;border-radius:inherit;background:var(--ab-sea)}
.ab-person-note,.ab-person-field dd{margin:0;line-height:1.65;white-space:pre-wrap;overflow-wrap:anywhere}
.ab-person:not(.expanded) .ab-person-note{display:-webkit-box;-webkit-box-orient:vertical;-webkit-line-clamp:2;overflow:hidden}
.ab-person-actions{justify-content:flex-end;flex-wrap:wrap;gap:6px;border-top:1px solid var(--ab-line);padding-top:10px}
.ab-person-details{display:grid;gap:12px;border-top:1px solid var(--ab-line);padding-top:12px}
.ab-person-fields{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,220px),1fr));gap:10px 18px;margin:0}
.ab-person-field dt{color:var(--ab-sub);font-size:11.5px;font-weight:600;margin-bottom:2px}
.ab-person-follow{display:flex;justify-content:space-between;align-items:flex-start;gap:7px;flex-wrap:wrap;padding:5px 0;overflow-wrap:anywhere}
.ab-person-follow+ .ab-person-follow{border-top:1px solid var(--ab-line)}
.ab-person-edit{display:grid;gap:7px}
.ab-person-edit .ab-person-actions{border:0;padding:0}
.ab-people-group{min-width:0;padding:11px 13px;background:var(--ab-card-2);border-radius:10px;overflow-wrap:anywhere}
.ab-people-group p{margin:3px 0 0}
.ab-starmap{max-width:640px;margin:auto}
.ab-starmap svg{width:100%;height:auto;display:block}
.ab-starmap .orbit{fill:none;stroke:var(--ab-line-2);stroke-dasharray:2 6}
.ab-starmap .person-node:focus-visible{outline:none;opacity:1}
.ab-starmap .person-node:focus-visible circle{stroke:var(--ab-deep);stroke-width:3}
.ab-starmap-caption{margin:12px 0 0;text-align:center;color:var(--ab-sub);font-size:12px}
@container (max-width:930px){
  .ab-workspace{grid-template-columns:160px minmax(0,1fr)}
  .ab-stage{padding-inline:22px}
  .ab-data-list .ab-icon:last-child:not(:first-child){display:none}
}
@container (max-width:760px){
  .ab-workspace{display:block}
  .ab-rail{position:static;height:auto;max-height:none;padding:calc(8px + var(--dsh-frame-top-clearance,0px)) 15px 8px;gap:7px;overflow:visible;border-inline-end:0;border-bottom:1px solid var(--ab-rail-border)}
  .ab-wordmark{padding:0;min-height:32px}
  .ab-brand-mark{width:27px;height:27px;border-radius:8px}
  .ab-work-nav{display:flex;overflow-x:auto;gap:4px;padding:2px}
  .ab-work-nav>div{flex:1 0 auto}
  .ab-rail-collapse{display:none}
  .ab-stage-collapse{display:grid}
  .ab-page-nav{display:flex}
  .ab-rail-item{justify-content:center;gap:4px;padding:4px 6px;min-height:34px;font-size:11.5px}
  .ab-rail-label{flex:none;gap:3px}
  .ab-build{display:none}
  .ab-stage{padding:0 16px 24px}
  .ab-topbar{min-height:48px}
  .ab-persona{grid-template-columns:minmax(0,1fr)}
}
@container (max-width:520px){
  .ab-rail{padding-inline:8px}
  .ab-rail-item{flex-direction:column;gap:2px;min-height:45px;font-size:10.5px}
  .ab-rail-item>.ab-icon{width:15px;height:15px}
  .ab-rail-label .ab-icon{width:10px;height:10px}
  .ab-stage{padding-inline:12px}
  .ab-topbar{gap:5px}
  .ab-top-actions{gap:5px}
  .ab-find-btn,.ab-run-btn{padding-inline:7px;min-width:0}
  .ab-find-btn span,.ab-find-btn kbd{display:none}
  .ab-finder{right:-70px}
  .ab-page-nav{gap:3px}
  .ab-page-nav button{font-size:12px;padding-inline:8px}
  .ab-cover{min-height:175px;gap:9px;padding:16px}
  .ab-cover-meta{font-size:11px}
  .ab-cover h1{font-size:34px}
  .ab-cover-portrait{width:80px;margin-right:5px;padding:5px}
  .ab-cover-copy p{gap:4px 7px;font-size:11.5px}
  .ab-card{padding:14px}
  .ab-overview-pair,.ab-now-lead,.ab-now-detail{grid-template-columns:minmax(0,1fr)}
  .ab-metrics{grid-template-columns:repeat(3,minmax(0,1fr));row-gap:11px}
  .ab-memory-totals{grid-template-columns:repeat(2,minmax(0,1fr))}
  .ab-memory-totals .ab-metric:nth-child(3){border-inline-start:0;padding-inline-start:0}
  .ab-memory-totals .ab-metric:nth-child(4){border-inline-start:1px solid var(--ab-line);padding-inline-start:13px}
  .ab-activity .ab-metric:nth-child(4){border-inline-start:0;padding-inline-start:0}
  .ab-row:has(>.ab-ctl:not(:empty)):not(:has(>.ab-ctl>:only-child:is([role=switch],.sm,.ab-number-ctl))){flex-direction:column;align-items:stretch}
  .ab-row>.ab-ctl:not(:has(>:only-child:is([role=switch],.sm,.ab-number-ctl))){max-width:none;flex:auto;justify-content:flex-start}
  .ab-row .ab-sel-pop{inset-inline:0 auto;max-width:100%}
  .ab-li .meta{flex-basis:100%}
  .ab-li .body{flex-basis:100%}
  .ab-people-grid,.ab-people-groups{gap:10px}
  .ab-person-scores{grid-template-columns:repeat(auto-fit,minmax(min(100%,72px),1fr))}
  .ab-person-actions button{flex:0 1 auto}
  .ab-savebar{flex-wrap:wrap;gap:6px}
  .ab-savebar .msg{flex-basis:100%}
}
.ab-table th{font-size:12px;letter-spacing:.02em}
.ab-table tr:hover td{background:var(--ab-hover)}
.ab-checks{display:grid;grid-template-columns:repeat(auto-fill,minmax(190px,1fr));gap:8px}
.ab-check{display:flex;align-items:center;gap:8px;padding:8px 12px;border-radius:12px;border:1px solid var(--ab-line);background:var(--ab-card-2);color:var(--ab-sub);font-size:12.5px}
.ab-check i{font-style:normal;width:18px;height:18px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:11px;font-weight:700;background:var(--ab-line-2);color:#fff;flex:none}
.ab-check.done{color:var(--ab-text);border-color:color-mix(in srgb,var(--ab-ok) 30%,transparent);background:color-mix(in srgb,var(--ab-ok) 7%,var(--ab-card))}
.ab-check.done i{background:var(--ab-ok)}
.ab-drop{border-radius:14px;background:var(--ab-card-2)}
.ab-drives{display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:8px}
.ab-drive{display:flex;flex-direction:column;align-items:flex-start;gap:2px;text-align:left;padding:9px 12px;border-radius:12px;border:1px solid var(--ab-line-2);background:var(--ab-card);color:var(--ab-text);font:inherit;cursor:pointer;transition:border-color .12s,box-shadow .12s}
.ab-drive:hover{border-color:var(--ab-sky)}
.ab-drive.on{border-color:var(--ab-sea);box-shadow:0 0 0 3px var(--ab-foam);background:linear-gradient(var(--ab-foam),var(--ab-foam)),var(--ab-card)}
.ab-drive b{font-weight:600}.ab-drive small{color:var(--ab-dim);font-size:11.5px;word-break:break-all}
.ab-drive .bar{display:block;width:100%;height:4px;border-radius:999px;background:var(--ab-card-2);overflow:hidden;margin-top:4px}
.ab-drive .bar i{display:block;height:100%;background:var(--ab-sky)}
.ab-drive.low .bar i{background:var(--ab-warn)}
.ab-install{margin-top:12px;padding:14px 16px;border-radius:14px;border:1px solid var(--ab-foam-2);background:var(--ab-foam)}
.ab-install-steps{display:flex;gap:6px}
.ab-install-steps .st{flex:1;min-width:0;display:flex;flex-direction:column;align-items:center;gap:4px;font-size:11.5px;color:var(--ab-dim);text-align:center;position:relative}
.ab-install-steps .st:before{content:"";position:absolute;top:11px;left:-50%;right:50%;height:2px;background:var(--ab-line-2);z-index:0}
.ab-install-steps .st:first-child:before{display:none}
.ab-install-steps .st.done:before,.ab-install-steps .st.on:before{background:var(--ab-sea)}
.ab-install-steps .st i{position:relative;z-index:1;font-style:normal;width:22px;height:22px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:11px;font-weight:700;background:var(--ab-card);border:2px solid var(--ab-line-2);color:var(--ab-dim)}
.ab-install-steps .st.done i{background:var(--ab-sea);border-color:var(--ab-sea);color:#fff}
.ab-install-steps .st.on i{border-color:var(--ab-sea);color:var(--ab-sea);box-shadow:0 0 0 4px var(--ab-foam-2)}
.ab-install-steps .st.on{color:var(--ab-deep);font-weight:600}
.ab-install-steps .st span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:100%}
.ab-install-dl{display:flex;flex-wrap:wrap;gap:10px 24px;align-items:center;margin-top:10px}
.ab-install-dl small{display:block;color:var(--ab-dim);font-size:11px}
.ab-install-dl b{font-size:18px;font-variant-numeric:tabular-nums}
@media (max-width:640px){.ab-install-steps .st span{display:none}}
.ab-rail-item,.ab-rail-pages button,.ab-page-nav button,.ab-find-btn,.ab-run-btn,.ab-fold-summary,
.ab-finder-item,.ab-run-option,.ab-sel-opt,.ab-seg button{
  transition:background-color var(--ab-quick) ease,color var(--ab-quick) ease,border-color var(--ab-quick) ease
}
.ab-content,.ab-standalone,.ab-stage-collapse .ab-page-nav{animation:abPageIn var(--ab-reveal) var(--ab-ease)}
.ab-savebar,.ab-person-details{animation:abPageIn var(--ab-quick) var(--ab-ease)}
.ab-finder,.ab-run-pop,.ab-sel-pop,.ab-fold[open]>.ab-fold-body{animation:abPopIn var(--ab-quick) var(--ab-ease)}
@keyframes abPageIn{from{opacity:0;translate:0 5px}to{opacity:1;translate:none}}
@keyframes abPopIn{from{opacity:0;translate:0 -4px}to{opacity:1;translate:none}}
@keyframes abFoldClip{from{overflow:clip}to{overflow:visible}}
@supports (interpolate-size:allow-keywords) and selector(::details-content){
  .ab-root :is(details.ab-card,.ab-feed-help)::details-content{
    interpolate-size:allow-keywords;block-size:0;overflow:clip;
    transition:block-size var(--ab-reveal) var(--ab-ease),content-visibility var(--ab-reveal) allow-discrete
  }
  .ab-root :is(details.ab-card,.ab-feed-help)[open]::details-content{
    block-size:auto;overflow:visible;animation:abFoldClip var(--ab-reveal) step-end
  }
  .ab-root :is(details.ab-card,.ab-feed-help):not([open])::details-content{pointer-events:none}
}
@media (prefers-reduced-motion:reduce){
  .ab-root *,.ab-root *::before,.ab-root *::after{transition:none!important;animation:none!important}
  .ab-root :is(details.ab-card,.ab-feed-help)::details-content{transition:none!important;animation:none!important}
}
.ab-badge.dim{background:var(--ab-card-2);color:var(--ab-sub);border:1px solid var(--ab-line)}
.ab-badge.warn{background:rgba(191,135,0,.14);color:#9a6700;border:1px solid rgba(191,135,0,.3)}
.ab-badge.err{background:rgba(207,34,46,.1);color:var(--ab-err);border:1px solid rgba(207,34,46,.3)}
.ab-badge.mine{background:var(--ab-deep)}
.ab-mod{display:flex;gap:12px;align-items:flex-start;padding:12px 0;border-top:1px solid var(--ab-line)}
.ab-mod:first-child{border-top:0}
.ab-mod .main{flex:1;min-width:0}
.ab-mod .nm{display:flex;flex-wrap:wrap;align-items:center;gap:6px;font-weight:600}
.ab-mod .nm code{font-weight:400;font-size:11.5px;color:var(--ab-dim)}
.ab-mod .ds{color:var(--ab-sub);font-size:12.5px;margin-top:2px}
.ab-mod .what{color:var(--ab-dim);font-size:11.5px;margin-top:4px;word-break:break-word}
.ab-mod .acts{display:flex;flex-wrap:wrap;gap:6px;margin-top:8px}
.ab-mod .side{display:flex;flex-direction:column;align-items:flex-end;gap:6px}
.ab-code{font-family:ui-monospace,Consolas,monospace;font-size:11.5px;background:var(--ab-card-2);border:1px solid var(--ab-line);border-radius:8px;padding:8px 10px;white-space:pre-wrap;word-break:break-all;margin:6px 0 0}
`
    function useStyle() {
      useEffect(() => {
        // 交给 DSH 的样式归属：热更新时旧 <style> 会被宿主清掉，新模块重新注入。
        // 老版本留下的无主 style 先移除，否则 getElementById 会一直复用它，CSS 永远不刷新。
        const old = document.getElementById('aurabot-style')
        if (old) {
          if (old.dataset && old.dataset.plugin === 'dsh-aurabot-qq') return
          old.remove()
        }
        const el = document.createElement('style')
        el.id = 'aurabot-style'
        el.dataset.plugin = 'dsh-aurabot-qq'
        el.textContent = CSS
        document.head.appendChild(el)
      }, [])
    }

    // ---------------- 图标 ----------------













    function useField(draft, setDraft) {
      return {
        sw: (path, extra) => h(Switch, { on: !!getPath(draft, path), onChange: (v) => setDraft(setPath(draft, path, v)), ...(extra || {}) }),
        text: (path, props) => h('input', { className: cx('ab-input', props && props.size), value: getPath(draft, path) ?? '', placeholder: props && props.placeholder, type: (props && props.type) || 'text', onChange: (e) => setDraft(setPath(draft, path, e.target.value)) }),
        area: (path, props) => h('textarea', { className: cx('ab-input', props && props.size), rows: (props && props.rows) || 3, spellCheck: false, style: { fontFamily: 'ui-monospace, Consolas, monospace', fontSize: 12, lineHeight: 1.5, resize: 'vertical' }, value: getPath(draft, path) ?? '', placeholder: props && props.placeholder, onChange: (e) => setDraft(setPath(draft, path, e.target.value)) }),
        num: (path, props) => h('input', { className: 'ab-input sm', type: 'number', min: props && props.min, max: props && props.max, step: (props && props.step) || 1, value: getPath(draft, path) ?? '', onChange: (e) => setDraft(setPath(draft, path, e.target.value === '' ? '' : Number(e.target.value))) }),
        percent: (path) => h(Range, { min: 0, max: 100, value: pct(getPath(draft, path)), onChange: (v) => setDraft(setPath(draft, path, v / 100)), fmt: (v) => v + '%' }),
        // 滑块只是常用范围；超过的值在旁边的框里直接填（概率这种 0~1 的不用）
        range: (path, min, max, step, fmt) => {
          const slider = h(Range, { min, max, step, value: getPath(draft, path), onChange: (v) => setDraft(setPath(draft, path, v)), fmt })
          if (max <= 1) return slider
          return h('div', { className: 'ab-flex' }, slider, h('input', { className: 'ab-input sm', type: 'number', step, value: getPath(draft, path) ?? '', onChange: (e) => setDraft(setPath(draft, path, e.target.value === '' ? '' : Number(e.target.value))) }))
        },
        list: (path, props) => h(ListArea, { value: getPath(draft, path) || [], placeholder: props && props.placeholder, numbers: props && props.numbers, onChange: (v) => setDraft(setPath(draft, path, v)) }),
        select: (path, options, props) => h(Select, { value: getPath(draft, path) ?? '', options, onChange: (v) => setDraft(setPath(draft, path, v)), ...(props || {}) }),
        choices: (path, options) => h(Choices, { value: getPath(draft, path), options, onChange: (v) => setDraft(setPath(draft, path, v)) }),
      }
    }

    // ---------------- 按插件所在系统显示示例 ----------------
    // 主目录（/state 带回来），示例路径用它写
    const HOST = { home: '' }
    /** 示例路径：主目录下的 rel。 */
    const exPath = (rel) => (HOST.home || '/Users/你') + '/' + rel

    // 页面 ID 同时供旧书签、模块 manifest 的 tab 和本地导航记录使用。

    function PageNav({ group, current, go, dirtyOf, expanded, rail }) {
      return h('div', {
        id: pageNavId(group, rail), className: cx('ab-nav-collapse', rail ? 'ab-rail-collapse' : 'ab-stage-collapse'),
        'data-expanded': expanded,
      }, h('div', { className: 'ab-nav-clip', inert: expanded ? undefined : 'inert' },
        h(rail ? 'div' : 'nav', { className: rail ? 'ab-rail-pages' : 'ab-page-nav', 'aria-label': rail ? undefined : group.label + '页面' },
          group.pages.map((t) => h('button', {
            key: t.id, type: 'button', 'aria-current': current.id === t.id ? 'page' : undefined, onClick: () => go(t.id),
          }, t.label, dirtyOf(t.id) ? unsavedDot() : null)))))
    }

    function WorkspaceNav({ groups, current, go, dirtyOf, version, collapsedGroup, toggleGroup }) {
      return h('aside', { className: 'ab-rail' },
        h('button', { type: 'button', className: 'ab-wordmark', onClick: () => go('overview'), 'aria-label': 'AuraBot 概览' },
          h('span', { className: 'ab-brand-mark' }, h(WhaleIcon, { size: 21 })), h('b', null, 'AuraBot')),
        h('nav', { className: 'ab-work-nav', 'aria-label': 'AuraBot 功能' }, groups.map((g) => {
          const active = current.group === g.id
          const hasPages = g.pages.length > 1
          const expanded = hasPages && active && collapsedGroup !== g.id
          return h('div', { key: g.id }, h('button', {
            type: 'button', 'aria-current': active ? 'true' : undefined, 'aria-expanded': hasPages ? expanded : undefined,
            'aria-controls': hasPages ? pageNavId(g, true) + (active ? ' ' + pageNavId(g, false) : '') : undefined,
            className: cx('ab-rail-item', active && 'on'),
            onClick: () => {
              if (!active) go(g.pages[0].id)
              else if (hasPages) toggleGroup(g.id)
            },
          }, navIcon(g.icon), h('span', { className: 'ab-rail-label' }, g.label, hasPages ? navIcon('chevron') : null),
          (!active || (hasPages && !expanded)) && g.pages.some((t) => dirtyOf(t.id)) ? unsavedDot() : null),
          hasPages ? h(PageNav, { group: g, current, go, dirtyOf, expanded, rail: true }) : null)
        })),
        h('button', { type: 'button', className: 'ab-build', onClick: () => go('about') }, 'v' + version, navIcon('next')))
    }

























































































































    function apply(ctx) {
      const slots = ctx.get('slots')
      if (slots === undefined) return
      try {
        primitives()
      } catch (error) {
        slots.inject('main', () => slots.register({ name: 'main', key: PANEL_ID }, () => h(MissingPrimitivesPage, { error })))
        slots.inject('sidebar.panellist', () => slots.register({ name: 'sidebar.panellist', id: PANEL_ID, order: 20, label: () => 'Aurabot' }, WhaleIcon))
        return
      }
      // 写法同 DSH 自带的「自动化任务」（order 10）和「插件」（order 0）：排在它们后面
      slots.inject('main', () => slots.register({ name: 'main', key: PANEL_ID }, AurabotPage))
      slots.inject('sidebar.panellist', () => slots.register({ name: 'sidebar.panellist', id: PANEL_ID, order: 20, label: () => 'Aurabot' }, WhaleIcon))
    }

    /* @include parts */

    // 稳定的面板测试钩子：面板测试直接取组件，不再靠源码字符串注入。
    exports.__panelTest = { visibleTabs, TABS, TAB_CONTENT, Overview, WorkspaceNav, PageNav, MindSettings, MindMemory, MindPeople, MindSelf, MindNow, MindInner, MindLocalModel, DrawChatPermissions, Meter, MindInput, Row, Switch, Select, Card, Range, Btn }
    exports.apply = apply
    exports.inject = inject
    exports.AurabotPage = AurabotPage
    exports.WhaleIcon = WhaleIcon
    return module.exports
  },
})
