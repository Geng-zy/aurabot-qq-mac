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
    function WhaleIcon({ size }) {
      const s = size || 16
      return h('svg', { width: s, height: s, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.6, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': true },
        h('path', { d: 'M3 13c0 3.6 3.3 6 8 6 4.6 0 8.2-2.7 8.7-6.6.1-.8.8-1.4 1.6-1.4H22c-.3-1.6-1.6-2.6-3-2.6-1.8 0-3 1.2-3.6 2.6H9c-3.4 0-6 .4-6 2Z' }),
        h('path', { d: 'M7.5 3.5c.8.9.9 2.3.2 3.3M10.5 3.5c-.8.9-.9 2.3-.2 3.3M9 6.8V9' }),
        h('circle', { cx: 7.3, cy: 13.3, r: 0.6, fill: 'currentColor' }),
      )
    }

    // ---------------- 基础控件 ----------------
    function Switch({ on, onChange, disabled, title, label }) {
      const p = primitives()
      return h(p.Switch, { checked: !!on, onChange, label: label || title || '开关', disabled: !!disabled, title })
    }
    function Row({ label, hint, details, className, children }) {
      const id = useId()
      return h('div', { className: cx('ab-row', className), role: 'group', 'aria-labelledby': id, 'aria-describedby': hint ? id + '-hint' : undefined },
        h('div', { className: 'ab-label' }, h('b', { id }, label), hint ? h('small', { id: id + '-hint' }, hint) : null, details),
        h('div', { className: 'ab-ctl' }, children))
    }
    function Card({ title, desc, icon, right, children, className, fold, section, onToggle, collapseAtEnd }) {
      if (fold) return h('details', { className: cx('ab-card ab-fold', className), id: 'ab-section-' + fold, onToggle },
        h('summary', { className: 'ab-fold-summary' }, navIcon('chevron'), h('span', null, icon, title)),
        h('div', { className: 'ab-fold-body' },
          right ? h('div', { className: 'ab-card-head' }, right) : null,
          desc ? h('p', { className: 'ab-desc' }, desc) : null,
          children,
          collapseAtEnd ? h('div', { className: 'ab-fold-footer' },
            h(Btn, { small: true, kind: 'ghost', onClick: (e) => {
              const card = e.currentTarget.closest('details')
              const summary = card.querySelector('summary')
              card.open = false
              summary.focus({ preventScroll: true })
              summary.scrollIntoView({ block: 'nearest' })
            } }, '收起')) : null))
      return h('div', { className: cx('ab-card', section && 'ab-anchor', className), id: section ? 'ab-section-' + section : undefined, tabIndex: section ? -1 : undefined },
        title ? h('div', { className: cx('ab-card-head', desc && 'with-desc') }, h('h3', null, icon || null, title), right || null) : null,
        desc ? h('p', { className: 'ab-desc' }, desc) : null,
        children)
    }
    function Btn({ kind, small, onClick, disabled, children, title, expanded, controls }) {
      const [busy, setBusy] = useState(false)
      const run = async () => { if (!onClick) return; setBusy(true); try { await onClick() } finally { setBusy(false) } }
      const p = primitives()
      return h(p.Button, {
        variant: kind === 'primary' ? 'primary' : kind === 'danger' ? 'outline' : 'ghost',
        size: small ? 'sm' : 'md',
        className: kind === 'danger' ? 'ab-danger' : undefined,
        title, disabled: disabled || busy,
        'aria-expanded': expanded, 'aria-controls': controls, onClick: run,
      }, busy ? [h('i', { key: 's', className: 'ab-spin' }), ' 处理中'] : children)
    }

    /** 自定义下拉：替代系统自带的蓝白 select。options: [{value, label, desc?, group?}] */
    let nextSelectId = 0
    function Select({ value, options, onChange, placeholder, width, ariaLabel, disabled }) {
      const [open, setOpen] = useState(false)
      const [act, setAct] = useState(-1)
      const ref = useRef(null)
      const listId = useRef(null)
      if (!listId.current) listId.current = 'ab-sel-list-' + (++nextSelectId)
      const cur = options.find((o) => o.value === value)
      useEffect(() => {
        if (!open) return
        const close = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false) }
        document.addEventListener('mousedown', close)
        return () => document.removeEventListener('mousedown', close)
      }, [open])
      const pick = (o) => { if (!disabled) onChange(o.value); setOpen(false) }
      const openAt = () => { setOpen(true); setAct(Math.max(0, options.indexOf(cur))) }
      const onKey = (e) => {
        if (e.key === 'Escape') { setOpen(false); return }
        if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
          e.preventDefault()
          if (!open) return openAt()
          setAct((i) => (i + (e.key === 'ArrowDown' ? 1 : -1) + options.length) % options.length)
        }
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          if (open && options[act]) pick(options[act])
          else openAt()
        }
      }
      let lastGroup = null
      const items = []
      options.forEach((o, i) => {
        if (o.group && o.group !== lastGroup) items.push(h('div', { key: 'g' + i, className: 'ab-sel-group' }, o.group))
        lastGroup = o.group || lastGroup
        items.push(h('div', { key: 'o' + i, id: listId.current + '-' + i, role: 'option', 'aria-selected': o.value === value, className: cx('ab-sel-opt', o.value === value && 'on', i === act && 'act'), onMouseEnter: () => setAct(i), onMouseDown: (e) => e.preventDefault(), onClick: () => pick(o) },
          h('span', { className: 'ck' }, o.value === value ? '✓' : ''),
          h('span', { className: 'tx' }, o.label, o.desc ? h('span', { className: 'ds' }, o.desc) : null)))
      })
      return h('div', { className: cx('ab-sel', open && 'open'), ref, style: width ? { width, minWidth: 0 } : null, onBlur: (e) => { if (!e.currentTarget.contains(e.relatedTarget)) setOpen(false) } },
        h('button', { type: 'button', role: 'combobox', className: 'ab-sel-btn', disabled, onClick: () => (open ? setOpen(false) : openAt()), onKeyDown: onKey, 'aria-label': ariaLabel, 'aria-haspopup': 'listbox', 'aria-expanded': open, 'aria-controls': open ? listId.current : undefined, 'aria-activedescendant': open && act >= 0 ? listId.current + '-' + act : undefined },
          h('span', { className: 'v' }, cur ? cur.label : h('span', { className: 'ab-muted' }, placeholder || '请选择')),
          h('svg', { className: 'chev', width: 12, height: 12, viewBox: '0 0 12 12', fill: 'none', stroke: 'currentColor', strokeWidth: 1.8 }, h('path', { d: 'M3 4.5 6 7.5 9 4.5' }))),
        open ? h('div', { id: listId.current, className: 'ab-sel-pop', role: 'listbox', 'aria-label': ariaLabel }, items) : null)
    }

    /** 卡片式单选：选项少、需要解释时用。 */
    function Choices({ value, options, onChange }) {
      return h('div', { className: 'ab-choices', role: 'radiogroup' }, options.map((o) => h('button', { key: o.value, type: 'button', role: 'radio', 'aria-checked': o.value === value, className: cx('ab-choice', o.value === value && 'on'), onClick: () => onChange(o.value) },
        h('b', null, o.icon || null, o.label), o.desc ? h('small', null, o.desc) : null)))
    }

    /** 贴表情的映射表：QQ 系统表情（自己的编号）＋ emoji（Unicode 码点），两种都能直接填给 set_msg_emoji_like。 */
    /** QQ 系统表情的预览图：社区维护的 QFace 图库按 id 取 png；取不到就把图藏起来，只留名字。 */
    const QFACE_IMG = (id) => 'https://koishi.js.org/QFace/assets/qq_emoji/' + id + '/png/' + id + '.png'

    function FaceMapCard() {
      const [data, setData] = useState(null)
      const [q, setQ] = useState('')
      const [kind, setKind] = useState('all')
      const [copied, setCopied] = useState('')
      useEffect(() => {
        let alive = true
        get('/panel/faces')
          .then((r) => { if (alive && r && r.ok !== false) setData(r) })
          .catch(() => {})
        return () => { alive = false }
      }, [])
      const faces = data ? data.faces || [] : []
      const emojis = data ? data.emojis || [] : []
      const all = [
        ...faces.map((x) => ({ kind: 'face', name: String(x.name), id: String(x.id), label: String(x.name) })),
        ...emojis.map((x) => ({ kind: 'emoji', name: String(x.name), id: String(x.id), label: x.char + ' ' + x.name })),
      ]
      const key = String(q || '').trim().toLowerCase()
      const rows = all.filter((x) => (kind === 'all' || x.kind === kind) &&
        (!key || x.name.toLowerCase().includes(key) || x.id.includes(key) || x.label.toLowerCase().includes(key)))
      const copy = (x) => {
        clipboard(x.id).catch(() => {})
        setCopied(x.id)
        setTimeout(() => setCopied(''), 1200)
      }
      return h(Card, {
        title: '可用映射' + (all.length ? '（' + all.length + ' 条）' : ''),
        desc: '两种编号混着用都行。点一行复制编号，填进贴表情或让她自己挑。',
      },
        h('div', { style: { display: 'flex', gap: 8, alignItems: 'center', marginBottom: 8, flexWrap: 'wrap' } },
          h(Seg, {
            value: kind,
            options: [
              { value: 'all', label: '全部' },
              { value: 'face', label: 'QQ 表情 ' + faces.length },
              { value: 'emoji', label: 'emoji ' + emojis.length },
            ],
            onChange: setKind,
          }),
          h('input', {
            className: 'ab-input sm',
            placeholder: '搜名字或编号',
            value: q,
            onChange: (e) => setQ(e.target.value),
            style: { width: 180 },
          }),
          copied ? h('span', { className: 'ab-small', style: { color: 'var(--ab-ok)' } }, '已复制 ' + copied) : null),
        data === null
          ? h('div', { className: 'ab-muted ab-small' }, '正在读表情目录…')
          : rows.length === 0
            ? h('div', { className: 'ab-muted ab-small' }, '没有匹配的')
            : h('div', { style: { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(148px, 1fr))', gap: 6, maxHeight: 260, overflow: 'auto', paddingRight: 4 } },
                rows.map((x) => h('button', {
                  key: x.kind + x.id,
                  type: 'button',
                  title: '复制 ' + x.id,
                  onClick: () => copy(x),
                  style: { display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'center', font: 'inherit', fontSize: 12, padding: '4px 8px', borderRadius: 6, border: '1px solid rgba(127,127,127,.22)', background: 'rgba(127,127,127,.06)', color: 'inherit', cursor: 'pointer', textAlign: 'left' },
                },
                  h('span', { style: { display: 'flex', alignItems: 'center', gap: 6, minWidth: 0 } },
                    x.kind === 'face'
                      ? h('img', {
                          src: QFACE_IMG(x.id), alt: '', width: 18, height: 18, loading: 'lazy',
                          style: { flex: '0 0 auto', width: 18, height: 18, objectFit: 'contain' },
                          onError: (e) => { e.currentTarget.style.visibility = 'hidden' },
                        })
                      : null,
                    h('span', { style: { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }, x.kind === 'emoji' ? x.label : x.name)),
                  h('span', { style: { fontFamily: 'ui-monospace, Consolas, monospace', opacity: 0.75 } }, x.id)))),
      )
    }

    /** 滑块 + 数值，比纯数字框直观。 */
    function Range({ value, min, max, step, onChange, fmt }) {
      return h('div', { className: 'ab-range' },
        h('input', { type: 'range', min, max, step: step || 1, value: value ?? min, onChange: (e) => onChange(Number(e.target.value)) }),
        h('span', { className: 'val' }, fmt ? fmt(value) : value))
    }
    function Seg({ value, options, onChange, disabled }) {
      return h('div', { className: 'ab-seg' + (disabled ? ' off' : '') }, options.map((o) => h('button', { key: o.value, type: 'button', className: value === o.value ? 'on' : '', 'aria-pressed': value === o.value, disabled: !!disabled, onClick: () => { if (!disabled) onChange(o.value) } }, o.label)))
    }
    function Empty({ icon, text }) {
      return h('div', { className: 'ab-empty' }, h('div', { className: 'big' }, icon || '🐋'), text)
    }

    /** 一行一个的列表框：输入时保留原文（含正在敲的空行），只把解析结果交给草稿。 */
    function ListArea({ value, onChange, placeholder, numbers }) {
      const parse = (t) => t.split(numbers ? /[\n,，;；\s]+/ : /[\n,，;；]+/).map((s) => s.trim()).filter(Boolean)
      const [text, setText] = useState(value.join('\n'))
      // 外面改了（保存、撤销、重新载入）而且和框里内容对不上时才覆盖
      useEffect(() => { if (parse(text).join('\n') !== value.join('\n')) setText(value.join('\n')) }, [value.join('\n')])
      return h('textarea', { className: 'ab-textarea', style: { minHeight: 60 }, placeholder, value: text,
        onChange: (e) => { setText(e.target.value); onChange(parse(e.target.value)) },
        onBlur: () => setText(parse(text).join('\n')) })
    }

    // 绑定到草稿配置的控件
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
    const NAV_GROUPS = [
      { id: 'home', label: '概览', icon: 'home', pages: [
        { id: 'overview', label: '概览', search: '首页 状态 接收能力 转发 视频 用量 费用' },
      ] },
      { id: 'mind', label: '心智', icon: 'mind', pages: [
        { id: 'now', label: '她现在', search: '心情 情绪 精力 困 饿 投喂 睡觉 叫醒 身体' },
        { id: 'mood', label: '记忆', search: '梦 遗忘 隐私 私聊 保密 跨会话 分享 向量' },
        { id: 'knowledge', label: '知识库', search: '资料 笔记 Markdown 知识 scope 文件' },
        { id: 'persona', label: '关系', search: '人物 亲近 信任 喜欢 亲密 激情 承诺 老梗 群 关系星图' },
        { id: 'inner', label: '念头与行动', search: '内心 念头 日记 欲望 动力 犯懒 主动找 权限 申请 本地小模型' },
      ] },
      { id: 'identity', label: '自我与设置', icon: 'memory', pages: [
        { id: 'selfmind', label: '人格与自我', search: '人格卡 人设 头像 名字 小名 性格 特质 本来的样子 习惯 版本 退回 自我故事 价值观 爱好 影子模式' },
        { id: 'mindsettings', label: '设置', search: '参数 记性 遗忘 改写 情绪 后台预算 时区 年龄 生日 本地小模型 一键安装' },
      ] },
      { id: 'platforms', label: '平台', icon: 'puzzle', pages: [
        { id: 'platforms', label: '平台连接', search: 'QQ Telegram 飞书 Discord 多平台 适配器 状态 能力' },
      ] },
      { id: 'qq', label: 'QQ 会话', icon: 'chat', pages: [
        { id: 'connect', label: '连接', search: 'QQ 网关 SnowLuma OneBot 登录 工作区 自测 重置' },
        { id: 'access', label: '白名单与权限', search: '管理员 群管 改资料 QQ 命令 好友申请 生图白名单' },
        { id: 'group', label: '回复规则', search: '群聊 私聊 插话 连发 合并 转发' },
        { id: 'model', label: '聊天模型', search: 'AI 大模型 视觉 看图 图片 思考强度' },
        { id: 'asr', label: '语音识别', modules: ['voice'], search: '听语音 转文字 ASR' },
        { id: 'diary', label: 'QQ 空间', modules: ['diary', 'qzone-social'], search: '空间日记 说说 空间互动' },
      ] },
      { id: 'media', label: '表达与创作', icon: 'sparkles', pages: [
        { id: 'voice', label: '语音合成', modules: ['voice'], search: 'TTS 说话 音色 Edge Breeze' },
        { id: 'stickers', label: '表情包', modules: ['stickers'], search: '小黄脸 GIF 商城表情 贴表情' },
        { id: 'imagegen', label: '生图', modules: ['imagegen'], search: '画图 图片 Codex 图库 自拍' },
        { id: 'song', label: '翻唱', modules: ['song'], search: '唱歌 RVC 点歌' },
        { id: 'video', label: '生视频', modules: ['video'], search: 'ComfyUI 本地脚本 视频生成' },
      ] },
      { id: 'system', label: '系统', icon: 'settings', pages: [
        { id: 'logs', label: '日志', search: '诊断 报错' },
        { id: 'backup', label: '备份与恢复', search: '换电脑 迁移 导入 导出 WebDAV Gitee' },
        { id: 'security', label: '安全防护', search: 'SSRF 内网 图片下载 更新' },
        { id: 'browser', label: '浏览器', search: '侧边栏 Ego 共享 独立窗口' },
        { id: 'local', label: '本地接口', search: '脚本 FFmpeg SD SoVITS ComfyUI' },
        { id: 'about', label: '关于', search: '版本 许可 鸣谢 开源' },
      ] },
      { id: 'extensions', label: '扩展', icon: 'puzzle', pages: [
        { id: 'modules', label: '模块管理', search: '扩展 已安装 内置 自己写 模板 安全模式' },
        { id: 'market', label: '模块库', search: '插件 社区 下载 安装 外部模块 空间互动' },
      ] },
    ]
    const TABS = NAV_GROUPS.flatMap((group) => group.pages.map((page) => ({ ...page, group: group.id })))
    const FIND_SECTIONS = {
      platforms: [['platforms-status', '平台状态', 'QQ Telegram 飞书 适配器 能力 连接']],
      overview: [['overview-logs', '最近日志', '近期报错 运行状态']],
      connect: [['qq-workspace', '工作区与会话维护', '归档 重开 重置 搬家 目录 所有会话'], ['qq-endpoint', 'QQ 网关配置', 'WebSocket HTTP 令牌 OneBot 机器人号']],
      access: [
        ['qq-allowlist', '私聊与群白名单', '加好友 接待 谁可以聊天 群号 QQ 号'],
        ['qq-draw-allow', '生图白名单', '画图权限 会话生图 谁能请求画图'],
        ['qq-owner', '管理员与私聊权限', '管理员 QQ号 给她自由 完整 受限 纯聊天 称呼'],
        ['qq-notices', 'DSH 授权与通知', '审批 批准 提问 工作区'],
        ['qq-host-tools', '本机工具与发文件', '群里的本机工具 终端 文件 下载口 长任务 子智能体'],
        ['qq-profile', '改资料与名单', '头像 昵称 签名 好友申请 改白名单 外部模块权限'],
        ['qq-group-admin', '群管权限', '禁言 公告 踢人 群主 头衔'],
        ['qq-commands', 'QQ 命令', '斜杠 命令列表'],
      ],
      group: [
        ['qq-wake', '群聊回应与唤醒词', '群聊必回 群里必回 引用 艾特 @ 别名 叫法 接话'],
        ['qq-secretary', '群聊秘书闸', '便宜模型 判断 接话 主模型'],
        ['qq-merge', '连发合并', '多条消息 等待 攒消息'],
        ['qq-history', '跨群阅读与会话上下文', '跨群 看别的群 历史 接上聊天 扩展线索'],
        ['qq-reply-output', '回复正文与超时', '思考 内心 外泄 回复防漏 严格正文 每段都发 回合时限'],
        ['qq-interject', '群聊插话与限制', '主动接话 插嘴 频率 冷却 群限制'],
        ['qq-brakes', '安全刹车', '限速 互聊 防刷屏'],
        ['qq-group-overrides', '按群单独设置', '单独一个群 主动插话'],
        ['qq-title-filter', '按头衔不理', '机器人互聊 过滤 专属头衔'],
      ],
      model: [['qq-chat-models', '按会话选模型', '默认 私聊模型 群模型 单独切换 思考强度'], ['qq-model-speed', '模型列表与测速', '延迟 测试 可用模型']],
      now: [['mind-feelings', '此刻的感受', '当前情绪 心情 感受']],
      mood: [['knowledge-files', '知识库', '资料 笔记 Markdown 知识'], ['memory-entries', '她记得的事', '经历 搜索记忆 记忆列表'], ['memory-privacy', '私聊隐私', '跨会话 片段 保护 保密 共享'], ['memory-vectors', '向量检索与精排', 'embedding BGE-M3 rerank 向量重算 相似 本地 离线'], ['memory-chat-log', '聊天流水保留', '原话 保存几天 流水'], ['memory-dreams', '最近的梦', '做梦 睡眠 整理']],
      inner: [['mind-journal', '内心日记', '念头记录 深想记录'], ['mind-wants', '她想要的', '愿望 基本需要 帮她放下'], ['mind-actions', '能做的事', '待行动 动力 主动行为'], ['mind-outreach', '主动找你', '主动联系 搭话 勿扰'], ['mind-grants', '权限申请', '批准 收回 授权']],
      selfmind: [['self-persona', '人格卡与头像', '人设 头像 名字 小名 人格卡'], ['self-versions', '人格卡的版本', '回滚 还原 退回 人格历史'], ['self-traits', '性格（19 项）', '大五 气质 基线 影子模式'], ['self-versions-manage', '版本对比与清理', '删除 清理 对比 版本']],
      mindsettings: [['mind-local-model', '本地小模型', '一键安装 本地念头 MLX Python']],
      diary: [['diary-write', '现在写日记', '立即发布 私密日记 写一篇'], ['diary-history', '日记发布历史', '写过的日记 说说 记录'], ['diary-rich', '图文日记与预览', '预览 配图 日记图片'], ['diary-archive', '按日期归档浏览图', '归档 图片目录'], ['diary-social', '空间互动', '说说 点赞 评论 回复 好友空间']],
      voice: [['voice-rvc', '语音条变声', 'RVC 说话音色 翻唱音色 语音克隆']],
      imagegen: [['image-fallbacks', '备用生图服务', '降级 后备'], ['image-appearance', '她的形象', '自拍 参考图 形象描述'], ['image-library', '她的画作', '图库 历史图片']],
      song: [['song-effects', '翻唱效果', '混音 伴唱 人声 特征检索'], ['song-netease', '网易云音乐', 'Cookie MUSIC_U 登录 版权']],
      security: [['security-remote', '远端管理', '反代 可信代理 主机名 外部访问'], ['security-download', 'SSRF 防护', '内网 下载 安全策略']],
      backup: [['backup-cloud', '云备份', 'WebDAV Gitee 自动 定时'], ['backup-restore', '从备份恢复', '导入 换电脑 还原']],
      modules: [['modules-simulate', '模拟测试', '扩展模块 接线 工具调试'], ['modules-create', '新建一个模块', '自定义 模板 插件']],
    }
    const modOn = (st, id) => (st.modules || []).some((m) => m.id === id && m.running)
    const visibleTabs = (st) => TABS.filter((tab) => !tab.modules || tab.modules.some((id) => modOn(st, id)))
    const ICONS = {
      home: 'M3 10.5 12 3l9 7.5M5.5 9v11.5h13V9M10 20.5v-6h4v6',
      mind: 'M12 12.5a4.25 4.25 0 1 0 0-8.5 4.25 4.25 0 0 0 0 8.5zM4.5 20.5c.9-3.6 3.9-5.5 7.5-5.5s6.6 1.9 7.5 5.5',
      chat: 'M20.5 11.5a8 8 0 0 1-11.7 7.1L4 20l1.4-4.4A8 8 0 1 1 20.5 11.5zM9 11.5h6',
      sparkles: 'M12 2.5 14.4 9.6 21.5 12l-7.1 2.4L12 21.5l-2.4-7.1L2.5 12l7.1-2.4zM19 3v4m-2-2h4',
      settings: 'M4 7h9M17 7h3M4 12h3M11 12h9M4 17h11M19 17h1M15 5v4M9 10v4M17 15v4',
      puzzle: 'M4 4h6.5v2a1.5 1.5 0 0 0 3 0V4H20v6.5h-2a1.5 1.5 0 0 0 0 3h2V20h-6.5v-2a1.5 1.5 0 0 0-3 0v2H4v-6.5h2a1.5 1.5 0 0 0 0-3H4Z',
      find: 'M10.5 4a6.5 6.5 0 1 0 0 13 6.5 6.5 0 0 0 0-13zM20 20l-5-5',
      next: 'M5 12h14m-6-6 6 6-6 6',
      chevron: 'm7 10 5 5 5-5',
      close: 'm6 6 12 12M18 6 6 18',
      image: 'M3 5h18v14H3zM3 16l5-5 4 4 3-3 6 6M15 9h.01',
      mic: 'M9 6a3 3 0 0 1 6 0v5a3 3 0 0 1-6 0zM6 11a6 6 0 0 0 12 0M12 17v4M9 21h6',
      forward: 'M4 5h16v12H9l-5 3zM8 9h8M8 13h5',
      video: 'M4 5h16v14H4zM10 9l5 3-5 3z',
      lock: 'M5 10h14v10H5zm3 0V7a4 4 0 0 1 8 0v3m-4 4v2',
      memory: 'M5 4h11a3 3 0 0 1 3 3v13H6a2 2 0 0 1 0-4h13M5 18V6a2 2 0 0 1 2-2m2 5h6',
      pulse: 'M3 12h5l2.5-6 3 12 2.5-6H21',
      bolt: 'M13.5 2.5 5 14h6l-.5 7.5L19 10h-6z',
      moon: 'M20.4 15.3A8.8 8.8 0 0 1 8.7 3.6 9 9 0 1 0 20.4 15.3z',
      meal: 'M4 11h16a8 8 0 0 1-16 0zm4 8h8M9 8V4m6 4V3',
    }
    // 有 DSH primitives 时优先用宿主图标；没有对应图标或没有 primitives 时保留自己的 SVG。
    const ICON_COMPONENTS = {
      mind: 'IconThinkOutlineRegular',
      sparkles: 'IconSparkleRegular',
      settings: 'IconSettingsOutlineRegular',
      puzzle: 'IconPluginPinwheelOutlineRegular',
      find: 'IconSearchOutlineRegular',
      next: 'IconChevronRightOutlineRegular',
      chevron: 'IconChevronDownOutlineRegular',
      close: 'IconCloseOutlineRegular',
      mic: 'IconMicrophoneOutlineRegular',
      video: 'IconPlayOutlineRegular',
      lock: 'IconShieldOutlineRegular',
      memory: 'IconDatabaseOutlineRegular',
      pulse: 'IconGaugeOutlineRegular',
      bolt: 'IconEnhanceOutlineRegular',
      moon: 'IconDarkOutlineRegular',
    }
    const navIcon = (name) => {
      const p = primitives()
      const component = ICON_COMPONENTS[name] && p?.[ICON_COMPONENTS[name]]
      if (typeof component === 'function') return h(component, { className: 'ab-icon' })
      return h('svg', { className: 'ab-icon', viewBox: '0 0 24 24', 'aria-hidden': true }, h('path', { d: ICONS[name] || name }))
    }

    const unsavedDot = () => h('i', { className: 'ab-unsaved-dot', title: '有未保存的设置' })
    const pageNavId = (group, rail) => (rail ? 'ab-rail-pages-' : 'ab-stage-pages-') + group.id

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

    function FeatureFinder({ groups, go, st, embeddedModules }) {
      const [find, setFind] = useState(null)
      const [hi, setHi] = useState(0)
      const [params, setParams] = useState(null)
      const box = useRef(null)
      const trigger = useRef(null)
      const open = find !== null
      const hasMindSettings = groups.some((g) => g.pages.some((t) => t.id === 'mindsettings'))
      const close = () => { setFind(null); trigger.current?.focus() }
      const toggle = () => { setFind((f) => f === null ? '' : null); setHi(0) }
      useEffect(() => {
        const onKey = (e) => {
          if (e.altKey && !e.ctrlKey && !e.metaKey && (e.code === 'KeyK' || e.key.toLowerCase() === 'k')) {
            e.preventDefault()
            if (open) close()
            else toggle()
          }
        }
        window.addEventListener('keydown', onKey)
        return () => window.removeEventListener('keydown', onKey)
      }, [open])
      useEffect(() => {
        if (!open) return
        const onDown = (e) => { if (!box.current?.contains(e.target)) setFind(null) }
        document.addEventListener('mousedown', onDown)
        return () => document.removeEventListener('mousedown', onDown)
      }, [open])
      useEffect(() => {
        if (!open || !hasMindSettings || params) return
        let active = true
        get('/mind/settings').then((r) => { if (active && r.ok) setParams(r.params || []) })
        return () => { active = false }
      }, [open, hasMindSettings, params])
      const query = (find || '').trim().toLowerCase()
      const words = query.split(/\s+/).filter(Boolean)
      const catalog = open ? groups.flatMap((g) => g.pages.flatMap((t) => {
        const path = g.label + ' / ' + t.label
        const sections = (FIND_SECTIONS[t.id] || []).flatMap(([section, label, search]) => {
          if (section === 'qq-group-admin' && !modOn(st, 'group-admin')) return []
          if (section.startsWith('diary-') && !modOn(st, section === 'diary-social' ? 'qzone-social' : 'diary')) return []
          return [{ id: section, tab: t.id, label, path, search, section }]
        })
        const settings = t.id === 'mindsettings' ? (params || []).map((p) => ({ id: p.key, tab: t.id, label: p.label, path, search: [p.key, p.hint].join(' '),
          aliases: p.key === 'models.backgroundTokensDaily' ? ['后台预算', '后台额度', '每日额度'] : [], setting: p })) : []
        const embedded = (embeddedModules[t.id] || []).map((m) => {
          const section = 'module-' + m.id
          return { id: section, tab: t.id, label: m.name, path, search: moduleSearchText(m), section }
        })
        return [{ id: t.id, tab: t.id, label: t.label, path: g.label, search: t.search }, ...sections, ...settings, ...embedded]
      })) : []
      const hits = words.length ? catalog.flatMap((entry) => {
        const title = entry.label.toLowerCase()
        const haystack = [title, entry.path, entry.search, entry.id, ...(entry.aliases || [])].join(' ').toLowerCase()
        if (!words.every((word) => haystack.includes(word))) return []
        const rank = title === query ? 10 : entry.aliases?.includes(query) ? 9 : title.startsWith(query) ? 8 : title.includes(query) ? 6 : entry.search?.toLowerCase().includes(query) ? 4 : 2
        return [{ entry, rank: rank + (entry.section || entry.setting ? 0.5 : 0) }]
      }).sort((a, b) => b.rank - a.rank).slice(0, 32).map(({ entry }) => entry)
        : ['connect', 'qq-allowlist', 'group', 'model', 'memory-vectors', 'mindsettings'].flatMap((id) => catalog.filter((entry) => entry.id === id))
      const pick = (entry) => { close(); go(entry.tab, entry) }
      return h('div', { className: 'ab-find', ref: box },
        h('button', { type: 'button', className: 'ab-find-btn', ref: trigger, 'aria-label': '查找功能', 'aria-expanded': open, onClick: toggle },
          navIcon('find'), h('span', null, '搜索功能或设置'), h('kbd', { className: 'ab-kbd' }, isMacLike() ? '⌥ K' : 'Alt K')),
        open ? h('div', { className: 'ab-finder', onKeyDown: (e) => { if (e.key === 'Escape') { e.stopPropagation(); close() } } },
          h('input', {
            className: 'ab-input', autoFocus: true, role: 'combobox', 'aria-label': '搜索功能', 'aria-expanded': true, 'aria-controls': 'ab-finder-list',
            'aria-activedescendant': hits[hi] ? 'ab-hit-' + hi : undefined,
            placeholder: '例如：精排、生图、群聊必回',
            value: find,
            onChange: (e) => { setFind(e.target.value); setHi(0) },
            onKeyDown: (e) => {
              if (e.nativeEvent?.isComposing) return
              if (e.key === 'ArrowDown' && hits.length) { e.preventDefault(); setHi((i) => Math.min(i + 1, hits.length - 1)) }
              else if (e.key === 'ArrowUp') { e.preventDefault(); setHi((i) => Math.max(i - 1, 0)) }
              else if (e.key === 'Enter' && hits[hi]) { e.preventDefault(); pick(hits[hi]) }
            },
          }),
          h('div', { className: 'ab-finder-list', id: 'ab-finder-list', role: 'listbox', 'aria-label': '功能搜索结果' }, hits.length
            ? hits.map((entry, i) => h('button', {
              key: entry.id, id: 'ab-hit-' + i, type: 'button', role: 'option', 'aria-selected': i === hi,
              className: cx('ab-finder-item', i === hi && 'on'), onMouseEnter: () => setHi(i), onClick: () => pick(entry),
            }, h('span', { className: 'ab-finder-title' }, entry.label), h('small', null, entry.path)))
            : h('div', { className: 'ab-finder-empty' }, '没有匹配的功能'))) : null)
    }

    const runMode = (cfg) => cfg.debug ? '调试模式' : cfg.dryRun ? '试运行' : '正式模式'
    function RunControls({ cfg, busy, onToggle, onMode }) {
      const [open, setOpen] = useState(false)
      const box = useRef(null)
      const trigger = useRef(null)
      useEffect(() => {
        if (!open) return
        const outside = (e) => { if (!box.current?.contains(e.target)) setOpen(false) }
        document.addEventListener('mousedown', outside)
        return () => document.removeEventListener('mousedown', outside)
      }, [open])
      const selected = runMode(cfg)
      const modes = [
        ['正式模式', '正常发送 QQ 回复。'],
        ['试运行', '照常记录记忆，回复只写日志。'],
        ['调试模式', '仅在面板和 DSH 对话，不写长期记忆。'],
      ]
      return h('div', { className: 'ab-run', ref: box, onKeyDown: (e) => { if (open && e.key === 'Escape') { setOpen(false); trigger.current?.focus() } } },
        h('button', { type: 'button', className: 'ab-run-btn', ref: trigger, 'aria-label': '运行模式：' + (cfg.enabled ? selected : '已停用'), 'aria-expanded': open, onClick: () => setOpen(!open) },
          h('i', { className: cx('ab-dot', cfg.enabled && (cfg.dryRun || cfg.debug ? 'warn' : 'ok')), 'aria-hidden': true }), cfg.enabled ? selected : '已停用', navIcon('chevron')),
        open ? h('div', { className: 'ab-run-pop' },
          h('div', { className: 'ab-run-power' }, h('b', null, '启用 AuraBot'), h(Switch, { label: '总开关', on: cfg.enabled, disabled: busy, onChange: onToggle })),
          h('div', { role: 'group', 'aria-label': '运行模式' }, modes.map(([mode, description]) => h('button', {
            key: mode, type: 'button', className: 'ab-run-option', 'aria-pressed': mode === selected, disabled: busy, onClick: () => onMode(mode),
          }, h('span', null, h('b', null, mode), h('small', null, description)), h('span', { className: 'ab-mode-indicator', 'aria-hidden': true }))))) : null)
    }

    function ModOff({ name }) {
      return h(Card, { title: name }, h('div', { className: 'ab-muted ab-small' }, '「' + name + '」模块关着，这部分用不了。要用的话去「扩展 → 模块管理」把它打开。'))
    }
    /** 一个标签页出错时只坏这一页：显示原因和「回到概览」，不会整个面板白屏（也不会因为记住了这一页而一直白）。 */
    class TabBoundary extends React.Component {
      constructor(p) { super(p); this.state = { error: null } }
      static getDerivedStateFromError(error) { return { error } }
      componentDidCatch(error) { try { localStorage.setItem('aurabot.tab', 'overview') } catch (e) {} }
      render() {
        if (!this.state.error) return this.props.children
        return h(Card, { title: '这一页出错了' },
          h('div', { className: 'ab-note err' }, String((this.state.error && this.state.error.message) || this.state.error)),
          h('div', { className: 'ab-small ab-muted', style: { margin: '8px 0' } }, '别的页面不受影响。把这段报错截图发给作者就行。'),
          h('div', { className: 'ab-flex' },
            h(Btn, { small: true, kind: 'primary', onClick: () => this.props.onHome && this.props.onHome() }, '回到概览'),
            h(Btn, { small: true, kind: 'ghost', onClick: () => this.setState({ error: null }) }, '再试一次')))
      }
    }
    const copy = (text, toast, msg) => {
      Promise.resolve().then(() => clipboard(text)).then(() => { if (msg) toast(msg, 'ok') }, () => toast('复制失败，手动选中复制吧', 'err'))
    }

    /** 版本更新说明：插件更新交给 DSH 插件管理器，这里只在版本变化后显示一次 CHANGELOG。 */
    function UpdateNotes({ st }) {
      const [notes, setNotes] = useState(null)
      useEffect(() => {
        let seen = null
        try { seen = localStorage.getItem('aurabot.seenVersion') } catch (e) {}
        if (seen && seen !== st.version) get('/changelog').then((r) => r.notes && setNotes(r.notes))
        else if (!seen) { try { localStorage.setItem('aurabot.seenVersion', st.version) } catch (e) {} }
      }, [st.version])
      const dismiss = () => { try { localStorage.setItem('aurabot.seenVersion', st.version) } catch (e) {} setNotes(null) }
      return notes ? h('div', { className: 'ab-note' },
        h('div', { className: 'ab-flex' }, h('b', null, '已更新到 v' + st.version), h('div', { className: 'ab-spacer' }), h(Btn, { small: true, kind: 'ghost', onClick: dismiss }, '知道了')),
        h('div', { style: { whiteSpace: 'pre-wrap', marginTop: 6 } }, notes)) : null
    }

    function Overview({ st, toast, go, connection, displayName = '大肥鱼' }) {
      const [usage, setUsage] = useState(null)
      const [models, setModels] = useState([])
      const [usageOpen, setUsageOpen] = useState(false)
      // 下面三张明细表看哪个区间：today / yesterday / 7 / 30（点指标卡切换）
      const [usageRange, setUsageRange] = useState('7')
      const loadUsage = (range) => get('/usage?range=' + (range || usageRange)).then((r) => { if (r && r.ok !== false) setUsage(r) }).catch(() => {})
      useEffect(() => { loadUsage(); get('/models').then((r) => setModels(r.list || [])) }, [])
      const cfg = st.config
      const s = st.stats || {}
      const conn = st.onebot.state === 'connected' && !st.onebot.problem
      const quick = (p, body) => async () => { const r = await post(p, body); toast(r.message || (r.ok ? '好了' : '没成功'), r.ok ? 'ok' : 'err') }
      const model = models.find((m) => m.provider === cfg.model.provider && m.model === cfg.model.model)
      const vision = cfg.model.vision === 'off' ? '仅文字提示' : cfg.model.vision === 'on' ? '按视觉模式发送' : model?.vision === true ? '默认模型支持看图' : model?.vision === false ? '默认模型仅接收提示' : '随会话模型'
      const voice = modOn(st, 'voice')
      const image = cfg.imageGen
      const imageModel = image.provider === 'local' ? '本地部署 · Qwen Image 2.1' : image.provider === 'codex' ? image.codex?.model : image.provider === 'custom' ? '自定义接口' : image.model
      const imageLabel = !modOn(st, 'imagegen') ? '模块已停用'
        : cfg.local?.image && image.provider !== 'local' ? '优先使用本地接口'
          : !image.enabled ? '未启用'
            : imageModel ? (image.provider === 'codex' ? 'Codex · ' : '') + imageModel : '尚未选择模型'
      const chatModel = cfg.model.model || '跟随 DSH 默认'
      const sessionCount = Object.keys(st.sessions || {}).filter((k) => !k.startsWith('system:')).length
      const capabilities = [
        ['图片', vision, 'model', 'image'],
        ['语音', voice && cfg.voice.asr ? '转写成文字' : '未开启转写', voice ? 'asr' : 'modules', 'mic'],
        ['合并转发', '展开文字和图片', null, 'forward'],
        ['视频', '显示消息提示', null, 'video'],
      ]
      const usageToday = usage && usage.ranges ? usage.ranges.today : null
      // 维度小表：名称在左，其余数字右对齐；金额加粗提一档
      const dimTable = (list, nameOf) => (list && list.length
        ? h('div', { className: 'ab-scroll-table' }, h('table', { className: 'ab-table num' },
          h('thead', null, h('tr', null, ['名称', '调用', '合计 tokens', '缓存命中率', '花费'].map((t) => h('th', { key: t }, t)))),
          h('tbody', null, list.map((x) => h('tr', { key: x.key },
            h('td', null, nameOf(x.key)),
            h('td', null, x.runs),
            h('td', null, fmtTokens(x.totalTokens)),
            h('td', null, x.promptTokens ? Math.round(x.cacheHitRate * 100) + '%' : '–'),
            h('td', { className: 'money' }, fmtCost(x.cost, usage.currency)))))))
        : h('div', { className: 'ab-muted ab-small' }, '这段时间没有记录。'))
      const openUsage = () => {
        const next = !usageOpen
        setUsageOpen(next)
        if (next) loadUsage()
      }
      const cur = usage && usage.current
      const RANGE_LABEL = { today: '今日', yesterday: '昨日', 7: '近 7 天', 30: '近 30 天' }
      // 点指标卡 = 换下面三张表看的区间（range 参数跟后端对齐：today / yesterday / 7 / 30）
      const pickRange = (param) => (e) => {
        if (e && e.stopPropagation) e.stopPropagation()
        if (usageRange === param) return
        setUsageRange(param)
        loadUsage(param)
      }
      // 四个区间做成指标卡：大字是 tokens，下面一行是花费 + 调用次数 + 命中率；当前选中的那张高亮
      const usageTile = ([label, key, param]) => {
        const r = usage.ranges[key]
        const active = usageRange === param
        return h('div', {
          key, role: 'button', tabIndex: 0,
          className: cx('ab-utile', 'pick', active && 'hi'),
          title: active ? '下面三张表就是在看' + label : '点一下，下面三张表换成' + label,
          onClick: pickRange(param),
          onKeyDown: (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); pickRange(param)(e) } },
        },
          h('div', { className: 'k' }, label, active ? h('span', { className: 'ab-utile-cur' }, ' · 明细中') : null),
          h('div', { className: 'v' }, fmtTokens(r.totalTokens)),
          h('div', { className: 's' }, fmtCost(r.cost, usage.currency) + ' · ' + r.runs + ' 次'
            + (r.promptTokens ? ' · 命中 ' + Math.round(r.cacheHitRate * 100) + '%' : '')))
      }
      const usagePanel = !usageOpen ? null
        : usage && usage.ranges ? h(Card, {
        title: 'token 用量与花费',
        right: h(Btn, { small: true, kind: 'ghost', onClick: () => setUsageOpen(false) }, '收起'),
        desc: '按模块、会话和模型查看用量。费用按价目表估算，未定价的调用单独显示。',
      },
        h('div', { className: 'ab-utiles' },
          usageTile(['今日', 'today', 'today']),
          usageTile(['昨日', 'yesterday', 'yesterday']),
          usageTile(['近 7 天', 'last7', '7']),
          usageTile(['近 30 天', 'last30', '30'])),
        cur
          ? h('div', { className: 'ab-upills' },
            h('span', { className: 'ab-upill' }, '新输入 ', h('b', null, fmtCost(cur.freshCost, usage.currency))),
            h('span', { className: 'ab-upill' }, '缓存命中 ', h('b', null, fmtCost(cur.cachedCost, usage.currency))),
            h('span', { className: 'ab-upill' }, '输出 ', h('b', null, fmtCost(cur.outputCost, usage.currency))),
            h('span', { className: cx('ab-upill', usage.peak && 'warn') },
              '峰时占比 ', h('b', null, Math.round((cur.peakRatio || 0) * 100) + '%'),
              usage.peak ? '（现在高峰价）' : '（现在空闲价）'),
            cur.unpricedCalls
              ? h('span', { className: 'ab-upill warn' }, '未定价 ', h('b', null, cur.unpricedCalls + ' 次'), ' 不算花费')
              : null,
            cur.assumedCalls
              ? h('span', { className: 'ab-upill' }, '含 ', h('b', null, cur.assumedCalls + ' 次'), ' 旧数据按 DeepSeek flash 价估')
              : null)
          : null,
        cur ? h('div', null,
          h('div', { className: 'ab-section-title' }, '按模块（' + RANGE_LABEL[usageRange] + '）'),
          dimTable(cur.byModule, (k) => k),
          h('div', { className: 'ab-section-title' }, '按聊天（' + RANGE_LABEL[usageRange] + ' · 哪个群 / 哪个私聊花得多）'),
          dimTable(cur.byChat, chatLabel),
          h('div', { className: 'ab-section-title' }, '按模型（' + RANGE_LABEL[usageRange] + '）'),
          dimTable(cur.byModel, (k) => k || '（跟随默认）')) : null,
        cur && cur.unpricedCalls
          ? h('div', { className: 'ab-note warn', style: { marginTop: 12 } },
            '有 ' + cur.unpricedCalls + ' 次调用没算进花费（' + fmtTokens(cur.unpricedTokens) + ' tokens）：'
            + (cur.unpricedModels || []).map((m) => m.model).join('、')
            + '。这些模型价格表里没有，在 config.usage.pricing 里加一条就会算进去。')
          : null,
        h('div', { className: 'ab-muted ab-small', style: { marginTop: 12 } },
          '数据保留 ' + (usage.days || 90) + ' 天；聊天回合的 token 由 DSH 会话上报，后台任务由插件自己记。'))
        : h(Card, { title: 'token 用量与花费', right: h(Btn, { small: true, kind: 'ghost', onClick: () => setUsageOpen(false) }, '收起') },
          h('div', { className: 'ab-muted ab-small' }, '还没读到用量数据…'))
      return h('div', { className: 'ab-overview' },
        h(UpdateNotes, { st, toast }),
        h('section', { className: 'ab-cover', 'aria-label': '运行概览' },
          h('div', { className: 'ab-cover-copy' },
            h('div', { className: 'ab-cover-meta' }, h('i', { className: cx('ab-dot', connection.cls), 'aria-hidden': true }), connection.text, h('span', { 'aria-hidden': true }, '·'), cfg.enabled ? runMode(cfg) : '已停用'),
            h('h1', null, displayName),
            h('p', null, '聊天模型', h('strong', null, chatModel)),
            h('button', { type: 'button', className: 'ab-cover-link', onClick: () => go(conn ? 'now' : 'connect') }, conn ? '查看她现在' : '检查 QQ 连接', navIcon('next'))),
          h('button', { type: 'button', className: 'ab-cover-portrait', 'aria-label': '查看人格卡和头像', onClick: () => go('selfmind') },
            h('img', { src: avatarSrc(st), alt: '' }))),
        cfg.enabled && !conn ? h('div', { className: 'ab-note err' }, st.onebot.problem || 'QQ 网关未就绪。请检查 OneBot 连接。') : null,
        st.outbox?.count ? h('div', { className: 'ab-note warn' }, `${st.outbox.count} 条消息待补发，QQ 网关恢复后会继续发送。`) : null,
        cfg.enabled && cfg.debug ? h(Card, { title: '调试对话', desc: '对话仅在面板和 DSH 中可见，不会发到 QQ 或写入长期记忆。',
          right: h(Btn, { small: true, onClick: quick('/debug/session') }, '打开 DSH 调试会话') }, h(DebugChat, { toast })) : null,
        cfg.enabled && !cfg.debug && cfg.dryRun ? h('div', { className: 'ab-note' }, '试运行会照常记录记忆，回复只写日志。') : null,
        h('section', { className: 'ab-card ab-activity', 'aria-label': '今日活动' },
          h('div', { className: 'ab-section-heading' }, h('h2', null, '今日活动'),
            h('button', { type: 'button', className: 'ab-inline-link', 'aria-expanded': usageOpen, onClick: openUsage }, usageOpen ? '收起用量' : '查看用量', navIcon('chevron'))),
          h('dl', { className: 'ab-metrics' }, [
            ['收到消息', s.received ?? '—'], ['发出消息', s.sent ?? '—'], ['发出语音', s.voice ?? '—'], ['表情使用', s.stickers ?? '—'],
            ['今日 token', usageToday ? fmtTokens(usageToday.totalTokens ?? usageToday.total ?? 0) : '—'],
          ].map(([label, value]) => h('div', { key: label, className: 'ab-metric' }, h('dt', null, label), h('dd', null, value))))),
        usagePanel,
        h('div', { className: 'ab-overview-pair' },
          h('section', { className: 'ab-card ab-reception' },
            h('div', { className: 'ab-section-heading' }, h('h2', null, 'QQ 接收能力'), h('span', null, sessionCount + ' 个会话')),
            h('ul', { className: 'ab-data-list' }, capabilities.map(([label, state, target, icon]) =>
              h('li', { key: label }, target ? h('button', { type: 'button', onClick: () => go(target) }, navIcon(icon), h('b', null, label), h('small', null, state), navIcon('next'))
                : h('div', null, navIcon(icon), h('b', null, label), h('small', null, state)))))),
          h('section', { className: 'ab-card ab-overview-paths' },
            h('div', { className: 'ab-section-heading' }, h('h2', null, '常用入口')),
            h('ul', { className: 'ab-data-list' }, [
              ['记忆', '跨会话使用与私聊隐私', 'mood', 'memory'],
              ['生图配置', imageLabel, modOn(st, 'imagegen') ? 'imagegen' : 'modules', 'sparkles'],
              ['回复规则', '群聊插话、连发合并', 'group', 'chat'],
              ['白名单与权限', '谁可以和她聊天', 'access', 'lock'],
              ['聊天模型', '默认模型与每个会话的模型', 'model', 'settings'],
            ].map(([label, description, id, icon]) => h('li', { key: id }, h('button', { type: 'button', onClick: () => go(id) },
              navIcon(icon), h('b', null, label), h('small', null, description), navIcon('next'))))))),
        h(RecentLogs, { go }))
    }

    function About({ st }) {
      const link = (label, href, button = false) => h('a', { href, className: button ? 'ab-link-btn' : undefined, target: '_blank', rel: 'noreferrer' }, label)
      const entry = (title, ...content) => h('div', { key: title }, h('dt', null, title), h('dd', null, ...content))
      return h('div', { className: 'ab-grid' },
        h(Card, { className: 'ab-about-project', title: 'AuraBot for macOS', desc: 'v' + st.version + ' · 面板 API v' + (st.apiVersion || '?') },
          h('p', null, '由 Geng-zy 维护的 DeepSeek Harness 插件。心智核心管理大肥鱼的记忆、情绪和关系。Apple 芯片 Mac 上可通过 OneBot v11 接入 QQ，也可部署本地念头模型和生图模型。'),
          h('div', { className: 'ab-note' }, '插件更新请在 DSH 的插件管理器里进行；这里不再自己检查或安装新版本。'),
          h('div', { className: 'ab-about-links' },
            link('项目仓库', PROJECT_REPO, true),
            link('用户手册', PROJECT_REPO + '/blob/main/docs/USER-MANUAL.md', true),
            link('发布记录', PROJECT_REPO + '/releases', true),
            link('提交改动', PROJECT_REPO + '/pulls', true))),
        h('div', { className: 'ab-grid ab-g2' },
          h(Card, { title: '模块来源' }, h('dl', { className: 'ab-about-origin' },
            entry('macOS 分支模块库', link(MODULE_REPOS.mac, 'https://github.com/' + MODULE_REPOS.mac)),
            entry('上游模块库（只读参考）', link(MODULE_REPOS.upstream, 'https://github.com/' + MODULE_REPOS.upstream)))),
          h(Card, { title: '来源与许可' }, h('dl', { className: 'ab-about-origin' },
            entry('上游项目', link('aureth-labs/dsh-aurabot-qq', UPSTREAM_REPO), ' · ', link('上游贡献者', UPSTREAM_REPO + '/graphs/contributors')),
            entry('许可证', link('MIT（插件代码）', PROJECT_REPO + '/blob/main/LICENSE'), ' · ', link('素材和第三方署名', PROJECT_REPO + '/blob/main/THIRD-PARTY-NOTICES.md'))))))
    }

    function RecentLogs({ go }) {
      const [items, setItems] = useState(null)
      const [open, setOpen] = useState(false)
      useEffect(() => {
        if (!open) return
        let alive = true
        const load = () => get('/logs?limit=8&level=info').then((r) => alive && setItems(r.entries || []))
        load()
        const t = setInterval(load, 5000)
        return () => { alive = false; clearInterval(t) }
      }, [open])
      return h(Card, { fold: 'overview-logs', title: '最近日志', className: 'ab-recent', onToggle: (e) => setOpen(e.currentTarget.open), right: h(Btn, { kind: 'ghost', small: true, onClick: () => go('logs') }, '全部日志 →') },
        items === null ? h(Empty, { icon: '⏳', text: '加载中…' }) : items.length === 0 ? h('p', { className: 'ab-muted ab-small' }, '暂无日志') :
          h('div', { className: 'ab-logs', style: { maxHeight: 240 } }, items.slice().reverse().map((e, i) => h(LogLine, { key: i, e }))))
    }

    function LogLine({ e }) {
      return h('div', { className: cx('ab-log', e.level) }, h('span', { className: 't' }, e.time), h('span', { className: 'a' }, e.area), h('span', { className: 'm' }, e.text))
    }

    /** 已有 OneBot 机器人的地址和令牌。 */
    function OneBotFields({ draft, f }) {
      return h(Fragment, null,
        h(Row, { label: 'WebSocket 地址', hint: '正向 WebSocket（OneBot v11），收消息靠它，必填。DSH 在 Docker 里的话，要填 DSH 容器能访问到的地址' }, f.text('platforms.qq.wsUrl', { size: 'wide', placeholder: 'ws://127.0.0.1:3001' })),
        h(Row, { label: 'WebSocket 令牌', hint: '对方设了 access_token 就填，没设留空' }, f.text('platforms.qq.wsToken', { type: 'password', placeholder: draft.platforms?.qq?.wsTokenSet ? '已保存' : '没有就留空' })),
        h(Row, { label: 'HTTP 地址', hint: '可选。填了就用 HTTP 调接口，不填就都走 WebSocket' }, f.text('platforms.qq.httpUrl', { size: 'wide', placeholder: 'http://127.0.0.1:3000' })),
        h(Row, { label: 'HTTP 令牌' }, f.text('platforms.qq.httpToken', { type: 'password', placeholder: draft.platforms?.qq?.httpTokenSet ? '已保存' : '没有就留空' })))
    }

    /** 平台入口：QQ / Telegram 共用状态卡；后续适配器会在这里出现。 */
    function Platforms({ st, go, draft, setDraft }) {
      const list = st.channels || []
      const f = useField(draft, setDraft)
      const label = (s) => ({ connected: '已连接', connecting: '连接中', stopped: '未启动', error: '异常' }[s] || s || '未知')
      const capLabel = { faces: '小黄脸', stickers: '表情包', voice: '语音', files: '文件', recall: '撤回', poke: '戳一戳', react: '贴表情', typing: '输入状态', history: '历史消息', forward: '合并转发', card: '名片', friendRequests: '好友申请', groupRequests: '入群申请', profile: '改资料', groupAdmin: '群管', text: '文字', reply: '回复', images: '图片' }
      const scrollTo = (id) => document.getElementById('ab-section-' + id)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
      const tg = list.find((p) => p.platform === 'telegram')
      const items = list.length
        ? h('div', { className: 'ab-list' }, list.map((p) => h('div', { key: p.platform, className: 'ab-li ab-platform-row' },
          h('div', { className: 'meta' },
            h('i', { className: cx('ab-dot', p.state === 'connected' ? 'ok' : p.state === 'connecting' ? 'warn' : 'err') }),
            p.label || p.platform,
            h('span', { className: 'ab-muted ab-small' }, ' · ' + label(p.state) + (p.ready ? ' · 已就绪' : ' · 未就绪'))),
          h('div', { className: 'ab-platform-caps' }, Object.entries(p.caps || {}).filter(([, v]) => v).map(([k]) => h('span', { key: k, className: 'ab-platform-chip' }, capLabel[k] || k))),
          h('div', { className: 'ab-platform-actions' },
            p.platform === 'qq' ? h(Btn, { small: true, onClick: () => go('connect') }, '配置 QQ') : null,
            p.platform === 'telegram' ? h(Btn, { small: true, onClick: () => scrollTo('telegram') }, '配置 Telegram') : null))))
        : h(Empty, { text: '还没有平台适配器' })
      return h('div', { className: 'ab-grid' },
        h(Card, { title: '平台连接', desc: '所有平台的适配器和能力。QQ 的详细参数在「QQ 会话 → 连接」里配置；Telegram 直接在下方填写。' }, items),
        h(Card, { section: 'telegram', title: 'Telegram', desc: '长轮询 Bot API，不需要公网端口。先在 @BotFather 创建 Bot，把 Token 填在这里。', right: h('span', { className: cx('ab-badge', tg?.state === 'connected' && 'ok') }, tg ? label(tg.state) : '未启用') },
          h(Row, { label: '启用 Telegram' }, f.sw('platforms.telegram.enabled')),
          h(Row, { label: 'Bot API 地址', hint: '默认 https://api.telegram.org；服务器访问不了 Telegram 时填可用反代' }, f.text('platforms.telegram.apiBase', { placeholder: 'https://api.telegram.org' })),
          h(Row, { label: 'Bot Token', hint: '只保存在本机配置里' }, f.text('platforms.telegram.token', { type: 'password', placeholder: draft.platforms?.telegram?.tokenSet ? '已保存' : '123456:ABC...' })),
          h(Row, { label: '管理员 Telegram ID', hint: '你的 Telegram 用户 ID，可先用 @userinfobot 查' }, f.text('platforms.telegram.ownerQQ')),
          h(Row, { label: '私聊白名单', hint: '允许私聊的 Telegram 用户 ID，一行一个' }, f.list('platforms.telegram.allow.private', { placeholder: '每行一个用户 ID' })),
          h(Row, { label: '群白名单', hint: '允许的 Telegram 群 ID，一行一个（群 ID 通常是负数）' }, f.list('platforms.telegram.allow.groups', { placeholder: '每行一个群 ID' })))
      )
    }

    function Connect({ st, draft, setDraft, toast, reload, openWizard }) {
      const f = useField(draft, setDraft)
      const [moveTo, setMoveTo] = useState('')
      const conn = st.onebot.state === 'connected'
      const login = st.onebot.login
      const [diag, setDiag] = useState(null)
      const runDiag = async () => { setDiag({ busy: true }); try { setDiag(await get('/onebot/diagnose')) } catch (e) { setDiag(null); toast(e.message, 'err') } }
      const diagView = diag ? (diag.busy ? h('div', { className: 'ab-muted ab-small', style: { marginTop: 8 } }, '正在一项项检查…') : h('div', { style: { marginTop: 10 } },
        diag.problem ? h('div', { className: 'ab-note warn' }, diag.problem) : h('div', { className: 'ab-note' }, '每一项都正常。'),
        h('table', { className: 'ab-table', style: { marginTop: 6 } }, h('tbody', null, (diag.items || []).map((it, i) => h('tr', { key: i },
          h('td', { style: { width: 24 } }, it.ok === true ? '✓' : it.ok === false ? '✗' : '·'),
          h('td', null, it.label),
          h('td', null, it.detail, it.ok === false && it.hint ? h('div', { className: 'ab-small ab-muted' }, it.hint) : null))))))) : null
      const testBtns = h('div', { className: 'ab-flex', style: { marginTop: 10, gap: 12 } },
        h(Btn, { small: true, kind: 'primary', onClick: runDiag }, '一键诊断'),
        h(Btn, { small: true, onClick: async () => { const r = await get('/onebot/test'); toast(r.message) } }, '测试连接'),
        h(Btn, { small: true, onClick: async () => { const r = await post('/onebot/reconnect'); toast(r.message, r.ok ? 'ok' : 'err'); reload() } }, '重新连接'))
      return h('div', { className: 'ab-grid' },
        h(Card, { title: '连接状态' },
          h('div', { className: 'ab-kv' },
            h('span', null, 'QQ 网关'), h('span', null, h('span', { className: 'ab-flex' }, h('i', { className: cx('ab-dot', conn ? 'ok' : st.onebot.state === 'connecting' ? 'warn' : 'err') }), { connected: '已连上', connecting: '连接中', disconnected: '断开了，正在重连', stopped: '没启动（总开关关着）', unconfigured: '还没配置' }[st.onebot.state] || st.onebot.state)),
            h('span', null, '登录的号'), h('span', null, login ? login.nickname + '（' + login.uin + '）' + (login.uin !== (draft.platforms?.qq?.botQQ || draft.botQQ) ? ' ⚠ 不是机器人号！' : '') : '—'),
            h('span', null, 'HTTP'), h('span', null, st.onebot.endpoint.httpUrl || '—'),
            h('span', null, 'WebSocket'), h('span', null, st.onebot.endpoint.wsUrl || '—'),
          ),
          !conn && st.onebot.problem ? h('div', { className: 'ab-note warn', style: { marginTop: 10 } }, st.onebot.problem) : null,
          testBtns, diagView,
          h('div', { style: { marginTop: 12 } }, h(Btn, { small: true, onClick: async () => { const r = await post('/test-send'); toast(r.message) } }, '发一条 QQ 自测')),
        ),
        h(Card, { fold: conn ? 'qq-endpoint' : undefined, section: conn ? undefined : 'qq-endpoint', title: 'QQ 网关配置', right: openWizard ? h(Btn, { small: true, kind: 'ghost', onClick: openWizard }, '重新走一遍设置向导') : null,
          desc: 'SnowLuma 没有 macOS 版：在 OrbStack（或 Docker Desktop）里跑它的官方镜像，用远程桌面登录机器人号 ' + (draft.platforms?.qq?.botQQ || draft.botQQ || '') + '，再把它的 OneBot 正向 WebSocket 地址和令牌填在这里，保存后插件就会去连。NapCat、LLOneBot、Lagrange 等任何 OneBot v11 实现也可以。插件只连接，不启动、不注入任何东西。' },
          h(OneBotFields, { draft, f }),
          h(Row, { label: '机器人 QQ 号' }, f.text('platforms.qq.botQQ')),
        ),
        h(Card, { fold: 'qq-workspace', title: '工作区与会话维护', desc: '每个 QQ 私聊 / 群都是 DSH 里「Aurabot · QQ」工作区下的一个会话，ta在会话里读写文件也在这个文件夹。改了以后新开的会话放到新位置；已有的会话还在原来的地方，想全部换成新会话，可在下方点「重新开始所有 QQ 会话」。' },
          h(Row, { label: '工作区文件夹', hint: '填完整路径（比如 ' + exPath('Aurabot/qq-chats') + '）；留空 = 使用全局/默认位置' }, f.text('platforms.qq.workspaceDir', { size: 'wide', placeholder: st.config.platforms?.qq?.workspaceDir || st.workspaceDir || '' })),
          h('div', { className: 'ab-muted ab-small' }, '现在用的：' + (st.workspaceDir || '—') + (st.workspaceReal && st.workspaceReal !== st.workspaceDir ? '（文件实际在 ' + st.workspaceReal + '）' : '')),
          h(Row, { label: '把现有文件搬过去', hint: '填一个空文件夹的完整路径。已有会话照常接着聊，原路径留一个联接指过去；聊天记录和记忆在用户目录的 .dsh 里，不跟着搬。她正在跑命令时搬不了' },
            h('div', { className: 'ab-flex' },
              h('input', { className: 'ab-input', value: moveTo, placeholder: exPath('Aurabot/qq-chats'), onChange: (e) => setMoveTo(e.target.value) }),
              h(Btn, { small: true, disabled: !moveTo.trim(), onClick: async () => {
                const r = await post('/workspace/move', { to: moveTo.trim() })
                toast(r.message, r.ok ? 'ok' : 'err')
                if (r.ok) { setMoveTo(''); reload() }
              } }, '搬过去'))),
            h(Btn, { small: true, kind: 'ghost', onClick: async () => {
              if (!confirm('重新开始所有 QQ 会话？普通旧会话会归档，有工作树的旧会话会留在侧栏。')) return
              const r = await post('/sessions/reset')
              toast(r.message)
              if (r.ok) reload()
            } }, '重新开始所有 QQ 会话'),
        ),
      )
    }

    /** 选一张图片当头像（最多 5MB）。 */
    async function pickAvatar(toast, reload) {
      const inp = document.createElement('input')
      inp.type = 'file'
      inp.accept = 'image/png,image/jpeg,image/gif,image/webp'
      const file = await new Promise((res) => { inp.onchange = () => res(inp.files && inp.files[0]); inp.oncancel = () => res(null); inp.click() })
      if (!file) return
      if (file.size > 5 * 1024 * 1024) return toast('图片太大了，最多 5MB', 'err')
      const data = await new Promise((res) => { const fr = new FileReader(); fr.onload = () => res(fr.result); fr.readAsDataURL(file) })
      const r = await post('/avatar/upload', { data })
      toast(r.message, r.ok ? 'ok' : 'err')
      reload()
    }
    const avatarSrc = (st) => API + '/avatar?v=' + ((st.avatar && st.avatar.at) || 0)

    function AvatarCard({ st, toast, reload }) {
      const custom = st.avatar && st.avatar.custom
      return h('div', { className: 'ab-card', style: { marginTop: 12, padding: 14 } },
        h('div', { className: 'ab-flex', style: { alignItems: 'center', gap: 12 } },
          h('img', { src: avatarSrc(st), alt: '头像', style: { width: 56, height: 56, borderRadius: '50%', objectFit: 'cover', objectPosition: '50% 18%', border: '2px solid var(--ab-line)' } }),
          h('div', null, h('b', null, '头像'), h('div', { className: 'ab-muted ab-small' }, custom ? '用的是你上传的图片' : '默认的大肥鱼'))),
        h('div', { className: 'ab-flex', style: { marginTop: 10, flexWrap: 'wrap' } },
          h(Btn, { small: true, kind: 'primary', onClick: () => pickAvatar(toast, reload) }, '换一张'),
          custom ? h(Btn, { small: true, kind: 'ghost', onClick: async () => { const r = await post('/avatar/reset'); toast(r.message, 'ok'); reload() } }, '恢复默认') : null,
          h(Btn, { small: true, kind: 'ghost', onClick: async () => { if (!confirm('把这张图设成机器人号的 QQ 头像？')) return; const r = await post('/avatar/sync-qq'); toast(r.message, r.ok ? 'ok' : 'err') } }, '同步成 QQ 头像')),
        h('div', { className: 'ab-muted ab-small', style: { marginTop: 6 } }, '这是面板里显示的头像；点「同步成 QQ 头像」才会改机器人号在 QQ 上的头像。'))
    }

    // 人格按【标题】分节：面板里拆开逐节编辑，保存时按原来的写法拼回一整段（文件格式不变）
    const PSEC_HEAD = /^【([^】\n]{1,30})】\s*$/
    const PSEC_SUGGEST = ['你的样子', '性格', '打字习惯', '情绪是活的', '你的生活', '和管理员的关系', '绝对禁止']
    // 每节一个颜色（跟着这一节走，挪位置颜色不变）。低饱和的雾色系，相邻的冷暖交替，深浅两种主题下都不刺眼：
    // 青瓷、雾紫、琥珀、雾蓝、藕粉、苔绿、黛蓝、赭石、橄榄、紫藤
    const PSEC_COLORS = ['#4f9a8c', '#8a7bc0', '#c08a4a', '#5f8fc7', '#c47a90', '#6f9f68', '#5c6fae', '#b9775a', '#8d9450', '#a173b5']
    let psecSeq = 0
    const psec = (title, text) => ({ k: ++psecSeq, title, text })
    const splitPersona = (body) => {
      const out = [psec(null, '')]
      let cur = out[0]
      let buf = []
      const flush = () => { cur.text = buf.join('\n').replace(/^\n+/, '').replace(/\s+$/, ''); buf = [] }
      for (const line of String(body || '').replace(/\r\n/g, '\n').split('\n')) {
        // 复制粘贴来的人设常带看不见的零宽字符（行首一个 U+200B），认标题时不算它
        const m = PSEC_HEAD.exec(line.replace(/[​-‍﻿]/g, '').trim())
        if (m) { flush(); cur = psec(m[1].trim(), ''); out.push(cur) } else buf.push(line)
      }
      flush()
      return out
    }
    const joinPersona = (secs) => secs
      .map((s) => (s.title === null ? s.text.trim() : '【' + (s.title.trim() || '未命名') + '】\n' + s.text.replace(/\s+$/, '')))
      .filter(Boolean).join('\n\n')
    const autoRows = (text) => Math.min(22, Math.max(3, String(text || '').split('\n').length + 1))

    /** 一节设定：标题、正文、上下移、删除、AI 润色。润色后原版和润色版只显示一个，按钮来回切，选定一个另一个就丢掉。 */
    function PersonaSection({ sec, lead, first, last, onChange, onMove, onDelete, onPolish, pending, onPick, onFlip }) {
      const showing = pending ? (pending.view === 'new' ? pending.text : sec.text) : sec.text
      const color = lead ? 'var(--ab-sea)' : PSEC_COLORS[sec.k % PSEC_COLORS.length]
      return h('div', { className: cx('ab-psec', lead && 'lead', pending && 'cmp'), style: { '--c': color } },
        h('div', { className: 'ab-psec-head' },
          lead
            ? h('div', { className: 'ab-psec-fixed' }, '开场', h('small', null, 'ta是谁，一两段话'))
            : h('input', { className: 'ab-psec-title', value: sec.title, placeholder: '这一节叫什么', maxLength: 30, onChange: (e) => onChange({ title: e.target.value.replace(/[【】\n]/g, '') }) }),
          h('span', { className: 'ab-psec-n' }, showing.length + ' 字'),
          h('div', { className: 'ab-psec-act' },
            lead ? null : h('button', { type: 'button', className: 'ab-ibtn', title: '往上移', disabled: first || !!pending, onClick: () => onMove(-1) }, navIcon('M12 19V5M6 11l6-6 6 6')),
            lead ? null : h('button', { type: 'button', className: 'ab-ibtn', title: '往下移', disabled: last || !!pending, onClick: () => onMove(1) }, navIcon('M12 5v14M6 13l6 6 6-6')),
            lead ? null : h('button', { type: 'button', className: 'ab-ibtn danger', title: '删掉这一节', disabled: !!pending, onClick: onDelete }, navIcon('M5 7h14M10 7V5h4v2M7 7l1 12h8l1-12'))),
          pending
            ? null
            : h(AiButton, { onClick: onPolish, empty: !sec.text.trim() })),
        h('textarea', {
          value: showing, rows: autoRows(showing), readOnly: !!pending,
          placeholder: lead ? '你是「…」，一个真实存在的人，正在用手机 QQ 和对面聊天。' : '- 一条一行，短句就好',
          onChange: (e) => onChange({ text: e.target.value }),
        }),
        pending ? h('div', { className: 'ab-compare' },
          h('span', { className: 'ab-compare-tag' }, pending.view === 'new' ? 'AI 润色版' : '原版'),
          h('span', { className: 'ab-muted ab-small' }, pending.view === 'new' ? '和原版比：' + (pending.text.length - sec.text.length >= 0 ? '多 ' : '少 ') + Math.abs(pending.text.length - sec.text.length) + ' 字' : '还没改过的样子'),
          h('div', { className: 'ab-spacer' }),
          h('button', { type: 'button', className: 'ab-chip solid', onClick: onFlip }, pending.view === 'new' ? '看原版' : '看润色版'),
          h(Btn, { small: true, kind: 'primary', onClick: () => onPick(pending.view) }, pending.view === 'new' ? '用润色版' : '保留原版')) : null)
    }
    function AiButton({ onClick, empty }) {
      const [busy, setBusy] = useState(false)
      return h('button', {
        type: 'button', className: 'ab-aibtn', disabled: busy, title: empty ? '让 AI 按这一节的标题先写一版' : '让 AI 把这一节改得更具体、更像真人',
        onClick: async () => { setBusy(true); try { await onClick() } finally { setBusy(false) } },
      },
      busy ? h('i', { className: 'ab-spin' }) : navIcon('M12 3l1.8 4.7L18.5 9.5l-4.7 1.8L12 16l-1.8-4.7L5.5 9.5l4.7-1.8zM19 15l.8 2.2L22 18l-2.2.8L19 21l-.8-2.2L16 18l2.2-.8z'),
      h('span', null, busy ? '润色中' : empty ? 'AI 写一版' : 'AI 润色'))
    }

    const personaDraftKey = (id) => 'aurabot.persona.draft.' + id
    function Persona({ st, toast, reload }) {
      const [list, setList] = useState(st.personas)
      const [current, setCurrent] = useState(st.config.persona.current)
      // 记住上次编辑的人格：切走标签页再回来还编辑同一个，而不是跳回正在用的那个
      const [sel, setSel] = useState(() => { try { return localStorage.getItem('aurabot.persona.sel') || st.config.persona.current } catch (e) { return st.config.persona.current } })
      const [edit, setEdit] = useState(null) // { id, name, tags, secs }
      const [dirty, setDirty] = useState(false)
      const [pending, setPending] = useState({}) // 节的 k → { text, view: 'new' | 'old' } AI 润色还没选定的
      const [whole, setWhole] = useState(() => { try { return localStorage.getItem('aurabot.persona.whole') === '1' } catch (e) { return false } })
      // 上次没保存的草稿：进来时只提示「要不要恢复」，不自动覆盖当前内容
      const [restore, setRestore] = useState(null)
      useEffect(() => { try { localStorage.setItem('aurabot.persona.sel', sel) } catch (e) {} }, [sel])
      const load = async (id) => {
        const r = await get('/persona/get?id=' + encodeURIComponent(id))
        if (!r.ok) return
        const server = { id: r.persona.id, name: r.persona.name, nickname: r.persona.nickname || '', tags: (r.persona.tags || []).join('，'), secs: splitPersona(r.persona.body) }
        let draft = null
        try { const raw = localStorage.getItem(personaDraftKey(id)); if (raw) { const d = JSON.parse(raw); if (d && d.id === id && typeof d.body === 'string' && d.body !== r.persona.body) draft = d } } catch (e) {}
        setEdit(server)
        setDirty(false)
        setRestore(draft ? { body: draft.body, name: draft.name, nickname: draft.nickname, tags: draft.tags, at: draft.at || 0 } : null)
        setPending({})
      }
      useEffect(() => { load(sel) }, [sel])
      // 编辑中的草稿只写 localStorage（不动磁盘）；切标签/刷新后在下次进来时提示是否恢复
      useEffect(() => {
        if (!edit || !dirty) return
        const t = setTimeout(() => {
          try { localStorage.setItem(personaDraftKey(edit.id), JSON.stringify({ id: edit.id, name: edit.name, nickname: edit.nickname, tags: edit.tags, body: joinPersona(edit.secs), at: Date.now() })) } catch (e) {}
        }, 200)
        return () => clearTimeout(t)
      }, [edit, dirty])
      const restoreDraft = () => {
        if (!restore) return
        setEdit({ ...edit, name: restore.name ?? edit.name, nickname: restore.nickname ?? edit.nickname, tags: restore.tags ?? edit.tags, secs: splitPersona(restore.body) })
        setDirty(true)
        setRestore(null)
        toast('已恢复上次的改动（还没保存，确认后点「保存人格」）', 'ok')
      }
      const discardDraft = () => {
        try { localStorage.removeItem(personaDraftKey(edit.id)) } catch (e) {}
        setRestore(null)
        toast('已丢弃上次没保存的改动')
      }
      const refresh = async () => { const r = await get('/personas'); if (r.ok) { setList(r.list); setCurrent(r.current) } }
      const body = edit ? joinPersona(edit.secs) : ''
      const waiting = Object.keys(pending).length
      const save = async () => {
        const r = await post('/persona/save', { id: edit.id, name: edit.name, nickname: edit.nickname || '', tags: edit.tags.split(/[,，\s]+/).filter(Boolean), body })
        toast(r.message || (r.ok ? '保存好了' : '没保存成功'))
        if (r.ok) { setDirty(false); setRestore(null); try { localStorage.removeItem(personaDraftKey(edit.id)) } catch (e) {} refresh() }
      }
      const patch = (p) => { setEdit({ ...edit, ...p }); setDirty(true) }
      const setSecs = (secs) => patch({ secs })
      const updSec = (k, p) => setSecs(edit.secs.map((s) => (s.k === k ? { ...s, ...p } : s)))
      const moveSec = (i, d) => { const n = edit.secs.slice(); const [x] = n.splice(i, 1); n.splice(i + d, 0, x); setSecs(n) }
      const delSec = (s) => { if (s.text.trim() && !confirm('删掉「' + (s.title || '未命名') + '」这一节？')) return; setSecs(edit.secs.filter((x) => x.k !== s.k)) }
      const addSec = (title) => setSecs([...edit.secs, psec(title, '')])
      const polish = async (s) => {
        const r = await post('/persona/polish', { name: edit.name, title: s.title === null ? '' : s.title, text: s.text, others: edit.secs.filter((x) => x.k !== s.k).map((x) => (x.title === null ? '开场' : x.title)) })
        if (!r.ok) { toast(r.message || '润色没成功', 'err'); return }
        if (!s.text.trim()) { updSec(s.k, { text: r.text }); toast('写好了，不满意就接着改', 'ok'); return }
        setPending({ ...pending, [s.k]: { text: r.text, view: 'new' } })
      }
      const pick = (s, view) => {
        const next = { ...pending }
        delete next[s.k]
        setPending(next)
        if (view === 'new') updSec(s.k, { text: pending[s.k].text })
      }
      const flip = (s) => setPending({ ...pending, [s.k]: { ...pending[s.k], view: pending[s.k].view === 'new' ? 'old' : 'new' } })
      const setMode = (w) => { if (w && waiting) { toast('先把 AI 润色的那几节选定一版', 'err'); return } setWhole(w); try { localStorage.setItem('aurabot.persona.whole', w ? '1' : '0') } catch (e) {} }
      const titles = edit ? edit.secs.map((s) => s.title) : []
      const suggest = PSEC_SUGGEST.filter((t) => !titles.includes(t))
      return h('div', { className: 'ab-persona' },
        h('div', { className: 'ab-plist' },
          list.map((p) => h('button', { key: p.id, type: 'button', className: cx('ab-pitem', sel === p.id && 'on'), onClick: () => setSel(p.id) },
            h('div', { className: 'nm' }, p.name, p.id === current ? h('span', { className: 'ab-badge' }, '正在用') : null),
            h('div', { className: 'tg' }, (p.tags || []).join(' · ') || p.id + ' · ' + p.chars + ' 字'))),
          h(Btn, { kind: 'ghost', onClick: () => { const id = 'persona-' + Date.now().toString(36); setEdit({ id, name: '新人格', tags: '', secs: splitPersona('你是……\n\n【打字习惯】\n- 短句、口语，一次只说一两句。') }); setSel(id); setDirty(true); setPending({}) } }, '＋ 新建人格'),
          h(AvatarCard, { st, toast, reload }),
        ),
        edit ? h(Card, { title: '编辑人格', desc: '人格写在系统提示词的最前面，按节写更好改。离开不会自动保存；切标签/切页面会先记住草稿，下次进来会问你要不要恢复；输入框里 Ctrl+Z 可撤回。保存后大肥鱼下一轮回复起就按新的来。',
          right: h('div', { className: 'ab-flex' },
            edit.id !== current ? h(Btn, { small: true, onClick: async () => { const r = await post('/persona/use', { id: edit.id }); toast(r.message); refresh(); reload() } }, '设为当前') : null,
            edit.id !== current ? h(Btn, { small: true, kind: 'danger', onClick: async () => { if (!confirm('删掉这个人格？')) return; const r = await post('/persona/delete', { id: edit.id }); if (r.ok) { try { localStorage.removeItem(personaDraftKey(edit.id)) } catch (e) {} setList(r.list); setSel(current) } else toast(r.message) } }, '删除') : null) },
          restore ? h('div', { className: 'ab-flex', style: { marginTop: 12, padding: '8px 10px', border: '1px solid #4a4a55', borderRadius: 8, background: 'rgba(255,255,255,.04)' } },
            h('span', { className: 'ab-small' }, '发现上次没保存的人格改动（' + String(restore.body || '').length + ' 字' + (restore.at ? '，' + new Date(restore.at).toLocaleString() : '') + '）。要恢复吗？'),
            h('div', { className: 'ab-spacer' }),
            h(Btn, { small: true, kind: 'primary', onClick: restoreDraft }, '恢复'),
            h(Btn, { small: true, kind: 'ghost', onClick: discardDraft }, '丢弃')) : null,
          h(Row, { label: '名字' }, h('input', { className: 'ab-input', value: edit.name, onChange: (e) => patch({ name: e.target.value }) })),
          h(Row, { label: '小名', hint: '和「人格与自我」里的小名联动' }, h('input', { className: 'ab-input', value: edit.nickname || '', onChange: (e) => patch({ nickname: e.target.value }) })),
          h(Row, { label: '标签', hint: '用逗号隔开' }, h('input', { className: 'ab-input', value: edit.tags, onChange: (e) => patch({ tags: e.target.value }) })),
          h('div', { className: 'ab-flex', style: { marginTop: 14 } },
            h(Seg, { value: whole ? 'whole' : 'secs', onChange: (v) => setMode(v === 'whole'), options: [{ value: 'secs', label: '分节' }, { value: 'whole', label: '整段' }] }),
            h('div', { className: 'ab-spacer' }),
            h('span', { className: 'ab-muted ab-small' }, (edit.secs.length - 1) + ' 节 · ' + body.length + ' 字')),
          whole
            ? h('textarea', { className: 'ab-textarea', style: { minHeight: 380, marginTop: 12 }, value: body, onChange: (e) => setSecs(splitPersona(e.target.value)) })
            : h('div', { className: 'ab-psecs' },
              edit.secs.map((s, i) => h(PersonaSection, {
                key: s.k, sec: s, lead: s.title === null, first: i <= 1, last: i === edit.secs.length - 1, pending: pending[s.k],
                onChange: (p) => updSec(s.k, p), onMove: (d) => moveSec(i, d), onDelete: () => delSec(s),
                onPolish: () => polish(s), onPick: (v) => pick(s, v), onFlip: () => flip(s),
              })),
              h('div', { className: 'ab-psec-add' },
                h('span', { className: 'ab-muted ab-small' }, '加一节：'),
                suggest.map((t) => h('button', { key: t, type: 'button', className: 'ab-chip', onClick: () => addSec(t) }, t)),
                h('button', { type: 'button', className: 'ab-chip solid', onClick: () => addSec('') }, '＋ 自己起名'))),
          h('div', { className: 'ab-flex', style: { marginTop: 14 } },
            waiting ? h('span', { className: 'ab-muted ab-small' }, '还有 ' + waiting + ' 节 AI 润色没选定，选好再保存') : null,
            h('div', { className: 'ab-spacer' }),
            h(Btn, { kind: 'primary', disabled: !dirty || !!waiting, onClick: save }, dirty ? '保存人格' : '已保存')),
        ) : h(Card, null, h(Empty, { icon: '⏳', text: '加载中…' })),
      )
    }

    /**
     * 按工作区控制「授权 / 提问」要不要在 QQ 里说（移植自原项目 354160e）。
     * 工作区是 DSH 动态登记的，所以单独拉接口，不走配置表单的 draft。
     */
    function NoticeWorkspaces({ toast }) {
      const [info, setInfo] = useState(null)
      const load = async () => {
        try { setInfo(await get('/notice/state')) } catch (e) { setInfo({ ok: false, workspaces: [] }) }
      }
      useEffect(() => { load() }, [])
      const toggle = async (kind, workspace, value) => {
        try {
          const r = await post('/notice/toggle', { kind, workspace, value })
          if (r && r.ok === false) toast(r.message, 'err')
          await load()
        } catch (e) { toast(e.message, 'err') }
      }
      const list = info?.workspaces || []
      return h('div', { style: { marginTop: 6 } },
        h('div', { className: 'ab-small ab-muted', style: { margin: '4px 0' } }, '按工作区分开管（点了立刻生效）：'),
        list.length === 0
          ? h('div', { className: 'ab-muted ab-small' }, info ? '这个 DSH 里还没有工作区。' : '读取中…')
          : list.map((w) => h(Row, { key: w.path, label: w.name, hint: w.path + (w.sessions ? ` · ${w.sessions} 个会话` : '') },
            h('div', { style: { display: 'flex', gap: 10, alignItems: 'center' } },
              h('span', { className: 'ab-small ab-muted' }, '授权'), h(Switch, { on: w.approval, onChange: (v) => toggle('approval', w.path, v) }),
              h('span', { className: 'ab-small ab-muted' }, '提问'), h(Switch, { on: w.question, onChange: (v) => toggle('question', w.path, v) })))))
    }

    function DrawChatPermissions({ st, draft, setDraft }) {
      const owner = String(draft.platforms?.qq?.ownerQQ || draft.ownerQQ || '')
      const bot = String(draft.platforms?.qq?.botQQ || draft.botQQ || '')
      const [names, setNames] = useState({})
      const savedAllow = st.config?.platforms?.qq?.allow || st.config?.allow
      useEffect(() => {
        let active = true
        get('/access/chat-names').then((result) => {
          if (active && result.ok) setNames(result)
        }).catch(() => {})
        return () => { active = false }
      }, [savedAllow?.private?.join(','), savedAllow?.groups?.join(',')])

      const row = (kind, label, ids, fallback) => {
        const selected = draft.platforms?.qq?.drawAllow?.[kind] ?? draft.drawAllow?.[kind] ?? []
        return h(Row, { label }, ids.length
          ? ids.map((id) => h('button', {
            className: cx('ab-chip', selected.includes(id) && 'on'), key: id, type: 'button',
            'aria-pressed': selected.includes(id),
            onClick: () => setDraft((prev) => {
              const current = prev.platforms?.qq?.drawAllow?.[kind] ?? prev.drawAllow?.[kind] ?? []
              return setPath(prev, 'platforms.qq.drawAllow.' + kind, current.includes(id) ? current.filter((x) => x !== id) : [...current, id])
            }),
          }, names[kind]?.[id] || fallback, h('span', { className: 'n' }, id)))
          : h('span', { className: 'ab-muted ab-small' }, '暂无可选会话。'))
      }

      return h(Card, { fold: 'qq-draw-allow', title: '生图白名单', desc: '生图启用后，管理员有权限画图。其他人只能在这里勾选的会话里请求画图。' },
        row('private', '其他好友私聊', ((draft.platforms?.qq?.allow || draft.allow)?.private || []).map(String).filter((id) => id !== owner && id !== bot), '好友'),
        row('groups', 'QQ 群', ((draft.platforms?.qq?.allow || draft.allow)?.groups || []).map(String), '群'))
    }

    function Access({ st, draft, setDraft, toast }) {
      const f = useField(draft, setDraft)
      return h('div', { className: 'ab-grid' },
        h(Card, { section: 'qq-allowlist', className: 'ab-allowlist', title: '私聊与群白名单', desc: '只有名单里的人和群，ta才会理。一行一个号码。' },
          h(Row, { label: '私聊白名单', hint: '管理员默认就在里面。' }, f.list('platforms.qq.allow.private', { placeholder: '每行一个 QQ 号', numbers: true })),
          h(Row, { label: '群白名单', hint: '把机器人拉进群后，把群号加到这里。' }, f.list('platforms.qq.allow.groups', { placeholder: '每行一个群号', numbers: true })),
        ),
        h(DrawChatPermissions, { st, draft, setDraft }),
        h(Card, { fold: 'qq-owner', title: '管理员与私聊权限', desc: '管理员的 QQ 号。群管、点歌、电脑上的操作只听管理员的。' },
          h(Row, { label: '管理员 QQ 号' }, f.text('platforms.qq.ownerQQ')),
          h(Row, { label: 'ta怎么称呼你', hint: '一开始她这么叫你；之后她可以自己换个叫法（会通知你，「人格与自我」页能看、能退回）。你在这里改了，就以你改的为准。' }, f.text('ownerName', { placeholder: '管理员' })),
          h(Row, { label: '管理员私聊的权限', hint: '群聊永远没有电脑操作权限，这里管不到群。' },
            h('div', { style: { width: '100%' } },
              h(Choices, { value: draft.ownerLevel, onChange: (v) => setDraft(setPath(draft, 'ownerLevel', v)), options: [
                { value: 'full', label: '完整', desc: '私聊里让ta用电脑做事（查文件、跑命令、上网查）也能做' },
                { value: 'social', label: '受限', desc: '可用 QQ 和心智工具，例如查关系、回忆经历、看待办。无本机读写权限。' },
                { value: 'chat', label: '纯聊天', desc: '什么工具都没有，只聊天' },
              ] }),
              h('div', { className: 'ab-muted ab-small', style: { marginTop: 8 } }, '切换后会给管理员私聊换一个新的 DSH 会话（旧的还在侧栏里）。'))),
          h(Row, { label: '给她自由', hint: '开启后，她可以自行决定怎么聊天和创作。修改 QQ 资料、管理好友或群、读写本机文件等操作仍需通过当前会话的管理员权限检查。' }, f.sw('freedom')),
        ),
        h(Card, { fold: 'qq-notices', title: 'DSH 授权与通知' },
          h(Row, { label: 'DSH 卡住时在 QQ 里说一声', hint: '有会话在等授权、等你选东西时，她用自己的话跟你说一句（不是固定通知）。人不在电脑前也知道。' }, f.sw('notice.enabled')),
          draft.notice?.enabled === false ? null : [
            h(Row, { key: 'a', label: '要授权时', hint: '工具卡住、等你点批准的时候' }, f.sw('notice.approval')),
            h(Row, { key: 'q', label: '要选选项时', hint: '有会话在等你选东西的时候' }, f.sw('notice.question')),
            h(NoticeWorkspaces, { key: 'w', toast }),
          ],
          h(Row, { label: '在 QQ 里批准', hint: '和你私聊时要授权，回复「确认」批准这一次、回复「取消」拒绝，5 分钟没回就不批。只认你本人的私聊回复，DSH 里也能同时点。QQ 号被盗的话，对方也能批，介意就关掉' }, f.sw('approvalViaQQ')),
        ),
        h(HostToolPermissions, { draft, setDraft }),
        h(ProfilePerms, { st, draft, setDraft }),
        modOn(st, 'group-admin') ? h(GroupRoles, null) : null,
        h(CommandList, null),
      )
    }

    function HostToolPermissions({ draft, setDraft }) {
      const f = useField(draft, setDraft)
      return h(Card, { fold: 'qq-host-tools', title: '本机工具与发文件' },
        h('div', { className: 'ab-grid' },
        h(Card, { title: '发文件', right: f.sw('files.enabled'), desc: '打开后，你可以让ta把本机文件发到 QQ：图片会直接显示成图，其它当文件发。私聊里随时能发，群里只在你自己开口那一轮能发；也能按你说的发给白名单里的人或群。ta只能发 QQ 工作区和下面目录里的文件；单个文件有大小上限；发过什么会记在日志里。' },
          h(Row, { label: '单个文件最大' }, f.num('files.maxMB', { min: 1, max: 2048 }), h('span', { className: 'ab-muted' }, ' MB')),
          h(Row, { label: '额外允许的目录', hint: '一行一个完整路径。QQ 工作区里的文件一直允许，不用写；留空 = 只能发工作区里的' }, f.list('files.dirs', { placeholder: exPath('Desktop') })),
          h(Row, { label: '图片和文件按路径直发', hint: '网关和插件在同一台机器或共享挂载时，直接把路径交给网关，省掉读盘和 base64 膨胀。Mac 上网关在 Docker / OrbStack 里读不到本机路径，默认关，建议保持关；关着时图片和文件都直接走 base64 / 下载口。' }, f.sw('files.imageByPath')),
          h(Row, { label: '大文件下载口', hint: '网关跑在 Docker / 虚拟机里看不到本机文件时，超过 30 MB 的文件会临时开一个只对本机开放的下载地址让网关来取（随机口令，15 分钟作废）。关掉后这种情况下大文件发不出去' }, f.sw('files.relay')),
          draft.files.relay !== false ? h(Row, { label: '网关访问本机用的地址', hint: 'OrbStack、Docker Desktop 都是 host.docker.internal；网关在别的电脑上时这招不管用' }, f.text('files.relayHost', { placeholder: 'host.docker.internal' })) : null,
        ),
        h(Card, { title: '群里的本机工具', right: f.choices('group.ownerTools', [{ value: 'off', label: '谁都不行' }, { value: 'owner', label: '只有管理员' }]),
          desc: '默认关：群里ta只能聊天，没有任何电脑操作能力。「只有管理员」＝管理员在群里说话的那一轮ta才拿得到命令和文件工具，别人说话时照旧收走。没有「谁问都行」这一档：群里任何人都能远程驱动这台机器，权限面太大。',
          ...(draft.group.ownerTools && draft.group.ownerTools !== 'off' ? [
            h(Row, { label: '只在这些群生效', hint: '一行一个群号；留空 = 白名单里所有群都生效' }, f.list('group.ownerToolsGroups', { placeholder: '100200300' })),
          ] : []),
        }),
        h(Card, { title: '工具与任务' },
          h(Row, { label: 'QQ 接口', hint: '让她用 QQ 的其他能力：别人只能查当前群的公告、精华这些；撤回、设精华、改群名片等只听你的。取 Cookie、发原始包、删好友、退群这些不开放。' }, f.sw('qqApi.enabled')),
          h(Row, { label: '长任务模式', hint: '只在「完整」权限下生效。打开后ta能把命令放到后台跑、跑完自动回来告诉你，也能设定时任务；工具多一点，回话会稍慢。切换后同样换新会话。' },
            h(Choices, { value: draft.longTasks ? 'on' : 'off', onChange: (v) => setDraft(setPath(draft, 'longTasks', v === 'on')), options: [
              { value: 'off', label: '关', desc: '工具少一点，回话快一点' },
              { value: 'on', label: '开', desc: '干长活时能接着聊（默认）' },
            ] })),
          h(Row, { label: '后台子智能体', hint: '默认关。关着时只有你本人最近 5 分钟内说过话，模块才被允许派子智能体（拿本机命令/文件能力干活动）；打开后，定时任务这类没人应答的后台流程也能派——等于把这份能力也交给后台。' },
            h(Choices, { value: draft.subagentBackground ? 'on' : 'off', onChange: (v) => setDraft(setPath(draft, 'subagentBackground', v === 'on')), options: [
              { value: 'off', label: '关', desc: '后台任务不派子智能体（默认）' },
              { value: 'on', label: '开', desc: '后台任务也可以派子智能体' },
            ] })),
        )))
    }

    /** 内置 QQ 资料和名单操作仍须由管理员亲口发起。 */
    function ProfilePerms({ st, draft, setDraft }) {
      const perms = draft.profilePerms || {}
      const opts = [
        { value: 'off', label: '关', desc: '谁说都不改' },
        { value: 'owner', label: '仅管理员私聊', desc: '只有你私聊让ta改才改（默认）' },
        { value: 'all', label: '所有人', desc: '白名单里的人、群里的人都能让ta改' },
      ]
      const ownerOpts = [...opts.slice(0, 2), { value: 'all', label: '管理员私聊或群聊', desc: '这一轮只有管理员发言时可用' }]
      const row = (key, label, hint, options = opts) => h(Row, { label, hint },
        h(Choices, { value: perms[key] || 'owner', onChange: (v) => setDraft(setPath(draft, 'profilePerms.' + key, v)), options }))
      return h(Card, { fold: 'qq-profile', title: '改资料与名单', desc: 'ta能不能听人的话改自己的 QQ 昵称、签名、头像，处理好友申请和改白名单；外部模块的权限在各自模块面板里设置。改 QQ 资料要 SnowLuma 支持。各项默认仅管理员。' },
        row('qqNickname', 'QQ 昵称', '', ownerOpts),
        row('qqSignature', 'QQ 个性签名', '', ownerOpts),
        row('qqAvatar', 'QQ 头像', '只用网址图片，或「刚才发的那张图」。', ownerOpts),
        row('qqFriendRequest', '处理好友申请', '让ta通过或拒绝好友申请。处理加群申请须在管理员私聊。', ownerOpts),
        row('whitelist', '改白名单', '让ta把 QQ 号或群号加进或移出白名单。管理员会保留在白名单中。', ownerOpts),
      )
    }

    /** QQ 里的管理员命令一览。 */
    function CommandList() {
      const [list, setList] = useState([])
      useEffect(() => { get('/commands').then((r) => setList(r.list || [])) }, [])
      return h(Card, { fold: 'qq-commands', title: 'QQ 命令', desc: '管理员在 QQ 里（私聊或白名单群）直接发这些命令就能管ta，别人发了不算。总开关关着时也能用。' },
        h('table', { className: 'ab-table' }, h('tbody', null, list.map((c) => h('tr', { key: c.name },
          h('td', { style: { whiteSpace: 'nowrap' } }, h('code', null, '/' + c.name), c.aliases.length ? h('div', { className: 'ab-muted ab-small' }, c.aliases.map((a) => '/' + a).join(' ')) : null),
          h('td', null, c.desc))))))
    }

    /** 她在每个白名单群里的身份：群主 / 群管理员才能禁言踢人。 */
    function GroupRoles() {
      const [result, setResult] = useState(null)
      const load = () => { setResult(null); get('/groups/roles').then(setResult) }
      const list = result?.list || []
      useEffect(load, [])
      return h(Card, { fold: 'qq-group-admin', title: '群管权限', desc: 'ta在群里是群主或群管理员时，管理员才能让ta禁言、踢人、发公告；改专属头衔要群主。按已保存的群白名单查。',
        right: h(Btn, { small: true, kind: 'ghost', onClick: load }, '刷新') },
        !result ? h('div', { className: 'ab-muted ab-small' }, h('i', { className: 'ab-spin' }), ' 查询中…')
          : !result.ok ? h('div', { className: 'ab-muted ab-small', role: 'status' }, result.message || '暂时查不到群管权限。')
          : list.length === 0 ? h('div', { className: 'ab-muted ab-small' }, '群白名单是空的。')
          : h('table', { className: 'ab-table' },
            h('thead', null, h('tr', null, ['群', 'ta的身份', '群管'].map((x) => h('th', { key: x }, x)))),
            h('tbody', null, list.map((g) => h('tr', { key: g.groupId },
              h('td', null, (g.name && g.name !== g.groupId ? g.name + ' ' : '') + '(' + g.groupId + ')'),
              h('td', null, g.label),
              h('td', null, g.canManage ? h('span', { className: 'ab-badge' }, '可以') : h('span', { className: 'ab-muted ab-small' }, '不行')))))))
    }

    /** 按群头衔不理：勾选的群里，专属头衔是某个词的成员（别的机器人）她不理。头衔可以从群里现有的里面点一个。 */
    function TitleFilter({ draft, setDraft }) {
      const tf = draft.titleFilter || { enabled: true, groups: [], title: '大肥鱼' }
      const [info, setInfo] = useState(null) // { groups, titles, failed, message } 拉过才有 titles
      const [busy, setBusy] = useState(false)
      const set = (p) => setDraft(setPath(draft, 'titleFilter', { ...tf, ...p }))
      const pull = async () => {
        setBusy(true)
        const r = await get('/groups/titles')
        setBusy(false)
        if (r.ok) setInfo(r)
        else setInfo({ groups: [], titles: [], message: r.message || '没拉到' })
      }
      useEffect(() => { pull() }, [])
      const groups = (draft.allow.groups || []).map(String)
      const nameOf = (gid) => { const g = ((info && info.groups) || []).find((x) => x.groupId === gid); return g && g.name && g.name !== gid ? g.name : '' }
      const on = (gid) => tf.groups.includes(gid)
      const hit = info && info.titles ? info.titles.find((t) => t.title === tf.title.trim()) : null
      return h(Card, { fold: 'qq-title-filter', title: '按头衔不理（防机器人互聊）', right: h(Switch, { on: tf.enabled, onChange: (v) => set({ enabled: v }) }),
        desc: '同一个群里有别的机器人时，给它们挂上同一个专属头衔（比如「大肥鱼」），ta在勾选的群里就不理它们：说话、@ ta、戳ta都不回，免得机器人之间互相接话停不下来。只认专属头衔，昵称和群名片不算；私聊不受影响。' },
        h(Row, { label: '要不理的头衔', hint: '一字不差才算。下面列出白名单群里现有的头衔，点一个就填进来。' },
          h('div', { style: { width: '100%' } },
            h('div', { className: 'ab-flex' },
              h('input', { className: 'ab-input', value: tf.title, maxLength: 30, placeholder: '大肥鱼', onChange: (e) => set({ title: e.target.value }) }),
              h(Btn, { small: true, onClick: pull, disabled: busy }, busy ? '拉取中…' : '从群里拉取头衔')),
            info && info.titles ? h('div', { className: 'ab-psec-add', style: { marginTop: 10 } },
              info.titles.length
                ? info.titles.slice(0, 30).map((t) => h('button', { key: t.title, type: 'button', className: cx('ab-chip', t.title === tf.title.trim() && 'on'), title: t.members.map((m) => m.name).join('、'), onClick: () => set({ title: t.title }) }, t.title, h('span', { className: 'n' }, t.count + ' 人')))
                : h('span', { className: 'ab-muted ab-small' }, groups.length ? '这些群里还没有人挂专属头衔。' : '群白名单是空的，先在「权限」页加群。')) : null,
            hit ? h('div', { className: 'ab-tf-who' }, '挂着「' + hit.title + '」的：' + hit.members.map((m) => m.name + '（' + m.id + '）').join('、') + (hit.count > hit.members.length ? ' 等 ' + hit.count + ' 人' : '')) : null,
            info && info.message ? h('div', { className: 'ab-muted ab-small', style: { marginTop: 6 } }, info.message) : null)),
        h(Row, { label: '在哪些群生效', hint: '没勾的群照常回。只列白名单里的群。' },
          groups.length
            ? h('div', { className: 'ab-flex' }, groups.map((gid) => h('button', { key: gid, type: 'button', className: cx('ab-chip', on(gid) && 'on'), onClick: () => set({ groups: on(gid) ? tf.groups.filter((x) => x !== gid) : [...tf.groups, gid] }) },
              (on(gid) ? '✓ ' : '') + (nameOf(gid) || '群'), h('span', { className: 'n' }, gid))))
            : h('span', { className: 'ab-muted ab-small' }, '群白名单是空的。')),
        h('div', { className: 'ab-muted ab-small', style: { marginTop: 6 } }, '查不到某人的头衔时（网关抽风），那条先不回，过几秒再查；成员改了头衔一分钟内生效。'))
    }

    function Group({ draft, setDraft, go }) {
      const f = useField(draft, setDraft)
      const overrides = draft.group.overrides || {}
      const [newGid, setNewGid] = useState('')
      const [secChat, setSecChat] = useState('')
      const [secLog, setSecLog] = useState(null)
      const [secGroupId, setSecGroupId] = useState('')
      const [secGroupProvider, setSecGroupProvider] = useState('')
      const [secGroupModel, setSecGroupModel] = useState('')
      const [secStats, setSecStats] = useState({})
      const loadSecretary = async () => {
        if (!secChat.trim()) { setSecLog([]); setSecStats({}); return }
        const r = await get('/chat/secretary?chatId=' + encodeURIComponent(secChat.trim()))
        setSecLog(r.list || []); setSecStats(r.stats || {})
      }
      return h('div', { className: 'ab-grid' },
        h(Card, { section: 'qq-wake', title: '群聊回应与唤醒词', desc: '被 @、有人引用回复ta的消息、或者提到下面这些名字时，ta一定会回。',
          right: go ? h(Btn, { small: true, kind: 'ghost', onClick: () => go('access', { section: 'qq-host-tools' }) }, '本机工具与发文件 →') : null },
          h(Row, { label: '@ 了别人不算叫ta', hint: '有人 @ 别人时顺口提到ta的名字，不算在叫ta；ta还是可以按平时的频率插话。默认关' }, f.sw('group.ignoreAtOthers')),
          h(Row, { label: '别的叫法', hint: '她的名字和小名自动算（她改名后跟着变）；这里加别的叫法，一行一个' },f.list('group.wakeWords', { placeholder: '一行一个' })),
          h(Row, { label: '每小时必回上限', hint: '一个群里一小时内因被 @、引用、叫名字而必回的次数最多这么多，超过就不回（管理员说话不受限，也不计入）；小时一过自动恢复。0 = 不限' }, f.range('group.mustMaxPerHour', 0, 100, 5, (v) => (v === 0 ? '不限' : v + ' 次'))),
        ),
        h(Card, { fold: 'qq-secretary', title: '群聊秘书闸', right: f.sw('chat.secretary.enabled'), desc: '可选：先用便宜的模型判断这段群聊值不值得叫主模型。默认关；@、引用、叫名字的必回不经过这里。' },
          h(Row, { label: '秘书模型', hint: '填 provider/model；留空用当前聊天模型。建议用便宜的小模型' },
            f.text('chat.secretary.provider', { placeholder: 'provider，如 openai' }),
            f.text('chat.secretary.model', { placeholder: 'model，如 gpt-4o-mini' })),
          h(Row, { label: '最多看几条', hint: '最近这么多条群消息 + 本轮合并内容' }, f.num('chat.secretary.maxRecent', { min: 1, max: 100, step: 1 })),
        ),
        h(Card, { fold: 'qq-secretary-groups', title: '按群秘书覆盖', desc: '只对某个群改秘书模型；没写的群继承上面的全局设置。' },
          Object.keys(draft.chat?.secretary?.groups || {}).length === 0 ? h('div', { className: 'ab-muted ab-small' }, '还没有单独设置。') :
            Object.entries(draft.chat.secretary.groups).map(([gid, v]) => h(Row, { key: gid, label: '群 ' + gid },
              h('span', { className: 'ab-muted' }, `${v.enabled === false ? '关' : '开'} · ${v.provider || '默认'}/${v.model || '默认'}`),
              h(Btn, { small: true, kind: 'ghost', onClick: () => {
                const groups = { ...draft.chat.secretary.groups, [gid]: { ...v, enabled: v.enabled === false } }
                setDraft(setPath(draft, 'chat.secretary.groups', groups))
              } }, v.enabled === false ? '开启' : '关闭'),
              h(Btn, { small: true, kind: 'ghost', onClick: () => {
                const next = { ...draft.chat.secretary.groups }; delete next[gid]
                setDraft(setPath(draft, 'chat.secretary.groups', next))
              } }, '移除'))),
          h('div', { className: 'ab-flex', style: { gap: 6, marginTop: 8 } },
            h('input', { className: 'ab-input sm', placeholder: '群号', value: secGroupId, onChange: (e) => setSecGroupId(e.target.value.replace(/\D/g, '')) }),
            h('input', { className: 'ab-input sm', placeholder: 'provider', value: secGroupProvider, onChange: (e) => setSecGroupProvider(e.target.value) }),
            h('input', { className: 'ab-input sm', placeholder: 'model', value: secGroupModel, onChange: (e) => setSecGroupModel(e.target.value) }),
            h(Btn, { small: true, disabled: !secGroupId, onClick: () => {
              const id = secGroupId.startsWith('qq:') ? secGroupId : 'qq:group:' + secGroupId
              const groups = { ...(draft.chat?.secretary?.groups || {}), [id]: { enabled: true, provider: secGroupProvider, model: secGroupModel } }
              setDraft(setPath(draft, 'chat.secretary.groups', groups))
              setSecGroupId(''); setSecGroupProvider(''); setSecGroupModel('')
            } }, '添加')),
        ),
        h(Card, { fold: 'qq-secretary-log', title: '最近秘书判断', desc: '按会话查看最近 20 次秘书闸结果，排查“为什么没回”。',
          right: h('span', { className: 'ab-flex', style: { gap: 6 } },
            h(Btn, { small: true, kind: 'ghost', onClick: loadSecretary }, '刷新'),
            h(Btn, { small: true, kind: 'ghost', onClick: async () => {
              const r = await get('/chat/secretary/export')
              const blob = new Blob([JSON.stringify(r.stats || {}, null, 2)], { type: 'application/json' })
              const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'secretary-stats.json'; a.click(); URL.revokeObjectURL(a.href)
            } }, '导出')) },
          h(Row, { label: '会话 ID', hint: '如 qq:group:123456 或 telegram:group:-100…' },
            h('input', { className: 'ab-input wide', value: secChat, placeholder: '渠道:group:群号', onChange: (e) => setSecChat(e.target.value) })),
          secLog === null ? h('div', { className: 'ab-muted ab-small' }, '填会话 ID 后点刷新')
            : secLog.length === 0 ? h('div', { className: 'ab-muted ab-small' }, '还没有记录')
              : h('div', null,
                h('div', { className: 'ab-muted ab-small', style: { marginBottom: 6 } },
                  `累计：放行 ${secStats.allowed || 0}，不接 ${secStats.blocked || 0}；本页最近 ${secLog.length} 次`),
                h('table', { className: 'ab-table' }, h('tbody', null, secLog.slice().reverse().map((x, i) => h('tr', { key: i },
                  h('td', null, new Date(x.at).toLocaleString()), h('td', null, x.allowed ? '放行' : '不接'), h('td', { className: 'ab-muted' }, x.reason))))),
                secStats.days && Object.keys(secStats.days).length ? h('div', { style: { marginTop: 10 } },
                  h('div', { className: 'ab-muted ab-small' }, '按天'),
                  h('table', { className: 'ab-table' }, h('tbody', null, Object.entries(secStats.days).slice(0, 7).map(([day, n]) => h('tr', { key: day },
                    h('td', null, day), h('td', null, `放行 ${n.allowed || 0}`), h('td', null, `不接 ${n.blocked || 0}`)))))) : null,
              ),
        ),
        h(Card, { fold: 'qq-merge', title: '连发合并', right: f.sw('merge.enabled'), desc: '人常常一口气发好几句。打开后ta会等对方说完再一起回，而不是一句一回。' },
          h(Row, { label: '对方停顿多久算说完' }, f.range('merge.waitSec', 0.5, 10, 0.5, (v) => v + ' 秒')),
          h(Row, { label: '最多等多久', hint: '对方一直在发也最多等这么久' }, f.range('merge.maxSec', 2, 30, 1, (v) => v + ' 秒')),
          h(Row, { label: '群里停顿多久算一段', hint: '群里大家你一句我一句，多等一会儿把一段话攒齐再回；ta回上一段的时候，新消息也会先攒着' }, f.range('merge.groupWaitSec', 1, 20, 1, (v) => v + ' 秒')),
          h(Row, { label: '群里最多等多久' }, f.range('merge.groupMaxSec', 3, 60, 1, (v) => v + ' 秒')),
        ),
        h(Card, { fold: 'qq-history', title: '跨群阅读与会话上下文' },
          h(Row, { label: '能不能看别的群', hint: '只读白名单里的群，一次最多 50 条，管理员随时能看。开到「群里也行」后，ta在 A 群的回答全群都看得到，里面可能有不在 B 群的人；读到的内容也会留在这个会话里。' }, f.choices('group.crossRead', [{ value: 'off', label: '关', desc: '只看当前聊天' }, { value: 'private', label: '私聊可以', desc: '管理员，以及私聊里问的人本身在那个群（默认）' }, { value: 'group', label: '群里也行', desc: '再加上群里问的人都在那个群' }])),
          h(Row, { label: '新会话先补看聊天记录', hint: '会话第一次开口时先读最近几条，接得上话。默认关' }, f.sw('chat.seedHistory')),
          h(Row, { label: '给扩展提供近期私聊线索', hint: '默认关闭。开启后，已安装扩展的提示词钩子可收到当前管理员私聊的近期原话，用于授权的历史资料检索。' }, f.sw('chat.shareRecentWithModules')),
        ),
        h(Card, { fold: 'qq-reply-output', title: '回复正文与超时' },
          h(Row, { label: '每段都发', hint: '一轮里她分几段说，就发几条。私聊多半是闲聊，连着说的几句常常各说各的，关着只发最后一段，看起来就像只回了一个话题；干活时前面多是「我先去查」这类过程话，开着会啰嗦。默认关' }, f.sw('chat.everyStep')),
          h(Row, { label: '回复防漏', hint: '过滤明显混进回复的思考和草稿，保留围栏中的代码' }, f.sw('chat.thinkingGuard')),
          h(Row, { label: '严格正文标记', hint: '只发送完整标记内的正文。缺失时尝试重写一次' }, f.sw('chat.replyMarker')),
          h(Row, { label: '话写在思考里也捞出来', hint: '她偶尔把要说的话全写在思考里，正文是空的，这一轮就什么都发不出去。打开后从思考里找她自己定稿的那段，找不到就不发。默认关' }, f.sw('chat.rescueFromThinking')),
          h(Row, { label: '不要说的台词', hint: '一行一条。她整条回复都是这些台词时会改成「嗯」或「啊？」；正常句子里出现不会乱删。' }, f.list('chat.clicheFilters', { placeholder: '一行一条，例如：这句话稳' })),
          h(Row, { label: '一轮最多等多久（分钟）', hint: '模型或工具卡住时，超过这么多分钟就强制放开，后面的消息正常开新一轮；不然会一直哑着。填 0 不兜底。默认 30' }, f.num('chat.turnTimeoutMinutes', { min: 0, max: 180 })),
        ),
        h(TitleFilter, { draft, setDraft }),
        h(Card, { fold: 'qq-brakes', title: '安全刹车', desc: '只防失控（比如和别的机器人聊停不下来）：ta在一个群里短时间说太多就歇一会儿；别人 @ ta、引用 ta、喊 ta 名字或追问 ta 不算主动接话，不会被刹车拦。平时碰不到。' },
          h(Row, { label: '连着接话几次', hint: '她会自己判断该不该停，这里只是兜底：没人叫她时最多连着接几次。0 = 不接话' }, f.range('group.engagedMax', 0, 10, 1, (v) => v + ' 次')),
          h(Row, { label: '最多说几次' }, f.range('group.burstMax', 1, 20, 1, (v) => v + ' 次'), h('span', { className: 'ab-muted' }, '/'), f.range('group.burstWindowSec', 30, 600, 30, (v) => Math.round(v / 6) / 10 + ' 分钟')),
        ),
        h(Card, { fold: 'qq-interject', title: '群聊插话与限制', desc: '没人叫她的时候插不插话由她自己：看她的性格（爱社交那一项）、此刻的心情和精力、群里在聊的和她记得的事、她的爱好有多相关、在场的人和她多亲近；看完群里在聊什么，她也可以决定不说话。睡没睡由她的身体管，不用设静默时段。整体多爱接话、每小时最多几次在「设置 → 社会认知与关系」里调。' },
          h(Row, { label: '冷却', hint: '两次主动插话至少隔多久' }, f.range('group.cooldownSec', 0, 600, 10, (v) => v + ' 秒')),
          h(Row, { label: '群冷清时不插话', hint: '最近几分钟内消息少于这个数就不插' }, f.num('group.minRecentMessages', { min: 0 }), h('span', { className: 'ab-muted' }, '条 / '), f.num('group.activeWindowSec', { min: 30 }), h('span', { className: 'ab-muted' }, '秒')),
          h('div', { className: 'ab-note', style: { marginTop: 8 } }, 'ta被叫到或插上话以后算「加入了话题」：话题还和ta相关、ta 3 分钟内说过话，就会接着聊下去（每次看完群里新说的一段再回），不受冷却限制；话题跑偏或者ta选择不说话就退出。'),
        ),
        h(Card, { fold: 'qq-group-overrides', title: '按群单独设置', desc: '填 0：这个群里她不主动插话（被叫到还是会回）；填 100：这个群每条消息都给她看一眼（说不说还是她自己定，花钱多）。其他数值不起作用——插不插由她自己定。' },
          Object.keys(overrides).length === 0 ? h('div', { className: 'ab-muted', style: { marginBottom: 10 } }, '还没有单独设置的群。') :
            Object.entries(overrides).map(([gid, o]) => h(Row, { key: gid, label: '群 ' + gid },
              h('input', { className: 'ab-input sm', type: 'number', min: 0, max: 100, value: pct(o.interjectChance ?? draft.group.interjectChance), onChange: (e) => setDraft(setPath(draft, 'group.overrides', { ...overrides, [gid]: { ...o, interjectChance: Number(e.target.value) / 100 } })) }),
              h('span', { className: 'ab-muted' }, '% 插话'),
              h(Btn, { small: true, kind: 'ghost', onClick: () => { const n = { ...overrides }; delete n[gid]; setDraft(setPath(draft, 'group.overrides', n)) } }, '移除'))),
          h('div', { className: 'ab-flex' }, h('input', { className: 'ab-input', placeholder: '群号', value: newGid, onChange: (e) => setNewGid(e.target.value.replace(/\D/g, '')) }),
            h(Btn, { small: true, disabled: !newGid, onClick: () => { setDraft(setPath(draft, 'group.overrides', { ...overrides, [newGid]: { interjectChance: draft.group.interjectChance } })); setNewGid('') } }, '添加')),
        ),
      )
    }

    /** 按聊天选模型：私聊默认 / 群聊默认两个下拉，单个 QQ / 群的例外放在默认收起的小列表里。 */
    function ChatModels({ draft, setDraft, list }) {
      const cm = draft.chatModels || { privateDefault: {}, groupDefault: {}, privates: {}, groups: {} }
      const [open, setOpen] = useState(false)
      const [add, setAdd] = useState({ kind: 'private', id: '', sel: '' })
      const key = (m) => m.provider + '::' + m.model
      const val = (s) => (s && s.provider && s.model ? s.provider + '::' + s.model : '')
      const toSel = (v) => { const [p, ...m] = v.split('::'); return v ? { provider: p, model: m.join('::'), reasoningEffort: '' } : { provider: '', model: '', reasoningEffort: '' } }
      const base = [{ value: '', label: '跟随全局模型', desc: '上面「聊天用的模型」' }].concat((list || []).map((m) => ({ value: key(m), label: m.name, desc: m.provider, group: m.provider })))
      const optsFor = (v) => (v && !base.some((o) => o.value === v) ? base.concat([{ value: v, label: v.split('::').slice(1).join('::'), desc: '（DSH 里没找到）' }]) : base)
      const setCm = (patch) => setDraft(setPath(draft, 'chatModels', { ...cm, ...patch }))
      const rows = [['private', cm.privates || {}], ['group', cm.groups || {}]].flatMap(([kind, m]) => Object.entries(m).map(([id, sel]) => ({ kind, id, sel })))
      const label = (sel) => { const v = val(sel); const hit = (list || []).find((m) => key(m) === v); return hit ? hit.name : sel.model }
      const addRow = () => {
        if (!add.id || !add.sel) return
        const field = add.kind === 'private' ? 'privates' : 'groups'
        setCm({ [field]: { ...(cm[field] || {}), [add.id]: toSel(add.sel) } })
        setAdd({ ...add, id: '' })
      }
      const remove = (kind, id) => { const field = kind === 'private' ? 'privates' : 'groups'; const n = { ...(cm[field] || {}) }; delete n[id]; setCm({ [field]: n }) }
      return h(Card, { fold: 'qq-chat-models', title: '按会话选模型', desc: '顺序：这个私聊 > 这个群 > 所有私聊 / 所有群的默认 > 上面的全局模型。没选的一级就用下一级；选的模型在 DSH 里找不到时也自动退回。只有你能在这里改，聊天里的人换不了。换了之后从那个聊天的下一条消息起生效。' },
        h(Row, { label: '私聊默认模型' }, h(Select, { value: val(cm.privateDefault), width: 280, options: optsFor(val(cm.privateDefault)), onChange: (v) => setCm({ privateDefault: toSel(v) }) })),
        h(Row, { label: '群聊默认模型' }, h(Select, { value: val(cm.groupDefault), width: 280, options: optsFor(val(cm.groupDefault)), onChange: (v) => setCm({ groupDefault: toSel(v) }) })),
        h('div', { style: { marginTop: 8 } }, h(Btn, { small: true, kind: 'ghost', onClick: () => setOpen(!open) }, (open ? '收起' : '展开') + '单个 QQ / 群的例外（' + rows.length + '）')),
        open ? h('div', { style: { marginTop: 8 } },
          rows.length === 0 ? h('div', { className: 'ab-muted', style: { marginBottom: 10 } }, '还没有单独设置的 QQ 或群。') :
            rows.map((r) => h(Row, { key: r.kind + r.id, label: (r.kind === 'private' ? '私聊 ' : '群 ') + r.id }, h('span', { className: 'ab-muted' }, label(r.sel)), h(Btn, { small: true, kind: 'ghost', onClick: () => remove(r.kind, r.id) }, '移除'))),
          h('div', { className: 'ab-flex' },
            h(Seg, { value: add.kind, onChange: (v) => setAdd({ ...add, kind: v }), options: [{ value: 'private', label: '私聊' }, { value: 'group', label: '群' }] }),
            h('input', { className: 'ab-input', placeholder: add.kind === 'private' ? 'QQ 号' : '群号', value: add.id, onChange: (e) => setAdd({ ...add, id: e.target.value.replace(/\D/g, '') }) }),
            h(Select, { value: add.sel, width: 220, options: base.filter((o) => o.value), placeholder: '选模型', onChange: (v) => setAdd({ ...add, sel: v }) }),
            h(Btn, { small: true, disabled: !add.id || !add.sel, onClick: addRow }, '添加'))) : null)
    }

    /** 模型页：DeepSeek 峰谷省钱模式（默认关，只影响后台模型调用时机，聊天回复不变）。 */
    function CostCard({ draft, setDraft, st }) {
      const f = useField(draft, setDraft)
      const [now, setNow] = useState(Date.now())
      useEffect(() => {
        const timer = setInterval(() => setNow(Date.now()), 30_000)
        return () => clearInterval(timer)
      }, [])
      const off = !!getPath(draft, 'cost.offPeak')
      const peak = Boolean(st?.offpeak?.peak)
      const next = Number(st?.offpeak?.next) || 0
      return h(Card, {
        title: 'DeepSeek 峰谷省钱模式',
        right: f.sw('cost.offPeak'),
        desc: '默认为关，现有行为不变。打开后只把「不着急的后台模型调用」尽量放到谷时，聊天回复不受影响。峰时 = 工作日北京时间 09:00–12:00、14:00–18:00；周末和法定节假日全天谷价，谷价约为峰价一半（以 DeepSeek 官网为准）。',
      },
        h(Row, { label: '现在的时段', hint: '按北京时间算；周末和下面填的节假日全天都算谷时' },
          h('span', { className: 'ab-small', style: { color: peak ? 'var(--ab-warn)' : 'var(--ab-ok)' } }, peak ? '峰时 · 省着用' : '谷时 · 可以跑'),
          next ? h('span', { className: 'ab-small ab-muted', style: { marginLeft: 8 } }, '下次切换 ' + fmtNextChange(next, now) + '（北京时间）') : null),
        off ? h(Row, { label: '峰时推迟什么', hint: '这些是额外的后台模型调用；聊天、工具、审批、定时任务本身不受影响，到点照常' },
          h('span', { className: 'ab-small ab-muted' }, '心情模型判断（退回关键词）。心智核心的睡觉整理本来就在夜里（谷时）；白天聊完记经历用的是最低思考深度，花得很少')) : null,
        off ? h(Row, { label: '法定节假日', hint: '一行一个 YYYY-MM-DD（北京时间）。中国法定节假日日期每年不同，这里不硬编码，按官网公布的放假日期自己填；填了当天全天按谷价' },
          f.list('cost.offPeakHolidays', { placeholder: '2026-10-01\n2026-10-02' })) : null,
      )
    }

    function Model({ draft, setDraft, toast, st }) {
      const [list, setList] = useState(null)
      const [ping, setPing] = useState({})
      useEffect(() => { get('/models').then((r) => setList(r.list || [])) }, [])
      const key = (m) => m.provider + '::' + m.model
      const cur = draft.model.provider && draft.model.model ? draft.model.provider + '::' + draft.model.model : ''
      const curModel = cur && list ? list.find((m) => key(m) === cur) : null
      // reasoning === null 表示 DSH 明确说这个模型不支持思考强度（本地 Ollama 之类）
      const noReasoning = Boolean(curModel && curModel.reasoning === null)
      // 视觉能力：自动时把 DSH 的声明显示出来，管理员一眼能看出会不会降级
      const autoVision = curModel ? curModel.vision : undefined
      const visionHint = draft.model.vision === 'on'
        ? '强制当「能看图」；模型其实看不了的话，带图的那一轮会报错'
        : draft.model.vision === 'off'
          ? '强制当「看不懂」：收到图片只给一行文字提示，不会把图塞给模型'
          : autoVision === true
            ? '自动：DSH 说这个模型支持看图'
            : autoVision === false
              ? '自动：DSH 说这个模型看不了图，会自动降级成文字提示'
              : '自动：DSH 没声明，默认照发；真看不了就手动选「不支持」'
      const test = async (m) => {
        setPing({ ...ping, [key(m)]: '测速中…' })
        const r = await post('/model/ping', { provider: m.provider, model: m.model })
        setPing((p) => ({ ...p, [key(m)]: r.ok ? (r.ms / 1000).toFixed(1) + ' 秒' : '失败：' + (r.message || '') }))
      }
      return h('div', { className: 'ab-grid' },
        h(Card, { title: '聊天用的模型', desc: '新建的 QQ 会话按这里的设置来；已有会话也可以在 DSH 里点开单独切换。聊天对速度很敏感，可以先点「测速」挑个快的。' },
          h(Row, { label: '思考强度', hint: noReasoning ? '这个模型不支持思考强度，会自动忽略' : '聊天建议「低」，回得快' }, h(Seg, { value: draft.model.reasoningEffort || 'low', disabled: noReasoning, onChange: (v) => setDraft(setPath(draft, 'model.reasoningEffort', v)), options: [{ value: 'low', label: '低' }, { value: 'high', label: '高' }, { value: 'max', label: '最高' }] })),
          h(Row, { label: '视觉能力', hint: visionHint }, h(Seg, {
            value: draft.model.vision || 'auto',
            onChange: (v) => setDraft(setPath(draft, 'model.vision', v)),
            options: [{ value: 'auto', label: '自动' }, { value: 'on', label: '支持' }, { value: 'off', label: '不支持' }],
          })),
          h(Row, { label: '模型' },
            h(Select, {
              value: cur, width: 280,
              options: [{ value: '', label: '跟随 DSH 默认', desc: '和你在 DSH 里平时用的一样' }].concat((list || []).map((m) => ({ value: key(m), label: m.name, desc: m.provider, group: m.provider }))),
              onChange: (v) => { const [p, ...m] = v.split('::'); setDraft(setPath(setPath(draft, 'model.provider', v ? p : ''), 'model.model', v ? m.join('::') : '')) },
            }),
            cur ? h(Btn, { small: true, onClick: () => test({ provider: draft.model.provider, model: draft.model.model }) }, '测速') : null,
            cur && ping[cur] ? h('span', { className: 'ab-muted ab-small' }, ping[cur]) : null),
        ),
        h(ChatModels, { draft, setDraft, list }),
        h(CostCard, { draft, setDraft, st }),
        h(Card, { fold: 'qq-model-speed', title: '模型列表与测速', desc: '点「测速」会真的问一次模型（花一点点额度），看它回一句话要多久。' },
          list === null ? h(Empty, { icon: '⏳', text: '加载中…' }) : list.length === 0 ? h(Empty, { text: 'DSH 没有列出模型' }) :
            h('table', { className: 'ab-table' }, h('tbody', null, list.map((m) => h('tr', { key: key(m) },
              h('td', null, m.name), h('td', { className: 'ab-muted' }, m.provider),
              h('td', null, ping[key(m)] || ''),
              h('td', { style: { textAlign: 'right' } }, h(Btn, { small: true, kind: 'ghost', onClick: () => test(m) }, '测速'), h(Btn, { small: true, kind: 'ghost', onClick: () => { setDraft(setPath(setPath(draft, 'model.provider', m.provider), 'model.model', m.model)); toast('选好了，记得保存') } }, '用这个')))))),
        ),
      )
    }

    /** 语音条变声：用「翻唱」页导入的 RVC 音色模型（TTS 后接一层 RVC）。 */
    function VoiceSongModel({ draft, setDraft }) {
      const [s, setS] = useState(null)
      const f = useField(draft, setDraft)
      useEffect(() => { get('/voice/song-voices').then(setS).catch(() => setS({ ok: false, voices: [], message: '没查到翻唱音色' })) }, [])
      const voices = (s && s.voices) || []
      return h(Card, { fold: 'voice-rvc', title: '语音条变声（RVC）', desc: '把ta说话的声音也换成「翻唱」页导入的 RVC 音色模型：先 TTS 念出来，再用同一个音色变声。默认不变声，直接用 TTS 原声；变声失败会自动回退原声，不影响发送。' },
        h(Row, { label: '翻唱音色', hint: s && s.available === false ? (s.message || '翻唱环境还没装好，装好并导入音色后才能选') : '只列「翻唱」页导入过的 .pth 音色（带 index 的会标出来）' },
          f.select('voice.songVoice', [{ value: '', label: '不变声（TTS 原声）' }, ...voices.map((v) => ({ value: v.id, label: v.id + (v.hasIndex ? '（有 index）' : '') }))], { width: 280 })),
        h(Row, { label: '变调', hint: '模型是男声训练的、想变成女声一般 +12；不确定就 0' },
          f.num('voice.songPitch', { min: -24, max: 24 }), h('span', { className: 'ab-muted' }, ' 半音')),
        h('div', { className: 'ab-muted ab-small' }, !s ? '正在查翻唱音色…' : (s.available ? '变声要跑一次 RVC，会比普通语音慢几秒；单次变声失败会自动用原声。' : (s.message || '翻唱环境还没装好（面板「翻唱」页一键安装、导入音色后才能给语音条变声）')))) 
    }

    /** Breeze 云端音色：点一下拉列表，选中即填 voice id（不用去官网抄）。 */
    function BreezeVoices({ b, draft, setDraft }) {
      const [list, setList] = useState(null)
      const [err, setErr] = useState('')
      const [busy, setBusy] = useState(false)
      const load = async () => {
        setBusy(true); setErr('')
        try {
          const r = await get('/voice/breeze-voices')
          if (r && r.ok) setList(r.voices || [])
          else setErr(r?.message || '拉不到音色列表')
        } catch (e) { setErr(e.message) } finally { setBusy(false) }
      }
      const cur = String(b?.voiceId || '')
      const opts = (list || []).map((v) => ({ value: v.id, label: v.name || v.id, desc: [v.origin === 'cloned' ? '克隆' : v.origin, v.desc].filter(Boolean).join(' · ') || undefined }))
      if (list && cur && !opts.some((o) => o.value === cur)) opts.unshift({ value: cur, label: cur, desc: '当前配置里的音色（不在列表里）' })
      return h('div', null,
        h(Row, { label: 'Breeze 音色', hint: list ? '共 ' + list.length + ' 个，选一个就填进上面的音色 id' : '点「列出音色」从 Breeze 拉列表，选中自动填 id，不用去官网抄' },
          h('div', { className: 'ab-flex' },
            list ? h(Select, { width: 340, value: cur, options: opts, onChange: (v) => setDraft(setPath(draft, 'voice.breeze.voiceId', v)) }) : null,
            h(Btn, { small: true, kind: 'ghost', disabled: busy, onClick: load }, busy ? '拉取中…' : (list ? '刷新' : '列出音色')))),
        err ? h('div', { className: 'ab-note warn', style: { marginTop: 6 } }, err) : null,
      )
    }
    /** Breeze 云端额度：查余额、显示上次领取、手动领一次。 */
    function BreezeQuota({ b, toast }) {
      const [st, setSt] = useState(null)
      const [busy, setBusy] = useState('')
      const load = () => get('/voice/breeze-status').then((r) => setSt(r && r.ok !== false ? r : null)).catch(() => setSt(null))
      useEffect(() => { load() }, [b?.mode, b?.keySet, b?.emailSet, b?.autoClaim])
      const claim = async () => {
        setBusy('claim')
        try {
          const r = await post('/voice/breeze-claim', {})
          toast(r.message || (r.ok ? '领完了' : '没领到'), r.ok ? 'ok' : 'err')
          load()
        } catch (e) { toast(e.message, 'err') } finally { setBusy('') }
      }
      if (b?.mode === 'local') return h('div', { className: 'ab-muted ab-small' }, '本地自建模式：不查额度，也不用登录。')
      const when = st?.lastClaimAt ? new Date(st.lastClaimAt).toLocaleString() : ''
      return h('div', { className: 'ab-note', style: { marginTop: 8 } },
        st
          ? [
            h('div', { key: 'a' }, st.online
              ? '云端在线' + (st.balance == null ? '' : '（额度 ' + st.balance + '）')
              : '云端离线' + (st.note ? '：' + st.note : '')),
            when ? h('div', { key: 'b', className: 'ab-muted ab-small' }, '上次领取：' + when + (st.lastTier ? '（' + st.lastTier + '）' : '')) : null,
            !st.emailSet ? h('div', { key: 'c', className: 'ab-muted ab-small' }, '填了邮箱密码才能自动领每日额度。') : null,
          ]
          : h('div', { className: 'ab-muted ab-small' }, '正在查额度…'),
        h('div', { key: 'btn', style: { marginTop: 8 } },
          h(Btn, { small: true, disabled: busy === 'claim' || !st?.emailSet, onClick: claim }, busy === 'claim' ? '领取中…' : '领取今日额度')),
      )
    }

    function Voice({ st, draft, setDraft, toast, reload }) {
      const f = useField(draft, setDraft)
      const voiceDirty = Boolean(st && st.config) && JSON.stringify(draft.voice) !== JSON.stringify(st.config.voice)
      const [txt, setTxt] = useState('晚安啦，今天也辛苦了，明天见～')
      const [src, setSrc] = useState('')
      return h('div', { className: 'ab-grid' },
        h(Card, { title: '说话（文字转语音）', right: f.sw('voice.enabled'), desc: '回复里写了 <voice>…</voice> 的部分会变成 QQ 语音条；对方明确要语音时一定发语音；短回复也有一定概率整条变语音。' },
          voiceDirty ? h('div', { className: 'ab-note' }, '语音设置有没保存的改动：点「生成」试听会直接用这一页现在的设置；真正聊天要点底部「保存设置」后才生效。') : null,
          h('div', { style: { margin: '4px 0 12px' } }, f.choices('voice.engine', [
            { value: 'auto', label: '自动', desc: 'edge-tts 优先，不行用 macOS 自带语音' },
            { value: 'edge', label: '微软 edge-tts', desc: st.voice.edgeInstalled ? '在线，音色自然（已装好）' : '在线，音色自然（还没装）' },
            { value: 'cosyvoice', label: '本地 CosyVoice', desc: '自己部署的 CosyVoice 服务，可克隆音色' },
            { value: 'gptsovits', label: '本地 GPT-SoVITS', desc: 'GPT-SoVITS api_v2，用参考音频定音色' },
            { value: 'breeze', label: 'Breeze 语音', desc: 'BreezeBlue 云端或自建，填 Key + 音色 id' },
            { value: 'http', label: '其他 HTTP 接口', desc: '任意返回音频的地址' },
            { value: 'system', label: 'macOS 自带', desc: '离线可用，机械感重一些' },
          ])),
          ['auto', 'edge'].includes(draft.voice.engine) ? [
            !st.voice.edgeInstalled ? h(Row, { key: 'i', label: 'edge-tts', hint: '装在插件自己的 Python 环境里，不影响系统' }, h(Btn, { small: true, onClick: async () => { toast('正在安装，可能要一两分钟…'); const r = await post('/voice/install'); toast(r.message); reload() } }, '安装 edge-tts')) : null,
            h(Row, { key: 'v', label: '音色' }, f.select('voice.voice', [
              { value: 'zh-CN-XiaoyiNeural', label: '晓伊', desc: '活泼女声', group: '普通话' }, { value: 'zh-CN-XiaoxiaoNeural', label: '晓晓', desc: '温柔女声', group: '普通话' },
              { value: 'zh-CN-YunxiNeural', label: '云希', desc: '少年男声', group: '普通话' },
              { value: 'zh-CN-liaoning-XiaobeiNeural', label: '晓北', desc: '东北女声', group: '方言' }, { value: 'zh-CN-shaanxi-XiaoniNeural', label: '晓妮', desc: '陕西女声', group: '方言' },
              { value: 'zh-TW-HsiaoChenNeural', label: '曉臻', desc: '台湾女声', group: '方言' }], { width: 220 })),
            h(Row, { key: 'r', label: '语速' }, f.select('voice.rate', [{ value: '-20%', label: '慢一点' }, { value: '-10%', label: '稍慢' }, { value: '+0%', label: '正常' }, { value: '+10%', label: '稍快' }, { value: '+20%', label: '快一点' }], { width: 140 })),
            h(Row, { key: 'p', label: '音调', hint: '拖动调整，±80Hz 为上限（实测再往上 edge-tts 会静默夹住）；只对 edge-tts 有效' },
              h(Range, {
                min: -80,
                max: 80,
                step: 10,
                value: pitchNum(draft.voice.pitch),
                fmt: pitchLabel,
                onChange: (v) => setDraft(setPath(draft, 'voice.pitch', pitchText(v))),
              })),
          ] : null,
          draft.voice.engine === 'cosyvoice' ? [
            h(Row, { key: 'u', label: '服务地址', hint: 'CosyVoice 自带 runtime/python/fastapi/server.py' }, f.text('voice.cosyvoice.url', { size: 'wide', placeholder: 'http://127.0.0.1:50000' })),
            h(Row, { key: 'm', label: '模式' }, f.select('voice.cosyvoice.mode', [{ value: 'sft', label: '预置音色（sft）' }, { value: 'instruct', label: '带语气指令（instruct）' }], { width: 220 })),
            h(Row, { key: 's', label: '音色 ID', hint: '例如 中文女、中文男' }, f.text('voice.cosyvoice.spkId')),
            draft.voice.cosyvoice.mode === 'instruct' ? h(Row, { key: 'i', label: '语气指令', hint: '例如：用甜美撒娇的语气说' }, f.text('voice.cosyvoice.instruct', { size: 'wide' })) : null,
            h(Row, { key: 'r', label: '采样率', hint: 'CosyVoice 1 是 22050，CosyVoice 2 是 24000' }, f.select('voice.cosyvoice.sampleRate', [{ value: 22050, label: '22050 Hz' }, { value: 24000, label: '24000 Hz' }], { width: 160 })),
          ] : null,
          draft.voice.engine === 'gptsovits' ? [
            h(Row, { key: 'u', label: '服务地址', hint: 'GPT-SoVITS 的 api_v2.py' }, f.text('voice.gptsovits.url', { size: 'wide', placeholder: 'http://127.0.0.1:9880' })),
            h(Row, { key: 'a', label: '参考音频路径', hint: '服务那台电脑上的路径' }, f.text('voice.gptsovits.refAudio', { size: 'wide' })),
            h(Row, { key: 'p', label: '参考音频的文字' }, f.text('voice.gptsovits.promptText', { size: 'wide' })),
          ] : null,
          draft.voice.engine === 'breeze' ? [
            (() => {
              // 缺东西时先提示（不拦保存）：不然只有点「试听」才报错，还看不懂缺哪个
              const b = draft.voice.breeze || {}
              const miss = b.mode === 'local'
                ? (!String(b.url || '').trim() ? ['服务地址'] : [])
                : [
                  !String(b.key || '').trim() && !b.keySet ? 'API Key' : '',
                  !String(b.voiceId || '').trim() ? '音色 id' : '',
                ].filter(Boolean)
              const localDown = b.mode === 'local' && !String(b.url || '').trim()
              return miss.length
                ? h('div', { className: 'ab-note warn', style: { marginBottom: 8 } },
                  '还差：' + miss.join('、') + '。不填的话说话会退回 macOS 自带语音（照常发声，只是不是 Breeze 的音色）。',
                  localDown ? '本地模式要先把 breeze_infer 跑起来，地址填它的 /v1 前缀（例如 http://127.0.0.1:7860）。' : '')
                : null
            })(),
            h(Row, { key: 'mode', label: '模式', hint: '云端走 BreezeBlue 官方接口；本地走自己跑的 breeze_infer' }, h(Select, {
              width: 240,
              value: draft.voice.breeze?.mode || 'cloud',
              options: [{ value: 'cloud', label: '云端（BreezeBlue）' }, { value: 'local', label: '本地自建（breeze_infer）' }],
              // 切模式时顺手把服务地址换成对应的默认值（自己填过的自定义地址不动）
              onChange: (v) => {
                const cur = String(draft.voice.breeze?.url || '').trim()
                const defaults = ['', 'https://api.breeze.blue', 'http://127.0.0.1:7860']
                const url = defaults.includes(cur) ? (v === 'local' ? 'http://127.0.0.1:7860' : 'https://api.breeze.blue') : cur
                setDraft(setPath(setPath(draft, 'voice.breeze.mode', v), 'voice.breeze.url', url))
              },
            })),
            h(Row, { key: 'u', label: '服务地址', hint: '云端填 https://api.breeze.blue；自建就填自己的地址' }, f.text('voice.breeze.url', { size: 'wide', placeholder: 'https://api.breeze.blue' })),
            draft.voice.breeze?.mode === 'local' ? null : h(Row, { key: 'k', label: 'API Key', hint: 'Breeze 控制台 → API Keys 生成，brz_ 开头；已保存就不回显' }, f.text('voice.breeze.key', { type: 'password', placeholder: draft.voice.breeze?.keySet ? '已保存' : 'brz_…', size: 'wide' })),
            draft.voice.breeze?.mode === 'local' ? null : h(Row, { key: 'v', label: '音色 id', hint: '云端只用这个 id（不发描述，音色最稳）；也可以点下面的「列出音色」直接挑' }, f.text('voice.breeze.voiceId', { size: 'wide', placeholder: 'voc_…' })),
            draft.voice.breeze?.mode === 'local' ? null : h(BreezeVoices, { key: 'voices', b: draft.voice.breeze, draft, setDraft }),
            h(Row, { key: 'm', label: '模型', hint: '默认 breeze-tts-2' }, f.text('voice.breeze.model', { placeholder: 'breeze-tts-2' })),
            h(Row, { key: 'l', label: '语种' }, f.text('voice.breeze.languageCode', { placeholder: 'zh' })),
            draft.voice.breeze?.mode === 'local' ? h(Row, { key: 'i', label: '语气说明', hint: '本地模式用：这段描述就是音色设计（voice design），不填就用模型默认声音' }, f.text('voice.breeze.instructions', { size: 'wide', placeholder: '清亮柔软、略带奶气的普通话少女音' })) : null,
            draft.voice.breeze?.mode === 'local' ? h(Row, { key: 'g', label: '指令遵循强度', hint: '本地模式的 cfg_scale，越大越贴着描述走（默认 4）' }, f.range('voice.breeze.guidanceScale', 0, 10, 0.5, (v) => (String(v || '4')))) : null,
            draft.voice.breeze?.mode === 'local' ? null : h(Row, { key: 'em', label: '账号邮箱', hint: '填了才能自动领每日额度（免费额度约 250 句短话）' }, f.text('voice.breeze.email', { size: 'wide', placeholder: 'you@example.com' })),
            draft.voice.breeze?.mode === 'local' ? null : h(Row, { key: 'pw', label: '账号密码', hint: '存在本机 config.json（和别的密钥一样，面板里不回显）；留空 = 用已保存的' }, f.text('voice.breeze.password', { type: 'password', placeholder: draft.voice.breeze?.passwordSet ? '已保存' : '不填就不自动领额度' })),
            draft.voice.breeze?.mode === 'local' ? null : h(Row, { key: 'ac', label: '自动领每日额度', hint: '每小时醒一次，一天最多领一次；失败只记日志' }, f.sw('voice.breeze.autoClaim')),
            draft.voice.breeze?.mode === 'local' ? null : h(BreezeQuota, { key: 'quota', b: draft.voice.breeze, toast }),
          ] : null,
          draft.voice.engine === 'http' ? [
            h(Row, { key: 'u', label: '接口地址', hint: 'GET：地址里带 {text}；POST：填接口地址就行' }, f.text('voice.http.urlTemplate', { size: 'wide', placeholder: 'https://openspeech.bytedance.com/api/v1/tts' })),
            h(Row, { key: 'm', label: '请求方式' }, f.select('voice.http.method', [{ value: 'GET', label: 'GET' }, { value: 'POST', label: 'POST' }], { width: 140 })),
            h(Row, { key: 'h', label: '请求头', hint: '一行一个。多个头就多写几行' }, f.area('voice.http.headers', { size: 'wide', rows: 2, placeholder: 'Authorization: Bearer;你的token' })),
            String((draft.voice.http || {}).method || 'GET').toUpperCase() !== 'GET'
              ? h(Row, { key: 'b', label: '请求体', hint: '{text} 换成要念的话（自动转义），{reqid} 换成每次不同的随机串' }, f.area('voice.http.body', { size: 'wide', rows: 6, placeholder: '{"app":{"appid":"你的appid","token":"随便填","cluster":"volcano_tts"},"user":{"uid":"aurabot"},"audio":{"voice_type":"zh_female_wanwanxiaohe_moon_bigtts","encoding":"mp3"},"request":{"reqid":"{reqid}","text":"{text}"}}' }))
              : null,
          ] : null,
          h(Row, { label: '短回复变语音的概率' }, f.percent('voice.autoChance')),
          h(Row, { label: '多短算短回复' }, f.range('voice.autoMaxChars', 10, 200, 5, (v) => v + ' 字')),
          h(Row, { label: '表情和语音分开发', hint: '语音条里的表情 / emoji 不念出来，语音发完再单独补一条文字发出去（没有表情就不补）；关掉 = 表情直接丢掉，不补发' }, f.sw('voice.emojiSeparate')),
          h(Row, { label: '试听', hint: '用这一页现在的设置试听（没保存也行；本地接口不会把这里顶掉）' },
            h('input', { className: 'ab-input', value: txt, onChange: (e) => setTxt(e.target.value) }),
            h(Btn, { small: true, onClick: async () => {
              setSrc('')
              const r = await post('/voice/test', { text: txt, voice: draft.voice })
              if (r.ok) setSrc('data:' + r.mime + ';base64,' + r.data)
              else toast(r.message)
            } }, '生成'),
            src ? h('audio', { key: src, src, controls: true, autoPlay: true, style: { height: 32 } }) : null),
        ),
        h(VoiceSongModel, { draft, setDraft }),
      )
    }

    /** 语音识别单独一页：和「语音」「表情包」同级（移植自原项目 2baf896）。 */
    /**
     * 「获取可用模型」：按这一页填的地址和 Key 问服务有哪些模型，点一下就填进去，不用自己抄模型名。
     * Key 没填（已保存、面板不回显）时用已保存的那个（keyFrom 指明是哪一个）。
     */
    function ModelPicker({ kind, baseUrl, apiKey, keyFrom, value, onPick, toast }) {
      const [res, setRes] = useState(null)
      const [busy, setBusy] = useState(false)
      const [all, setAll] = useState(false)
      const [q, setQ] = useState('')
      const load = async () => {
        setBusy(true)
        try {
          const r = await post('/provider-models', { kind, baseUrl: baseUrl || '', apiKey: apiKey || '', keyFrom })
          if (!r || r.ok === false) { toast((r && r.message) || '没拿到模型列表', 'err'); setRes(null); return }
          setRes(r)
          setAll(!r.models.length)
          if (!r.models.length && !r.others.length) toast('服务没有列出任何模型，只能自己填', 'err')
        } finally { setBusy(false) }
      }
      const list = res ? (all ? [...res.models, ...res.others] : res.models).filter((m) => !q || m.toLowerCase().includes(q.toLowerCase())) : []
      return h('div', { style: { marginTop: 6 } },
        h('div', { className: 'ab-flex', style: { gap: 6, alignItems: 'center', flexWrap: 'wrap' } },
          h(Btn, { small: true, disabled: busy, onClick: load }, busy ? '获取中…' : res ? '重新获取' : '获取可用模型'),
          res ? h('input', { className: 'ab-input', style: { flex: '1 1 160px', minWidth: 120 }, placeholder: '在 ' + (all ? res.models.length + res.others.length : res.models.length) + ' 个模型里找', value: q, onChange: (e) => setQ(e.target.value) }) : null,
          res && res.others.length && res.models.length ? h(Btn, { small: true, kind: 'ghost', onClick: () => setAll(!all) }, all ? '只看像是能用的' : '显示全部（另外 ' + res.others.length + ' 个）') : null,
          res ? h(Btn, { small: true, kind: 'ghost', onClick: () => setRes(null) }, '收起') : null),
        res ? h('div', { style: { maxHeight: 220, overflowY: 'auto', marginTop: 6, border: '1px solid var(--ab-line)', borderRadius: 8 } },
          list.length ? list.slice(0, 200).map((m) => h('div', {
            key: m, onClick: () => { onPick(m); toast('选了 ' + m, 'ok') },
            style: { padding: '6px 10px', cursor: 'pointer', fontSize: 12.5, wordBreak: 'break-all', background: m === value ? 'var(--ab-hover)' : 'transparent', fontWeight: m === value ? 600 : 400 },
          }, m === value ? '✓ ' + m : m)) : h('div', { className: 'ab-muted ab-small', style: { padding: 8 } }, '没有对得上的')) : null)
    }

    function Asr({ draft, setDraft, toast }) {
      const f = useField(draft, setDraft)
      const a = draft.voice.asrApi || {}
      const ph = (sf, oa, other) => (a.provider === 'siliconflow' ? sf : a.provider === 'openai' ? oa : other)
      return h('div', { className: 'ab-grid' },
        h(Card, { title: '听语音（语音转文字）', right: f.sw('voice.asr'), desc: '别人发来的语音会先转成文字再交给ta（群里没 @ 她的语音也会转，她能接上话）：本地接口 → QQ 自带转文字 → 云端识别（可选）→ DSH 自带识别，哪一层不行就试下一层。' },
          h(Row, { label: '云端识别', hint: '可选；不选就按 本地接口 → QQ → DSH 的顺序' },
            f.select('voice.asrApi.provider', [
              { value: '', label: '不用云端识别' },
              { value: 'siliconflow', label: '硅基流动' },
              { value: 'openai', label: 'OpenAI' },
              { value: 'custom', label: '自定义（OpenAI 兼容）' },
            ], { width: 220 })),
          a.provider ? [
            h(Row, { key: 'u', label: '服务地址', hint: '只填到 /v1，不要带 /audio/transcriptions；留空用预置地址' },
              f.text('voice.asrApi.baseUrl', { size: 'wide', placeholder: ph('https://api.siliconflow.cn/v1', 'https://api.openai.com/v1', 'http://127.0.0.1:8000/v1') })),
            h(Row, { key: 'm', label: '模型', hint: '留空用预置：硅基 FunAudioLLM/SenseVoiceSmall（免费），OpenAI whisper-1' },
              h('div', { style: { flex: 1 } },
                f.text('voice.asrApi.model', { size: 'wide', placeholder: ph('FunAudioLLM/SenseVoiceSmall', 'whisper-1', 'whisper-1') }),
                h(ModelPicker, { kind: 'asr', keyFrom: 'asr', toast, baseUrl: a.baseUrl || ph('https://api.siliconflow.cn/v1', 'https://api.openai.com/v1', ''), apiKey: a.apiKey, value: a.model, onPick: (m) => setDraft(setPath(draft, 'voice.asrApi.model', m)) }))),
            h(Row, { key: 'k', label: 'API Key', hint: '只存在本机，面板不回显；本地服务可留空。硅基的 Key 可以和「记忆」页的向量 Key 是同一个' },
              f.text('voice.asrApi.apiKey', { type: 'password', placeholder: a.apiKeySet ? '已保存（不改就留空）' : '没有就留空' })),
            h(Row, { key: 'l', label: '语言', hint: '可留空；只对支持 language 的模型有效' },
              f.text('voice.asrApi.language', { placeholder: 'zh' })),
            h(Row, { key: 'p', label: '先用谁', hint: 'QQ 自带一般 1~2 秒；硅基 SenseVoice 实测约 14 秒，建议先 QQ' },
              f.select('voice.asrApi.prefer', [{ value: 'qq', label: '先 QQ 自带（推荐）' }, { value: 'cloud', label: '先云端识别' }], { width: 220 })),
            h(Row, { key: 't', label: '测试', hint: '先用 macOS 自带语音念一句，再交给云端识别；用这一页现在的设置，没保存也行' },
              h(Btn, { small: true, onClick: async () => {
                toast('正在念一句再识别，可能要十几秒…')
                const r = await post('/voice/asr-provider-test', { text: '今天天气不错', voice: draft.voice })
                toast(r.ok ? '念的是「' + r.said + '」，听成了「' + r.heard + '」（' + r.ms + ' 毫秒）' : r.message)
              } }, '测试云端识别')),
          ] : null,
          h(AsrStatus, { toast })),
      )
    }

    function AsrStatus({ toast }) {
      const [s, setS] = useState(null)
      const load = () => get('/voice/asr-status').then(setS)
      useEffect(() => { load(); const t = setInterval(load, 5000); return () => clearInterval(t) }, [])
      const active = s?.enabled && s.provider
      const downloading = ['preparing', 'downloading'].includes(s?.phase)
      const phase = active ? ({ ready: '已就绪', standby: '已就绪（休眠中）', idle: '还没下载模型', preparing: '正在下载模型…', downloading: '正在下载模型…', failed: '下载失败', error: '下载失败' }[s.phase] || s.phase) : null
      return h('div', { className: 'ab-flex' },
        h('span', { className: 'ab-pill' }, h('i', { className: cx('ab-dot', active && ['ready', 'standby'].includes(s.phase) ? 'ok' : s ? 'warn' : '') }), s === null ? '查询中…' : 'DSH 识别：' + (phase || s.message || '读取状态失败')),
        active && !['ready', 'standby'].includes(s.phase) ? h(Btn, { small: true, disabled: downloading, onClick: async () => { const r = await post('/voice/asr-prepare'); toast(r.message); load() } }, '下载识别模型') : null,
        active && ['ready', 'standby'].includes(s.phase) ? h(Btn, { small: true, onClick: async () => { toast('正在测试…'); const r = await post('/voice/asr-test', { text: '今天想吃白米饭' }); toast(r.ok ? '念的是「' + r.said + '」，听成了「' + r.heard + '」' : r.message) } }, '测试一下') : null)
    }

    function Stickers({ draft, setDraft, toast }) {
      const f = useField(draft, setDraft)
      const [items, setItems] = useState(null)
      const fileRef = useRef(null)
      const load = () => get('/stickers').then((r) => setItems(r.items || []))
      useEffect(() => { load() }, [])
      const [newName, setNewName] = useState('')
      // 起名用哪个模型：列 DSH 里已经接好的模型，能看图的标出来（AI 补全必须看图）
      const [models, setModels] = useState(null)
      useEffect(() => { get('/models').then((r) => setModels(r.list || [])).catch(() => setModels([])) }, [])
      const cm = (draft.stickers && draft.stickers.captionModel) || {}
      const cmKey = cm.provider && cm.model ? cm.provider + '::' + cm.model : ''
      const cmHit = cmKey && models ? models.find((m) => m.provider + '::' + m.model === cmKey) : null
      const pickCaptionModel = (v) => {
        const [p, ...rest] = String(v || '').split('::')
        setDraft(setPath(setPath(draft, 'stickers.captionModel.provider', v ? p : ''), 'stickers.captionModel.model', v ? rest.join('::') : ''))
      }
      // 多选：勾中若干张，一次确认全部删掉（不用一张张点、一张张确认）
      const [picking, setPicking] = useState(false)
      const [picked, setPicked] = useState([])
      const [dropQQ, setDropQQ] = useState(true)
      // AI 批量补名字 / 标签：后台跑，这里每 2 秒看一次进度
      const [job, setJob] = useState(null)
      const [redoAll, setRedoAll] = useState(false)
      const shown = useRef(0)
      const jobRunning = Boolean(job && job.running)
      // 面板关掉再打开时，后台可能还有一轮在跑：接上它的进度，别让按钮看起来能再点一次
      useEffect(() => {
        get('/sticker/caption-status').then((r) => { if (r && r.running) { shown.current = r.done || 0; setJob(r) } })
      }, [])
      useEffect(() => {
        if (!jobRunning) return undefined
        let live = true
        const timer = setInterval(async () => {
          const r = await get('/sticker/caption-status')
          if (!live || !r || r.ok === false) return
          setJob(r)
          if (!r.running) {
            clearInterval(timer)
            load()
            toast(r.message || '整理完了', r.failed ? 'err' : 'ok')
          } else if ((r.done || 0) - shown.current >= 5) {
            shown.current = r.done || 0 // 每跑五张刷一下，新起的名字能早点看到
            load()
          }
        }, 2000)
        return () => { live = false; clearInterval(timer) }
      }, [jobRunning])
      const startCaption = async () => {
        const r = await post('/sticker/caption-all', { all: redoAll })
        if (!r.ok) { toast(r.message || '没开始', 'err'); return }
        toast(r.message || '开始了')
        if (!r.total) return
        shown.current = 0
        setJob({ running: true, total: r.total, done: 0, ok: 0, failed: 0, skipped: 0, last: '' })
      }
      const toggle = (md5) => setPicked((cur) => (cur.includes(md5) ? cur.filter((x) => x !== md5) : [...cur, md5]))
      const allPicked = Boolean(items && items.length) && picked.length === items.length
      const dropPicked = async () => {
        if (!picked.length) return
        const n = picked.length
        const ask = dropQQ ? '删掉选中的 ' + n + ' 张表情？（QQ 收藏里也会一起删）' : '删掉选中的 ' + n + ' 张表情？（只删本地库，QQ 收藏保留）'
        if (!confirm(ask)) return
        const r = await post('/sticker/delete-batch', { md5s: picked, fromQQ: dropQQ })
        toast(r.message || (r.ok ? '删掉了 ' + n + ' 张' : '没删成'), r.ok ? 'ok' : 'err')
        setPicked([])
        load()
      }
      // DSH 是 Electron，不支持 prompt() 弹框：名字在页面上填（不填就自动看图起名）
      const upload = async (files) => {
        const list = [...(files || [])]
        if (!list.length) return
        let ok = 0
        const errs = []
        for (const file of list) {
          if (file.size > 5 * 1024 * 1024) { errs.push(file.name + ' 超过 5MB'); continue }
          try {
            const data = await new Promise((res, rej) => { const fr = new FileReader(); fr.onload = () => res(fr.result); fr.onerror = () => rej(new Error('读不了这个文件')); fr.readAsDataURL(file) })
            const r = await post('/sticker/upload', { data, name: list.length === 1 ? newName.trim().slice(0, 12) : '' })
            if (r.ok) ok++
            else errs.push(file.name + '：' + (r.reason || r.message || '没加成功'))
          } catch (e) {
            errs.push(file.name + '：' + e.message)
          }
        }
        setNewName('')
        toast(errs.length ? (ok ? `加好 ${ok} 张；` : '') + errs.join('；') : `加好了 ${ok} 张`, errs.length ? 'err' : 'ok')
        load()
      }
      // 右上角工具条：平时是上传 / 导入 / AI 补标签 / 多选，多选模式下换成批量操作
      const bar = picking
        ? [
          h('span', { key: 'n', className: 'ab-muted ab-small' }, '已选 ' + picked.length + ' 张'),
          h(Btn, { key: 'all', small: true, kind: 'ghost', onClick: () => setPicked(allPicked ? [] : (items || []).map((i) => i.md5)) }, allPicked ? '全不选' : '全选'),
          h(Btn, { key: 'inv', small: true, kind: 'ghost', onClick: () => setPicked((items || []).map((i) => i.md5).filter((md5) => !picked.includes(md5))) }, '反选'),
          h('label', { key: 'qq', className: 'ab-small ab-muted', title: '取消勾选就只删本地库，QQ 收藏里的表情留着' },
            h('input', { type: 'checkbox', checked: dropQQ, onChange: (e) => setDropQQ(e.target.checked) }), ' 连 QQ 收藏一起删'),
          h(Btn, { key: 'del', small: true, kind: 'danger', disabled: !picked.length, onClick: dropPicked }, '删除所选'),
          h(Btn, { key: 'end', small: true, kind: 'ghost', onClick: () => { setPicking(false); setPicked([]) } }, '取消多选'),
        ]
        : [
          h('input', { key: 'file', ref: fileRef, type: 'file', accept: 'image/*', multiple: true, style: { display: 'none' }, onChange: (e) => { upload(e.target.files); e.target.value = '' } }),
          h('input', { key: 'name', className: 'ab-input sm', style: { width: 140 }, placeholder: '名字（可不填）', value: newName, onChange: (e) => setNewName(e.target.value) }),
          h(Btn, { key: 'up', small: true, onClick: () => fileRef.current && fileRef.current.click() }, '＋ 上传'),
          h(Btn, { key: 'imp', small: true, title: '把机器人号 QQ「我喜欢的」里已有的表情导进来', onClick: async () => { toast('正在从 QQ 收藏导入…'); const r = await post('/sticker/import-qq'); toast(r.message, r.ok === false ? 'err' : 'ok'); load() } }, '从 QQ 收藏导入'),
          h(Btn, { key: 'ai', small: true, kind: 'primary', disabled: jobRunning, title: '用「起名用的模型」看图（默认跟随聊天模型），给还没有名字或标签的表情起名字、打标签（后台跑，可以关掉面板）', onClick: startCaption }, 'AI 补全标签'),
          h('label', { key: 'redo', className: 'ab-small ab-muted', title: '勾上以后连已经有名字的也重新起一遍（会重新花模型调用）' },
            h('input', { type: 'checkbox', checked: redoAll, onChange: (e) => setRedoAll(e.target.checked) }), ' 全部重做'),
          h(Btn, { key: 'pick', small: true, kind: 'ghost', onClick: () => { setPicking(true); setPicked([]) } }, '多选'),
          h(Btn, { key: 'reload', small: true, kind: 'ghost', onClick: load }, '刷新'),
        ]
      return h('div', { className: 'ab-grid' },
        h(Card, { title: '表情包', right: f.sw('stickers.enabled'), desc: '回复里写 <sticker:名字> 就会发对应的表情；也会按概率自动配一张。' },
          h(Row, { label: '自动配表情的概率' }, f.percent('stickers.autoChance')),
          h(Row, { label: '夹 QQ 小黄脸', hint: '回复里能夹 QQ 自带的系统表情（/捂脸 /斜眼笑 这种），和文字在同一条消息里' }, f.sw('stickers.faces')),
          h(Row, { label: '偷表情', hint: '别人发的表情包会被收藏（普通照片不收）。' }, f.sw('stickers.collect'), h('span', { className: 'ab-muted' }, '从群里'), f.sw('stickers.fromGroups'), h('span', { className: 'ab-muted' }, '从私聊'), f.sw('stickers.fromPrivate')),
          draft.stickers.collect ? h(Row, { label: '怎么偷', hint: '「ta挑」只递给ta看，喜欢才收；「只听管理员的」只在管理员私聊 / 这一轮只有管理员时ta才可自己收，有别人在场要管理员发话' },
            f.choices('stickers.collectMode', [
              { value: 'auto', label: '全都偷', desc: '看到就收，不用ta同意（默认，保持原行为）' },
              { value: 'ask', label: 'ta挑', desc: '先记着，给ta一句轻提示，喜欢才凭编号收' },
              { value: 'owner', label: '只听管理员的', desc: '只有管理员私聊 / 只有管理员时ta才可自己收；别人在场要管理员发话' },
            ])) : null,
          h(Row, { label: '每小时最多收' }, f.num('stickers.maxPerHour', { min: 0 }), h('span', { className: 'ab-muted' }, '张')),
          h(Row, { label: '表情库最多存', hint: 'QQ 收藏表情有数量上限，满了就收不进去了。超过这个数会自动清掉最少用的偷来的表情（你自己加的不会动）' }, f.num('stickers.maxLibrary', { min: 20, max: 2000 }), h('span', { className: 'ab-muted' }, '张')),
          h(Row, { label: '看图起名', hint: '收下后让模型看图起个 12 字以内的备注；库里已有的名字可以点右边「AI 补全标签」批量补' }, f.sw('stickers.caption')),
          h(Row, { label: '起名用的模型', hint: 'AI 补全标签 / 看图起名都要看图：留空就用「模型」页那个聊天模型，也可以单独挑一个 DSH 里已经接好的视觉模型。' },
            h(Select, {
              value: cmKey, width: 320,
              options: [{ value: '', label: '跟随聊天模型', desc: '和「模型」页选的一样' }].concat((models || []).map((m) => ({
                value: m.provider + '::' + m.model,
                label: m.name + (m.vision === true ? '（能看图）' : m.vision === false ? '（不看图）' : ''),
                desc: m.provider,
                group: m.provider,
              }))),
              onChange: pickCaptionModel,
            }),
            models === null ? h('span', { className: 'ab-muted ab-small' }, ' 正在查模型…') : null,
            cmHit && cmHit.vision === false ? h('span', { className: 'ab-small', style: { color: 'var(--ab-warn)' } }, ' 这个模型看不了图，起名会被跳过') : null),
        ),
        h(Card, { title: '表情库' + (items ? '（' + items.length + ' 张）' : ''), right: h('div', { className: 'ab-flex' }, bar) },
          job ? h('div', { className: 'ab-flex', style: { margin: '0 0 10px' } },
            job.running ? h('i', { key: 's', className: 'ab-spin' }) : h('span', { key: 'k', style: { color: job.failed ? 'var(--ab-warn)' : 'var(--ab-ok)' } }, '✓'),
            h('span', { key: 't', className: 'ab-small' }, job.running
              ? 'AI 起名中 ' + (job.done || 0) + ' / ' + (job.total || 0) + (job.model ? '（' + job.model + '）' : '') + (job.last ? '，刚起好「' + job.last + '」' : '')
              : (job.message || '整理完了')),
            job.running ? h('div', { key: 'bar', className: 'ab-progress' }, h('i', { style: { width: Math.round(((job.done || 0) / Math.max(job.total || 1, 1)) * 100) + '%' } })) : null,
            job.running
              ? h(Btn, { key: 'stop', small: true, kind: 'ghost', onClick: async () => { const r = await post('/sticker/caption-stop', {}); toast(r.message || '停了') } }, '停')
              : h(Btn, { key: 'ok', small: true, kind: 'ghost', onClick: () => setJob(null) }, '知道了'),
          ) : null,
          items === null ? h(Empty, { icon: '⏳', text: '加载中…' }) : items.length === 0 ? h(Empty, { icon: '🐳', text: '表情库还是空的。别人在群里发表情包，ta会自己收；也可以点右上角上传，或者「从 QQ 收藏导入」机器人号已经收藏的表情。' }) :
            h('div', { className: cx('ab-stickers', picking && 'picking') },
              items.map((it) => h(StickerCell, { key: it.md5, it, onChanged: load, toast, picking, selected: picked.includes(it.md5), onToggle: toggle }))),
        ),
        h(Card, {
          title: '贴表情',
          right: f.sw('stickers.react'),
          desc: '默认关。打开后看到谁的消息，就可能贴个表情——不一定回话，只在旁边看着也行。emoji 直接给 Unicode 码点（🍬 127852、👍 128077），QQ 老表情是另一套编号（❓ 10068），两种混着用都行。',
        },
          h(Row, { label: '主动贴表情的概率', hint: '默认 15%，和「表情包」那张卡里的自动配表情各算各的，互不影响；心情好会更频繁' },
            h(Range, {
              min: 0,
              max: 100,
              value: pct(draft.stickers.reactChance ?? 0.15),
              onChange: (v) => setDraft(setPath(draft, 'stickers.reactChance', v / 100)),
              fmt: (v) => v + '%',
            })),
          h(Row, { label: '概率表', hint: '实际概率 = 拖拽条的值 × 心情系数（心情越高越爱贴；超过 100% 就是必贴）' },
            (() => {
              const base = Number(draft.stickers.reactChance ?? 0.15) || 0
              const cell = (key, text, extra) => h('td', { key, style: Object.assign({ padding: '3px 16px 3px 0' }, extra) }, text)
              return h('table', { style: { borderCollapse: 'collapse', fontSize: 12, marginTop: 2 } },
                h('thead', null, h('tr', null,
                  cell('h0', '心情', { opacity: 0.55, fontWeight: 500 }),
                  cell('h1', '系数', { opacity: 0.55, fontWeight: 500, textAlign: 'right' }),
                  cell('h2', '实际概率', { opacity: 0.55, fontWeight: 500, textAlign: 'right', paddingRight: 0 }),
                )),
                h('tbody', null, REACT_MOOD_BANDS.map(([label, mult]) => h('tr', { key: label },
                  cell('m', label, { opacity: 0.8 }),
                  cell('k', mult + '×', { opacity: 0.55, textAlign: 'right' }),
                  cell('p', Math.min(100, Math.round(base * mult * 1000) / 10) + '%', { textAlign: 'right', paddingRight: 0, fontVariantNumeric: 'tabular-nums' }),
                ))),
              )
            })()),
          h(Row, { label: '每小时上限', hint: '每个会话单独算，免得在热闹的群里刷屏' }, f.range('stickers.reactMaxPerHour', 0, 60, 1, (v) => v + ' 次')),
        ),
        h(FaceMapCard, null),
      )
    }

    /**
     * 一张表情：名字（备注）和标签都能直接改，改完离开输入框就保存（#31：模型起的名字 / 标签不对时手动纠正）。
     * 多选模式下整张卡片就是勾选框，点一下就选中。
     */
    function StickerCell({ it, onChanged, toast, picking, selected, onToggle }) {
      const [name, setName] = useState(it.name || '')
      const tagText = (it.tags || []).join(' ')
      const [tags, setTags] = useState(tagText)
      // 外面改了（AI 起名 / 刷新列表）时，框里跟着换成新的
      useEffect(() => { setName(it.name || '') }, [it.name])
      useEffect(() => { setTags((it.tags || []).join(' ')) }, [(it.tags || []).join(' ')])
      const save = async (body, label) => {
        const r = await post('/sticker/rename', { md5: it.md5, ...body })
        toast(r.ok ? label + '改好了' : '没改成：' + (r.message || '找不到这张表情'), r.ok ? 'ok' : 'err')
        if (r.ok) onChanged()
      }
      return h('div', {
        className: cx('ab-sticker', picking && 'pick', selected && 'on'),
        onClick: picking ? () => onToggle(it.md5) : undefined,
        title: picking ? (selected ? '再点一下取消选中' : '点一下选中这张') : undefined,
      },
        h('img', { src: API + '/sticker/image?md5=' + it.md5, alt: it.name || '表情', loading: 'lazy' }),
        it.variantOf ? h('span', { className: 'ab-badge', title: '同名表情的变体', style: { position: 'absolute', left: 6, top: 6 } }, '变体') : null,
        picking ? h('span', { className: 'ck' }, selected ? '✓' : '') : null,
        it.primary ? h('span', { className: 'ab-badge', title: '同名表情的主图', style: { position: 'absolute', right: 6, top: 6 } }, '主图') : null,
        h('input', { className: 'nm', value: name, placeholder: '未命名（点这里改）', title: '名字 / 备注，最多 12 字', maxLength: 12, readOnly: Boolean(picking), tabIndex: picking ? -1 : undefined, onChange: (e) => setName(e.target.value),
          onBlur: () => { if (!picking && name !== (it.name || '')) save({ name }, '名字') } }),
        h('input', { className: 'tg', value: tags, placeholder: '加标签，空格隔开', title: '标签，空格或逗号隔开，最多 5 个', readOnly: Boolean(picking), tabIndex: picking ? -1 : undefined, onChange: (e) => setTags(e.target.value),
          onBlur: () => { if (!picking && tags.trim() !== tagText) save({ tags: tags.split(/[\s,，、#]+/).map((x) => x.trim()).filter(Boolean).slice(0, 5) }, '标签') } }),
        picking ? null : h(Btn, { small: true, kind: 'danger', title: '删除', onClick: async () => { if (!confirm('删掉这张表情？（QQ 收藏里也会删）')) return; await post('/sticker/delete', { md5: it.md5 }); onChanged() } }, '✕'),
        !picking && it.name ? h(Btn, { small: true, kind: 'ghost', title: '同名表情默认发这张', onClick: async () => { const r = await post('/sticker/primary', { md5: it.md5 }); toast(r.ok ? '设为主图了' : (r.message || '没设成'), r.ok ? 'ok' : 'err'); if (r.ok) onChanged() } }, '主图') : null,
      )
    }

    // 和 QQ 空间自身的可见范围一致（ugc_right 1/4/16/64/128）
    const AUDIENCE_OPTIONS = [
      { value: 'all', label: '所有人可见' },
      { value: 'friends', label: '好友可见' },
      { value: 'selected', label: '部分好友可见' },
      { value: 'excluded', label: '部分好友不可见' },
      { value: 'self', label: '仅自己可见' },
    ]
    const AUDIENCE_LABEL = Object.fromEntries(AUDIENCE_OPTIONS.map((o) => [o.value, o.label]))

    /** 可见范围：固定范围存进配置；部分好友再配一份 QQ 名单。 */
    function DiaryAudience({ draft, setDraft, toast }) {
      const mode = draft.diary.visibility
      const partial = mode === 'selected' || mode === 'excluded'
      const [friends, setFriends] = useState(null)
      const [query, setQuery] = useState('')
      const qqText = draft.diary.audienceQQs || ''
      const selected = Array.from(new Set(String(qqText).split(/[\s,，;；]+/).filter(Boolean)))
      const setList = (list) => setDraft(setPath(draft, 'diary.audienceQQs', Array.from(new Set(list)).join('\n')))
      const toggle = (qq) => setList(selected.includes(qq) ? selected.filter((q) => q !== qq) : [...selected, qq])
      return h('div', null,
        h(Row, { label: '谁能看', hint: '和 QQ 空间的可见范围一致' },
          h(Select, { value: mode, options: AUDIENCE_OPTIONS, width: 170, onChange: (v) => setDraft(setPath(draft, 'diary.visibility', v)) })),
        partial ? h('div', { style: { marginTop: 10 } },
          h('div', { className: 'ab-flex', style: { gap: 8, marginBottom: 8 } },
            h(Btn, { small: true, kind: 'ghost', onClick: async () => { try { const r = await get('/diary/friends'); if (!r.ok) return toast(r.message || '读取好友失败'); setFriends(r.friends) } catch (e) { toast(e.message) } } }, '从好友列表选择'),
            h('span', { className: 'ab-muted ab-small' }, '已选 ' + selected.length + ' 人，只对之后发的说说生效')),
          friends ? h('div', { style: { marginBottom: 8 } },
            h('input', { className: 'ab-input', placeholder: '搜索昵称或 QQ 号', value: query, onChange: (e) => setQuery(e.target.value) }),
            h('div', { style: { maxHeight: 220, overflow: 'auto', marginTop: 6 } },
              friends.filter((f) => (f.name + f.qq).toLowerCase().includes(query.toLowerCase())).map((f) =>
                h('label', { key: f.qq, style: { display: 'block', padding: '4px 2px' } },
                  h('input', { type: 'checkbox', checked: selected.includes(f.qq), onChange: () => toggle(f.qq) }),
                  ' ' + (f.name || '（无备注）') + '（' + f.qq + '）')))) : null,
          h('textarea', {
            className: 'ab-textarea', style: { minHeight: 64 }, placeholder: '也可以直接填 QQ 号，一行一个',
            value: qqText, onChange: (e) => setDraft(setPath(draft, 'diary.audienceQQs', e.target.value)),
          }),
          h('div', { className: 'ab-small ab-muted', style: { marginTop: 6 } }, mode === 'selected' ? '名单为空时不会发布，也不会退回公开。' : '这些好友看不到之后的说说。')) : null,
      )
    }

    function DiaryMedia({ st, draft, setDraft, toast }) {
      const f = useField(draft, setDraft)
      const [preview, setPreview] = useState(null)
      const [busy, setBusy] = useState(false)
      const request = useRef(0)
      const unsaved = JSON.stringify(draft.diary) !== JSON.stringify(st.config.diary)
      // 修改配置后清掉旧预览，避免把旧目录或旧可见范围当成当前设置。
      useEffect(() => { request.current++; setPreview(null); setBusy(false) }, [JSON.stringify(draft.diary)])
      useEffect(() => () => { request.current++ }, [])
      const generate = async () => {
        const id = ++request.current
        setBusy(true)
        setPreview(null)
        try {
          const result = await post('/diary/preview', {})
          if (id !== request.current) return
          if (!result.ok) return toast(result.message || '预览没有生成')
          setPreview(result)
        } finally { if (id === request.current) setBusy(false) }
      }
      return h(Card, { fold: 'diary-rich', title: '图文日记与预览', right: f.sw('diary.rich.enabled'), desc: '默认关闭。开启后围绕公开浏览经历或心情写日记，按备注挑选配图；关闭后沿用原来的日记流程。' },
        draft.diary.rich?.enabled ? h('div', null,
          h(Row, { label: '表情包', hint: '默认关闭，需管理员单独开启；开启后可能将从群聊收藏的表情图发布到空间' }, f.sw('diary.rich.stickers')),
          h(Row, { label: '公开浏览配图', hint: '仅取已浏览作品的公开封面；发布会附原作者和作品链接' }, f.sw('diary.rich.browsing')),
          h(Row, { label: '使用指定目录的图片', hint: '只放你允许自动发布到空间的图片；文件内容不会自动识别隐私' }, f.sw('diary.rich.local')),
          h(Row, { label: '本地图片目录', hint: '由管理员主动填写完整路径。留空不扫描；不读取桌面或聊天截图' }, f.text('diary.rich.folder', { placeholder: '留空不读取本地图库' })),
          h(Row, { label: '每篇最多配图' }, f.num('diary.rich.maxImages', { min: 1, max: 4 })),
        ) : null,
        h('div', { className: 'ab-small ab-muted', style: { margin: '12px 0' } }, '先保存设置再预览。预览不会发布、记入发布历史或消耗当天次数；「现在写一篇」会重新写作，遵守保存的可见范围。'),
        unsaved ? h('div', { className: 'ab-small', style: { color: 'var(--ab-warn)', marginBottom: 8 } }, '日记设置尚未保存，保存后可生成预览。') : null,
        h(Btn, { kind: 'ghost', disabled: busy || unsaved, onClick: generate }, busy ? '正在生成预览…' : '生成预览（不发布）'),
        preview ? h('div', { className: 'ab-note', style: { marginTop: 14 } },
          h('div', { className: 'ab-small ab-muted' }, '预览 · ' + preview.label + ' · 尚未发布'),
          h('div', { style: { whiteSpace: 'pre-wrap', margin: '10px 0' } }, preview.text),
          h('div', { className: 'ab-flex', style: { flexWrap: 'wrap', alignItems: 'flex-start' } }, (preview.media || []).map((image) =>
            h('figure', { key: image.id, style: { margin: 0, width: 160 } },
              h('img', { src: image.src, alt: image.caption || '日记配图', style: { width: '100%', maxHeight: 180, objectFit: 'contain', borderRadius: 10 } }),
              h('figcaption', { className: 'ab-small ab-muted' }, image.kind === 'browsing' || image.sourceKind === 'browsing' ? image.platform + ' · ' + image.title : image.kind === 'local' ? '管理员指定图库 · ' + image.caption : '表情包 · ' + image.caption)))),
          (preview.warnings || []).map((warning, i) => h('div', { key: i, className: 'ab-small', style: { color: 'var(--ab-warn)' } }, warning)),
        ) : null,
      )
    }

    function DiaryArchive({ st, draft, setDraft, toast }) {
      const f = useField(draft, setDraft)
      const [status, setStatus] = useState(null)
      const [busy, setBusy] = useState(false)
      const unsaved = JSON.stringify(draft.diary.archive) !== JSON.stringify(st.config.diary.archive)
      const load = () => get('/diary/archive').then(setStatus)
      useEffect(() => {
        load()
        const timer = setInterval(load, 15_000)
        return () => clearInterval(timer)
      }, [])
      return h(Card, { fold: 'diary-archive', title: '按日期归档浏览图', right: f.sw('diary.archive.enabled'), desc: '默认关闭。每五分钟把已有的公开浏览配图保存一份，按浏览日期放入 20261031 这样的文件夹。不截取桌面或聊天。' },
        h(Row, { label: '归档文件夹', hint: '管理员主动指定的输出目录，留空不保存；每张图附来源说明文件' }, f.text('diary.archive.folder', { placeholder: '请填写完整路径' })),
        h('div', { className: 'ab-small ab-muted', style: { margin: '10px 0' } }, status ? '已归档 ' + status.count + ' 张' + (status.lastAt ? ' · 最近收集 ' + new Date(status.lastAt).toLocaleString() : '') : '正在读取归档状态…'),
        status?.error ? h('div', { className: 'ab-small', style: { color: 'var(--ab-warn)' } }, status.error) : null,
        h(Btn, { kind: 'ghost', disabled: busy || unsaved || !draft.diary.archive?.enabled || !draft.diary.archive?.folder, onClick: async () => {
          setBusy(true)
          try { const result = await post('/diary/archive/collect', {}); toast(result.message || '归档完成'); await load() }
          finally { setBusy(false) }
        } }, busy ? '正在收集…' : '现在收集浏览图'),
        h('div', { className: 'ab-small ab-muted', style: { marginTop: 8 } }, '先保存设置。总开关关闭或试运行开启时不保存图片；归档本身不会发布到空间。要用作日记配图，另在上方启用指定图库。'),
      )
    }

    function Diary({ st, draft, setDraft, toast }) {
      const f = useField(draft, setDraft)
      const [data, setData] = useState(null)
      const on = modOn(st, 'diary')
      const load = () => (on ? get('/diary/history').then((r) => { setData(r); if (r.warning) toast(r.warning) }).catch((e) => toast('日记状态刷新失败：' + e.message)) : null)
      useEffect(() => { load() }, [on])
      const social = modOn(st, 'qzone-social') ? h(QzoneSocial, { draft, setDraft, toast }) : h(ModOff, { name: '空间互动' })
      if (!on) return h('div', { className: 'ab-grid' }, h(ModOff, { name: '空间日记' }), social)
      return h('div', { className: 'ab-grid' },
        h(Card, { title: '空间日记', right: f.sw('diary.enabled'), desc: '她用可公开的经历和当前心情写说说。普通日记只在「仅自己可见」时自动从当天的画作或表情包里配图。' },
          h(Row, { label: '每天自动发布上限', hint: '设为 0 可暂停自动发布' }, f.num('diary.timesPerDay', { min: 0, max: 6 })),
          h(Row, { label: '自动发布时段', hint: '按心智时区，空闲且有动力时才写' }, f.text('diary.windowStart', { size: 'sm' }), h('span', { className: 'ab-muted' }, '到'), f.text('diary.windowEnd', { size: 'sm' })),
          h(Row, { label: '自动发布最短间隔' }, f.num('diary.minGapMinutes', { min: 0 }), h('span', { className: 'ab-muted' }, '分钟')),
          h(Row, { label: '字数' }, f.num('diary.minChars', { min: 10 }), h('span', { className: 'ab-muted' }, '到'), f.num('diary.maxChars', { min: 20 }), h('span', { className: 'ab-muted' }, '字')),
          h(DiaryAudience, { draft, setDraft, toast }),
        ),
        h(Card, { section: 'diary-write', title: '现在写日记', right: h('div', { className: 'ab-flex' },
          data?.automatic ? h('span', { className: 'ab-muted ab-small' }, '今天 ' + data.automatic.count + '/' + data.automatic.limit + ' · ' + (data.automatic.reason || '等她空闲时决定')) : null,
          h(Btn, { small: true, kind: 'ghost', title: '刷新空间状态', onClick: load }, h('svg', { width: 16, height: 16, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 2, 'aria-hidden': true }, h('path', { d: 'M20 7v5h-5M4 17v-5h5M6.1 7a7 7 0 0 1 11.6-1L20 9M4 15l2.3 3A7 7 0 0 0 17.9 17' }))),
          h(Btn, { small: true, kind: 'primary', onClick: async () => {
            toast('ta在写了…')
            try {
              const r = await post('/diary/run', {})
              const message = r.dryRun ? '写好了（试运行，没真发）' : '发出去了'
              toast(r.ok ? [message, ...(r.warnings || [])].join('；') : r.message)
            } catch (e) { toast(e.message) }
            finally { await load() }
          } }, '现在写一篇'),
          h(Btn, { small: true, onClick: async () => { const r = await post('/diary/run', { visibility: 'self' }); toast(r.message || (r.ok ? '已写入日记' : '日记生成失败')); await load() } }, '写一篇仅自己可见的日记')) }),
        h(DiaryMedia, { st, draft, setDraft, toast }),
        h(DiaryArchive, { st, draft, setDraft, toast }),
        h(Card, { fold: 'diary-history', title: '发布历史' },
          !data ? h(Empty, { icon: '⏳', text: '加载中…' }) : !data.items || data.items.length === 0 ? h(Empty, { icon: '📔', text: '还没写过日记。' }) :
            h('div', { className: 'ab-list' }, data.items.map((d, i) => h('div', { key: i, className: 'ab-li' },
              h('div', { className: 'meta' }, new Date(d.at).toLocaleString(), h('br'), d.deletedAt ? '已从空间删除' : d.dryRun ? '试运行' : d.ok ? (AUDIENCE_LABEL[d.visibility] || '已发布') : '失败'),
              h('div', { className: 'body' }, d.text,
                (d.warnings || []).map((warning, index) => h('div', { key: index, className: 'ab-small', style: { color: 'var(--ab-warn)' } }, warning)),
                d.error ? h('div', { className: 'ab-small', style: { color: 'var(--ab-err)' } }, d.error) : null),
              d.tid && !d.deletedAt ? h(Btn, { small: true, kind: 'ghost', onClick: async () => { if (!confirm('从 QQ 空间删除这条说说？')) return; try { const r = await post('/qzone/delete', { tid: d.tid }); toast(r.message) } catch (e) { toast(e.message) } finally { await load() } } }, '从空间删除') : null))),
        ),
        social,
      )
    }

    const SOCIAL_KIND = { reply: '回复评论', comment: '评论', like: '点赞' }

    /** 空间互动：回复自己说说下的评论、逛好友动态。 */
    function QzoneSocial({ draft, setDraft, toast }) {
      const f = useField(draft, setDraft)
      const [s, setS] = useState(null)
      const load = () => get('/qzone/social/state').then(setS)
      useEffect(() => { load() }, [])
      return h(Card, { fold: 'diary-social', title: '空间互动', right: f.sw('qzoneSocial.enabled'), desc: '她醒着、空闲时会定期检查自己说说下的新评论，并决定是否回复。她想逛好友空间时，也会按设置点赞或评论。' },
        h(Row, { label: '回复自己说说下的评论' }, f.sw('qzoneSocial.replyOwn')),
        h(Row, { label: '评论好友的说说' }, f.sw('qzoneSocial.commentFriends')),
        h(Row, { label: '顺手点赞' }, f.sw('qzoneSocial.like')),
        h(Row, { label: '好友说说互动概率', hint: '每条说说只判断一次' }, f.percent('qzoneSocial.friendChance')),
        h(Row, { label: '你的说说互动概率' }, f.percent('qzoneSocial.ownerChance')),
        h(Row, { label: '每天最多评论', hint: '点赞不算' }, f.range('qzoneSocial.maxPerDay', 0, 30, 1, (v) => v + ' 条')),
        h('div', { className: 'ab-flex', style: { marginTop: 10 } },
          h('span', { className: 'ab-muted ab-small' }, s ? '今天评论了 ' + s.count + ' 条' + (s.lastReplyCheck ? '，上次检查新评论 ' + timeAgo(s.lastReplyCheck) : '') + (s.lastRun ? '，上次逛空间 ' + timeAgo(s.lastRun) : '') : ''),
          h('div', { className: 'ab-spacer' }),
          h(Btn, { small: true, onClick: async () => { toast('ta去逛空间了…'); const r = await post('/qzone/social/run'); toast(r.message, r.ok ? 'ok' : 'err'); load() } }, '现在逛一次')),
        s && s.history && s.history.length ? h('div', { className: 'ab-list', style: { marginTop: 10 } }, s.history.map((x, i) => h('div', { key: i, className: 'ab-li' },
          h('div', { className: 'meta' }, timeAgo(x.at), h('br'), SOCIAL_KIND[x.kind] || x.kind),
          h('div', { className: 'body' }, h('b', null, x.who), x.post ? h('span', { className: 'ab-muted' }, ' 的「' + x.post + '」') : null, x.text ? h('div', null, x.text) : null)))) : null,
      )
    }

    /** 内心：内心日记、想要的、能做的事和动力、主动找你、权限申请、本地小模型。 */
    function MindInner({ toast }) {
      const [d, setD] = useState(null)
      const [busy, setBusy] = useState('')
      const load = () => get('/mind/inner').then(setD)
      useEffect(() => { load(); const t = setInterval(load, 30000); return () => clearInterval(t) }, [])
      if (!d) return h(Card, { title: '内心' }, h('p', { className: 'ab-muted' }, '读取中…'))
      if (!d.ok) return h(Card, { title: '内心' }, h(Empty, { text: d.message || '心智核心没起来' }))
      const act = async (path, body, label) => { setBusy(label || path); try { const r = await post(path, body || {}); toast(r.message || (r.ok ? '好了' : '没成功')); load() } finally { setBusy('') } }
      const m = d.motivation
      const motivesByWant = new Map()
      for (const motive of d.motives || []) {
        for (const id of motive.wantIds || []) {
          const previous = motivesByWant.get(id)
          if (!previous || (!previous.available && motive.available)) motivesByWant.set(id, motive)
        }
      }
      const pending = (d.grants.requests || []).filter((r) => r.status === 'pending')
      const grantedKeys = Object.keys(d.grants.granted || {})
      const diary = (d.diary || []).slice(0, 40)
      const wants = m.wants || []
      const diaryTime = new Intl.DateTimeFormat('zh-CN', { timeZone: d.timezone, month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
      return h(Fragment, null,
        h(Card, { fold: 'mind-journal', title: '内心日记（最近 ' + diary.length + ' 条）', collapseAtEnd: diary.length > 5, desc: '她醒着、空闲时，会结合各会话近况和回忆想一会儿。每条左侧是实际生成时间，正文是她的念头。标有「深想」的是她进一步思考后的结果。' + (d.boredom >= 0.5 ? '　现在有点无聊。' : '') },
          diary.length ? h('div', { className: 'ab-list' }, diary.map((x, i) => h('div', { key: i, className: 'ab-li' },
            h('div', { className: 'meta' }, diaryTime.format(x.at) + ' · ' + timeAgo(x.at) + (x.by === 'local' ? ' · 本地' : ' · 聊天模型') + (x.repeated ? ' · 在重复，放空了' : '')),
            h('div', { className: 'body' }, x.thought,
              x.feel ? h('span', { className: 'ab-muted ab-small' }, '  （' + x.feel.name + '）') : null,
              x.plan ? h('div', { className: 'ab-small' }, '想去：' + x.plan) : null,
              x.deep ? h('div', { className: 'ab-note', style: { marginTop: 4 } }, '深想（' + x.deep.reason + '）：' + x.deep.thought) : null)))) : h(Empty, { text: '还没想过什么' })),
        h(Card, { fold: 'mind-wants', title: '她想要的（' + wants.length + ' 项）', collapseAtEnd: wants.length > 5, desc: '这些念头会影响她的动力。醒着、空闲时，她会从能做的事里选一件。' },
          wants.length ? h('div', { className: 'ab-list', style: { marginBottom: 12 } }, wants.map((w) => {
            const motive = motivesByWant.get(w.id)
            const status = motive?.why || (motive ? (motive.motive < d.actThreshold ? '动力还不够' : '等她空闲时决定') : '没有对应的动作')
            return h('div', { key: w.id, className: 'ab-li' },
              h('div', { className: 'meta' }, timeAgo(w.at)),
              h('div', { className: 'body' }, w.text, h('div', { className: 'ab-muted ab-small' }, motive ? motive.label + ' · ' + status : status)),
              h(Btn, { small: true, onClick: () => act('/mind/want/close', { id: w.id }) }, '帮她放下'))
          })) : h('p', { className: 'ab-muted' }, '现在没什么特别想要的'),
          m.needs.filter((n) => n.deficit >= 0.05).sort((a, b) => b.deficit - a.deficit).slice(0, 8).map((n) => h(Meter, { key: n.id, label: n.name, value: n.deficit, warn: n.deficit >= 0.7 }))),
        h(Card, { fold: 'mind-actions', title: '能做的事', desc: '模块交给她的事，什么时候做由她决定：动力 ≈ 觉得能做成 × 有多想要 ÷（1 + 容易分心 × 回报要等多久），再看费不费力、精力和心情。动力没过门槛就犯懒不做。做完按结果学：比预想的开心，下次更想做。' },
          (d.motives || []).length ? h('div', { className: 'ab-list' }, d.motives.map((x) => h('div', { key: x.id, className: 'ab-li' },
            h('div', { className: 'meta' }, '动力 ' + x.motive.toFixed(2) + (x.why ? ' · ' + x.why : '') + (m.learned[x.id] ? ' · 以前做了 ' + m.learned[x.id].runs + ' 次，满意度 ' + Math.round(m.learned[x.id].expect * 100) + '%' : '')),
            h('div', { className: 'body' }, x.label, x.wants.length ? h('span', { className: 'ab-muted ab-small' }, '  惦记着：' + x.wants.join('、')) : null),
            h(Btn, { small: true, disabled: !x.available || Boolean(busy), onClick: () => act('/mind/act', { id: x.id }, x.id) }, busy === x.id ? '在做…' : '让她现在去')))) : h(Empty, { text: '还没有模块交给她事情做' }),
          (m.log || []).length ? h('div', { style: { marginTop: 12 } }, h('b', null, '最近做过的'), h('div', { className: 'ab-list' }, m.log.slice(0, 10).map((x, i) => h('div', { key: i, className: 'ab-li' },
            h('div', { className: 'meta' }, timeAgo(x.at)), h('div', { className: 'body' }, (x.ok ? '' : '没做成：') + x.label + (x.summary ? '——' + x.summary : '')))))) : null),
        h(Card, { fold: 'mind-outreach', title: '主动找你', desc: '想你了、有事想分享、答应你的事做好了、要申请权限时，她自己决定找不找你。你没回之前她不会追着发；一直没回她会有点失落。勿扰时段和每天上限在「设置 → 动机与行动」里设（默认不设，由她自己拿捏）。' },
          d.outreach.pending ? h('p', null, '刚找过你，还在等你回：' + d.outreach.pending.reason) : null,
          (d.outreach.log || []).length ? h('div', { className: 'ab-list' }, d.outreach.log.slice(0, 10).map((x, i) => h('div', { key: i, className: 'ab-li' },
            h('div', { className: 'meta' }, timeAgo(x.at) + (x.kind === 'permission' ? ' · 申请权限' : '')), h('div', { className: 'body' }, x.reason)))) : h('p', { className: 'ab-muted' }, '还没主动找过你')),
        h(Card, { fold: 'mind-grants', title: '权限申请', desc: '她想要一项还没有的权限时会私聊问你，说清楚要什么、为什么。你在 QQ 私聊里回「同意 #编号」或「不同意 #编号」就行（群里有人替你说不算），这里也能批。批过的随时可以收回。' },
          pending.length ? h('div', { className: 'ab-list' }, pending.map((r) => h('div', { key: r.n, className: 'ab-li' },
            h('div', { className: 'meta' }, '#' + r.n + ' · ' + timeAgo(r.at)),
            h('div', { className: 'body' }, r.what, r.why ? h('div', { className: 'ab-muted ab-small' }, '因为：' + r.why) : null),
            h('div', { className: 'ab-flex', style: { gap: 6 } },
              h(Btn, { small: true, kind: 'primary', onClick: () => act('/mind/permission/decide', { n: r.n, yes: true }) }, '批准'),
              h(Btn, { small: true, onClick: () => act('/mind/permission/decide', { n: r.n, yes: false }) }, '不批'))))) : h('p', { className: 'ab-muted' }, '没有等你批的'),
          grantedKeys.length ? h('div', { style: { marginTop: 10 } }, h('b', null, '已经批过的'), h('div', { className: 'ab-flex', style: { flexWrap: 'wrap', gap: 6, marginTop: 6 } }, grantedKeys.map((k) => h(Btn, { key: k, small: true, onClick: () => { if (confirm('收回「' + k + '」？')) act('/mind/permission/revoke', { key: k }) } }, k + ' ✕')))) : null),
        h(MindLocalModel, { toast, usage: d.usage }))
    }

    function MindLocalModel({ toast, usage, settings }) {
      const [status, setStatus] = useState(null)
      const [busy, setBusy] = useState('')
      const [result, setResult] = useState(null)
      const load = () => get('/mind/local/install/status').then(setStatus)
      useEffect(() => { load() }, [settings])
      useEffect(() => {
        if (!status?.running) return
        let cancelled = false
        let timer
        const poll = async () => {
          const next = await get('/mind/local/install/status')
          if (cancelled) return
          // 读状态失败时保留最后一步进度，下次再试。
          if (typeof next.running === 'boolean') setStatus(next)
          if (next.running !== false) timer = setTimeout(poll, 1000)
        }
        timer = setTimeout(poll, 1000)
        return () => { cancelled = true; clearTimeout(timer) }
      }, [status?.running])
      const act = async (action) => {
        setBusy(action)
        setResult(null)
        try {
          const response = await post('/mind/local/' + action)
          // 安装请求只确认任务已启动，完成结果来自安装状态接口。
          if (action === 'install' && response.ok) {
            setStatus((current) => ({ ...current, running: true, step: '', log: [], message: '' }))
            return
          }
          setResult(response)
          toast(response.message, response.ok ? 'ok' : 'err')
          await load()
        } finally {
          setBusy('')
        }
      }
      const local = status?.local
      const canInstall = status?.supported !== false
      const notice = status?.running ? '' : result?.message || status?.message || local?.lastError
      const pathRow = (label, path) => path
        ? h(Row, { label }, h('code', { className: 'ab-small', style: { wordBreak: 'break-all' } }, path))
        : null
      return h(Card, { fold: 'mind-local-model', title: '本地小模型', desc: '处理日常念头。已有模型和 Python 环境会直接复用，约占 6 GB 内存，闲置后自动停止。' },
        h(Row, { label: '状态' }, !status ? '读取中…' : !local ? status.message || '心智核心未就绪'
          : local.configured ? (local.running ? '已就绪 · 运行中' : '已就绪 · 用时启动') : local.reason || '尚未安装'),
        pathRow('实际模型路径', local?.modelDir || status?.paths?.model),
        pathRow('实际 Python 路径', local?.python || status?.paths?.python),
        usage ? h(Row, { label: '今日后台用量' }, Math.round((usage.tokens || 0) / 1000) + 'K token') : null,
        status?.running || busy === 'install' ? h(Row, { label: '安装进度', hint: (status?.log || []).at(-1) || '' },
          status?.step || '正在检查本地环境…') : null,
        notice && busy !== 'install' ? h('div', { className: 'ab-small', role: 'status' }, notice) : null,
        local ? h('div', { className: 'ab-flex', style: { gap: 8 } },
          h(Btn, { small: true, kind: local.configured ? undefined : 'primary', disabled: !canInstall || status.running || Boolean(busy), onClick: () => {
            if (local.configured || confirm('安装到 ~/Aurabot/mind？已有文件会复用。缺少模型时会下载约 18 GB 的原版权重并在本机转换。')) act('install')
          } }, status.running ? '正在检查或安装…' : local.configured ? '检查与修复' : '一键下载安装'),
          h(Btn, { small: true, disabled: !local.configured || status.running || Boolean(busy), onClick: () => act('test') }, busy === 'test' ? '正在测试…' : '试一下')) : null,
        local && !canInstall ? h('p', { className: 'ab-muted ab-small' }, '一键安装需要 Apple 芯片 Mac。') : null)
    }

    function Mood({ draft, setDraft, toast }) {
      const f = useField(draft, setDraft)
      const mc = draft.mind || {}
      const [vp, setVp] = useState(null)
      const [ms, setMs] = useState(null)
      const [savingPrivacy, setSavingPrivacy] = useState(false)
      const loadMs = () => get('/mind/settings').then((r) => setMs(r && r.ok ? r.values : null)).catch(() => {})
      const shareEveryday = 'memory.ownerEverydayExcerpts'
      const setPrivacy = async (value) => {
        setSavingPrivacy(true)
        try {
          const r = await post('/mind/settings/save', { patch: { [shareEveryday]: value } })
          if (!r.ok) { toast(r.message || '隐私设置保存失败', 'err'); return }
          setMs(r.values)
          toast('已保存隐私设置', 'ok')
        } finally { setSavingPrivacy(false) }
      }
      const backend = mc.embedBackend || 'remote'
      const offline = backend === 'local'
      useEffect(() => { loadMs() }, [])
      useEffect(() => {
        let active = true
        const refresh = () => get('/mind/vectors').then((r) => { if (active) setVp(r && r.ok ? r : null) })
        refresh()
        const timer = setInterval(refresh, 5000)
        return () => { active = false; clearInterval(timer) }
      }, [backend])
      // 选了模型直接存进设置（和「设置」页是同一处）
      const pickMind = async (key, m) => { const r = await post('/mind/settings/save', { patch: { [key]: m } }); if (r && r.ok === false) toast(r.message, 'err'); loadMs() }
      const privacy = typeof ms?.[shareEveryday] === 'boolean' ? h(Card, { section: 'memory-privacy', title: '私聊隐私', className: 'ab-privacy' },
          h(Row, { className: 'ab-param-row', label: '跨会话使用日常片段', hint: '你们的私聊原话和私密经历留在原会话。关掉后，日常片段也留在原会话。你指定会话的分享仍然有效。' },
            h(Switch, { label: '跨会话使用日常片段', on: ms[shareEveryday], disabled: savingPrivacy, onChange: setPrivacy }))) : null
      return h('div', { className: 'ab-grid' },
        h(MindMemory, { toast, privacy }),
        h(Card, { fold: 'memory-vectors', title: '向量检索与精排', desc: '向量可用来找措辞不同但意思相近的记忆。切换方式并保存后，旧记忆会在睡眠整理时分批重算。' },
          h(Row, { label: '向量后端' }, f.select('mind.embedBackend', [
            { value: 'remote', label: '兼容接口', desc: '用设置的接口计算向量' },
            { value: 'local', label: '离线中文模型', desc: '在本机计算，暂停远程精排' },
          ])),
          offline ? h('div', { className: 'ab-muted ab-small' },
            vp?.backend !== 'local' ? '保存设置后切换到离线模型。' : vp.error || '本机模型 bge-small-zh-v1.5 已就绪。') : null,
          !offline ? h(Row, { label: '向量服务密钥', hint: '只存在本机，不会显示出来。按意思想起相近的事（向量）和精排（「设置 → 记忆」里打开）都用它' }, f.text('mind.embedKey', { type: 'password', placeholder: mc.embedKeySet ? '已保存（不改就留空）' : '没有就留空' })) : null,
          !offline && ms ? h(Row, { label: '向量模型', hint: '现在用的：' + (ms['memory.embedModel'] || '—') + '。换了以后，旧记忆她每晚睡觉时分批重新算' },
            h('div', { style: { flex: 1 } }, h(ModelPicker, { kind: 'embedding', keyFrom: 'mind', toast, baseUrl: ms['memory.embedUrl'], apiKey: mc.embedKey, value: ms['memory.embedModel'], onPick: (m) => pickMind('memory.embedModel', m) }))) : null,
          !offline && ms ? h(Row, { label: '精排模型', hint: '现在用的：' + (ms['memory.rerankModel'] || '—') + (ms['memory.rerank'] ? '' : '（精排没开，在「设置 → 记忆」打开）') },
            h('div', { style: { flex: 1 } }, h(ModelPicker, { kind: 'rerank', keyFrom: 'mind', toast, baseUrl: ms['memory.embedUrl'], apiKey: mc.embedKey, value: ms['memory.rerankModel'], onPick: (m) => pickMind('memory.rerankModel', m) }))) : null,
          vp && vp.backend === backend && vp.total ? h('div', { className: 'ab-muted ab-small', style: { marginTop: 6 } }, vp.done >= vp.total ? '全部 ' + vp.total + ' 条记忆都算好了（' + vp.model + '）。' : '已经按意思算好 ' + vp.done + ' / ' + vp.total + ' 条（' + vp.model + '）。换过向量模型或刚填密钥时，剩下的她每晚睡觉时分批算，没算到的照常按字找。') : null),
        h(Card, { fold: 'memory-chat-log', title: '聊天流水保留', desc: '聊天中枢自己的近几天流水（空间日记等功能会看今天的）。她的完整经历在心智核心里，和这个无关。' },
          h(Row, { label: '聊天流水留多久', hint: '超过的按天移到废纸篓（不直接删）；-1 = 一直留；0 = 只留今天' }, f.num('memory.keepChatlogDays', { min: -1, max: 3650 }))))
    }

    /** 一条 0～1 的状态条。 */
    function Meter({ label, value, hint, warn, compact, icon }) {
      const pctv = Math.round(Math.max(0, Math.min(1, Number(value) || 0)) * 100)
      if (compact) return h('div', { className: cx('ab-vital', warn && 'warn') },
        h('div', { className: 'ab-vital-label' }, navIcon(icon), h('b', null, label), h('span', null, pctv + '%')),
        h('div', { className: 'ab-vital-meter', role: 'meter', 'aria-label': label, 'aria-valuemin': 0, 'aria-valuemax': 100, 'aria-valuenow': pctv },
          h('i', { style: { width: pctv + '%' } })))
      return h(Row, { label, hint }, h('div', { className: 'ab-flex', style: { gap: 8, minWidth: 220 } },
        h('div', { className: 'ab-mood', style: { flex: 1 } }, h('i', { style: { width: Math.max(3, pctv) + '%', background: warn ? 'var(--ab-warn)' : undefined } })),
        h('span', { className: 'ab-muted ab-small' }, pctv + '%')))
    }

    /** 身体、心情和情绪来自同一份心智状态。 */
    function MindNow({ toast }) {
      const [d, setD] = useState(null)
      const [food, setFood] = useState('')
      const load = () => get('/mind/now').then(setD)
      useEffect(() => { load(); const t = setInterval(load, 30000); return () => clearInterval(t) }, [])
      if (!d) return h(Card, { title: '她现在' }, h('p', { className: 'ab-muted' }, '读取中…'))
      if (!d.ok) return h(Card, { title: '她现在' }, h(Empty, { text: d.message || '心智核心没起来' }))
      const b = d.body
      const act = async (path, body) => { const r = await post(path, body || {}); toast(r.message || (r.ok ? '好了' : '没成功')); load(); return r }
      const feed = async () => { if (!food.trim()) return toast('填一个吃的'); const r = await act('/mind/feed', { food: food.trim() }); if (r.ok) setFood('') }
      const deg = (i) => (i >= 0.75 ? '很' : i >= 0.45 ? '有些' : '一点')
      const emotions = (d.emotions || []).filter((e) => e.intensity >= 0.05)
      const bodyState = b.asleep ? '睡着了' : b.groggy ? '刚睡醒' : '醒着'
      const details = [
        ['愉快度', Math.round(d.mood.v * 100)],
        ['活跃度', Math.round(d.mood.a * 100)],
      ]
      return h('div', { className: 'ab-now' },
        h('div', { className: 'ab-now-lead' },
          h('section', { className: 'ab-now-mood' },
            h('div', { className: 'ab-now-heading' }, navIcon(b.asleep ? 'moon' : 'pulse'), h('h1', null, '她现在')),
            h('p', { className: 'ab-now-date' }, d.now, b.shift ? ' · 时差 ' + b.shift + ' 小时' : ''),
            h('p', { className: 'ab-now-label' }, '当前心情', h('strong', null, d.mood.label)),
            h('dl', { 'aria-label': '心情指标，范围为负 100 到正 100' }, details.map(([label, value]) => h('div', { key: label }, h('dt', null, label), h('dd', null, value > 0 ? '+' + value : value))))),
          h('section', { className: 'ab-card ab-body-state' },
            h('div', { className: 'ab-section-heading' }, h('h2', null, '身体状态'), h('span', null, bodyState, b.asleep && b.sleepAt ? ' · ' + timeAgo(b.sleepAt) : '')),
            h(Meter, { compact: true, icon: 'bolt', label: '精力', value: b.energy, warn: b.energy < 0.25 }),
            h(Meter, { compact: true, icon: 'moon', label: '困意', value: b.sleepiness, warn: b.sleepiness >= 0.6 }),
            d.hunger ? h(Meter, { compact: true, icon: 'meal', label: '饥饿', value: b.hunger, warn: b.hunger >= 0.6 })
              : h('p', { className: 'ab-small ab-muted' }, '「会饿」已关闭'),
            h('div', { className: 'ab-body-foot' },
              b.lastSleep ? h('span', null, `上一觉 ${b.lastSleep.hours} 小时 · 睡眠质量 ${Math.round(b.lastSleep.quality * 100)}%` + (b.lastSleep.wokenBy ? ' · 被叫醒' : '')) : null,
              b.asleep ? h(Btn, { small: true, onClick: () => act('/mind/wake') }, '叫醒她')
                : h(Btn, { small: true, onClick: () => { if (confirm('让她现在去睡？')) act('/mind/sleepnow') } }, '让她睡吧')))),
        h('div', { className: 'ab-now-detail' },
          h(Card, { fold: 'mind-feelings', title: '此刻的感受（' + emotions.length + ' 项）', className: 'ab-feelings', collapseAtEnd: emotions.length > 5 },
            emotions.length ? h('ul', { className: 'ab-feeling-list' }, emotions.map((e, i) => h('li', { key: i },
              h('span', { className: 'ab-feeling-mark' }, navIcon('pulse')),
              h('div', null, h('b', null, deg(e.intensity) + e.name),
                h('div', { className: 'ab-muted ab-small' }, '起于 ' + timeAgo(e.at) + (e.targetName ? ' · 对' + e.targetName : '') + (e.source === 'thought' ? ' · 源自念头' : e.source === 'deep' ? ' · 源自深想' : e.source === 'recall' ? ' · 回忆唤起' : '') + (e.hidden ? ' · 没表现出来' : '')),
                e.why && !(e.source === 'thought' && e.why === '想着想着') ? h('p', null, e.why) : null))))
              : h('div', { className: 'ab-quiet' }, navIcon('pulse'), h('span', null, '此刻没有明显的情绪'))),
          h(Card, { title: '投喂', desc: '虚拟投喂，不涉及任何付款。', className: 'ab-feed' },
            h('div', { className: 'ab-feed-form' },
              h('input', { className: 'ab-input', 'aria-label': '想投喂的食物', placeholder: '例如 奶茶', value: food, onChange: (e) => setFood(e.target.value), onKeyDown: (e) => { if (e.key === 'Enter' && !e.nativeEvent?.isComposing) feed() } }),
              h(Btn, { kind: 'primary', onClick: feed, disabled: !food.trim() }, '投喂')),
            b.lastMeal ? h('p', { className: 'ab-small ab-muted' }, '上次吃东西 · ', timeAgo(b.lastMeal.at),
              b.lastMeal.by === 'self' || !b.lastMeal.by ? '，自己吃的' : '，' + (b.lastMeal.by === 'qq:' + (d.ownerQQ || '') ? '你' : b.lastMeal.by.replace(/^qq:/, '')) + '喂的',
              b.lastMeal.food ? '：' + b.lastMeal.food : '') : null,
            h('details', { className: 'ab-feed-help' }, h('summary', null, '怎么投喂'),
              h('ul', null,
                h('li', null, '在 QQ 里直接说「这块蛋糕给你」，也可以配一张食物图。'),
                h('li', null, '在 QQ 发送 ', h('code', null, '/投喂 食物名'), ' 或 ', h('code', null, '/喂 食物名'), '。'),
                h('li', null, '在这里填食物，点「投喂」。')),
              h('p', null, d.feedOnlyByOwner ? '「只靠管理员投喂」已开启。她饿了会来找你。' : '她饿了也会自己找吃的。')))),
        (d.history || []).length ? h(Card, { fold: 'mood-history', title: '最近的情绪变化', className: 'ab-emotion-history' },
          h('ol', null, d.history.slice(0, 15).map((x, i) => h('li', { key: i },
            h('span', null, timeAgo(x.at)), h('b', null, deg(x.i) + x.name), x.why ? h('small', null, x.why) : null)))) : null)
    }

    // ---------- 心智核心：记忆、人物、设置 ----------
    const MIND_KIND = { event: '经历', experience: '看过的', fact: '知道的事', hearsay: '听说的', belief: '我觉得', intention: '要做的事', semantic: '整理出来的', noted: '特意记下的', 'public-note': '可聊的片段', 'shared-note': '允许分享的片段', dream: '梦', 'own-post': '自己发过的', pending: '惦记别人的事', date: '每年的日子', 'day-summary': '那天的回顾', 'week-summary': '那一周的回顾', 'month-summary': '那个月的回顾' }
    const MIND_LEVEL = { clear: '记得清楚', vague: '只记得大概', tip: '要很强的线索才想得起' }
    const mindDay = (at) => {
      if (!at) return '时间未知'
      const d = new Date(at)
      return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
    }

    /** 她的记忆：数量、今天花了多少、上次睡觉整理，按状态 / 种类 / 关键字翻，单条加强或删除，对照原始记录。 */
    /* @include knowledge.js */

    function MindMemory({ toast, privacy }) {
      const [state, setState] = useState(null)
      const [items, setItems] = useState(null)
      const [q, setQ] = useState('')
      const [status, setStatus] = useState('live')
      const [kind, setKind] = useState('')
      const [sleeping, setSleeping] = useState(false)
      const [next, setNext] = useState(null)
      const [loading, setLoading] = useState(false)
      const [error, setError] = useState('')
      const [sources, setSources] = useState([])
      const [relation, setRelation] = useState(null)
      const [share, setShare] = useState(null)
      const [sharing, setSharing] = useState(false)
      const pageTicket = useRef(0)
      const relatedTicket = useRef(0)
      const sourceLabel = (id) => id === 'qq' ? 'QQ' : id || '未标平台'
      const load = async (offset = 0) => {
        const ticket = ++pageTicket.current
        setLoading(true)
        setError('')
        const r = await get('/mind/memories?status=' + status + '&kind=' + encodeURIComponent(kind) + '&q=' + encodeURIComponent(q) + '&limit=40&offset=' + offset)
        if (ticket !== pageTicket.current) return
        setLoading(false)
        if (!r.ok) { setError(r.message || '记忆读取失败'); return }
        setItems((old) => offset ? [...(old || []), ...(r.items || []).filter((item) => !old?.some((x) => x.id === item.id))] : r.items || [])
        if (!offset) setSources(r.sources || [])
        setNext(r.next ?? null)
      }
      const toggleRelated = async (id) => {
        const ticket = ++relatedTicket.current
        if (relation?.id === id) { setRelation(null); return }
        setRelation({ id, loading: true })
        const r = await get('/mind/memory/related?id=' + encodeURIComponent(id))
        if (ticket === relatedTicket.current) setRelation({ id, items: r.items || [], error: r.ok ? '' : r.message || '关联读取失败' })
      }
      const loadState = () => get('/mind/state').then(setState)
      useEffect(() => { loadState() }, [])
      useEffect(() => {
        setItems(null)
        setNext(null)
        setRelation(null)
        setSources([])
        const timer = setTimeout(() => load(), 250)
        return () => { clearTimeout(timer); pageTicket.current++; relatedTicket.current++ }
      }, [q, status, kind])
      if (state && !state.ok) return h(Card, { title: '记忆' }, h(Empty, { text: state.message || '心智核心没起来' }))
      const counts = state?.status?.counts || {}
      const mem = counts.memory || {}
      const usage = state?.usage
      const act = async (path, id, ask) => {
        if (ask && !confirm(ask)) return
        const r = await post(path, { id })
        toast(r.message || (r.ok ? '好了' : '没成功'))
        relatedTicket.current++
        setRelation(null)
        load(); loadState()
      }
      const sleepNow = async () => {
        if (!confirm('现在就让她睡一觉整理记忆？会调用模型、花 token（按睡觉整理的思考深度），一般几十秒到几分钟。')) return
        setSleeping(true)
        const r = await post('/mind/sleep', {})
        setSleeping(false)
        toast(r.message || (r.ok ? '整理完了' : '没成功'))
        load(); loadState()
      }
      const last = state?.sleep
      const saveShare = async () => {
        setSharing(true)
        try {
          const r = await post('/mind/memory/share', { ...share, audience: share.kind + ':' + share.target.trim() })
          toast(r.message)
          if (r.ok) { setShare(null); load() }
        } finally { setSharing(false) }
      }
      return h(Fragment, null,
        h('div', { className: 'ab-memory-head' },
          h(Card, { title: '记忆概况', className: 'ab-memory-summary' },
            h('dl', { className: 'ab-metrics ab-memory-totals' },
              [['记得的经历', state?.ok ? mem.live ?? 0 : '—'], ['已淡忘的经历', state?.ok ? mem.archived ?? 0 : '—'], ['看到和说过的原话', counts.perception ?? '—'],
                ['今日后台用量', usage ? fmtTokens(usage.tokens) : '—']].map(([label, value]) =>
                h('div', { key: label, className: 'ab-metric' }, h('dt', null, label), h('dd', null, value)))),
            h(Row, { label: '上次睡觉整理', hint: last ? mindDay(last.at) + (last.report ? ' · ' + Object.entries(last.report).map(([k, v]) => k + '：' + (typeof v === 'object' && v ? JSON.stringify(v) : v)).join('，').slice(0, 200) : '') : '还没整理过' },
              h(Btn, { small: true, onClick: sleepNow, disabled: sleeping }, sleeping ? '正在整理…' : '现在整理一次')),
            state?.pending ? h('p', { className: 'ab-muted ab-small' }, state.pending + ' 个聊天有还没记下的新消息（停下几分钟后自动记）') : null,
            state?.deferredThoughts ? h('p', { className: 'ab-muted ab-small' }, state.deferredThoughts + ' 件事排到后面的日子继续想。') : null,
            state?.status?.recovered ? h('p', { className: 'ab-note warn' }, '数据库曾损坏，已从完好的快照恢复。快照之后的部分数据可能需要补回。') : null),
          privacy),
        h(Card, { fold: 'memory-entries', title: '她记得的事', collapseAtEnd: items?.length > 5 },
          h('div', { className: 'ab-flex', style: { gap: 8, marginBottom: 10, flexWrap: 'wrap' } },
            h('input', { className: 'ab-input', placeholder: '按字找（大意、细节、原始记录）', value: q, onChange: (e) => setQ(e.target.value), style: { flex: 1, minWidth: 160 } }),
            h(Seg, { value: status, onChange: setStatus, options: [{ value: 'live', label: '记得的' }, { value: 'archived', label: '想不起来的' }] }),
            h(Select, { value: kind, onChange: setKind, options: [{ value: '', label: '全部种类' }, ...Object.entries(MIND_KIND).map(([value, label]) => ({ value, label }))] })),
          sources.length ? h('p', { className: 'ab-muted ab-small' }, '来源分布 · ' + sources.map((s) => sourceLabel(s.platform) + ' ' + s.count).join(' · ')) : null,
          error ? h('p', { className: 'ab-muted' }, error) : null,
          !items ? h('p', { className: 'ab-muted' }, loading || !error ? '读取中…' : '') : !items.length ? h(Empty, { text: q ? '没找到匹配的记忆' : status === 'archived' ? '暂无已淡忘的经历' : '还没有记下的经历' }) : h('div', { className: 'ab-list' }, items.map((m) => h('div', { key: m.id, className: 'ab-li' },
            h('div', { className: 'meta' }, mindDay(m.at), ' · ', sourceLabel(m.platform), ' · ', MIND_KIND[m.kind] || m.kind, ' · ', MIND_LEVEL[m.level] || '想不起来了', m.emotion ? ' · ' + m.emotion.name : '', m.outdated ? ' · 已过时：' + m.outdated.now : ''),
            h('div', { className: 'body' }, m.gist, m.detail ? h('div', { className: 'ab-muted ab-small' }, m.detail) : null,
              m.original ? h('div', { className: 'ab-muted ab-small', title: '她看不到原始记录；这里给你对照' }, '原来记的：' + m.original.gist) : null),
            h('div', { className: 'ab-flex', style: { gap: 6 } },
              h(Btn, { small: true, onClick: () => toggleRelated(m.id) }, relation?.id === m.id ? '收起关联' : '查看关联'),
              h(Btn, { small: true, onClick: () => act('/mind/memory/boost', m.id) }, '加强'),
              m.canShare ? h(Btn, { small: true, onClick: () => setShare({ id: m.id, text: '', kind: 'group', target: '' }), disabled: sharing }, '允许分享') : null,
              m.shareWith?.length ? h(Btn, { small: true, onClick: () => act('/mind/memory/share/revoke', m.id, '撤回这个会话的分享？'), kind: 'danger' }, '撤回分享') : null,
              h(Btn, { small: true, onClick: async () => { const r = await post('/mind/memory/private', { id: m.id, enabled: !m.privateOnly }); toast(r.message); load() } }, m.privateOnly ? '取消仅私聊' : '仅在私聊提'),
              h(Btn, { small: true, kind: 'danger', onClick: () => act('/mind/memory/delete', m.id, '删掉这条记忆？由它整理出来的「知道的事」会跟着删或重算。从备份恢复后也不会复活。') }, '删除')),
            m.shareWith?.length ? h('div', { className: 'ab-muted ab-small' }, '分享对象：' + m.shareWith.map((id) => id.replace(/^qq:group:/, 'QQ群 ').replace(/^qq:private:/, 'QQ 私聊 ')).join('、')) : null,
            share?.id === m.id ? h('div', { className: 'ab-note' },
              h(Row, { label: '可以聊的内容', hint: '只填你允许这个会话知道的细节' }, h('textarea', { className: 'ab-textarea', maxLength: 300, value: share.text, disabled: sharing, onChange: (e) => setShare({ ...share, text: e.target.value }) })),
              h(Row, { label: '分享给' },
                h(Select, { value: share.kind, options: [{ value: 'group', label: 'QQ群' }, { value: 'private', label: 'QQ 私聊' }], onChange: (kind) => setShare({ ...share, kind }), disabled: sharing }),
                h('input', { className: 'ab-input', inputMode: 'numeric', placeholder: share.kind === 'group' ? '群号' : '对方 QQ 号', value: share.target, disabled: sharing, onChange: (e) => setShare({ ...share, target: e.target.value }) })),
              h(Btn, { small: true, kind: 'primary', disabled: sharing || !share.text.trim() || !/^\d+$/.test(share.target.trim()), onClick: saveShare }, sharing ? '正在保存…' : '保存分享'),
              h(Btn, { small: true, disabled: sharing, onClick: () => setShare(null) }, '取消')) : null,
            relation?.id === m.id ? h('div', { className: 'ab-muted ab-small' },
              relation.loading ? '读取关联…' : relation.error || (relation.items.length ? relation.items.map((item) => h('div', { key: item.id },
                mindDay(item.at), ' · ', sourceLabel(item.platform), ' · ', ({ source: '来源', similar: '相近', cause: '因果', followup: '后续' })[item.relation] || item.relation, ' · ', item.gist)) : '暂无关联')) : null))),
          next !== null ? h(Btn, { onClick: () => load(next), disabled: loading }, loading ? '读取中…' : '加载更多') : null,
          error && next === null ? h(Btn, { onClick: () => load(), disabled: loading }, '重试') : null),
        h(Card, { fold: 'memory-dreams', title: '最近的梦', desc: '睡觉整理时做的梦。大部分醒来就忘；情绪强的、被叫醒的会记得，记得的才会变成她的记忆（梦不会被当成真发生过的事）。' },
          (state?.dreams || []).length ? h('div', { className: 'ab-list' }, state.dreams.map((d, i) => h('div', { key: i, className: 'ab-li' },
            h('div', { className: 'meta' }, mindDay(d.at), d.remembered ? ' · 她记得' : ' · 醒来忘了'),
            h('div', { className: 'body' }, d.text)))) : h(Empty, { text: '还没做过梦' })))
    }

    /** 关系：她认识的每个人（按 QQ 号认人）和每个群。数值是她自己的看法，你可以纠正几项。 */
    /**
     * 关系星图：她在正中，每个人一个点。越亲近点越大、离她越近；线是「在她的记忆里一起出现过」（越多越粗）。
     * 环上的顺序按谁和谁常一起出现排（贪心连成一串），一伙朋友会挨在一起。点一下打开那个人。
     */
    function StarMap({ onPick, q }) {
      const [g, setG] = useState(null)
      const [hover, setHover] = useState('')
      useEffect(() => { get('/mind/people/graph').then(setG).catch(() => setG({ ok: false })) }, [])
      if (!g) return h('p', { className: 'ab-muted' }, '读取中…')
      if (!g.ok || !(g.people || []).length) return h(Empty, { text: '还没认识谁' })
      const people = g.people.slice(0, 120)
      const w = new Map()
      for (const e of g.edges || []) { w.set(e.a + '|' + e.b, e.n); w.set(e.b + '|' + e.a, e.n) }
      // 排顺序：从最亲近的开始，每次接上和上一个联系最多的人；上一个没联系，就接和已经排好的人联系最多的，
      // 再没有就接下一个最亲近的。这样一伙常一起出现的人挨在一起
      const left = [...people].sort((a, b) => Number(b.owner) - Number(a.owner) || b.closeness - a.closeness)
      const order = [left.shift()]
      while (left.length) {
        const last = order[order.length - 1].id
        let bi = 0
        let best = 0
        left.forEach((p, i) => { const n = w.get(last + '|' + p.id) || 0; if (n > best) { best = n; bi = i } })
        if (!best) left.forEach((p, i) => { const n = order.reduce((t, o) => t + (w.get(o.id + '|' + p.id) || 0), 0); if (n > best) { best = n; bi = i } })
        order.push(left.splice(bi, 1)[0])
      }
      const S = 600, C = S / 2, R = S / 2 - 40
      const near = (p) => Math.max(0, Math.min(1, p.owner ? 0.95 : p.closeness))
      // 每个人占的角度按点的大小分：越亲近点越大，占得越宽，名字不挤在一起
      const span = order.map((p) => 1 + 4 * near(p))
      const total = span.reduce((a, b) => a + b, 0)
      let acc = 0
      const pos = new Map(order.map((p, i) => {
        const a = ((acc + span[i] / 2) / total) * Math.PI * 2 - Math.PI / 2
        acc += span[i]
        const r = 60 + (1 - near(p)) * (R - 60)
        return [p.id, { x: C + r * Math.cos(a), y: C + r * Math.sin(a), p }]
      }))
      const maxN = Math.max(1, ...(g.edges || []).map((e) => e.n))
      const match = (p) => q && [p.name, p.id, p.typeLabel].join(' ').toLowerCase().includes(q.toLowerCase())
      const focus = hover || ''
      return h('figure', { className: 'ab-starmap' },
        h('svg', { viewBox: `0 0 ${S} ${S}`, role: 'group', 'aria-label': '关系星图' },
          [0.33, 0.66, 1].map((k) => h('circle', { key: k, className: 'orbit', cx: C, cy: C, r: 60 + k * (R - 60) })),
          (g.edges || []).filter((e) => pos.has(e.a) && pos.has(e.b)).map((e) => {
            const a = pos.get(e.a), b = pos.get(e.b)
            const on = focus && (e.a === focus || e.b === focus)
            return h('line', { key: e.a + e.b, x1: a.x, y1: a.y, x2: b.x, y2: b.y, stroke: on ? 'var(--ab-sea)' : 'var(--ab-sub)', strokeOpacity: on ? 0.9 : focus ? 0.08 : 0.25, strokeWidth: 0.8 + 2.5 * (e.n / maxN) })
          }),
          h('circle', { cx: C, cy: C, r: 24, fill: 'var(--ab-foam-2)' }),
          h('circle', { cx: C, cy: C, r: 15, fill: 'var(--ab-sea)' }),
          h('text', { x: C, y: C + 34, textAnchor: 'middle', fontSize: 13, fill: 'var(--ab-text)', fontWeight: 700 }, g.self || '她'),
          order.map((p) => {
            const { x, y } = pos.get(p.id)
            const size = 4 + 12 * Math.max(0, Math.min(1, p.owner ? 1 : p.closeness))
            const dim = (q && !match(p)) || (focus && focus !== p.id && !w.get(focus + '|' + p.id))
            const personLabel = [p.name || p.id, p.typeLabel, '亲近 ' + Math.round(p.closeness * 100)].filter(Boolean).join(' · ')
            return h('g', { key: p.id, className: 'person-node', tabIndex: 0, role: 'button', 'aria-label': personLabel,
              style: { cursor: 'pointer' }, opacity: dim ? 0.25 : 1, onClick: () => onPick(p.id),
              onKeyDown: (event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); onPick(p.id) } },
              onFocus: () => setHover(p.id), onBlur: () => setHover(''), onMouseEnter: () => setHover(p.id), onMouseLeave: () => setHover('') },
              h('circle', { cx: x, cy: y, r: size, fill: p.owner ? 'var(--ab-warn)' : p.noMemory ? 'var(--ab-dim)' : 'var(--ab-sky)', stroke: match(p) ? 'var(--ab-err)' : 'var(--ab-card)', strokeWidth: match(p) ? 3 : 1.5 }),
              (size >= 8 || match(p) || focus === p.id) ? h('text', { x, y: y - size - 4, textAnchor: 'middle', fontSize: 11, fill: 'var(--ab-text)' }, (p.name || p.id.replace(/^qq:/, '')).slice(0, 8)) : null,
              h('title', null, personLabel))
          })),
        h('figcaption', { className: 'ab-starmap-caption' }, '距离表示亲近程度，连线表示同一段记忆。选择人物查看详情。'))
    }

    function MindPeople({ toast }) {
      const [d, setD] = useState(null)
      const [q, setQ] = useState('')
      const [open, setOpen] = useState('')
      const [gone, setGone] = useState([])
      const [view, setView] = useState(() => { try { return localStorage.getItem('aurabot.peopleView') || 'list' } catch (e) { return 'list' } })
      const switchView = (v) => { setView(v); try { localStorage.setItem('aurabot.peopleView', v) } catch (e) {} }
      const pick = (id) => {
        switchView('list')
        setOpen(id)
        setQ('')
        setTimeout(() => {
          const el = document.getElementById('person-' + id.replace(/\W/g, ''))
          if (!el) return
          el.focus({ preventScroll: true })
          el.scrollIntoView({ block: 'start', behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' })
        }, 50)
      }
      const [follows, setFollows] = useState([])
      const [impression, setImpression] = useState(null)
      const load = () => {
        get('/mind/people').then(setD)
        get('/mind/people/forgotten').then((r) => setGone((r && r.list) || [])).catch(() => {})
        get('/mind/followups').then((r) => setFollows((r && r.list) || [])).catch(() => {})
      }
      const stopAsking = async (f) => { const r = await post('/mind/followups/close', { id: f.id }); toast(r.message, r.ok ? 'ok' : 'err'); load() }
      useEffect(() => { load() }, [])
      if (d && !d.ok) return h(Card, { title: '关系' }, h(Empty, { text: d.message || '心智核心没起来' }))
      // 忘掉一个人：删除要确认两次；「以后不记」可以选要不要连以前的一起移走；都先进恢复区，30 天内能放回来
      const forget = async (p, mode) => {
        const who = (p.name || '这个人') + '（' + p.id.replace(/^qq:/, 'QQ ') + '）'
        let body = { id: p.id, mode }
        if (mode === 'delete') {
          if (!confirm('忘掉 ' + who + '？\n\n她对他的关系、关于他的事、和他的私聊、他说过的原话都会移进恢复区（30 天内能放回来，之后就真的没了）。和别人一起经历、他只是在场的事留着。')) return
          if (!confirm('再确认一次：现在就忘掉 ' + who + '？')) return
          body.confirm = true
        } else if (mode === 'stop') {
          const clear = confirm('以后不记 ' + who + ' 了：他说的话不再进她的记忆（聊天照常回）。\n\n以前关于他的记忆要不要也一起移走？\n「确定」= 一起移进恢复区；「取消」= 以前的留着')
          body.clear = clear
        }
        const r = await post('/mind/people/forget', body)
        toast(r.message || (r.ok ? '好了' : '没成功'), r.ok ? 'ok' : 'err'); load()
      }
      const restorePerson = async (g) => { if (!confirm('把 ' + (g.name || g.id) + ' 从恢复区放回来？')) return; const r = await post('/mind/people/restore', { id: g.id }); toast(r.message, r.ok ? 'ok' : 'err'); load() }

      const list = d?.list || []
      const needle = q.trim().toLowerCase()
      const shown = list.filter((p) => !needle || [p.name, p.id, ...(p.aliases || []), p.typeLabel, p.tom?.note].join(' ').toLowerCase().includes(needle)).slice(0, 300)
      const edit = async (id, patch) => {
        const r = await post('/mind/people/edit', { id, patch })
        toast(r.message || (r.ok ? '已保存' : '没有保存成功'), r.ok ? 'ok' : 'err')
        if (r.ok) load()
        return r.ok
      }
      const texts = (arr) => (arr || []).map((x) => x.text || x).join('、')
      const personCard = (p) => {
        const r = p.rel || {}
        const t = p.tom || {}
        const isOpen = open === p.id
        const id = 'person-' + p.id.replace(/\W/g, '')
        const detailId = id + '-details'
        const name = p.name || '未命名'
        const pending = follows.filter((f) => f.about === p.id)
        const editing = isOpen && impression?.id === p.id
        const scoreFields = [['亲近', r.closeness], ['喜欢', r.liking], ['尊重', r.respect], ['信任', r.trust]]
        if (p.owner || r.intimacy) scoreFields.push(['亲密', r.intimacy], ['承诺', r.commitment])
        const showPassion = p.owner && (d?.passionEnabled ?? Boolean(r.passion))
        if (showPassion) scoreFields.push(['激情', r.passion])
        const change = r.passionChange
        const points = change ? Number((change.delta * 100).toFixed(1)) : 0
        const detailFields = [
          ['她叫对方', r.call && '「' + r.call + '」'],
          ['对方叫她', r.callMe && '「' + r.callMe + '」'],
          ['曾用名', (p.aliases || []).join('、')],
          ['喜欢 / 在意', texts(t.likes)],
          ['习惯', texts(t.habits)],
          ['她理解对方知道什么', (t.knowledge || []).slice(-6).map((e) => (e.state === 'known' ? '知道' : '还不知道') + '「' + e.topic + '」').join('；')],
          ['最近', t.mood && (t.mood.text + '（' + timeAgo(t.mood.at) + '）')],
          ['老梗', texts(r.topics)],
          ['别碰', texts(r.limits)],
          ['重要时刻', (r.moments || []).map((m) => mindDay(m.at).slice(0, 10) + ' ' + m.text).join('；')],
          ['没解开的结', texts(r.knots)],
          ['激情', showPassion && (change
            ? '最近一段变化 ' + (points > 0 ? '+' : '') + points + ' 分 · ' + timeAgo(change.at)
            : '整理管理员私聊时，按对话中明确表现出来的吸引变化更新。')],
          ['其他印象', [r.rivalry >= 0.3 && '有点暗暗较劲', (r.flirts || []).length >= 3 && '最近老撩她、纠缠她'].filter(Boolean).join(' · ')],
        ].filter(([, value]) => value)
        return h('article', { key: p.id, id, tabIndex: -1, className: cx('ab-person', p.owner && 'owner', isOpen && 'expanded') },
          h('header', { className: 'ab-person-head' },
            h('span', { className: 'ab-person-mark', 'aria-hidden': true }, p.name ? Array.from(p.name.trim())[0] || navIcon('mind') : navIcon('mind')),
            h('div', { className: 'ab-person-id' },
              h('h2', null, name),
              h('div', { className: 'ab-person-meta' },
                p.typeLabel ? h('span', { className: 'ab-person-tag' }, p.typeLabel) : null,
                h('span', null, p.id.replace(/^qq:/, 'QQ ')),
                r.lastContact ? h('span', null, timeAgo(r.lastContact) + '联系过') : p.lastSeen ? h('span', null, mindDay(p.lastSeen) + ' 来过') : null,
                r.n ? h('span', null, '聊过 ' + r.n + ' 段') : null,
                pending.length ? h('span', null, '惦记着 ' + pending.length + ' 件事') : null,
                p.noMemory ? h('span', null, '已停止记录') : null))),
          h('dl', { className: 'ab-person-scores', 'aria-label': '关系指标（满分 100）' }, scoreFields.map(([label, score]) => {
            const value = Math.round(Math.max(0, Math.min(1, Number(score) || 0)) * 100)
            return h('div', { key: label }, h('dt', null, label), h('dd', null, value),
              h('span', { className: 'track', 'aria-hidden': true }, h('i', { style: { width: value + '%' } })))
          })),
          r.debt ? h('div', { className: 'ab-person-meta' }, '人情 · ' + (r.debt > 0 ? '她欠 ' + r.debt : '对方欠 ' + -r.debt)) : null,
          t.note && !editing ? h('p', { className: 'ab-person-note' }, t.note) : null,
          isOpen ? h('div', { id: detailId, className: 'ab-person-details' },
            detailFields.length ? h('dl', { className: 'ab-person-fields' }, detailFields.map(([label, value]) =>
              h('div', { className: 'ab-person-field', key: label }, h('dt', null, label), h('dd', null, value)))) : null,
            pending.length ? h('div', { className: 'ab-person-field' }, h('b', null, '惦记着的事'), pending.map((f) =>
              h('div', { className: 'ab-person-follow', key: f.id },
                h('span', null, f.gist + (f.asks ? '（问过 ' + f.asks + ' 次）' : f.nextAt > Date.now() ? '（' + mindDay(f.nextAt).slice(0, 10) + ' 以后会问）' : '（下次聊天时会问）')),
                h(Btn, { small: true, kind: 'ghost', onClick: () => stopAsking(f) }, '不用问了')))) : null,
            editing ? h('div', { className: 'ab-person-edit' },
              h('label', { htmlFor: id + '-impression' }, '对这个人的印象'),
              h('textarea', { id: id + '-impression', className: 'ab-textarea', rows: 4, autoFocus: true, value: impression.text, onChange: (e) => setImpression({ id: p.id, text: e.target.value }) }),
              h('div', { className: 'ab-person-actions' },
                h(Btn, { small: true, kind: 'ghost', onClick: () => setImpression(null) }, '取消'),
                h(Btn, { small: true, kind: 'primary', onClick: async () => {
                  if (await edit(p.id, { note: impression.text })) setImpression((current) => current?.id === p.id ? null : current)
                } }, '保存印象'))) : null) : null,
          h('footer', { className: 'ab-person-actions' },
            isOpen && (r.knots || []).length ? h(Btn, { small: true, kind: 'ghost', onClick: () => { if (confirm('把她对这个人的心结都清掉？')) return edit(p.id, { knots: [] }) } }, '清掉心结') : null,
            isOpen && !p.owner ? (p.noMemory
              ? h(Btn, { small: true, kind: 'ghost', onClick: async () => { const r = await post('/mind/people/forget', { id: p.id, mode: 'resume' }); toast(r.message); load() } }, '恢复记录')
              : h(Btn, { small: true, kind: 'ghost', onClick: () => forget(p, 'stop') }, '停止记录')) : null,
            isOpen && !p.owner ? h(Btn, { small: true, kind: 'danger', onClick: () => forget(p, 'delete') }, '忘掉这个人') : null,
            editing ? null : h(Btn, { small: true, kind: 'ghost', onClick: () => {
              setOpen(p.id)
              setImpression((current) => current?.id === p.id ? current : { id: p.id, text: t.note || '' })
            } }, '写印象'),
            h(Btn, { small: true, expanded: isOpen, controls: isOpen ? detailId : undefined, onClick: () => setOpen(isOpen ? '' : p.id) }, isOpen ? '收起' : '详细')))
      }
      return h('div', { className: 'ab-people' },
        h(Card, { desc: d && (d.exclusive ? '「专一」已开启，亲密、激情和承诺只对管理员。' : '「专一」已关闭，她也可能慢慢喜欢上别人。') },
          h('div', { className: 'ab-people-tools' },
            h('label', { className: 'ab-people-search' }, navIcon('find'), h('input', {
              className: 'ab-input', type: 'search', 'aria-label': '查找人物', placeholder: '查找姓名、账号或关系', value: q, onChange: (e) => setQ(e.target.value),
            })),
            h(Seg, { value: view, options: [{ value: 'list', label: '列表' }, { value: 'map', label: '星图' }], onChange: switchView }))),
        view === 'map' ? h(Card, null, h(StarMap, { onPick: pick, q: q.trim() }))
          : !d ? h('p', { className: 'ab-muted', role: 'status' }, '读取中…')
          : !shown.length ? h(Card, null, h(Empty, { text: needle ? '没有找到匹配的人' : '还没认识谁' }))
          : h('div', { className: 'ab-people-grid' }, shown.map(personCard)),
        gone.length ? h(Card, { fold: 'people-recovery', title: '恢复区', desc: '忘掉的人可以在 30 天内恢复。' },
          h('div', { className: 'ab-list' }, gone.map((g) => h('div', { key: g.id, className: 'ab-li' },
            h('div', { className: 'meta' }, '保留到 ' + mindDay(g.until).slice(0, 10)),
            h('div', { className: 'body' }, h('b', null, g.name || '未命名'), h('div', { className: 'ab-muted ab-small' }, [
              g.id.replace(/^qq:/, 'QQ '), g.episodes + ' 件事、' + g.perception + ' 句原话', g.keepPerson && '已停止记录',
            ].filter(Boolean).join(' · '))),
            h(Btn, { small: true, onClick: () => restorePerson(g) }, '放回来'))))) : null,
        d?.groups?.length ? h(Card, { fold: 'people-groups', title: '她对群的了解' }, h('div', { className: 'ab-people-groups' }, d.groups.map((g) =>
          h('article', { key: g.id, className: 'ab-people-group' },
            h('b', null, g.name || '群'),
            h('div', { className: 'ab-person-meta' }, g.id + (g.at ? ' · ' + timeAgo(g.at) : '')),
            h('p', null, [...(g.style || []), ...(g.rules || []).map((x) => '规矩：' + x), g.note].filter(Boolean).join('；') || '还没摸清楚'))))) : null)
    }

    /** 人格与自我：她本来的样子（特质，等你确认）、现在的样子、不知不觉的变化和提醒、她自己改过的、自我故事、各种版本可以退回。 */
    function MindSelf({ toast }) {
      const [d, setD] = useState(null)
      const [draft, setDraft] = useState(null)
      const [busy, setBusy] = useState(false)
      const [edit, setEdit] = useState(null)
      const load = () => get('/mind/self').then((r) => { setD(r); if (r.ok) setDraft(Object.fromEntries(r.personality.traits.map((t) => [t.id, t.base]))) })
      useEffect(() => { load() }, [])
      if (!d) return h(Card, { title: '人格与自我' }, h('p', { className: 'ab-muted' }, '读取中…'))
      if (!d.ok) return h(Card, { title: '人格与自我' }, h(Empty, { text: d.message || '心智核心没起来' }))
      const ps = d.personality
      const groups = [['E', '外向'], ['A', '宜人'], ['C', '尽责'], ['N', '情绪敏感'], ['O', '开放'], ['H', '诚实谦逊'], ['AT', '依恋'], ['X', '表达']]
      const restore = async (kind, id) => { if (!confirm('退回到这个版本？（会新存一个版本，写明是退回）')) return; const r = await post('/mind/self/restore', { kind, id }); toast(r.message || (r.ok ? '退回了' : '没成功')); load() }
      const infer = async () => { if (ps.confirmed && !confirm('重新从人格卡推一份？只是给你参考，确认之前不会改她本来的样子。')) return; setBusy(true); const r = await post('/mind/traits/infer', {}); setBusy(false); toast(r.message); load() }
      const confirmBase = async () => { const r = await post('/mind/traits/confirm', { base: draft }); toast(r.message); load() }
      const changeSelf = (what, label, multiline) => {
        const cur = what === 'values' || what === 'hobbies' || what === 'looks' ? d.profile[what] : what === 'story' ? d.profile.story.text : what === 'name' ? d.identity.name : what === 'ownerCall' ? d.ownerCall : d.identity.nickname
        setEdit({ what, label, multiline: Boolean(multiline), value: cur || '' })
      }
      const saveSelf = async () => {
        if (!edit) return
        const r = await post('/mind/self/change', { what: edit.what, content: edit.value, why: '管理员在面板里改的' })
        toast(r.message); setEdit(null); load()
      }
      const unread = (ps.alerts || []).filter((a) => !a.read)
      const BY = { owner: '你', self: '她自己', sleep: '睡觉时', migration: '迁移' }
      return h(Fragment, null,
        edit ? h(Card, { title: '改' + edit.label, desc: '会存一个版本；长文字建议在「人设」页改。' },
          h('textarea', { className: 'ab-textarea', rows: edit.multiline ? 6 : 2, value: edit.value, onChange: (e) => setEdit({ ...edit, value: e.target.value }) }),
          h('div', { className: 'ab-flex', style: { gap: 6 } },
            h(Btn, { small: true, kind: 'primary', onClick: saveSelf }, '保存'),
            h(Btn, { small: true, onClick: () => setEdit(null) }, '取消'))) : null,
        unread.length ? h(Card, { title: '提醒', right: h(Btn, { small: true, onClick: async () => { await post('/mind/traits/alerts/read', {}); load() } }, '知道了') },
          h('div', { className: 'ab-list' }, unread.map((a, i) => h('div', { key: i, className: 'ab-li' }, h('div', { className: 'meta' }, mindDay(a.at)), h('div', { className: 'body' }, a.text, h('span', { className: 'ab-muted ab-small' }, '  看下面「性格的版本」里的理由，必要时退回')))))) : null,
        h(Card, { fold: 'self-traits', title: '性格（19 项）', desc: '「本来的样子」相当于她的天生气质，从第一版人格卡推出来、由你确认，她改人格卡不会动它。「现在」随经历慢慢变：同一种表现要在不同的日子里出现够多次才走一小步，每晚睡觉时检查。数值只给你看，她看到的是每一档对应的那句话。' + (ps.shadowMode ? ' 影子模式开着：变化只计算、不生效。' : ''),
          right: h('div', { className: 'ab-flex', style: { gap: 6 } }, h(Btn, { small: true, onClick: infer, disabled: busy }, busy ? '推算中…' : '从人格卡推一份'), h(Btn, { small: true, kind: 'primary', onClick: confirmBase }, ps.confirmed ? '保存本来的样子' : '确认这就是她')) },
          !ps.confirmed ? h('div', { className: 'ab-note', style: { marginBottom: 10 } }, ps.inferred ? '下面「本来的样子」是从人格卡推出来的，括号里是依据。看看像不像她，不像就拖一下，再点「确认这就是她」。' : '还没推过：点「从人格卡推一份」（会调用一次模型），或者直接拖滑块设好再确认。') : null,
          groups.map(([g, label]) => h('div', { key: g, style: { marginBottom: 8 } },
            h('div', { className: 'ab-muted ab-small', style: { margin: '6px 0' } }, label),
            ps.traits.filter((t) => t.group === g).map((t) => h(Row, { key: t.id, label: t.label, hint: '现在：' + t.text + (t.band !== t.baseBand ? `（从第 ${t.baseBand} 档变到第 ${t.band} 档）` : '') + (ps.inferred && ps.inferred.why && ps.inferred.why[t.id] ? '　依据：' + ps.inferred.why[t.id] : '') },
              h('div', { className: 'ab-flex', style: { gap: 8, minWidth: 260 } },
                h(Range, { value: draft ? draft[t.id] : t.base, min: 0.02, max: 0.98, step: 0.01, onChange: (v) => setDraft({ ...draft, [t.id]: v }), fmt: (v) => '本来 ' + Math.round(v * 100) }),
                h('span', { className: 'ab-small', title: '现在的值' }, '现在 ' + Math.round(t.cur * 100) + (t.shadow !== null && t.shadow !== undefined && t.shadow !== t.cur ? '（影子 ' + Math.round(t.shadow * 100) + '）' : '')))))))),
        h(Card, { fold: 'self-habits', title: '小习惯', desc: '同一类场合里反复出现、又被正面回应的反应会变成习惯；被冷落、被责怪的慢慢消失。' },
          (ps.habits || []).length ? h('div', { className: 'ab-list' }, ps.habits.map((x) => h('div', { key: x.id, className: 'ab-li' },
            h('div', { className: 'meta' }, (x.active ? '已经是习惯' : '还在形成') + ' · 出现过 ' + x.count + ' 次'),
            h('div', { className: 'body' }, x.sit + '时，' + x.act)))) : h(Empty, { text: '还没有' })),
        h(Card, { title: '她自己写下的', desc: '她想通了可以随时改这些（人格卡、名字、价值观、爱好、外貌、自我故事、想变成的样子），改完会给你发通知（「设置 → 身份」里可以关），不需要你同意。年龄、生日、「专一」只有你能改。你也可以在这里改。' },
          h(Row, { label: '名字', hint: d.identity.name || '（没有）' }, h(Btn, { small: true, onClick: () => changeSelf('name', '名字') }, '改')),
          h(Row, { label: '小名', hint: d.identity.nickname || '（没有）' }, h(Btn, { small: true, onClick: () => changeSelf('nickname', '小名') }, '改')),
          h(Row, { label: '价值观', hint: d.profile.values || '（没写）' }, h(Btn, { small: true, onClick: () => changeSelf('values', '价值观') }, '改')),
          h(Row, { label: '爱好', hint: (d.profile.hobbies || '（没写）') + '（群里聊到这些，她更想接话）' }, h(Btn, { small: true, onClick: () => changeSelf('hobbies', '爱好') }, '改')),
          h(Row, { label: '外貌', hint: d.profile.looks || '（没写）' }, h(Btn, { small: true, onClick: () => changeSelf('looks', '外貌') }, '改')),
          h(Row, { label: '对你的称呼', hint: '她现在叫你「' + (d.ownerCall || '管理员') + '」' + (d.profile.ownerCall ? '' : '（你一开始设的）') + '。' + (d.ownerCallOk === true ? '她可以自己换个叫法，会通知你。' : '她现在不能自己改：' + d.ownerCallOk + '。') + '开关在「设置 → 身份」。' },
            h(Btn, { small: true, onClick: () => changeSelf('ownerCall', '对你的称呼') }, '改')),
          h(Row, { label: '想变成的样子', hint: (d.profile.goals || []).length ? d.profile.goals.map((g) => g.text).join('；') : '（没有）' }, (d.profile.goals || []).length ? h(Btn, { small: true, onClick: async () => { const g = d.profile.goals[0]; if (!confirm('删掉「' + g.text + '」？')) return; await post('/mind/self/goal/drop', { text: g.text }); load() } }, '删一个') : null)),
        h(Card, { fold: 'self-story', title: '她的故事', desc: '她用自己的话写的「我是怎么变成现在这样的」（叙事身份，McAdams）；有重要的经历时，睡觉整理会更新，重要的经历成为新的一章。', right: h(Btn, { small: true, onClick: () => changeSelf('story', '她的故事', true) }, '改') },
          d.profile.story.text ? h('div', { className: 'ab-small', style: { whiteSpace: 'pre-wrap' } }, d.profile.story.text) : h(Empty, { text: '还没写' }),
          (d.profile.story.chapters || []).length ? h('div', { className: 'ab-muted ab-small', style: { marginTop: 8 } }, '章节：' + d.profile.story.chapters.map((c) => mindDay(c.at).slice(0, 10) + ' ' + c.title).join(' · ')) : null),
        h(Card, { fold: 'self-versions', title: '人格卡的版本', desc: '谁改的、为什么改。退回会新存一个版本。人格卡原文在「人设」页编辑。' },
          h('div', { className: 'ab-list' }, d.versions.persona.map((v, i) => h('div', { key: v.id, className: 'ab-li' },
            h('div', { className: 'meta' }, mindDay(v.at) + ' · ' + (BY[v.by] || v.by) + ' · ' + v.data.chars + ' 字' + (v.data.name ? ' · ' + v.data.name : '')),
            h('div', { className: 'body' }, v.reason || '（没写理由）'),
            i > 0 ? h(Btn, { small: true, onClick: () => restore('persona', v.id) }, '退回') : h('span', { className: 'ab-muted ab-small' }, '现在用的'))))),
        h(Card, { fold: 'self-changes', title: '她改过自己的记录' },
          d.versions.self.length ? h('div', { className: 'ab-list' }, d.versions.self.map((v) => h('div', { key: v.id, className: 'ab-li' },
            h('div', { className: 'meta' }, mindDay(v.at) + ' · ' + (BY[v.by] || v.by)),
            h('div', { className: 'body' }, v.reason, v.data && v.data.what !== 'persona' && v.data.what !== 'story' ? h('div', { className: 'ab-muted ab-small' }, (v.data.before ? '「' + String(v.data.before).slice(0, 60) + '」→ ' : '') + '「' + String(v.data.after || '').slice(0, 80) + '」') : null),
            v.data && v.data.what !== 'goal' ? h(Btn, { small: true, onClick: () => restore('self', v.id) }, '退回这一项') : null))) : h(Empty, { text: '还没改过' })),
        h(Card, { fold: 'self-trait-versions', title: '性格的版本', desc: '每次不知不觉走了一步、你确认或退回，都存一个版本，写着理由。' },
          d.versions.traits.length ? h('div', { className: 'ab-list' }, d.versions.traits.map((v, i) => h('div', { key: v.id, className: 'ab-li' },
            h('div', { className: 'meta' }, mindDay(v.at) + ' · ' + (BY[v.by] || v.by)),
            h('div', { className: 'body ab-small' }, v.reason),
            i > 0 ? h(Btn, { small: true, onClick: () => restore('traits', v.id) }, '退回') : null))) : h(Empty, { text: '还没有' })),
        h(MindVersions, { versions: d.versions, restore, load, toast }),
        h(Card, { fold: 'self-prompt', title: '她看到的「她是谁」', desc: '每轮放在系统提示词开头的内容（人格卡 + 她自己写的 + 故事摘要 + 不知不觉的变化）。很少变，所以大多数时候能命中缓存。' },
          h('pre', { className: 'ab-small', style: { whiteSpace: 'pre-wrap', maxHeight: 360, overflow: 'auto' } }, d.prompt)))
    }

    function MindVersions({ versions, restore, load, toast }) {
      const [kind, setKind] = useState('traits')
      const [first, setFirst] = useState('')
      const [second, setSecond] = useState('')
      const [from, setFrom] = useState('')
      const [through, setThrough] = useState('')
      const [comparison, setComparison] = useState(null)
      const [extra, setExtra] = useState([])
      const [hasMore, setHasMore] = useState(true)
      const [loading, setLoading] = useState(false)
      const kinds = [{ value: 'traits', label: '性格' }, { value: 'habits', label: '习惯' }, { value: 'persona', label: '人格卡' }, { value: 'self', label: '自我' }]
      const rows = [...(versions[kind] || []), ...extra]
      const more = async () => {
        setLoading(true)
        try {
          const r = await get('/mind/version/list?kind=' + kind + '&before=' + rows.at(-1).id)
          if (r.ok) { setExtra([...extra, ...r.items]); setHasMore(r.hasMore) }
          else toast(r.message, 'err')
        } finally { setLoading(false) }
      }
      const options = [{ value: '', label: '选一个版本' }, ...rows.map((v) => ({
        value: String(v.id), label: '#' + v.id + ' · ' + mindDay(v.at) + (v.pinned ? ' · 已标记' : ''),
      }))]
      const selected = rows.find((v) => String(v.id) === first)
      const change = async (path, body) => {
        const r = await post(path, body)
        if (r.message) toast(r.message, r.ok ? 'ok' : 'err')
        setComparison(null)
        setExtra([]); setHasMore(true); setFirst(''); setSecond('')
        load()
      }
      const compare = async () => {
        const r = await get('/mind/version/compare?first=' + encodeURIComponent(first) + '&second=' + encodeURIComponent(second))
        if (r.ok) setComparison(r.versions)
        else toast(r.message, 'err')
      }
      const bulk = () => {
        const start = new Date(from + 'T00:00:00').getTime()
        const end = new Date(through + 'T00:00:00')
        end.setDate(end.getDate() + 1)
        if (confirm('清理这段日期内的版本？会保留标记的重要版本和最新版本。')) return change('/mind/version/delete', { kind, from: start, through: end.getTime() })
      }
      const content = (v) => {
        if (v.kind === 'persona') return [v.data.name, v.data.card].filter(Boolean).join('\n')
        if (v.kind === 'habits') return v.data.habits.filter((x) => x.active).map((x) => x.sit + '时，' + x.act).join('\n') || '没有已经形成的习惯'
        if (v.kind === 'traits') return Object.entries(v.data.cur || {}).map(([key, value]) => key + ' · ' + Math.round(value * 100)).join('\n')
        return [v.data.before, v.data.after].filter(Boolean).join('\n\n')
      }
      return h(Card, { fold: 'self-versions-manage', title: '版本对比与清理' },
        h(Row, { label: '类别' }, h(Select, { value: kind, options: kinds, onChange: (value) => { setKind(value); setFirst(''); setSecond(''); setComparison(null); setExtra([]); setHasMore(true) }, disabled: loading })),
        h(Row, { label: '两个版本' },
          h(Select, { value: first, options, onChange: (value) => { setFirst(value); setComparison(null) } }),
          h(Select, { value: second, options, onChange: (value) => { setSecond(value); setComparison(null) } }),
          h(Btn, { small: true, disabled: !first || !second || first === second, onClick: compare }, '对比')),
        hasMore && rows.length >= (kind === 'persona' ? 30 : 50) ? h(Btn, { small: true, disabled: loading, onClick: more }, loading ? '读取中…' : '加载更早的版本') : null,
        comparison ? h('div', { style: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(190px,1fr))', gap: 12 } }, comparison.map((v) =>
          h('div', { key: v.id }, h('b', null, '#' + v.id + ' · ' + mindDay(v.at)), h('p', { className: 'ab-small' }, v.reason),
            h('pre', { className: 'ab-small', style: { whiteSpace: 'pre-wrap', maxHeight: 300, overflow: 'auto' } }, content(v))))) : null,
        selected ? h(Row, { label: '第一个版本' },
          h(Btn, { small: true, onClick: () => change('/mind/version/pin', { id: selected.id, pinned: !selected.pinned }) }, selected.pinned ? '取消标记' : '标记重要'),
          kind === 'habits' ? h(Btn, { small: true, onClick: () => restore(kind, selected.id) }, '退回习惯版本') : null,
          h(Btn, { small: true, onClick: () => { if (confirm('删除所选版本？')) change('/mind/version/delete', { id: selected.id }).then(() => setFirst('')) } }, '删除版本')) : null,
        h(Row, { label: '按日期清理' },
          h('input', { type: 'date', className: 'ab-input', value: from, 'aria-label': '起始日期', onChange: (e) => setFrom(e.target.value) }),
          h('input', { type: 'date', className: 'ab-input', value: through, 'aria-label': '结束日期', onChange: (e) => setThrough(e.target.value) }),
          h(Btn, { small: true, disabled: !from || !through || from > through, onClick: bulk }, '清理范围')))
    }

    /** 面板里的调试对话：不经过 QQ、不写进她的心智，直接把她说的话显示出来（来自原项目 f476866）。 */
    function DebugChat({ toast }) {
      const [msgs, setMsgs] = useState([])
      const [text, setText] = useState('')
      const [busy, setBusy] = useState(false)
      const say = async () => {
        const t = text.trim()
        if (!t || busy) return
        setMsgs((m) => [...m, { who: 'me', text: t }])
        setText('')
        setBusy(true)
        try {
          const r = await post('/debug/say', { text: t })
          setMsgs((m) => [...m, { who: 'her', text: r.ok ? (r.text || '（她这次没说话）') : '✗ ' + (r.message || '出错了') }])
        } catch (error) {
          setMsgs((m) => [...m, { who: 'her', text: '✗ ' + error.message }])
        } finally {
          setBusy(false)
        }
      }
      return h('div', null,
        msgs.length ? h('div', { className: 'ab-list', style: { maxHeight: 340, overflow: 'auto', marginBottom: 8 } },
          msgs.map((m, i) => h('div', { key: i, className: 'ab-li' },
            h('div', { className: 'meta' }, m.who === 'me' ? '你' : '她'),
            h('div', { className: 'body', style: { whiteSpace: 'pre-wrap' } }, m.text)))) : h(Empty, { icon: '💬', text: '说点什么试试，比如「在吗」「今天心情怎么样」' }),
        h('div', { className: 'ab-flex', style: { marginTop: 6 } },
          h('input', { className: 'ab-input', style: { flex: 1 }, value: text, placeholder: '对她说…（回车发送）', onChange: (e) => setText(e.target.value), onKeyDown: (e) => { if (e.key === 'Enter') say() } }),
          h(Btn, { small: true, kind: 'primary', disabled: busy || !text.trim(), onClick: say }, busy ? '她在想…' : '发送')))
    }

    /** 心智设置的一个输入框：失焦或回车才保存（数字留空 = 没填）。 */
    function MindInput({ value, label, number, min, max, step, unit, onCommit, disabled }) {
      const [v, setV] = useState(value ?? '')
      useEffect(() => { setV(value ?? '') }, [value])
      const commit = () => {
        if (String(v) === String(value ?? '')) return
        if (number) onCommit(v === '' ? null : Number(v))
        else onCommit(String(v))
      }
      return h('span', { className: cx('ab-flex', number && 'ab-number-ctl'), style: { gap: 6 } },
        h('input', { className: 'ab-input', type: number ? 'number' : 'text', 'aria-label': label, disabled, value: v, min, max, step, style: { width: number ? 120 : 280 }, onChange: (e) => setV(e.target.value), onBlur: commit, onKeyDown: (e) => { if (e.key === 'Enter') e.target.blur() } }),
        unit ? h('span', { className: 'ab-muted' }, unit) : null)
    }

    /** 合并后的人格与自我：人格卡文件编辑 + 她的自我状态，一个入口两个视图。 */
    function Identity({ st, toast, reload, jump }) {
      const [mode, setMode] = useState(() => { try { return localStorage.getItem('aurabot.identity.mode') || 'self' } catch { return 'self' } })
      useEffect(() => { if (jump?.section === 'self-persona') setMode('persona') }, [jump])
      const pick = (v) => { setMode(v); try { localStorage.setItem('aurabot.identity.mode', v) } catch {} }
      return h('div', { className: 'ab-grid' },
        h(Card, { title: '人格与自我', desc: '人格卡是叙述底稿；名字、小名、自我描述和故事是她的自我记录。改名字/小名会双向同步。' },
          h(Seg, { value: mode, onChange: pick, options: [{ value: 'self', label: '自我与性格' }, { value: 'persona', label: '人格卡与头像' }] })),
        mode === 'persona' ? h(Persona, { st, toast, reload }) : h(MindSelf, { toast }))
    }

    /** 心智设置：按参数表生成。每项写着默认值、依据和改了有什么影响，可以单独恢复默认。 */
    function MindSettings({ toast, jump }) {
      const [d, setD] = useState(null)
      const [advanced, setAdvanced] = useState(false)
      const [group, setGroup] = useState('')
      const [search, setSearch] = useState('')
      const [exact, setExact] = useState('')
      const [pending, setPending] = useState('')
      const saving = useRef(false)
      useEffect(() => { get('/mind/settings').then(setD) }, [])
      useEffect(() => {
        if (jump?.section === 'mind-local-model') {
          setGroup('local')
          setSearch('')
          setExact('')
        } else if (jump?.setting) {
          setSearch(jump.setting.label)
          setExact(jump.setting.key)
          if (jump.setting.advanced) setAdvanced(true)
        }
      }, [jump])
      if (!d) return h(Card, { title: '设置' }, h('p', { className: 'ab-muted' }, '读取中…'))
      if (!d.ok) return h(Card, { title: '设置' }, h(Empty, { text: d.message || '心智核心没起来' }))
      const update = async (key, body, reset = false) => {
        if (saving.current) return
        saving.current = true
        setPending(key)
        try {
          const r = await post(reset ? '/mind/settings/reset' : '/mind/settings/save', body)
          if (!r.ok) { toast(r.message || '保存失败', 'err'); return }
          setD((old) => ({ ...old, values: r.values, saved: r.saved }))
          toast(reset ? '已恢复默认' : '已保存', 'ok')
        } finally { saving.current = false; setPending('') }
      }
      const show = (v) => v === null || v === undefined || v === '' ? '不填' : typeof v === 'boolean' ? (v ? '开' : '关') : String(v)
      const ctl = (p) => {
        const v = d.values[p.key]
        const save = (x) => update(p.key, { patch: { [p.key]: x } })
        if (typeof p.def === 'boolean') return h(Switch, { on: !!v, label: p.label, disabled: Boolean(pending), onChange: save })
        if (p.options) return h(Select, { value: v, options: p.options, ariaLabel: p.label, disabled: Boolean(pending), onChange: save })
        const number = typeof p.def === 'number' || p.min !== undefined
        return h(MindInput, { value: v, label: p.label, disabled: Boolean(pending), number, min: p.min, max: p.max, step: p.step, unit: p.unit, onCommit: save })
      }
      const hasAdvanced = d.params.some((p) => p.advanced)
      const words = search.trim().toLowerCase().split(/\s+/).filter(Boolean)
      const groups = d.groups.filter((g) => d.params.some((p) => p.group === g.id && (advanced || !p.advanced)))
      const current = groups.find((g) => g.id === group) || groups[0]
      const panels = (words.length ? groups : [current].filter(Boolean)).flatMap((g) => {
        const params = d.params.filter((p) => p.group === g.id && (advanced || !p.advanced) && (exact ? p.key === exact : words.every((word) => [g.label, p.label, p.hint, p.key].join(' ').toLowerCase().includes(word))))
        return params.length ? [h(Card, { key: g.id, title: g.label }, params.map((p) => h(Row, {
          key: p.key, label: p.label, hint: p.hint, className: 'ab-param-row',
          details: h('details', { className: 'ab-param-details' }, h('summary', null, '默认值与依据'),
            h('p', null, '默认：' + show(p.def) + (p.unit && typeof p.def === 'number' ? ' ' + p.unit : '')),
            h('p', null, '依据：' + p.source), p.ownerOnly ? h('p', null, '只有你能改。') : null),
        }, ctl(p), Object.hasOwn(d.saved || {}, p.key) ? h(Btn, { small: true, kind: 'ghost', disabled: Boolean(pending), onClick: () => update(p.key, { key: p.key }, true) }, '恢复默认') : null)))] : []
      })
      return h('div', { className: 'ab-grid' },
        h(Card, { className: 'ab-settings-tools' }, h('div', { className: 'ab-settings-toolbar' },
          h('input', { className: 'ab-input', type: 'search', value: search, placeholder: '搜索设置，例如跨会话、情绪、预算', 'aria-label': '搜索设置', onChange: (e) => { setSearch(e.target.value); setExact('') } }),
          hasAdvanced ? h('div', { className: 'ab-switch-row' }, h('span', null, '显示高级'), h(Switch, { label: '显示高级', on: advanced, onChange: (v) => { setAdvanced(v); setExact('') } })) : null),
          h('nav', { className: 'ab-settings-nav', 'aria-label': '设置分类' }, groups.map((g) =>
            h('button', { key: g.id, type: 'button', 'aria-current': !words.length && current?.id === g.id ? 'true' : undefined, onClick: () => { setSearch(''); setExact(''); setGroup(g.id) } }, g.label)))),
        h('div', { className: 'ab-grid ab-settings-body' },
          !words.length && current?.id === 'local' ? h(MindLocalModel, { toast, settings: d.values }) : null,
          panels.length ? panels : h(Card, null, h(Empty, { text: '没有找到匹配的设置' }))))
    }

    function VoiceImport({ s, toast, onChange }) {
      const [over, setOver] = useState(false)
      const [busy, setBusy] = useState('')
      // 生成音色档案：DSH 是 Electron，不支持 prompt() 弹框，数据集文件夹在列表里就地填
      const [profFor, setProfFor] = useState('')
      const [profDir, setProfDir] = useState('')
      const buildProfile = async (id) => {
        const folder = profDir.trim()
        if (!folder) { toast('先填数据集文件夹的完整路径', 'err'); return }
        const r = await post('/song/voice/profile', { id, folder })
        toast(r.message, r.ok ? 'ok' : 'err')
        if (r.ok) { setProfFor(''); setProfDir('') }
        onChange()
      }
      const upload = async (files) => {
        for (const file of [...files]) {
          if (!/\.(zip|pth|index|ckpt|yaml)$/i.test(file.name)) { toast('「' + file.name + '」不是 .zip / .pth / .index / .ckpt / .yaml', 'err'); continue }
          setBusy('正在导入「' + file.name + '」（' + Math.round(file.size / 1024 / 1024) + 'MB）…')
          const r = await fetch(API + '/song/import?name=' + encodeURIComponent(file.name), { method: 'POST', body: file })
            .then((x) => x.json()).catch((e) => ({ ok: false, message: '上传失败：' + e.message }))
          toast(r.message, r.ok ? 'ok' : 'err')
        }
        setBusy('')
        onChange()
      }
      const pick = () => {
        const inp = document.createElement('input')
        inp.type = 'file'
        inp.multiple = true
        inp.accept = '.zip,.pth,.index,.ckpt,.yaml'
        inp.onchange = () => inp.files && upload(inp.files)
        inp.click()
      }
      return h(Card, { title: '音色模型', desc: '插件不自带音色。把你有权使用的 RVC 模型导进来：.pth（可以带 .index），或者装着它们的 zip。只存在本机。自己训练的是 so-vits-svc 之类别的模型、或者想用自己的推理参数？去「本地接口」页接「翻唱换声」。' },
        h('div', {
          className: 'ab-drop' + (over ? ' over' : ''), role: 'button', tabIndex: 0,
          onClick: pick, onKeyDown: (e) => (e.key === 'Enter' || e.key === ' ') && pick(),
          onDragOver: (e) => { e.preventDefault(); setOver(true) }, onDragLeave: () => setOver(false),
          onDrop: (e) => { e.preventDefault(); setOver(false); upload(e.dataTransfer.files) },
        }, busy ? h('span', null, h('i', { className: 'ab-spin' }), ' ' + busy) : h('span', null, '把 .zip / .pth / .index 拖到这里，或者点击选择文件')),
        // 分离模型自动下载不动时：给几个地址，用浏览器或下载工具下好，拖进上面这个框
        s.parts && !s.parts.separatorModel && (s.separatorLinks || []).length ? h('div', { className: 'ab-note', style: { marginTop: 10 } },
          h('b', null, '人声分离模型下不动？'), ' 安装时会自动试好几个源（断了能接着下，太慢会换源）。实在不行，用浏览器或下载工具把下面还缺的文件下好（同一个文件名的几个地址是同一个文件，任选一个），拖进上面这个框就行，插件会核对文件对不对：',
          (s.separatorLinks || []).map((u) => h('div', { key: u, className: 'ab-flex', style: { marginTop: 4 } },
            h('code', { className: 'ab-small', style: { wordBreak: 'break-all', flex: 1 } }, u),
            h(Btn, { small: true, kind: 'ghost', onClick: () => { clipboard(u).then(() => toast('复制了', 'ok'), () => toast('复制失败，手动选中复制吧', 'err')) } }, '复制')))) : null,
        s.voices.length && !s.enabled ? h('div', { className: 'ab-note warn', style: { marginTop: 10 } }, '音色导入好了，但翻唱开关还没开（这一页最上面），打开并保存后ta才会唱。') : null,
        s.profileJob ? h('div', { className: cx('ab-note', s.profileJob.ok === false && 'err'), style: { marginTop: 10 } }, (s.profileJob.running ? '⏳ ' : '') + '音色档案「' + s.profileJob.id + '」：' + s.profileJob.message) : null,
        s.voices.length === 0 ? h('div', { className: 'ab-muted ab-small', style: { marginTop: 8 } }, '还没有音色。') :
          h('div', { className: 'ab-list', style: { marginTop: 10 } }, s.voices.map((v) => h(Fragment, { key: v.id },
            h('div', { className: 'ab-li' },
              h('div', { className: 'body' }, h('b', null, v.id), v.hasIndex ? h('span', { className: 'ab-muted ab-small' }, ' · 带 index') : null,
                h('span', { className: 'ab-small', style: { color: v.hasProfile ? 'var(--ab-ok)' : 'var(--ab-sub)' } }, v.hasProfile ? ' · 有音色档案' : ' · 没有音色档案（不定调、不校正音色）')),
              h(Btn, { small: true, kind: 'ghost', disabled: Boolean(s.profileJob && s.profileJob.running), onClick: () => { setProfFor(profFor === v.id ? '' : v.id); setProfDir('') } },
                profFor === v.id ? '收起' : v.hasProfile ? '重新生成档案' : '生成音色档案'),
              h(Btn, { small: true, kind: 'ghost', onClick: async () => { if (!confirm('删掉音色「' + v.id + '」？（连同它的 index 和音色档案）')) return; const r = await post('/song/voice/delete', { id: v.id }); toast(r.message, r.ok ? 'ok' : 'err'); onChange() } }, '删除')),
            profFor === v.id ? h('div', { className: 'ab-flex', style: { margin: '6px 0 10px' } },
              h('input', { className: 'ab-input', style: { flex: 1 }, value: profDir, placeholder: '「' + v.id + '」的数据集文件夹完整路径（本人的干声录音，wav / flac / mp3），如 ' + exPath('Downloads/数据集'),
                onChange: (e) => setProfDir(e.target.value), onKeyDown: (e) => e.key === 'Enter' && buildProfile(v.id) }),
              h(Btn, { small: true, kind: 'primary', disabled: Boolean(s.profileJob && s.profileJob.running), onClick: () => buildProfile(v.id) }, '开始生成')) : null))))
    }

    const fmtBytes = (n) => (n >= 1024 ** 3 ? (n / 1024 ** 3).toFixed(2) + ' GB' : (n / 1024 ** 2).toFixed(n >= 100 * 1024 ** 2 ? 0 : 1) + ' MB')
    const fmtDur = (ms) => { const sec = Math.max(0, Math.round(ms / 1000)); return sec >= 60 ? Math.floor(sec / 60) + ' 分 ' + (sec % 60) + ' 秒' : sec + ' 秒' }

    /** 装到哪里：默认位置一键选回；也可以自己填路径。 */
    function RootPicker({ draft, setDraft, s }) {
      const val = draft.song.root || ''
      const cur = val || s.defaultRoot
      const [chk, setChk] = useState(null)
      useEffect(() => {
        const t = setTimeout(() => get('/song/root/check?path=' + encodeURIComponent(cur)).then(setChk), 300)
        return () => clearTimeout(t)
      }, [cur])
      const pick = (root) => setDraft(setPath(draft, 'song.root', root === s.defaultRoot ? '' : root))
      return h('div', { style: { width: '100%' } },
        h('div', { className: 'ab-flex', style: { gap: 8, width: '100%' } },
          h('input', { className: 'ab-input', style: { flex: '1 1 280px', minWidth: 0 }, value: val, placeholder: '留空 = 默认位置（' + s.defaultRoot + '）', onChange: (e) => setDraft(setPath(draft, 'song.root', e.target.value)) }),
          h(Btn, { small: true, kind: val ? 'ghost' : 'primary', onClick: () => pick(s.defaultRoot) }, val ? '用默认位置' : '默认位置')),
        chk ? h('div', { className: 'ab-small', style: { marginTop: 4, color: !chk.ok || chk.warn ? 'var(--ab-warn)' : 'var(--ab-sub)' } },
          !chk.ok ? chk.message : ['装在 ' + cur, chk.freeGB !== null ? '这个磁盘还剩 ' + chk.freeGB + ' GB' : '', chk.warn].filter(Boolean).join('；')) : null,
        val && val !== s.root && s.voices.length ? h('div', { className: 'ab-muted ab-small', style: { marginTop: 2 } }, '换位置后，已导入的音色要重新导入（或把原来的 models 文件夹搬过去）') : null)
    }

    /** 安装进度：步骤条 + 当前这一步的用时、预计、下载量和网速，一看就知道没卡住。 */
    function InstallProgress({ inst }) {
      const pr = inst.progress
      const now = Date.now()
      const steps = inst.steps || []
      return h('div', { className: 'ab-install' },
        h('div', { className: 'ab-install-steps' }, steps.map((name, i) => h('div', { key: i, className: cx('st', i < inst.stepIndex && 'done', i === inst.stepIndex && 'on'), title: name },
          h('i', null, i < inst.stepIndex ? '✓' : i + 1), h('span', null, name.replace(/（.*?）/g, ''))))),
        h('div', { className: 'ab-flex', style: { marginTop: 12 } }, h('i', { className: 'ab-spin' }), h('b', null, '第 ' + (inst.stepIndex + 1) + ' / ' + steps.length + ' 步：' + inst.step), h('div', { className: 'ab-spacer' }),
          h('span', { className: 'ab-muted ab-small' }, '这一步 ' + fmtDur(now - inst.stepAt) + ' · 总共 ' + fmtDur(now - inst.startedAt))),
        inst.stepHint ? h('div', { className: 'ab-muted ab-small', style: { marginTop: 2 } }, '预计：' + inst.stepHint) : null,
        pr && pr.kind === 'download' ? h('div', { className: 'ab-install-dl' },
          h('div', null, h('small', null, '已下载'), h('b', null, fmtBytes(pr.done))),
          h('div', null, h('small', null, '当前网速'), h('b', { style: { color: pr.speed < 20 * 1024 ? 'var(--ab-warn)' : undefined } }, fmtBytes(pr.speed) + '/s')),
          pr.speed < 20 * 1024 ? h('div', { className: 'ab-small', style: { color: 'var(--ab-warn)', flex: '1 1 220px' } }, '很慢的话：打开「用国内镜像下载」后重新点安装（已下好的不会重下），或者开着代理') : null) : null,
        pr && pr.kind === 'file' && pr.total ? h('div', { style: { marginTop: 10 } },
          h('div', { className: 'ab-flex ab-small' }, h('span', null, pr.name), h('div', { className: 'ab-spacer' }), h('span', null, fmtBytes(pr.done) + ' / ' + fmtBytes(pr.total) + '（' + Math.round((pr.done / pr.total) * 100) + '%）')),
          h('div', { className: 'ab-mood', style: { marginTop: 4 } }, h('i', { style: { width: Math.round((pr.done / pr.total) * 100) + '%' } }))) : null)
    }

    const SONG_PARTS = [['python', 'Python 环境'], ['applio', 'Applio（RVC 推理引擎）'], ['separator', '人声分离'], ['ffmpeg', 'ffmpeg（混音）'], ['weights', '预训练文件（音高、音色特征）'], ['separatorModel', '人声分离模型']]

    function Song({ st, draft, setDraft, toast }) {
      const f = useField(draft, setDraft)
      const [s, setS] = useState(st.song)
      const [q, setQ] = useState('')
      const [found, setFound] = useState(null)
      const [pitch, setPitch] = useState(0)
      const [acct, setAcct] = useState(null)
      const load = () => get('/song/status').then((r) => r.ok && setS(r))
      // 安装中 / 正在唱的时候每 3 秒刷新一次进度
      useEffect(() => {
        load()
        const busy = s && (s.install.running || s.profileJob?.running || s.current || s.queue.length)
        if (!busy) return
        const t = setInterval(load, 3000)
        return () => clearInterval(t)
      }, [s && s.install.running, s?.profileJob?.running, s && Boolean(s.current), s && s.queue.length])
      if (!s) return h(Empty, { icon: '⏳', text: '加载中…' })
      const search = async () => { if (!q.trim()) return; setFound(null); const r = await get('/song/search?q=' + encodeURIComponent(q)); setFound(r.list || []); if (!r.ok) toast(r.message, 'err') }
      const sing = async (song) => { const r = await post('/song/request', { songId: song.id, song: song.name, pitch }); toast(r.message, r.ok ? 'ok' : 'err'); load() }
      const voices = s.voices.map((v) => ({ value: v.id, label: v.id, desc: v.hasIndex ? '带 .index' : '' }))
      return h('div', { className: 'ab-grid' },
        h(Card, { title: '翻唱', right: f.sw('song.enabled'), desc: '让ta用自己的声音唱歌：点歌 → 从网易云下载 → 分离人声和伴奏 → 用 RVC 换成ta的声音 → 混音 → 发语音条。管理员在 QQ 里说「唱首歌」，或者发 /sing 歌名 都行。' },
          h('div', { className: cx('ab-note', s.ready ? '' : 'warn') }, s.message),
          h('div', { className: 'ab-checks', style: { marginTop: 12 } },
            SONG_PARTS.map(([k, label]) => h('div', { key: k, className: cx('ab-check', s.parts[k] && 'done') }, h('i', null, s.parts[k] ? '✓' : '·'), label)),
            h('div', { className: cx('ab-check', s.voices.length && 'done'), title: s.voices.map((v) => v.id).join('、') }, h('i', null, s.voices.length ? '✓' : '·'), s.voices.length ? '音色模型 ×' + s.voices.length : '音色模型（在下面导入）')),
          s.install.running ? null : h('div', { style: { marginTop: 12 } },
            h(Row, { className: 'ab-block', label: '装到哪里', hint: '装完约 5 GB，音色模型也放这里。改了要先保存设置再点安装' }, h(RootPicker, { draft, setDraft, s })),
            h(Row, { label: '下载源', hint: '自动：安装前先测一下，官方源慢就用国内镜像（阿里云 / 南京大学 / npmmirror）' },
              h(Select, { value: draft.song.pypiMirror || 'auto', width: 220, onChange: (v) => setDraft(setPath(draft, 'song.pypiMirror', v)), options: [{ value: 'auto', label: '自动（推荐）' }, { value: 'cn', label: '一直用国内镜像' }, { value: 'off', label: '只用官方源' }] }))),
          h('div', { className: 'ab-flex', style: { marginTop: 12 } },
            h(Btn, { kind: 'primary', small: true, disabled: s.install.running || (draft.song.root || '') !== (st.config.song.root || ''), onClick: async () => { const r = await post('/song/install'); toast(r.message); setTimeout(load, 800) } },
              s.install.running ? h(Fragment, null, h('i', { className: 'ab-spin' }), ' 正在安装…') : Object.values(s.parts).every(Boolean) ? '重新检查 / 修复安装' : '一键安装'),
            h('span', { className: 'ab-muted ab-small' }, (draft.song.root || '') !== (st.config.song.root || '') ? '安装位置改了，先保存设置' : 'Apple 芯片用 MPS 加速（Intel Mac 只能用 CPU，会很慢）' + '；装在 ' + s.root)),
          s.install.running ? h(InstallProgress, { inst: s.install }) : null,
          s.install.ok === true && !s.install.running ? h('div', { className: 'ab-note', style: { marginTop: 8 } }, '✓ ' + s.install.message) : null,
          s.install.log.length ? h('details', { style: { marginTop: 8 } }, h('summary', { className: 'ab-muted ab-small', style: { cursor: 'pointer' } }, '详细日志'),
            h('div', { className: 'ab-logs', style: { maxHeight: 180, marginTop: 6, padding: '8px 12px', whiteSpace: 'pre-wrap' } }, s.install.log.slice(-20).join('\n'))) : null,
          s.install.ok === false && !s.install.running ? h('div', { className: 'ab-note err', style: { marginTop: 8 } },
            h('div', null, s.install.message),
            h('div', { className: 'ab-flex', style: { marginTop: 8 } },
              h(Btn, { small: true, kind: 'primary', onClick: async () => { const r = await post('/song/install'); toast(r.message); setTimeout(load, 800) } }, '再试一次'),
              h(Btn, { small: true, onClick: () => { clipboard(['Aurabot ' + st.version + ' 翻唱安装失败', s.install.message, '', s.install.error || '', '', ...(s.install.log || []).slice(-30)].join('\n')).then(() => toast('报错复制好了，发给作者就行', 'ok'), () => toast('复制失败，展开「详细日志」手动复制吧', 'err')) } }, '复制报错'),
              h('span', { className: 'ab-muted ab-small' }, '已经下好的部分不会重下'))) : null,
        ),
        h(VoiceImport, { s, toast, onChange: load }),
        h(Card, { title: '声音', desc: '用哪个音色唱、默认变调和语音条的长度。' },
          h(Row, { label: '音色' }, voices.length ? h(Select, { value: draft.song.voice || (voices[0] && voices[0].value), options: voices, onChange: (v) => setDraft(setPath(draft, 'song.voice', v)) }) : h('span', { className: 'ab-muted' }, '还没有模型')),
          h(Row, { label: '默认变调', hint: 'ta自己点歌时会按原唱男声 / 女声定，这里是你在面板里试唱时的默认值' }, f.range('song.pitch', -12, 12, 1, (v) => (v > 0 ? '+' : '') + v + ' 半音')),
          h(Row, { label: '先找本地原唱', hint: '点歌时先在本地音乐文件夹里找（文件名「歌名 - 歌手[专辑]」，网易云下载的默认格式），找到就不去网易云下；歌名对上就用' }, f.sw('song.localMusic')),
          draft.song.localMusic !== false ? h(Row, { label: '本地音乐文件夹', hint: '留空 = 用户目录下的「音乐 / Music」，会往下找 3 层' }, f.text('song.localMusicDir', { size: 'wide', placeholder: exPath('Music') })) : null,
          h(Row, { label: '语音条最长', hint: '歌比这个长就截一段' }, f.range('song.maxVoiceSec', 30, 300, 10, (v) => v + ' 秒')),
          h(Row, { label: '截哪一段' }, f.choices('song.clipStart', [{ value: 'auto', label: '副歌附近', desc: '从全曲大约 30% 的地方开始' }, { value: 'head', label: '从头开始' }])),
          h(Row, { label: '人声音量' }, f.range('song.vocalVolume', 0.2, 2, 0.05, (v) => Math.round(v * 100) + '%')),
          h(Row, { label: '伴奏音量' }, f.range('song.instVolume', 0.1, 2, 0.05, (v) => Math.round(v * 100) + '%')),
          h(Row, { label: '只有管理员能点歌' }, f.sw('song.ownerOnly')),
        ),
        h(Card, { fold: 'song-effects', title: '翻唱效果', right: f.sw('song.enhance.enabled'), desc: '换声前后的处理。关掉总开关就是最简单的「整条人声换一遍」。自动定调和音色校正要这个音色有「音色档案」（上面音色列表里生成）。本地接口接管翻唱时，这里的设置不起作用。' },
          draft.song.enhance && draft.song.enhance.enabled !== false ? h(Fragment, null,
            h(Row, { label: '去混响', hint: '分离出的人声先去掉混响、回声再换声；去完反而变噪的段落自动换回原人声' }, f.sw('song.enhance.dereverb')),
            h(Row, { label: '拆主唱和伴唱', hint: '两个人同时唱（和声、合唱）时各自换声再合起来，不容易破音；多花两三分钟' }, f.sw('song.enhance.splitBacking')),
            h(Row, { label: '对唱时分男女声', hint: '点歌说了「对唱」时，先把男声、女声分开各自换，换人处不破音（会先确认真的是男女对唱）' }, f.sw('song.enhance.duetSplit')),
            h(Row, { label: '自动定调、挪八度', hint: '按音色档案里的音域整首挪调（伴奏跟着挪，要装 rubberband），离音域太远的段落（比如对唱里的男声）挪整八度' }, f.sw('song.enhance.autoKey')),
            h(Row, { label: '音色校正', hint: '按音色档案里本人的声音逐首校正频段（换声出来常常发闷）' }, f.sw('song.enhance.toneMatch')),
            h(Row, { label: '伴唱音量跟原来走', hint: '0 = 完全跟原来的音量（背景和声、戏腔原本很轻，换完不会变得和主唱一样响）' }, f.range('song.enhance.backEnvelope', 0, 1, 0.05, (v) => v.toFixed(2)))) : null,
          h(Row, { label: '特征检索比例', hint: '越高越像模型里的音色，太高可能含糊；没有 .index 时不起作用' }, f.range('song.indexRate', 0, 1, 0.05, (v) => v.toFixed(2))),
          h(Row, { label: '音量包络', hint: '0 = 跟原唱的音量起伏，1 = 用换声出来的' }, f.range('song.volumeEnvelope', 0, 1, 0.05, (v) => v.toFixed(2))),
          h(Row, { label: '清辅音保护', hint: '保护「s、sh、呼吸声」不被换得发怪；0.5 = 不保护' }, f.range('song.protect', 0, 0.5, 0.01, (v) => v.toFixed(2))),
        ),
        h(Card, { fold: 'song-netease', title: '网易云音乐', desc: '不登录也能唱免费歌；会员歌、版权歌要填网易云的 Cookie。' },
          h(Row, { label: 'Cookie（MUSIC_U）', hint: '电脑浏览器登录 music.163.com → F12 → 应用 / 存储 → Cookie → 复制 MUSIC_U 的值。只存在本机，不显示' },
            f.text('song.neteaseCookie', { type: 'password', size: 'wide', placeholder: draft.song.neteaseCookieSet ? '已保存（不改就留空）' : '没有就留空' })),
          h('div', { className: 'ab-flex', style: { marginTop: 6 } },
            h(Btn, { small: true, onClick: async () => { const r = await get('/song/account'); setAcct(r) } }, '检查登录'),
            acct ? h('span', { className: 'ab-small', style: { color: acct.ok ? 'var(--ab-ok)' : 'var(--ab-warn)' } }, acct.ok ? '已登录：' + acct.nickname + (acct.vip ? '（会员）' : '（不是会员，只能下免费歌）') : acct.message) : null),
        ),
        h(Card, { title: '试唱', desc: '搜一首歌让ta唱，做好会发到你的 QQ 私聊。' },
          h('div', { className: 'ab-flex' },
            h('input', { className: 'ab-input', style: { flex: '1 1 260px' }, placeholder: '歌名，可以带歌手：小幸运 田馥甄', value: q, onChange: (e) => setQ(e.target.value), onKeyDown: (e) => e.key === 'Enter' && search() }),
            h(Btn, { small: true, onClick: search, disabled: !q.trim() }, '搜索'),
            h('span', { className: 'ab-muted ab-small' }, '变调'),
            h('input', { className: 'ab-input sm', type: 'number', min: -24, max: 24, value: pitch, onChange: (e) => setPitch(Number(e.target.value) || 0) })),
          found === null ? null : found.length === 0 ? h('div', { className: 'ab-muted', style: { marginTop: 8 } }, '没搜到') :
            h('table', { className: 'ab-table', style: { marginTop: 10 } }, h('tbody', null, found.map((x) => h('tr', { key: x.id },
              h('td', null, x.name, x.vip ? h('span', { className: 'ab-badge', style: { marginLeft: 6 } }, '会员') : null),
              h('td', { className: 'ab-muted' }, x.artists),
              h('td', { className: 'ab-muted' }, Math.floor(x.durationSec / 60) + ':' + String(x.durationSec % 60).padStart(2, '0')),
              h('td', null, h(Btn, { small: true, kind: 'primary', disabled: !s.ready || !draft.song.enabled, onClick: () => sing(x) }, '唱给我听')))))),
          !draft.song.enabled ? h('div', { className: 'ab-muted ab-small', style: { marginTop: 8 } }, '先打开上面的「翻唱」开关并保存。') : null,
          s.current ? h('div', { className: 'ab-note', style: { marginTop: 10 } }, h('i', { className: 'ab-spin' }), ' 正在唱「' + s.current.title + '」：' + s.current.stage + (s.queue.length ? '（后面还有 ' + s.queue.length + ' 首）' : '')) : null,
          s.history.length ? h('div', { className: 'ab-list', style: { marginTop: 10 } }, s.history.map((x, i) => h('div', { key: i, className: 'ab-li' },
            h('div', { className: 'meta' }, timeAgo(x.at)),
            h('div', { className: 'body' }, (x.ok ? '✓ ' : '✗ ') + x.title + (x.voice ? ' · ' + x.voice + (x.pitch ? ' ' + (x.pitch > 0 ? '+' : '') + x.pitch : '') : ''), h('div', { className: 'ab-muted ab-small' }, x.message))))) : null,
        ),
      )
    }

/** 本地接口：数据目录 local/ 里的脚本接管语音合成、生图、翻唱换声、语音识别。 */
    function LocalApi({ draft, setDraft, toast, slot }) {
      const f = useField(draft, setDraft)
      const [st, setSt] = useState(null)
      const [busy, setBusy] = useState('')
      const [img, setImg] = useState('')
      const load = () => get('/local/status').then(setSt)
      useEffect(() => { load() }, [])
      const act = async (path, target, label) => {
        setBusy(target + label)
        try {
          const r = await post(path, { slot: target })
          toast(r.message, r.ok ? 'ok' : 'err')
          if (r.image) setImg(r.image)
          await load()
        } catch (error) {
          toast(error.message, 'err')
        } finally {
          setBusy('')
        }
      }
      return h('div', { className: 'ab-grid' },
        slot === 'video' ? h(Card, { title: '本地视频脚本', desc: '生成视频需要可用的本机服务和接入脚本。' }) : slot ? null : h(Card, { title: '本地接口', desc: '想用自己电脑上的模型或服务（GPT-SoVITS 语音、SD WebUI / ComfyUI 画图、自己训练的 so-vits-svc 音色、本地语音识别……）？在这里生成一个脚本模板，照注释改，或者点「复制给 DSH」粘给 DSH，让它帮你改。脚本放在插件数据目录的 local 文件夹里，插件升级不会覆盖；改完保存就生效，不用重启。每一项要打开开关才会用，出错时语音和识别会自动退回内置方式。' },
          h('div', { className: 'ab-flex' },
            h('code', { className: 'ab-small', style: { wordBreak: 'break-all', flex: 1 } }, st ? st.dir : '…'),
            h(Btn, { small: true, onClick: () => post('/local/open').then((r) => toast(r.message)) }, '打开文件夹')),
          h(Row, { label: 'ffmpeg 路径', hint: '语音转换与图片处理共用，留空时自动查找' }, f.text('local.ffmpegPath', { placeholder: '/opt/homebrew/bin/ffmpeg' }))),
        !st ? h(Empty, { icon: '⏳', text: '加载中…' }) : (st.list || []).filter((x) => !slot || x.slot === slot).map((x) => h(Card, { key: x.slot, title: x.title + '（' + x.file + '）', right: f.sw('local.' + x.slot) },
          h('div', { className: 'ab-flex', style: { marginBottom: 8 } },
            h('span', { className: 'ab-small', style: { color: x.active ? 'var(--ab-ok)' : 'var(--ab-muted)' } },
              x.active ? '● 正在由本地脚本接管' : !x.exists ? '还没有这个脚本' : x.exists && !x.approved ? '脚本还没确认（不会执行）' : !x.enabled ? '脚本已经有了，开关没开（用内置方式）' : '用内置方式'),
            x.last ? h('span', { className: 'ab-small', style: { color: x.last.ok ? 'var(--ab-ok)' : 'var(--ab-err)' } }, ' · 上次' + (x.last.ok ? '成功，' + x.last.message : '出错：' + x.last.message)) : null),
          h('div', { className: 'ab-flex' },
            x.exists ? (x.approved ? null : h(Btn, { small: true, kind: 'primary', disabled: !!busy, onClick: () => act('/local/trust', x.slot, 't') }, '确认这个脚本')) : h(Btn, { small: true, kind: 'primary', disabled: !!busy, onClick: () => act('/local/template', x.slot, 't') }, '生成模板'),
            h(Btn, { small: true, onClick: () => { clipboard(x.prompt).then(() => toast('修改提示词复制好了，粘给 DSH，再把【】里那句换成你的情况', 'ok'), () => toast('复制失败，手动选中复制吧', 'err')) } }, '复制给 DSH'),
            x.exists && (x.slot === 'tts' || x.slot === 'image') ? h(Btn, { small: true, disabled: !!busy, onClick: () => act('/local/test', x.slot, 'x') }, busy === x.slot + 'x' ? '正在试…' : '试一下') : null),
          x.slot === 'video' ? h(Row, { label: '最多等多久', hint: '生视频很慢，超过这个时间算失败' }, f.num('local.videoTimeoutMin', { min: 1 }), h('span', { className: 'ab-muted' }, '分钟')) : null,
          x.slot === 'image' && img ? h('img', { src: 'data:image/png;base64,' + img, style: { marginTop: 10, maxWidth: 240, borderRadius: 8 } }) : null)),
      )
    }

    // ---------------- 扩展：模块 ----------------
    const MOD_STATE = (m) => {
      if (m.safeSkipped) return { cls: 'dim', text: '安全模式，没加载' }
      if (!m.enabled) return { cls: 'dim', text: '关着' }
      if (m.running === 'user' && m.builtin) return { cls: 'mine', text: '用的是你的版本' }
      if (m.running === 'user') return { cls: 'mine', text: '在跑' }
      if (m.running === 'builtin' && m.fallback) return { cls: 'warn', text: '你的版本没加载成功，先用内置的' }
      if (m.running === 'builtin') return { cls: '', text: '在跑' }
      return { cls: 'err', text: m.error ? '没加载成功' : '没在跑' }
    }

    /** 一个模块一行：开关、状态、报错，能复制来改 / 用回内置的 / 重新加载。 */
    function ModuleRow({ m, draft, setModules, toast, reload }) {
      const s = MOD_STATE(m)
      const [open, setOpen] = useState(false)
      const setMod = async (patch) => {
        const r = await post('/save', { modules: { [m.id]: { ...((draft.modules || {})[m.id] || {}), ...patch } } })
        if (r.ok === false) return toast(r.message, 'err')
        toast(patch.enabled === false ? `「${m.name}」关掉了` : patch.enabled ? `「${m.name}」打开了` : '好了', 'ok')
        setModules(r.modules)
        reload()
      }
      const act = async (path, body, okMsg) => {
        const r = await post(path, body)
        toast(r.message || okMsg, r.ok === false ? 'err' : 'ok')
        if (r.list) setModules(r.list)
        if (r.prompt && r.ok) copy(r.prompt, toast)
        reload()
        return r
      }
      const what = [m.tools.length ? '工具：' + m.tools.join('、') : '', m.commands.length ? '命令：' + m.commands.map((c) => '/' + c).join(' ') : ''].filter(Boolean).join('　')
      const errs = (m.error ? [{ label: '加载', message: m.error }] : []).concat(m.errors || [])
      return h('div', { className: 'ab-mod' },
        h('div', { className: 'main' },
          h('div', { className: 'nm' }, m.name, h('code', null, m.id),
            h('span', { className: cx('ab-badge', s.cls) }, s.text),
            m.outdated ? h('span', { className: 'ab-badge warn', title: '你复制 / 替换时内置的是 ' + m.forkedFrom + '，现在是 ' + m.builtinVersion }, '内置版本更新了') : null),
          m.description ? h('div', { className: 'ds' }, m.description) : null,
          what ? h('div', { className: 'what' }, what) : null,
          errs.length ? h('div', { className: 'ab-note err', style: { marginTop: 6 } },
            h('div', { style: { cursor: 'pointer' }, onClick: () => setOpen(!open) }, (open ? '▾ ' : '▸ ') + errs.length + ' 条报错：' + String(errs[0].message).split('\n')[0].slice(0, 120)),
            open ? h('div', { className: 'ab-code' }, errs.map((e) => (e.at ? new Date(e.at).toLocaleTimeString() + ' ' : '') + (e.label || '') + '：' + e.message).join('\n\n')) : null) : null,
          h('div', { className: 'acts' },
            m.builtin && !m.hasUser ? h(Btn, { small: true, onClick: () => act('/modules/fork', { id: m.id }, '复制好了'), title: '把这个内置模块的源码复制到 modules/' + m.id + '/，改了就替换内置的' }, '复制一份来改') : null,
            m.hasUser ? h(Btn, { small: true, onClick: () => post('/modules/open?id=' + encodeURIComponent(m.id)).then((r) => toast(r.message)) }, '打开文件夹') : null,
            m.hasUser ? h(Btn, { small: true, onClick: () => get('/modules/prompt?id=' + encodeURIComponent(m.id)).then((r) => copy(r.prompt, toast, '修改提示词复制好了，粘给 DSH，把【】里那句换成你想要的')) }, '复制给 DSH') : null,
            m.hasUser && !m.safeSkipped ? h(Btn, { small: true, onClick: () => act('/modules/reload', { id: m.id }, '重新加载好了') }, '重新加载') : null)),
        h('div', { className: 'side' },
          h(Switch, { on: m.enabled, onChange: (v) => setMod({ enabled: v }), title: m.enabled ? '关掉这个模块' : '打开这个模块' }),
          m.builtin && m.hasUser ? h('label', { className: 'ab-small ab-muted', style: { display: 'flex', alignItems: 'center', gap: 6 } }, '用内置的', h(Switch, { on: m.useBuiltin, onChange: (v) => setMod({ useBuiltin: v }) })) : null))
    }

    /** 模拟测试：不上 QQ 试模块。发出去的只截下来看，不真发。 */
    function Simulate({ toast }) {
      const [as, setAs] = useState('owner')
      const [kind, setKind] = useState('private')
      const [text, setText] = useState('')
      const [reply, setReply] = useState('')
      const [out, setOut] = useState(null)
      const [tools, setTools] = useState([])
      const [tool, setTool] = useState('')
      const [args, setArgs] = useState('{}')
      const [tout, setTout] = useState(null)
      useEffect(() => { get('/modules/tools?as=' + as + '&kind=' + kind).then((r) => { const l = r.list || []; setTools(l); if (!l.some((t) => t.name === tool)) setTool(l[0] ? l[0].name : '') }) }, [as, kind])
      const cur = tools.find((t) => t.name === tool)
      const run = async () => { const r = await post('/modules/simulate', { as, kind, text, reply }); if (r.ok === false) return toast(r.message, 'err'); setOut(r) }
      const call = async () => {
        let a
        try { a = JSON.parse(args || '{}') } catch (e) { return toast('参数要是 JSON，比如 {"city":"北京"}', 'err') }
        const r = await post('/modules/tool', { as, kind, name: tool, args: a })
        if (r.ok === false) return toast(r.message, 'err')
        setTout(r)
      }
      const sentList = (sent) => (sent && sent.length ? h('div', { className: 'ab-code' }, sent.map((s) => '→ ' + s.chatId + '：' + s.text).join('\n')) : h('div', { className: 'ab-small ab-muted', style: { marginTop: 6 } }, '没有发出任何消息'))
      return h(Card, { fold: 'modules-simulate', title: '模拟测试', desc: '不用上 QQ 就能试模块：这里发出去的消息只截下来显示，不会真发到 QQ。（模块直接调 api.onebot 的操作，比如禁言、发空间，是真的会执行的；会改设置的内置命令不执行。）' },
        h(Row, { label: '假装是', hint: '谁在说话、在哪儿说' },
          h('div', { className: 'ab-flex' },
            h(Seg, { value: as, options: [{ value: 'owner', label: '管理员' }, { value: 'other', label: '别人' }], onChange: setAs }),
            h(Seg, { value: kind, options: [{ value: 'private', label: '私聊' }, { value: 'group', label: '群聊' }], onChange: setKind }))),
        h(Row, { label: '发一条消息', hint: '看哪个模块接管、命令回什么（/开头是命令）' },
          h('input', { className: 'ab-input', value: text, placeholder: '比如：早安，或 /weather 北京', onChange: (e) => setText(e.target.value) })),
        h(Row, { label: 'ta的回复', hint: '可选：假设ta这样回，看经过各个模块改写后最后发出去什么（可以用 ||| 分条、<voice>…</voice>）' },
          h('input', { className: 'ab-input', value: reply, placeholder: '比如：早呀|||今天也要加油', onChange: (e) => setReply(e.target.value) })),
        h('div', { className: 'ab-flex' }, h(Btn, { kind: 'primary', small: true, disabled: !text.trim() && !reply.trim(), onClick: run }, '模拟')),
        out ? h('div', { style: { marginTop: 8 } }, out.steps.map((s, i) => h('div', { key: i, className: 'ab-small' }, '· ' + s)), sentList(out.sent)) : null,
        h('div', { className: 'ab-section-title' }, '调用工具'),
        tools.length ? h('div', null,
          h(Row, { label: '工具', hint: cur ? cur.description : '' }, h(Select, { value: tool, options: tools.map((t) => ({ value: t.name, label: t.name })), onChange: (v) => { setTool(v); setArgs('{}'); setTout(null) } })),
          cur && cur.parameters && Object.keys(cur.parameters.properties || {}).length ? h('div', { className: 'ab-small ab-muted', style: { margin: '0 0 6px' } }, '参数：' + Object.entries(cur.parameters.properties).map(([k, v]) => k + (v.description ? '（' + v.description + '）' : '')).join('；')) : null,
          h('textarea', { className: 'ab-textarea', style: { minHeight: 50, fontFamily: 'ui-monospace,Consolas,monospace' }, value: args, onChange: (e) => setArgs(e.target.value) }),
          h('div', { className: 'ab-flex', style: { marginTop: 6 } }, h(Btn, { small: true, onClick: call, disabled: !tool }, '调用')),
          tout ? h('div', null, h('div', { className: 'ab-code' }, JSON.stringify(tout.result, null, 2)), sentList(tout.sent)) : null)
          : h('div', { className: 'ab-small ab-muted' }, '这个场合没有工具'))
    }

    /** 写模块的教程：随插件带着，连不上 GitHub 也能看；复制后可以直接粘给 DSH。 */
    const TUTORIAL_URL = PROJECT_REPO + '/blob/main/docs/MODULE-TUTORIAL.md'
    function ModuleTutorial({ toast }) {
      const [text, setText] = useState('')
      const [err, setErr] = useState('')
      const open = (e) => {
        if (!e.target.open || text) return
        get('/modules/tutorial').then((r) => (r.ok ? setText(r.text) : setErr(r.message)))
      }
      return h('details', { className: 'ab-card', onToggle: open },
        h('summary', { style: { cursor: 'pointer', fontWeight: 620 } }, '想自己写一个模块？'),
        h('p', { className: 'ab-desc', style: { marginTop: 8 } }, '从零写一个模块，或者改现有模块。不会写代码也行：复制教程给 DSH，告诉它你想要什么。'),
        h('div', { className: 'ab-flex', style: { marginBottom: 10 } },
          h(Btn, { small: true, kind: 'primary', disabled: !text, onClick: () => copy(text, toast, '写模块教程复制好了') }, '复制教程'),
          h('a', { className: 'ab-small', href: TUTORIAL_URL, target: '_blank', rel: 'noreferrer' }, '在 GitHub 上看')),
        err ? h('div', { className: 'ab-note warn' }, err) : null,
        text ? h('pre', { className: 'ab-small', style: { whiteSpace: 'pre-wrap', wordBreak: 'break-word', maxHeight: 420, overflow: 'auto', margin: 0 } }, text) : (err ? null : h('div', { className: 'ab-small ab-muted' }, '加载中…')))
    }

    /** 模块库：逛、搜、装、更新、卸载社区模块。安装前给用户看来源和能力，能力声明不是沙箱。 */
    const CAP_LABEL = { network: '联网', filesystem: '读写本机文件', process: '启动其他程序', 'dynamic-code': '动态执行代码', 'plugin-config': '读写插件配置（含账号 Cookie）', 'plugin-internals': '使用插件内部接口' }
    const CATEGORY_LABEL = { platform: '逛平台', social: '聊天互动', creative: '创作', desktop: '桌面', manage: '管理', tool: '工具' }
    const capText = (m) => (m.capabilities || []).map((c) => CAP_LABEL[c] || c)
    function Market({ st, toast, reload, go }) {
      const [data, setData] = useState(null)
      const [busy, setBusy] = useState('')
      const [prog, setProg] = useState(null)
      const [q, setQ] = useState('')
      const [show, setShow] = useState('all')
      const [cat, setCat] = useState('')
      const load = (force) => get('/modules/community' + (force ? '?force=1' : '')).then(setData)
      useEffect(() => { load() }, [])
      // 一直查进度：恢复备份、老用户迁移时模块在后台装，不是从这个页面点的
      useEffect(() => {
        let was = false
        const tick = () => get('/modules/community/progress').then((r) => {
          const now = r.progress || null
          setProg(now)
          if (was && !now) load()
          was = Boolean(now)
        })
        const t = setInterval(tick, busy ? 300 : 1000)
        tick()
        return () => clearInterval(t)
      }, [busy])
      const percent = prog && prog.total ? Math.min(100, Math.round(prog.received / prog.total * 100)) : 0
      const stageText = () => {
        if (prog.stage === 'index') return '读取模块列表…'
        if (prog.stage === 'install') return '解压安装…'
        if (prog.stage === 'start') return '启动模块…'
        return '下载中 ' + (prog.total ? percent + '%' : Math.round(prog.received / 1024) + ' KB')
      }
      const progText = (word) => (prog ? stageText() : word + '中…')
      const STAGE_BAR = { index: 10, install: 90, start: 95 }
      const progBar = prog ? h('div', { className: 'ab-card', style: { marginBottom: 12 } },
        h('div', { className: 'ab-flex', style: { justifyContent: 'space-between' } }, h('b', null, '正在安装「' + (prog.name || prog.id) + '」'), h('span', { className: 'ab-muted ab-small' }, stageText())),
        h('div', { style: { height: 6, borderRadius: 3, background: 'var(--ab-foam-2)', marginTop: 8, overflow: 'hidden' } },
          h('div', { style: { height: '100%', width: (STAGE_BAR[prog.stage] || Math.max(12, 10 + percent * 0.8)) + '%', background: 'var(--ab-sea)', transition: 'width .3s' } }))) : null
      const done = async (r) => {
        toast(r.message, r.ok ? 'ok' : 'err')
        await load()
        reload()
      }
      const install = async (m) => {
        const caps = capText(m).join('、') || '无'
        const why = '来源：' + MODULE_REPOS[m.registry] + '\n版本：' + m.version + '\n作者：' + m.author + '\n能力：' + caps + '\n\n能力声明不是沙箱：模块和插件在同一进程运行。继续吗？'
        if (!confirm((m.installed ? '更新' : '安装') + '「' + m.name + '」？\n\n' + why)) return
        if (m.replacesBuiltin && !confirm('「' + m.name + '」会替换同名内置模块，确定吗？')) return
        setBusy(m.id)
        try { await done(await post('/modules/community/install', { id: m.id, registry: m.registry, version: m.version, confirmReplace: Boolean(m.replacesBuiltin) })) } finally { setBusy('') }
      }
      const remove = async (m) => {
        if (!confirm('卸载「' + m.name + '」？')) return
        const purge = confirm('把它的数据和设置也清掉吗？\n确定 = 一起清掉；取消 = 留着，以后重装还能用')
        setBusy(m.id)
        try { await done(await post('/modules/community/remove', { id: m.id, purge })) } finally { setBusy('') }
      }
      const list = (data && data.list) || []
      const counts = { all: list.length, installed: list.filter((m) => m.installed).length, update: list.filter((m) => m.update).length }
      const word = q.trim().toLowerCase()
      const cats = [...new Set(list.map((m) => m.category).filter(Boolean))]
      const shown = list.filter((m) => (!cat || m.category === cat) && (show === 'all' || (show === 'installed' && m.installed) || (show === 'update' && m.update)) && (!word || (m.name + ' ' + m.id + ' ' + (m.description || '') + ' ' + (m.tags || []).join(' ')).toLowerCase().includes(word)))
      const openSettings = (m) => {
        const running = (st.modules || []).find((x) => x.id === m.id)
        return running && running.tab ? () => go(running.tab) : null
      }
      const chip = (id, label) => h('button', { key: id, type: 'button', className: cx('ab-chip', show === id && 'on'), onClick: () => setShow(id) }, label, h('span', { className: 'n' }, counts[id]))
      const card = (m) => {
        const settings = m.installed ? openSettings(m) : null
        const otherSource = m.installedRegistry && m.installedRegistry !== m.registry
        const originNote = otherSource ? `当前安装来自 ${MODULE_REPOS[m.installedRegistry]}。` + (m.switchSource ? `更新将切换到 ${MODULE_REPOS[m.registry]}。` : '') : ''
        const note = [m.delisted ? '已从市场下架' : '', m.foreign ? '有同名的自己写的文件夹，不会覆盖' : '', originNote, m.blocked].filter(Boolean).join(' · ')
        return h('div', { key: m.id, className: 'ab-card', style: { display: 'flex', flexDirection: 'column' } },
          h('h3', null, m.name, MODULE_REPOS[m.registry] ? h('span', { className: 'ab-badge', title: MODULE_REPOS[m.registry] }, m.registry === 'mac' ? 'macOS 模块库' : '上游参考') : null, m.update ? h('span', { className: 'ab-badge' }, '可更新') : null),
          h('div', { className: 'ab-small ab-muted' }, 'v' + (m.installed || m.version) + (m.update ? ' → v' + m.version : '') + (CATEGORY_LABEL[m.category] ? ' · ' + CATEGORY_LABEL[m.category] : '') + (m.author ? ' · ' + m.author : '') + (m.license ? ' · ' + m.license : '')),
          h('p', { className: 'ab-desc', style: { margin: '8px 0' } }, m.description),
          capText(m).length ? h('div', { className: 'ab-small ab-muted', style: { marginBottom: 10 } }, '会用到：' + capText(m).join('、')) : null,
          note ? h('div', { className: 'ab-note warn', style: { marginBottom: 10 } }, note) : null,
          h('div', { className: 'ab-flex', style: { marginTop: 'auto' } },
            !m.installed && !m.foreign && !m.delisted ? h(Btn, { small: true, kind: 'primary', disabled: Boolean(busy || m.blocked), onClick: () => install(m) }, busy === m.id ? progText('安装') : '安装') : null,
            m.update ? h(Btn, { small: true, kind: 'primary', disabled: Boolean(busy || m.blocked), onClick: () => install(m) }, busy === m.id ? progText('更新') : '更新') : null,
            settings ? h(Btn, { small: true, onClick: settings }, '去设置') : null,
            m.installed ? h(Btn, { small: true, kind: 'ghost', disabled: Boolean(busy), onClick: () => remove(m) }, '卸载') : null))
      }
      return h('div', { className: 'ab-grid' },
        progBar,
        h(Card, { title: 'AuraBot 模块库', desc: '这里装的是 AuraBot 自己的 .mjs 模块，不是 DSH 插件；DSH 插件请用 DSH 的插件市场管理。只安装本分支模块库；上游模块只读参考，不能安装。安装前请核对来源和能力，模块会与插件在同一进程运行。', right: h(Btn, { small: true, kind: 'ghost', onClick: () => load(true) }, '刷新') },
          h('div', { className: 'ab-flex' },
            h('input', { className: 'ab-input', placeholder: '搜模块', value: q, onChange: (e) => setQ(e.target.value) }),
            chip('all', '全部'), chip('installed', '已安装'), chip('update', '可更新')),
          cats.length > 1 ? h('div', { className: 'ab-flex', style: { marginTop: 10 } }, [''].concat(cats).map((c) => h('button', { key: c || 'any', type: 'button', className: cx('ab-chip', cat === c && 'on'), onClick: () => setCat(c) }, c ? CATEGORY_LABEL[c] || c : '全部分类'))) : null,
          ((data && data.revoked) || []).map((r) => h('div', { key: r.id, className: 'ab-note err', style: { marginTop: 10 } }, '「' + r.id + '」' + r.version + ' 已撤回：' + r.reason + '。建议关闭或卸载。'))),
        !data ? h(Empty, { icon: '⏳', text: '加载中…' }) : null,
        data && data.ok === false ? h('div', { className: 'ab-note warn' }, '模块库打不开：' + data.message) : null,
        data?.partial ? h('div', { className: 'ab-note warn' }, '部分模块库暂时无法访问，当前列表可能不完整。') : null,
        data?.referenceUnavailable ? h('div', { className: 'ab-muted ab-small', style: { marginTop: 6 } }, '上游参考库暂时读不到，不影响本分支模块安装。') : null,
        data && data.ok !== false && !shown.length ? h(Empty, { icon: '🐟', text: list.length ? '没有符合条件的模块' : '市场里还没有模块' }) : null,
        shown.length ? h('div', { className: 'ab-grid', style: { gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))' } }, shown.map(card)) : null,
        h(ModuleTutorial, { toast }))
    }

    /** 扩展页：所有模块（内置的 + 市场装的 + 自己写的）、安全模式；写模块的工具收在最下面。 */
    function Modules({ st, draft, toast, reload, go }) {
      const [data, setData] = useState(null)
      const [newId, setNewId] = useState('')
      const [newName, setNewName] = useState('')
      const load = () => get('/modules').then(setData)
      useEffect(() => { load() }, [])
      useEffect(() => { if (data && st.modules) setData((d) => ({ ...d, list: st.modules })) }, [JSON.stringify(st.modules)])
      const setModules = (list) => list && setData((d) => ({ ...d, list }))
      if (!data) return h(Empty, { icon: '⏳', text: '加载中…' })
      const list = data.list || []
      const platformFeatures = list.filter((m) => m.platformFeature)
      const builtin = list.filter((m) => m.builtin && !m.platformFeature)
      const mine = list.filter((m) => !m.builtin && !m.community)
      const fromCommunity = list.filter((m) => m.community)
      const props = { draft, setModules, toast, reload: () => { reload(); load() } }
      const create = async () => {
        const r = await post('/modules/create', { id: newId.trim(), name: newName.trim() })
        if (!r.ok) return toast(r.message, 'err')
        setNewId(''); setNewName('')
        setModules(r.list)
        copy(r.prompt, toast, '建好了，修改提示词已复制，粘给 DSH 让它帮你写')
        reload()
      }
      return h('div', { className: 'ab-grid' },
        h(Card, { title: '已安装', right: h(Btn, { small: true, kind: 'primary', onClick: () => go('market') }, '逛模块库'), desc: 'ta的每项本事都是一个模块：能单独关掉；能复制一份来改，改了就替换内置的；也能自己写新模块，让ta学会你想要的任何事。自己写的东西放在下面这个文件夹，插件升级不会动；改完保存几秒内自动生效，不用重启。不会写代码？点「复制给 DSH」，粘给 DSH，说你想要什么。' },
          h('div', { className: 'ab-flex' },
            h('code', { className: 'ab-small', style: { wordBreak: 'break-all', flex: 1 } }, data.dir),
            h(Btn, { small: true, onClick: () => post('/modules/open').then((r) => toast(r.message)) }, '打开文件夹'),
            h(Btn, { small: true, onClick: () => copy(data.prompt, toast, '修改提示词复制好了，粘给 DSH，把【】里那句换成你想要的') }, '复制给 DSH'),
            h(Btn, { small: true, kind: 'ghost', onClick: async () => { const r = await post('/modules/reload', {}); setModules(r.list); toast(r.message) } }, '重新检查')),
          h(Row, { label: '安全模式', hint: '打开后你写的模块一个都不加载，内置的全部恢复。出了问题先开它，看是不是你的模块引起的。' },
            h(Switch, { on: st.config.safeMode, onChange: async (v) => { const r = await post('/save', { safeMode: v }); toast(v ? '安全模式开了：只跑内置模块' : '安全模式关了', 'ok'); setModules(r.modules); reload() } })),
          st.config.safeMode ? h('div', { className: 'ab-note warn' }, '安全模式开着：你写的模块现在都没加载。') : null),
        fromCommunity.length ? h(Card, { title: '从市场装的（' + fromCommunity.length + '）' }, h('div', null, fromCommunity.map((m) => h(ModuleRow, { key: m.id, m, ...props })))) : null,
        mine.length ? h(Card, { title: '自己写的（' + mine.length + '）' }, h('div', null, mine.map((m) => h(ModuleRow, { key: m.id, m, ...props })))) : null,
        platformFeatures.length ? h('div', { className: 'ab-note', style: { marginBottom: 2 } }, 'QQ 平台功能（群管、联系人、资料、空间日记、语音、基础 QQ 工具）随 QQ 连接加载，不再作为通用模块显示；相关开关在 QQ 页面。') : null,
        h(Card, { title: '内置模块（' + builtin.length + '）', desc: '关掉的模块：ta就没有这项本事，相关的标签页也会藏起来。连接、权限、人格、聊天这些是核心，不能关。' },
          h('div', null, builtin.map((m) => h(ModuleRow, { key: m.id, m, ...props })))),
        h('details', { className: 'ab-card' },
          h('summary', { style: { cursor: 'pointer', fontWeight: 620 } }, '写模块的工具'),
          h('p', { className: 'ab-desc', style: { marginTop: 8 } }, '自己写模块或排查问题时才用得上。'),
          h('div', { className: 'ab-grid' },
        h(Card, { fold: 'modules-create', title: '新建一个模块', desc: '从模板建一个能直接跑的例子（关键词自动回复 + 一个命令 + 一个工具），在它上面改。id 用小写英文，比如 weather。想改内置的本事，用下面内置模块那一行的「复制一份来改」。' },
          h('div', { className: 'ab-flex' },
            h('input', { className: 'ab-input', style: { maxWidth: 180 }, placeholder: 'id，如 weather', value: newId, onChange: (e) => setNewId(e.target.value.toLowerCase()) }),
            h('input', { className: 'ab-input', placeholder: '名字，如 查天气', value: newName, onChange: (e) => setNewName(e.target.value) }),
            h(Btn, { kind: 'primary', small: true, disabled: !newId.trim(), onClick: create }, '新建'))),
            h(Simulate, { toast }))),
      )
    }

    /** 自己写的模块的面板：自动表单 + 模块自己的 panel.js。 */
    function panelSandboxHtml(token, source, settings, draft) {
      const safe = (v) => JSON.stringify(v).replace(/</g, '\\u003c')
      const shim = [
        'const TOKEN=' + safe(token) + ';',
        'const SOURCE=' + safe(source) + ';',
        'const SETTINGS=' + safe(settings) + ';',
        'const DRAFT=' + safe(draft) + ';',
        "const root=document.getElementById('root');",
        'let seq=0,current=SETTINGS,draft=DRAFT,hooks=[],hookPos=0,effects=[],pending=new Map();',
        "function post(type,payload){parent.postMessage({token:TOKEN,type:type,payload:payload},'*')}",
        "function rpc(type,payload){return new Promise(function(resolve){var id=++seq;pending.set(String(id),resolve);post('rpc',{id:id,type:type,payload:payload})})}",
        "window.addEventListener('message',function(e){var d=e.data;if(!d||d.token!==TOKEN||d.type!=='rpc-result')return;var f=pending.get(String(d.id));if(f){pending.delete(String(d.id));f(d.result)}});",
        "function call(path,body){return rpc('call',{path:path,body:body})}",
        "function save(patch){return rpc('save',{patch:patch})}",
        "function toast(text,kind){post('toast',{text:text,kind:kind})}",
        "function reload(){post('reload')}",
        "function setSettings(patch){draft=Object.assign({},draft,patch||{});post('draft',{patch:patch||{}});render()}",
        "function h(type,props){var children=[];for(var i=2;i<arguments.length;i++)children.push(arguments[i]);return{type:type,props:props||{},children:children}}",
        "function flatten(v,out){if(Array.isArray(v)){v.forEach(function(x){flatten(x,out)})}else if(v!==null&&v!==undefined&&v!==false&&v!==true){out.push(v)}return out}",
        "function mount(v,parent){if(v===null||v===undefined||v===false||v===true)return;if(Array.isArray(v)){v.forEach(function(x){mount(x,parent)});return}if(typeof v==='string'||typeof v==='number'){parent.appendChild(document.createTextNode(String(v)));return}if(typeof v.type==='function'){mount(v.type(Object.assign({},v.props,{children:flatten(v.children,[]).concat(flatten(v.props.children,[]))})),parent);return}var tag=v.type==='Fragment'?'div':String(v.type);var el=document.createElement(tag);var p=v.props||{};Object.keys(p).forEach(function(k){var val=p[k];if(k==='children'||val===null||val===undefined)return;if(k==='className'){el.className=val;return}if(k==='style'&&typeof val==='object'){Object.assign(el.style,val);return}if(k==='value'||k==='checked'||k==='selected'||k==='disabled'||k==='placeholder'||k==='type'||k==='title'){el[k]=val;return}if(k.slice(0,2)==='on'&&typeof val==='function'){var ev=k.slice(2).toLowerCase();el.addEventListener(ev,function(e){if(k==='onChange'&&(e.target.type==='checkbox'||e.target.type==='radio')){val(e.target.checked)}else{val(e)}});return}if(k==='html'){el.innerHTML=val;return}try{el.setAttribute(k,val)}catch(e){}});flatten(v.children,[]).concat(flatten(p.children,[])).forEach(function(c){mount(c,el)});parent.appendChild(el)}",
        "function useState(init){var i=hookPos++;if(!(i in hooks))hooks[i]=typeof init==='function'?init():init;return[hooks[i],function(v){hooks[i]=typeof v==='function'?v(hooks[i]):v;schedule()}]}",
        "function useEffect(fn,deps){var i=hookPos++;var prev=hooks[i];if(!prev||!deps||!prev.deps||deps.some(function(x,j){return x!==prev.deps[j]})){hooks[i]={deps:deps,fn:fn};effects.push(fn)}}",
        "function useMemo(fn,deps){var i=hookPos++;var prev=hooks[i];if(!prev||!deps||!prev.deps||deps.some(function(x,j){return x!==prev.deps[j]})){hooks[i]={deps:deps,value:fn()}}return hooks[i].value}",
        "function useRef(v){var i=hookPos++;if(!(i in hooks))hooks[i]={current:v};return hooks[i]}",
        "function useCallback(fn,deps){return useMemo(function(){return fn},deps)}",
        "function schedule(){if(schedule.pending)return;schedule.pending=true;setTimeout(function(){schedule.pending=false;render()},0)}",
        "function render(){hookPos=0;effects=[];root.innerHTML='';try{var node=C({settings:current,draftSettings:draft,setSettings:setSettings,save:save,toast:toast,reload:reload});mount(node,root);effects.forEach(function(fn){try{fn()}catch(e){console.error(e)}});post('height',{height:document.body.scrollHeight+20})}catch(e){root.textContent='面板出错了：'+String(e&&e.message||e);post('error',{message:String(e&&e.message||e)})}}",
        "var React={createElement:h,Fragment:'div',useState:useState,useEffect:useEffect,useMemo:useMemo,useRef:useRef,useCallback:useCallback};",
        "var ui={Card:function(p){return h('section',{className:'card'},p.title?h('h3',null,p.title):null,p.desc?h('p',{className:'muted'},p.desc):null,p.right?h('div',{className:'right'},p.right):null,p.children)},Btn:function(p){return h('button',{className:'btn '+(p.kind||'')+(p.small?' small':''),disabled:p.disabled,onClick:p.onClick},p.children)},Switch:function(p){return h('input',{type:'checkbox',checked:!!p.value,onChange:p.onChange})},Row:function(p){return h('div',{className:'row'},p.label?h('label',null,p.label):null,h('div',null,p.children))},Empty:function(p){return h('div',{className:'empty'},p.text||'暂无')},Select:function(p){return h('select',{value:p.value,onChange:function(e){p.onChange&&p.onChange(e.target.value)}}, (p.options||[]).map(function(o){var v=typeof o==='string'?o:o.value;var l=typeof o==='string'?o:o.label;return h('option',{value:v,key:v,selected:String(v)===String(p.value)},l)}))},Seg:function(p){return h('div',{className:'seg'},p.children)},Range:function(p){return h('input',{type:'range',min:p.min,max:p.max,step:p.step,value:p.value,onChange:function(e){p.onChange&&p.onChange(Number(e.target.value))}})}};",
        "var C;try{C=new Function('React','h','ui','call','save','toast','reload','settings','draftSettings','setSettings',SOURCE)(React,h,ui,call,save,toast,reload,current,draft,setSettings);if(typeof C!=='function')throw new Error('panel.js 最后要 return 一个组件（函数）')}catch(e){root.textContent='面板加载失败：'+String(e&&e.message||e);post('error',{message:String(e&&e.message||e)});throw e}",
        "render();post('ready',{});"
      ].join('\n')
      return '<!doctype html><html><head><meta charset="utf-8"><style>'
        + 'body{font:13px/1.5 system-ui,sans-serif;margin:0;padding:8px;color:#ddd;background:transparent}.card{border:1px solid #333;border-radius:8px;padding:10px;margin:8px 0}.muted{color:#999;font-size:12px}.btn{border:1px solid #444;background:#222;color:#eee;border-radius:6px;padding:4px 10px;cursor:pointer}.btn.primary{background:#3b6ea8}.btn.small{padding:2px 7px;font-size:12px}.row{display:flex;gap:8px;align-items:center;margin:6px 0}.row>label{min-width:90px;color:#aaa}.right{float:right}.empty{color:#888;padding:12px}.seg{display:flex;gap:4px}select,input{background:#1c1c1c;color:#eee;border:1px solid #444;border-radius:4px;padding:3px}'
        + '</style></head><body><div id="root"></div><script>' + shim + '</script></body></html>'
    }
    function ExtPanel({ m, settings, draftSettings, setSettings, toast, reload }) {
      const [src, setSrc] = useState(null)
      const [err, setErr] = useState('')
      const [height, setHeight] = useState(160)
      const frame = useRef(null)
      const token = useMemo(() => 'panel-' + m.id + '-' + Date.now() + '-' + Math.random().toString(36).slice(2), [m.id, m.startedAt])
      useEffect(() => {
        let alive = true
        fetch(API + '/modules/panel?id=' + encodeURIComponent(m.id) + '&t=' + Date.now(), { cache: 'no-store' })
          .then((r) => (r.ok ? r.text() : Promise.reject(new Error('读不到 panel.js'))))
          .then((text) => { if (alive) setSrc(text) })
          .catch((e) => { if (alive) setErr(e.message) })
        return () => { alive = false }
      }, [m.id, m.startedAt])
      const doc = useMemo(() => src ? panelSandboxHtml(token, src, settings, draftSettings) : '', [token, src, JSON.stringify(settings), JSON.stringify(draftSettings)])
      useEffect(() => {
        const base = m.routesAtRoot ? '' : '/ext/' + m.id
        const onMessage = async (event) => {
          if (!frame.current || event.source !== frame.current.contentWindow) return
          const data = event.data
          if (!data || data.token !== token) return
          if (data.type === 'rpc' && data.payload) {
            let result = null
            try {
              const { id, type, payload } = data.payload
              if (type === 'call') {
                const p = String(payload.path || '')
                let decoded = p
                try { decoded = decodeURIComponent(p) } catch {}
                if (!p.startsWith('/') || decoded.includes('..') || decoded.includes('\\') || decoded.includes('://')) throw new Error('panel 接口路径不合法')
                result = payload.body === undefined ? await get(base + p) : await post(base + p, payload.body)
              }
              else if (type === 'save') result = await post('/save', { ext: { [m.id]: payload.patch } })
            } catch (error) { result = { ok: false, message: String(error.message || error) } }
            frame.current.contentWindow.postMessage({ token, type: 'rpc-result', id: data.payload.id, result }, '*')
          } else if (data.type === 'draft') setSettings?.(data.payload?.patch || {})
          else if (data.type === 'toast') toast?.(data.payload?.text || '', data.payload?.kind || 'ok')
          else if (data.type === 'height') setHeight(Math.max(80, Math.min(2000, Number(data.payload?.height) || 160)))
          else if (data.type === 'reload') reload?.()
          else if (data.type === 'error') setErr(data.payload?.message || 'panel.js 出错')
        }
        window.addEventListener('message', onMessage)
        return () => window.removeEventListener('message', onMessage)
      }, [token, m.id, m.startedAt, m.routesAtRoot, get, post, toast, reload])
      if (err) return h('div', { className: 'ab-note err' }, '面板加载失败：' + err)
      if (!src) return h(Empty, { icon: '⏳', text: '加载中…' })
      return h('iframe', { ref: frame, sandbox: 'allow-scripts', srcDoc: doc, title: m.name || m.id, style: { width: '100%', height, border: 0, background: 'transparent' } })
    }

    function ExtPage({ st, draft, setDraft, toast, reload, mod, embedded }) {
      const m = (st.modules || []).find((x) => x.id === mod)
      const f = useField(draft, setDraft)
      if (!m) return h(Empty, { icon: '🧩', text: '这个模块没在跑了' })
      const base = 'ext.' + m.id + '.'
      const settings = { ...(m.defaults || {}), ...((st.config.ext || {})[m.id] || {}) }
      const draftSettings = { ...(m.defaults || {}), ...((draft.ext || {})[m.id] || {}) }
      const setSettings = (patch) => setDraft((previous) => ({ ...previous, ext: { ...previous.ext, [m.id]: { ...(previous.ext || {})[m.id], ...patch } } }))
      const field = (s) => {
        const p = base + s.key
        if (s.type === 'switch') return f.sw(p)
        if (s.type === 'number') return f.num(p, { min: s.min, max: s.max, step: s.step })
        if (s.type === 'select') return f.select(p, (s.options || []).map((o) => (typeof o === 'string' ? { value: o, label: o } : o)))
        if (s.type === 'textarea') return h('textarea', { className: 'ab-textarea', value: getPath(draft, p) ?? '', placeholder: s.placeholder, onChange: (e) => setDraft(setPath(draft, p, e.target.value)) })
        if (s.type === 'password') return f.text(p, { type: 'password', placeholder: getPath(draft, p + 'Set') ? '已保存（不改就留空）' : s.placeholder || '' })
        return f.text(p, { placeholder: s.placeholder })
      }
      return h('div', { className: 'ab-grid' },
        ((m.settings || []).length || (m.errors || []).length || !m.panel) ? h(Card, { title: m.name, desc: m.description, right: h('span', { className: 'ab-badge mine' }, embedded ? '扩展模块 · ' + m.id : m.id) },
          (m.settings || []).map((s) => h(Row, { key: s.key, label: s.label || s.key, hint: s.hint }, field(s))),
          (m.settings || []).length ? h('div', { className: 'ab-small ab-muted' }, '改完点下面的「保存设置」。') : null,
          (m.errors || []).length ? h('div', { className: 'ab-note err', style: { marginTop: 8 } }, '最近的报错：' + m.errors[0].message) : null) : null,
        m.panel ? h(ExtPanel, { m, settings, draftSettings, setSettings, toast, reload }) : null)
    }


    /** 「她的画作」：读存图目录里最近的 N 张，可以单张删除、开文件夹。 */
    /**
     * 她的形象：导入几张她的图，她画自己（自拍、她的样子、合照里有她）时照着画。
     * 看图写的（或你写的）形象描述也会加进提示词：生图服务不收参考图时靠它画得像。
     */
    function AppearanceCard({ draft, toast }) {
      const [d, setD] = useState(null)
      const [busy, setBusy] = useState('')
      const [desc, setDesc] = useState(null)
      const fileRef = useRef(null)
      const load = () => get('/image/appearance').then((r) => { setD(r); setDesc(null) }).catch(() => setD({ ok: false, list: [] }))
      useEffect(() => { load() }, [])
      const upload = async (files) => {
        setBusy('upload')
        let n = 0
        try {
          for (const file of Array.from(files || [])) {
            const r = await fetch(API + '/image/appearance/upload', { method: 'POST', body: file }).then((x) => x.json()).catch((e) => ({ ok: false, message: e.message }))
            if (r && r.ok) n++
            else toast((file.name || '图片') + '：' + ((r && r.message) || '没导入成功'), 'err')
          }
          if (n) toast('导入了 ' + n + ' 张', 'ok')
        } finally { setBusy(''); if (fileRef.current) fileRef.current.value = ''; load() }
      }
      const act = async (path, body, ok) => { const r = await post(path, body); toast((r && r.message) || (r && r.ok ? ok : '没成功'), r && r.ok === false ? 'err' : 'ok'); load() }
      const describe = async () => { setBusy('describe'); try { const r = await post('/image/appearance/describe', {}); if (r.ok) { toast('写好了', 'ok'); load() } else toast(r.message, 'err') } finally { setBusy('') } }
      const list = (d && d.list) || []
      const img2imgOff = draft.imageGen && draft.imageGen.img2img === false
      const text = desc === null ? (d && d.description) || '' : desc
      return h(Card, { fold: 'image-appearance', title: '她的形象', desc: '导入几张她的图（最多 ' + ((d && d.max) || 8) + ' 张）。她画自己（自拍、她的样子、合照里有她）时会照着画：主图一定用，能一次收好几张参考图的生图服务（gpt-image 系列）其余几张也一起用。下面的形象描述也会加进提示词。' },
        img2imgOff ? h('div', { className: 'ab-note warn', style: { marginBottom: 8 } }, '「参考图」现在关着：她画自己时只用形象描述，不用这些图。') : null,
        h('div', { className: 'ab-flex', style: { gap: 8, marginBottom: 8 } },
          h('input', { ref: fileRef, type: 'file', accept: 'image/png,image/jpeg,image/webp,image/gif', multiple: true, style: { display: 'none' }, onChange: (e) => upload(e.target.files) }),
          h(Btn, { small: true, kind: 'primary', disabled: busy === 'upload', onClick: () => fileRef.current && fileRef.current.click() }, busy === 'upload' ? '导入中…' : '导入图片（可以多选）')),
        !d ? h(Empty, { icon: '⏳', text: '加载中…' })
          : !list.length ? h(Empty, { icon: '🪞', text: '还没导入。导入以后，让她发自拍、画她自己时就会照着画。' })
            : h('div', { className: 'ab-shots' }, list.map((it) => {
              const src = API + '/image/appearance/image?file=' + encodeURIComponent(it.file)
              return h('div', { key: it.file, className: 'ab-shot' },
                h('a', { href: src, target: '_blank', rel: 'noreferrer' }, h('img', { src, alt: '她的形象', loading: 'lazy' })),
                h('div', { className: 'cap' }, it.primary ? '★ 主图' : h('a', { href: '#', onClick: (e) => { e.preventDefault(); act('/image/appearance/primary', { file: it.file }, '设成主图了') } }, '设为主图')),
                h(Btn, { small: true, kind: 'danger', title: '移到废纸篓', onClick: () => { if (confirm('把这张移到废纸篓？')) act('/image/appearance/delete', { file: it.file }, '移到废纸篓了') } }, '✕'))
            })),
        h(Row, { label: '形象描述', hint: '画她自己时加进提示词。可以点「看图写一段」让能看图的模型写，也可以自己写、改' },
          h('div', { style: { flex: 1 } },
            h('textarea', { className: 'ab-input', rows: 4, style: { width: '100%' }, value: text, placeholder: '比如：银白色长发、蓝眼睛、常穿水手服……', onChange: (e) => setDesc(e.target.value) }),
            h('div', { className: 'ab-flex', style: { gap: 6, marginTop: 6 } },
              h(Btn, { small: true, disabled: !list.length || busy === 'describe', onClick: describe }, busy === 'describe' ? '正在看图…' : '看图写一段'),
              desc !== null ? h(Btn, { small: true, kind: 'primary', onClick: () => act('/image/appearance/description', { text: desc }, '存好了') }, '保存描述') : null,
              text ? h(Btn, { small: true, kind: 'ghost', onClick: async () => { const r = await post('/mind/self/change', { what: 'looks', content: text, why: '管理员导入了她的形象图' }); toast((r && r.message) || '好了', r && r.ok === false ? 'err' : 'ok') } }, '也写进她的「外貌」') : null))))
    }

    function PaintGallery({ draft, setDraft, toast }) {
      const f = useField(draft, setDraft)
      const shown = Math.min(50, Math.max(1, Number(draft.imageGen && draft.imageGen.galleryShown) || 20))
      const [data, setData] = useState(null)
      const load = async () => {
        const r = await get('/image/gallery?limit=' + shown).catch(() => null)
        setData(r && r.ok ? r : { items: [], total: 0, dir: '' })
      }
      useEffect(() => { load() }, [shown])
      const del = async (file) => {
        if (!confirm('删掉这张画？\n' + file)) return
        const r = await post('/image/gallery/delete', { file }).catch(() => ({ ok: false }))
        toast(r.message || (r.ok ? '删掉了' : '删除失败'), r.ok ? 'ok' : 'err')
        load()
      }
      return h(Card, {
        fold: 'image-library', title: '她的画作' + (data ? '（显示最近 ' + data.items.length + ' 张 / 共 ' + data.total + ' 张）' : ''),
        desc: 'ta画过的图都存在本机（不会自动删），这里只是面板里显示多少张。想看全部或者清理，点「打开文件夹」。',
        right: h('div', { className: 'ab-flex' },
          h(Btn, { small: true, kind: 'ghost', onClick: load }, '刷新'),
          h(Btn, { small: true, kind: 'ghost', onClick: () => post('/image/open-folder').then((r) => toast(r.message, r.ok ? 'ok' : 'err')).catch(() => toast('打不开文件夹', 'err')) }, '打开文件夹')),
      },
        h(Row, { label: '面板显示最近', hint: '最多 50 张；只影响面板显示，不删文件' },
          f.num('imageGen.galleryShown', { min: 1, max: 50 }), h('span', { className: 'ab-muted' }, '张')),
        data && data.dir ? h('div', { className: 'ab-muted ab-small', style: { margin: '4px 0 8px', wordBreak: 'break-all' } }, '存图目录：' + data.dir) : null,
        !data ? h(Empty, { icon: '⏳', text: '加载中…' })
          : data.items.length === 0 ? h(Empty, { icon: '🎨', text: 'ta还没画过图。在聊天里说「画一张……」，画好的图会出现在这里。' })
            : h('div', { className: 'ab-shots' }, data.items.map((it) => h(PaintCell, { key: it.file, it, onDelete: () => del(it.file) }))),
      )
    }

    function PaintCell({ it, onDelete }) {
      const src = API + '/image/gallery/image?file=' + encodeURIComponent(it.file)
      const cap = it.prompt ? '「' + it.prompt + '」' : '画作'
      const when = it.at ? timeAgo(it.at) : ''
      return h('div', { className: 'ab-shot' },
        h('a', { href: src, target: '_blank', rel: 'noreferrer' }, h('img', { src, alt: cap, loading: 'lazy' })),
        h('div', { className: 'cap', title: cap }, cap + (when ? '　' + when : '')),
        h(Btn, { small: true, kind: 'danger', title: '删除', onClick: onDelete }, '✕'),
      )
    }

    function CodexSub({ draft, setDraft, toast }) {
      const f = useField(draft, setDraft)
      const [status, setStatus] = useState(null)
      const [waiting, setWaiting] = useState(null)
      const [input, setInput] = useState('')
      const [busy, setBusy] = useState(false)
      const refresh = () => get('/image/codex/status').then(setStatus).catch(() => setStatus({ loggedIn: false }))
      useEffect(() => { refresh() }, [])
      useEffect(() => {
        if (!waiting) return undefined
        let active = true
        const timer = setInterval(async () => {
          const r = await get('/image/codex/login/status').catch(() => null)
          if (!active || !r) return
          if (r.state === 'done' || r.state === 'error') {
            clearInterval(timer); setWaiting(null); setInput(''); refresh()
            toast(r.state === 'done' ? '登录成功' : r.error || '登录失败')
          }
        }, 2000)
        return () => { active = false; clearInterval(timer) }
      }, [Boolean(waiting)])
      const act = (path, body = {}) => async () => {
        setBusy(true)
        const r = await post(path, body).catch(() => ({ ok: false, message: '请求失败' }))
        setBusy(false)
        if (!r.ok) { toast(r.message || '操作失败'); return }
        setInput('')
        if (path.endsWith('/login')) setWaiting({ url: r.url, needPaste: r.needPaste })
        else { setWaiting(null); refresh(); toast(path.endsWith('/logout') ? '已退出 ChatGPT' : path.endsWith('/cancel') ? '已取消登录' : '登录成功') }
      }
      return h('div', null,
        h('div', { className: 'ab-note', style: { margin: '8px 0' } }, '实验性订阅接法：使用非公开图片端点，可用性和额度由账号、工作区及服务端决定。登录信息仅存本机。'),
        h(Row, { label: 'ChatGPT 账号' },
          h('span', { className: 'ab-small' }, status === null ? '读取登录状态…' : status.loggedIn ? '已登录：' + (status.email || status.accountId) : '尚未登录'),
          h(Btn, { small: true, onClick: act('/image/codex/login'), disabled: busy || Boolean(waiting) }, '登录 ChatGPT'),
          status?.loggedIn ? h(Btn, { small: true, onClick: act('/image/codex/logout'), disabled: busy }, '退出') : null),
        waiting ? h('div', { className: 'ab-note' },
          h('div', null, waiting.needPaste ? '端口 1455 被占用：打开授权链接登录，再粘贴完整回调地址。' : '请在浏览器完成登录。回调成功后自动刷新，也可以手动粘贴完整回调地址。'),
          h('a', { href: waiting.url, target: '_blank', rel: 'noreferrer', style: { display: 'block', wordBreak: 'break-all' } }, '打开 ChatGPT 授权页'),
          h('input', { className: 'ab-input', value: input, type: 'password', autoComplete: 'off', placeholder: '粘贴完整回调地址', onChange: (e) => setInput(e.target.value) }),
          h(Btn, { small: true, onClick: act('/image/codex/complete', { input }), disabled: busy || !input.trim() }, '完成登录'),
          h(Btn, { small: true, onClick: act('/image/codex/cancel'), disabled: busy }, '取消登录')) : null,
        h(Row, { label: '模型', hint: '可用模型由服务端决定' }, f.select('imageGen.codex.model', [
          'gpt-image-2',
          'gpt-image-2.5-flare',
          'gpt-image-2.5-sunburst',
          'gpt-image-2.6-flare',
          'gpt-image-2.6-sunburst',
        ].map((value) => ({ value, label: value })), { width: 260 })),
        h(Row, { label: '质量', hint: '所选模型需支持该选项' }, f.select('imageGen.codex.quality', ['auto', 'low', 'medium', 'high', 'xhigh', 'max'].map((value) => ({ value, label: value })), { width: 180 })),
        h(Row, { label: '背景' }, f.select('imageGen.codex.background', ['auto', 'opaque', 'transparent'].map((value) => ({ value, label: value })), { width: 180 })),
        h('div', { className: 'ab-muted ab-small' }, '订阅接法通过构图提示引导，实际尺寸由服务端选择。'),
      )
    }

    function ImageFallbacks({ draft, setDraft }) {
      const f = useField(draft, setDraft)
      const rows = draft.imageGen.fallbacks || []
      const write = (list) => setDraft(setPath(draft, 'imageGen.fallbacks', list))
      const move = (index, delta) => {
        const list = [...rows]
        const target = index + delta
        if (target < 0 || target >= list.length) return
        const entry = list[index]
        list[index] = list[target]
        list[target] = entry
        write(list)
      }
      return h(Card, { fold: 'image-fallbacks', title: '备用生图服务', right: f.sw('imageGen.fallbackEnabled'), desc: '主服务不可用时按顺序尝试。提示词和参考图会发给尝试的备用服务。试运行会实际生成图片并存入画作库。' },
        rows.map((item, index) => {
          const codex = item.provider === 'codex'
          const set = (key, value) => write(rows.map((row, i) => i === index ? { ...row, [key]: value } : row))
          const input = (key, props = {}) => h('input', { className: 'ab-input wide', value: item[key] ?? '', onChange: (e) => set(key, e.target.value), ...props })
          return h('fieldset', { key: item.id, className: 'ab-card', style: { marginBottom: 8, minWidth: 0 } },
            h('legend', null, '备用服务 ' + (index + 1)),
            h(Row, { label: '接口格式' }, h(Select, { value: item.provider || 'openai', onChange: (v) => set('provider', v),
              options: [{ value: 'openai', label: 'OpenAI 兼容' }, { value: 'seedream', label: '豆包 Seedream' }, { value: 'xai', label: 'xAI' }, { value: 'gemini', label: 'Gemini' }, { value: 'sensenova', label: 'SenseNova' }, { value: 'codex', label: '已登录的 Codex 订阅' }] })),
            !codex ? h(Row, { label: '服务地址' }, input('baseUrl', { placeholder: 'https://example.com/v1' })) : null,
            h(Row, { label: '模型' }, input('model')),
            !codex ? h(Row, { label: 'API Key' }, input('apiKey', { type: 'password', placeholder: item.apiKeySet ? '已保存' : '可留空' }),
              item.apiKeySet ? h(Btn, { small: true, onClick: () => set('apiKey', null) }, item.apiKey === null ? '保存后清空' : '清空') : null) : null,
            h('div', { className: 'ab-flex' },
              h(Btn, { small: true, disabled: index === 0, onClick: () => move(index, -1) }, '上移'),
              h(Btn, { small: true, disabled: index === rows.length - 1, onClick: () => move(index, 1) }, '下移'),
              h(Btn, { small: true, kind: 'danger', onClick: () => write(rows.filter((_, i) => i !== index)) }, '移除')))
        }),
        rows.length < 5 ? h(Btn, { small: true, onClick: () => write([...rows, {
          id: globalThis.crypto?.randomUUID?.() || 'fallback-' + Date.now() + '-' + Math.random().toString(36).slice(2),
          provider: 'openai', baseUrl: '', apiKey: '', model: '',
        }]) }, '添加备用服务') : null)
    }

    function BuiltinLocalImage({ draft, setDraft, toast }) {
      const f = useField(draft, setDraft)
      const [status, setStatus] = useState(null)
      const [busy, setBusy] = useState('')
      const [preview, setPreview] = useState('')
      const [notice, setNotice] = useState('')
      useEffect(() => {
        let live = true
        let timer
        let active = busy === 'install' || status?.running || status?.pending > 0
        const poll = async () => {
          const next = await get('/image/local/status')
          if (!live) return
          if (typeof next.supported === 'boolean') {
            setStatus(next)
            active = next.running || next.pending > 0
          } else if (!active) setStatus(next)
          if (active) timer = setTimeout(poll, 1500)
        }
        poll()
        return () => { live = false; clearTimeout(timer) }
      }, [busy, status?.running, status?.pending])
      const act = async (action) => {
        setNotice('')
        setBusy(action)
        const result = await post('/image/local/' + action)
        if (action === 'install' && result.running) setStatus(result)
        setBusy('')
        if (result.image) setPreview(result.image)
        if (result.message) { setNotice(result.message); toast(result.message, result.ok ? 'ok' : 'err') }
      }
      const download = status?.remainingBytes ? `约 ${(status.remainingBytes / 1024 ** 3).toFixed(1)} GiB 权重` : ''
      const label = status?.running ? status.step : !status ? '正在检查…' : status.supported === false ? '此设备不支持' : status.ready ? '已就绪' : status.supported ? '尚未部署' : '状态读取失败'
      return h('div', { className: 'ab-grid', style: { gap: 0 } },
        h(Row, { label: '本地模型', hint: 'Apple 芯片 · macOS 26 或更新版本 · 建议至少 16 GB 内存' },
          h('b', null, 'Qwen Image 2.1 · 4 位'), h('a', { href: 'https://huggingface.co/OsaurusAI/Qwen-Image-2.1-mflux-4bit/blob/235fd28de40d745382e9d7a33f008c7735ec21c2/LICENSE', target: '_blank', rel: 'noreferrer' }, '模型许可（非商业研究与评估）')),
        h(Row, { label: '部署状态' },
          h('span', { role: 'status' }, label),
          status?.reusedModel || status?.reusedPython ? h('span', { className: 'ab-muted ab-small' }, status.reusedModel && status.reusedPython ? '复用已有模型和环境' : status.reusedModel ? '复用已有模型' : '复用已有环境') : null,
          download && !status.running ? h('span', { className: 'ab-muted ab-small' }, '待下载 ' + download) : null),
        h(Row, { label: '运行环境', hint: '已有文件会复用。新环境装在 ~/Aurabot/imagegen，安装后可离线生成。' },
          h(Btn, { small: true, kind: status?.ready ? undefined : 'primary', disabled: !status?.supported || status.running || status.pending > 0 || Boolean(busy), onClick: () => {
            if (status.ready || confirm((download ? '将下载' + download + '并安装缺少的依赖。' : '将安装缺少的依赖。') + '继续表示你已查看并同意模型许可。')) act('install')
          } }, status?.running || busy === 'install' ? '正在部署…' : status?.ready ? '检查与修复' : '一键部署'),
          h(Btn, { small: true, disabled: !status?.ready || status.running || status.pending > 0 || Boolean(busy), onClick: () => act('test') }, busy === 'test' ? '正在试画…' : '试画一张')),
        (notice || status?.message) && !status?.running ? h('p', { className: 'ab-small', role: 'status' }, notice || status.message) : null,
        preview ? h('img', { src: 'data:image/png;base64,' + preview, alt: '本地生图试画结果', style: { width: 240, maxWidth: '100%', borderRadius: 8, margin: '8px 0' } }) : null,
        h(Row, { label: '生成步数', hint: '步数越多，生成越慢。保存后应用到聊天里的新任务。' }, f.num('imageGen.localSteps', { min: 4, max: 50 })))
    }

    function ImageGen({ draft, setDraft, toast }) {
      const f = useField(draft, setDraft)
      const [imageTest, setImageTest] = useState(null)
      const [testingImage, setTestingImage] = useState(false)
      const [lastImageError, setLastImageError] = useState(null)
      useEffect(() => { get('/image/status').then((r) => setLastImageError(r.lastError || null)).catch(() => {}) }, [])
      const testImage = async () => {
        if (!confirm('会先保存当前生图设置，再调用当前服务画一张测试图，可能消耗额度。继续？')) return
        setTestingImage(true); setImageTest(null)
        try {
          const saved = await post('/save', { imageGen: draft.imageGen })
          if (!saved.ok) { setImageTest({ ok: false, message: saved.message || '保存生图设置失败' }); return }
          const r = await post('/image/test')
          setImageTest(r.ok ? { ok: true, image: r.image, message: r.message } : { ok: false, message: r.message || '试画失败' })
        } catch (e) { setImageTest({ ok: false, message: e.message }) } finally { setTestingImage(false) }
      }
      const c = draft.imageGen
      const custom = c.custom || {}
      const readyNow = (() => {
        if (c.provider === 'local' || c.provider === 'codex') return true
        if (c.provider === 'custom') return Boolean(custom.url)
        if (c.provider === 'comfyui') return Boolean(c.comfy?.workflow && c.comfy?.baseUrl)
        const needsKey = ['openai', 'seedream', 'xai', 'gemini', 'sensenova'].includes(c.provider)
        return Boolean(c.baseUrl || ['seedream', 'xai', 'gemini', 'sensenova'].includes(c.provider)) && (!needsKey || c.apiKey || c.apiKeySet)
      })()
      const isCustom = c.provider === 'custom'
      const isCodex = c.provider === 'codex'
      const isLocal = c.provider === 'local'
      const isComfy = c.provider === 'comfyui'
      const isPost = custom.method === 'POST'
      const params = Array.isArray(custom.params) ? custom.params : []
      const setParams = (next) => setDraft(setPath(draft, 'imageGen.custom.params', next))
      const setP = (i, k, v) => setParams(params.map((p, j) => (j === i ? { ...p, [k]: v } : p)))
      return h('div', { className: 'ab-grid' },
        h(Card, { title: '让ta画图', right: f.sw('imageGen.enabled'), desc: '选择生图方式。自定义生图脚本可在「系统 → 本地接口」管理。' },
          h(Row, { label: '生图方式' },
            h(Select, {
              value: c.provider || 'openai', width: 270,
              onChange: (v) => setDraft(setPath(draft, 'imageGen.provider', v)),
              options: [{ value: 'openai', label: 'OpenAI 格式' }, { value: 'seedream', label: '豆包 Seedream' }, { value: 'xai', label: 'xAI' }, { value: 'gemini', label: 'Gemini' }, { value: 'sensenova', label: 'SenseNova' }, { value: 'comfyui', label: 'ComfyUI' }, { value: 'custom', label: '自定义接口' }, { value: 'codex', label: 'Codex 订阅（实验性）' }, { value: 'local', label: '本地部署' }],
            })),
          isLocal ? h(BuiltinLocalImage, { draft, setDraft, toast }) : isCodex ? h(CodexSub, { draft, setDraft, toast }) : isComfy ? h('div', null,
            h(Row, { label: 'ComfyUI 地址', hint: '只填到主机和端口，不要带 /prompt' }, f.text('imageGen.comfy.baseUrl', { size: 'wide', placeholder: 'http://127.0.0.1:8188' })),
            h(Row, { label: 'API workflow', hint: 'ComfyUI「Save (API Format)」导出的 JSON；没有提示词节点时用 __PROMPT__ 占位，参考图用 __IMAGE__' },
              h('textarea', { className: 'ab-input wide', rows: 5, value: c.comfy?.workflow || '', placeholder: '{"6":{"class_type":"CLIPTextEncode","inputs":{"text":"__PROMPT__"}}}', onChange: (e) => setDraft(setPath(draft, 'imageGen.comfy.workflow', e.target.value)) })),
            h(Row, { label: '提示词节点', hint: '可选，如 6；填了就直接改这个节点的 inputs.text' }, f.text('imageGen.comfy.promptNode', { placeholder: '6' })),
            h(Row, { label: '参考图节点', hint: '可选，LoadImage 节点编号；用参考图时必须填' }, f.text('imageGen.comfy.imageNode', { placeholder: '10' })),
            h(Row, { label: '输出节点', hint: '可选，只从这个节点的 images 取图' }, f.text('imageGen.comfy.outputNode', { placeholder: '9' })),
            h(Row, { label: '轮询间隔', hint: '默认 1000ms' }, f.num('imageGen.comfy.pollMs', { min: 200, max: 10000, step: 100 })),
          ) : isCustom ? h('div', null,
            h(Row, { label: '请求方式', hint: 'GET 把参数都拼在地址上；POST 放进请求体' },
              h(Seg, {
                value: isPost ? 'POST' : 'GET',
                onChange: (v) => setDraft(setPath(draft, 'imageGen.custom.method', v)),
                options: [{ value: 'GET', label: 'GET' }, { value: 'POST', label: 'POST' }],
              })),
            h(Row, { label: '接口地址', hint: '可以用 {prompt} {model} {size} {width} {height} {image}（参考图 base64）' },
              f.text('imageGen.custom.url', { size: 'wide', placeholder: 'https://image.pollinations.ai/prompt/{prompt}' })),
            h(Row, { label: 'API Key', hint: '会以 Authorization: Bearer 发出；不需要就留空' },
              f.text('imageGen.apiKey', { type: 'password', placeholder: c.apiKeySet ? '已保存（不改就留空）' : '没有就留空' })),
            h('div', { className: 'ab-label', style: { marginTop: 12 } },
              h('b', null, isPost ? '请求体参数' : 'URL 参数'),
              h('small', null, '参数名和值都自己填；值里可以用 {prompt}、{image}（参考图 base64）；参考图需配置 {image} 才能使用')),
            params.length
              ? params.map((p, i) => h('div', { key: i, className: 'ab-flex', style: { gap: 6, marginBottom: 6 } },
                h('input', { className: 'ab-input', style: { width: 170 }, value: p.key || '', placeholder: '参数名，如 model', onChange: (e) => setP(i, 'key', e.target.value) }),
                h('input', { className: 'ab-input', style: { flex: 1 }, value: p.value || '', placeholder: '值，可以用 {prompt}', onChange: (e) => setP(i, 'value', e.target.value) }),
                h(Btn, { small: true, onClick: () => setParams(params.filter((_, j) => j !== i)) }, '删')))
              : h('div', { className: 'ab-muted ab-small', style: { marginBottom: 6 } }, '还没有参数 —— 比如 model=flux-anime、width=1080、height=1920、nologo=true'),
            h('div', { className: 'ab-flex', style: { marginBottom: 10 } },
              h(Btn, { small: true, onClick: () => setParams([...params, { key: '', value: '' }]) }, '＋ 加一个参数')),
            isPost ? h(Row, { label: '请求体格式' },
              h(Seg, {
                value: custom.bodyType === 'form' ? 'form' : 'json',
                onChange: (v) => setDraft(setPath(draft, 'imageGen.custom.bodyType', v)),
                options: [{ value: 'json', label: 'JSON' }, { value: 'form', label: '表单' }],
              })) : null,
            h(Row, { label: '取值路径', hint: '接口直接回图片就留空；回 JSON 时填地址字段' },
              f.text('imageGen.custom.responsePath', { size: 'wide', placeholder: '如 data.0.url（留空自动找）' })),
          ) : h('div', null,
            h(Row, { label: '服务地址', hint: '一般以 /v1 结尾' }, f.text('imageGen.baseUrl', { size: 'wide', placeholder: 'https://api.siliconflow.cn/v1' })),
            h(Row, { label: 'API Key', hint: '只存在本机，不会显示出来' }, f.text('imageGen.apiKey', { type: 'password', placeholder: c.apiKeySet ? '已保存（不改就留空）' : '没有就留空' })),
            h(Row, { label: '模型' }, h('div', { style: { flex: 1 } },
              f.text('imageGen.model', { size: 'wide', placeholder: '例如 Kwai-Kolors/Kolors' }),
              h(ModelPicker, { kind: 'image', keyFrom: 'imageGen', toast, baseUrl: (draft.imageGen || {}).baseUrl, apiKey: (draft.imageGen || {}).apiKey, value: (draft.imageGen || {}).model, onPick: (m) => setDraft(setPath(draft, 'imageGen.model', m)) }))),
          ),
          h(Row, { label: '默认构图', hint: isLocal ? '本地模型最长边为 1024 像素，按构图比例缩放。' : isCodex ? '通过构图提示引导，实际尺寸由服务端选择，不保证严格比例' : '聊天工具可指定本次构图。服务不支持所选尺寸时会报告失败，请换一种构图；自定义接口需使用尺寸占位符' },
            f.select('imageGen.shape', [
              { value: 'her', label: '让ta选择', desc: isCodex ? '未指定时由服务端选择' : '未指定时沿用图片尺寸' },
              { value: 'square', label: isCodex ? '方图 1:1' : '方图 1:1（1024 × 1024）' },
              { value: 'portrait', label: isCodex ? '竖图 2:3' : '竖图 2:3（1024 × 1536）' },
              { value: 'landscape', label: isCodex ? '横图 3:2' : '横图 3:2（1536 × 1024）' },
              { value: 'wide', label: isCodex ? '宽幅 16:9' : '宽幅 16:9（1536 × 864）' },
            ], { width: 260 })),
          !isCodex && (!c.shape || c.shape === 'her') ? h(Row, { label: '图片尺寸', hint: isCustom ? '接口地址 / 参数里可以用 {size} 或 {width}/{height}' : '未指定构图时沿用这个尺寸' },
            f.select('imageGen.size', [{ value: '1024x1024', label: '1024 × 1024', desc: '方图' }, { value: '768x1024', label: '768 × 1024', desc: '竖图' }, { value: '1024x768', label: '1024 × 768', desc: '横图' }, { value: '512x512', label: '512 × 512', desc: '小图，更快' }, { value: '2048x2048', label: '2K · 2048 × 2048', desc: '2K 方图' }, { value: '4096x4096', label: '4K · 4096 × 4096', desc: '4K 方图' }].filter((size) => !isLocal || Number(size.value.split('x')[0]) <= 1024), { width: 230 })) : null,
          h(Row, { label: '固定风格', hint: '每次画都会加在描述前面' }, f.text('imageGen.stylePrompt', { size: 'wide', placeholder: '例如：日系二次元，柔和光线，蓝白配色' })),
          h(Row, { label: '允许参考图改画', hint: '默认开启，只接受当前聊天收到的图、引用图或图库文件名；Codex 订阅暂不支持' }, f.sw('imageGen.img2img')),
          h(Row, { label: '让ta画完自己看一眼', hint: '开着才把画好的图传给ta看（模型不支持看图时自动不传）；关掉就只回一句「画好了」，不传图' }, f.sw('imageGen.seeOwn')),
          h(Row, { label: '连通性测试', hint: '会真的调用当前生图服务画一张 512×512 测试图，可能消耗额度' },
            h(Btn, { small: true, disabled: testingImage || !readyNow, onClick: testImage }, testingImage ? '试画中…' : '试画一张'),
            h('span', { className: readyNow ? 'ab-badge' : 'ab-muted ab-small' }, readyNow ? '配置就绪' : '还缺端点配置'),
            imageTest ? h('span', { className: 'ab-muted ab-small' }, imageTest.message || (imageTest.ok ? '成功' : '失败')) : null),
          imageTest?.image ? h('img', { src: 'data:image/png;base64,' + imageTest.image, alt: '生图测试结果', style: { maxWidth: 220, borderRadius: 8, marginTop: 8 } }) : null,
          lastImageError ? h('div', { className: 'ab-note', style: { marginTop: 8 } },
            `上次失败（${new Date(lastImageError.at).toLocaleString()}，${lastImageError.provider || '未知服务'}）：${lastImageError.message}`,
            h(Btn, { small: true, kind: 'ghost', onClick: async () => { await post('/image/status/clear'); setLastImageError(null) } }, '清除')) : null,
          isCustom ? h('div', { className: 'ab-note', style: { marginTop: 10 } }, '例子：地址填 https://image.pollinations.ai/prompt/{prompt}，再加 model=flux-anime、width=1080、height=1920、nologo=true 四个参数，GET 就会请求 …/prompt/<提示词>?model=flux-anime&width=1080&…') : null,
          !c.enabled ? h('div', { className: 'ab-note', style: { marginTop: 10 } }, isLocal ? '部署完成后，打开右上角开关并保存。' : '填好接口信息后，打开右上角开关并保存。') : null,
        ),
        isLocal ? null : h(ImageFallbacks, { draft, setDraft }),
        h(AppearanceCard, { draft, toast }),
        h(PaintGallery, { draft, setDraft, toast }),
      )
    }

    /** 云备份（Gitee 私有仓库 / WebDAV）：每天到点自动打包，把最新备份推上去，远端只留最近 N 份。 */
    function RemoteBackup({ toast }) {
      const [s, setS] = useState(null)
      const [form, setForm] = useState(null)
      const set = (k) => (e) => setForm((old) => ({ ...old, [k]: k === 'keep' ? Math.max(1, Math.round(Number(e.target.value) || 1)) : (k === 'enabled' || k === 'autoCreate' || k === 'forceOverwrite' || k === 'webdavConfigOnly' ? e.target.checked : e.target.value) }))
      const load = (refreshForm = false) => get('/backup/remote/state').then((st) => {
        if (!st.ok) { if (refreshForm) toast(st.message || '读不到云备份设置', 'err'); return }
        setS(st)
        if (!refreshForm) return
        const v = st.remote || {}
        setForm({
          provider: v.provider === 'webdav' ? 'webdav' : 'gitee',
          enabled: !!v.enabled, owner: v.owner || '', repo: v.repo || '', token: '', branch: v.branch || 'master',
          time: v.time || '03:30', keep: v.keep || 10, autoCreate: v.autoCreate !== false, forceOverwrite: !!v.forceOverwrite,
          webdavUrl: v.webdav?.url || '', webdavUsername: v.webdav?.username || '', webdavPassword: '', webdavConfigOnly: v.webdav?.configOnly === true,
        })
      })
      useEffect(() => { load(true) }, [])
      const running = Boolean(s && s.job && s.job.running)
      useEffect(() => { if (!running) return; const t = setInterval(load, 1000); return () => clearInterval(t) }, [running])
      const call = (p, body) => fetch(API + p, { method: 'POST', headers: { 'x-aurabot-backup': '1', 'content-type': 'application/json' }, body: JSON.stringify(body || {}) }).then((r) => r.json()).catch((error) => ({ ok: false, message: '备份请求失败：' + error.message }))
      const after = (r2, refreshForm = false) => { toast(r2.ok ? (r2.message || '好了') : r2.message, r2.ok ? 'ok' : 'err'); load(r2.ok && refreshForm) }
      if (!form) return null
      const job = s && s.job
      const webdav = form.provider === 'webdav'
      const Input = (k, placeholder, type) => h('input', { className: 'ab-input', type: type || 'text', placeholder, value: form[k], onChange: set(k), style: { minWidth: 0 } })
      const Field = (label, k, placeholder, type) => h('div', { style: { flex: 1, minWidth: 0 } },
        h('div', { className: 'ab-small ab-muted', style: { marginBottom: 2 } }, label),
        Input(k, placeholder, type))
      const saveBody = () => {
        const b = { provider: form.provider, enabled: form.enabled, time: form.time, keep: form.keep }
        if (webdav) {
          b.webdav = { url: form.webdavUrl.trim(), username: form.webdavUsername.trim(), configOnly: form.webdavConfigOnly, ...(form.webdavPassword ? { password: form.webdavPassword } : {}) }
        } else {
          Object.assign(b, { owner: form.owner.trim(), repo: form.repo.trim(), branch: form.branch.trim() || 'master', autoCreate: form.autoCreate, forceOverwrite: form.forceOverwrite })
          if (form.token) b.token = form.token
        }
        return b
      }
      return h(Card, { fold: 'backup-cloud', title: '云备份（Gitee / WebDAV）', desc: '每天到点自动打包一份备份，推到你的私有仓库或 WebDAV，换电脑或坏盘时也能找回来。' },
        h(Seg, {
          value: form.provider,
          onChange: (v) => setForm({ ...form, provider: v }),
          options: [{ value: 'gitee', label: 'Gitee 私有仓库' }, { value: 'webdav', label: 'WebDAV' }],
        }),
        webdav
          ? h('div', { className: 'ab-note warn', style: { margin: '10px 0' } }, '⚠️ 备份里有全部聊天记录、记忆和账号凭证。WebDAV 请用自己可控的私有网盘，并尽量走 HTTPS；插件会自动创建 aurabot-backups 文件夹，只把 zip 上传到你的服务器，不会传给第三方。')
          : h('div', { className: 'ab-note warn', style: { margin: '10px 0' } }, '⚠️ 仓库必须是「私有」的！备份里有你全部的聊天记录、记忆和账号凭证，推到公开仓库等于把它们挂到网上。推送前会先向 Gitee 核实仓库确实是私有的，公开仓库一律拒绝推。'),
        h('div', { className: 'ab-flex', style: { alignItems: 'center' } },
          h('label', { className: 'ab-small', style: { display: 'flex', gap: 6, alignItems: 'center', cursor: 'pointer' } }, h('input', { type: 'checkbox', checked: form.enabled, onChange: set('enabled') }), '每天自动备份并推送'),
          form.enabled ? h('span', { className: 'ab-small ab-muted' }, '下次：' + (s && s.nextAt ? String(s.nextAt).slice(0, 16).replace('T', ' ') : '到点就跑')) : null),
        webdav
          ? h('div', null,
            h('div', { className: 'ab-flex', style: { marginTop: 10 } },
              Field('服务器地址', 'webdavUrl', 'https://dav.jianguoyun.com/dav/')),
            h('div', { className: 'ab-flex', style: { marginTop: 8 } },
              Field('用户名', 'webdavUsername', '坚果云账号邮箱 / WebDAV 用户名'),
              Field('密码/应用授权码', 'webdavPassword', s && s.remote && s.remote.webdav && s.remote.webdav.hasPassword ? '已保存，留空就不改' : '坚果云：账户信息 → 安全选项 → 添加应用密码', 'password')),
            h('div', { className: 'ab-small ab-muted', style: { marginTop: 6 } }, '会自动在服务器根目录创建 aurabot-backups 文件夹；填到已有文件夹也可以。'),
            h('label', { className: 'ab-small', style: { display: 'flex', gap: 6, alignItems: 'center', cursor: 'pointer', marginTop: 10 } },
              h('input', { type: 'checkbox', checked: form.webdavConfigOnly, onChange: set('webdavConfigOnly') }), '仅备份配置文件（不含画作、表情、截图等媒体）'),
            h('div', { className: 'ab-small ab-muted', style: { marginTop: 4, lineHeight: 1.7 } },
              '勾选后打包 config.json、人格、心智核心（她的记忆、情绪、性格、关系）、日记、模块配置、聊天流水和当前工作区 DSH 会话；不包含画作 imagegen、表情 stickers、旧版截图、外部模块数据、语音缓存、模块库代码、日志和缓存。上传的 zip 会明显更小；远端保留份数对完整备份和仅配置备份分别计算。'))
          : h('div', null,
            h('div', { className: 'ab-flex', style: { marginTop: 10 } },
              Field('Gitee 用户名', 'owner', '如 gitee.com/小鱼 里的「小鱼」'),
              Field('仓库名（私有）', 'repo', '如 aurabot-backup，没有会自动建'),
              Field('分支（一般不用改）', 'branch', 'master')),
            h('div', { className: 'ab-flex', style: { marginTop: 8 } },
              Field('Gitee 私人令牌', 'token', s && s.remote && s.remote.hasToken ? '已保存，留空就不改' : '下面第 2 步生成的那串', 'password')),
            h('div', { className: 'ab-flex', style: { marginTop: 8, alignItems: 'center', flexWrap: 'wrap' } },
              h('label', { className: 'ab-small', style: { display: 'flex', gap: 6, alignItems: 'center', cursor: 'pointer' } }, h('input', { type: 'checkbox', checked: form.autoCreate, onChange: set('autoCreate') }), '仓库不存在时自动建（建的就是私有，推荐开）'),
              h('label', { className: 'ab-small', style: { display: 'flex', gap: 6, alignItems: 'center', cursor: 'pointer' } }, h('input', { type: 'checkbox', checked: form.forceOverwrite, onChange: set('forceOverwrite') }), '允许覆盖已有内容的仓库'))),
        h('div', { className: 'ab-flex', style: { marginTop: 8 } },
          Field('每天几点备份', 'time', '如 03:30'),
          Field('远端留几份', 'keep', '如 10')),
        h('div', { className: 'ab-flex', style: { marginTop: 10, alignItems: 'center' } },
          h('span', { className: 'ab-flex' },
            h(Btn, { small: true, kind: 'primary', disabled: running, onClick: async () => after(await call('/backup/remote/config', saveBody()), true) }, '保存设置'),
            h(Btn, { small: true, disabled: running, onClick: async () => { if (!confirm('现在就把最新备份推到 ' + (webdav ? 'WebDAV' : 'Gitee') + '？（不会重新打包，推 backups 里最新的一份）')) return; after(await call('/backup/push')) } }, running ? '推送中…' : '立即推送'))),
        job && job.error ? h('div', { className: 'ab-note err', style: { marginTop: 10 } }, '推送失败：' + job.error) : null,
        job && job.result ? h('div', { className: 'ab-small ab-muted', style: { marginTop: 10 } }, '上次推送：' + job.result.message) : null,
        h('details', { style: { marginTop: 10 } },
          h('summary', { className: 'ab-small', style: { cursor: 'pointer' } }, webdav ? '📖 WebDAV 怎么填（点这里收起）' : '📖 第一次用？跟着下面 4 步做（点这里收起）'),
          webdav
            ? h('div', { className: 'ab-small ab-muted', style: { marginTop: 8, lineHeight: 1.8 } },
              h('div', null, h('b', null, '第 1 步 · 服务器地址：'), '坚果云填 https://dav.jianguoyun.com/dav/（带 /dav/，只填域名根目录会 HTTP 410）；其他网盘填 WebDAV 根地址。'),
              h('div', null, h('b', null, '第 2 步 · 用户名和密码/应用授权码：'), '坚果云用户名就是账号邮箱；密码不是登录密码，去网页端「账户信息 → 安全选项 → 添加应用密码」生成一个，填到第二栏。'),
              h('div', null, h('b', null, '第 3 步 · 保存并试推：'), '点「保存设置」，再点「立即推送」。成功后每天按设置时间自动上传，远端按「留几份」清理旧 zip。'),
              h('div', { style: { marginTop: 6 } }, '插件会自动创建 aurabot-backups 文件夹；如果服务器不允许根目录建目录，可以先手动建好再把地址填到该文件夹。'))
            : h('div', { className: 'ab-small ab-muted', style: { marginTop: 8, lineHeight: 1.8 } },
              h('div', null, h('b', null, '第 1 步 · 注册 Gitee：'), '打开 ', h('a', { href: 'https://gitee.com/signup', target: '_blank', rel: 'noreferrer' }, 'gitee.com'), ' 注册一个账号（手机号或邮箱都行，免费的）。'),
              h('div', null, h('b', null, '第 2 步 · 生成令牌：'), '登录后点右上角头像 →「设置」→ 左侧「安全设置」→「私人令牌」→「+ 生成新令牌」，勾选 ', h('b', null, 'projects'), ' 权限后提交，把显示出来的那串字符复制粘贴到上面的「Gitee 私人令牌」里（只显示一次，丢了就重新生成一个）。'),
              h('div', null, h('b', null, '第 3 步 · 准备 git：'), 'Mac 上 git 跟着苹果的「命令行开发者工具」一起装：打开「终端」输入 ', h('code', null, 'git --version'), ' 回车，没装的话系统会弹窗问要不要安装，点「安装」等它装完，然后重启 DSH。能显示版本号就说明装过了，跳过这步。'),
              h('div', null, h('b', null, '第 4 步 · 填上面的表格：'), '「Gitee 用户名」填你个人主页地址 gitee.com/ 后面那串；「仓库名」自己起一个，比如 aurabot-backup；「私人令牌」粘第 2 步的；勾上「每天自动备份并推送」，点「保存设置」。仓库让插件自动建就行（建出来就是私有的）。如果自己在 Gitee 网页上建，右上角「+」→ 新建仓库时务必选 ', h('b', null, '「私有」'), '，不要勾「设置初始化 README」。'),
              h('div', { style: { marginTop: 6 } }, '弄完点一次「立即推送」试试，提示「已推送」就成功了，之后每天都会自动备份。备份超过 95MB 会自动分成若干卷推送（文件名带 .part01、.part02…）；恢复时把各卷按顺序合并回一个 zip 再导入——Windows 命令示例：copy /b aurabot-backup-xxx.zip.part01+aurabot-backup-xxx.zip.part02+… 完整的.zip')),
        h('div', { className: 'ab-small ab-muted', style: { marginTop: 10 } }, webdav ? 'WebDAV 密码只存在本机配置里，不会展示；推送由插件直接上传，不经过第三方。' : '令牌只存在本机配置里，不会上传；推送走电脑上装的 git。有报错看上面的红字，一般都是令牌权限没勾对或 git 没装。')))
    }

    /** 备份：打包数据目录，换电脑时导入，重启 DSH 后换上。 */
    /* @include backup.js */

    /** 浏览器：需要浏览器的功能（逛网页 / 平台验证）走哪个浏览器。 */
    function Browser({ st, draft, setDraft }) {
      const on = (draft.browser && draft.browser.useDshSidebar) === true
      return h('div', { className: 'ab-grid' },
        h(Card, { title: '使用 DSH 侧边浏览器', desc: '打开后，ta 需要浏览器的功能都连 DSH 的共享浏览器（侧边浏览器）：画面在 DSH 右侧「Agent 浏览器」里实时可见、可直接接手点按；不再为逛网页 / 平台验证各开一个独立窗口。关掉则回到原来的专用浏览器（每模块独立窗口、独立登录资料）。' },
          h(Row, { label: '使用 DSH 侧边浏览器', hint: '共享一个浏览器实例；切换过去后各平台要在共享浏览器里重新登录一次' },
            h(Switch, { on, onChange: (v) => setDraft(setPath(draft, 'browser.useDshSidebar', v)) })),
          on
            ? h('div', { className: 'ab-note' }, '已启用：共享浏览器没在跑时会自动拉起；这些功能「关闭浏览器」只断开连接，不会关掉 DSH 的共享窗口。')
            : h('div', { className: 'ab-note' }, '当前走各模块的专用浏览器：每个模块一个独立窗口、独立登录资料。'),
        ),
      )
    }

    /** 安全防护：SSRF 这类内置防护的强度。 */
    function Security({ st, draft, setDraft }) {
      const f = useField(draft, setDraft)
      const mode = (draft.security && draft.security.ssrfMode) || 'strict'
      return h('div', { className: 'ab-grid' },
        h(Card, { title: '危险命令确认', right: f.sw('security.dangerConfirm'), desc: '打开后，ta在私聊里要执行终端危险命令（删根目录、格式化、关机、下载后直接执行等）之前，会先发 QQ 私聊问你；你回复「确认」才执行，回复「取消」或 60 秒没回就拦下。默认关。只拦真正致命的命令，普通删除/构建/改文件不受影响。' }),
        h(Card, { fold: 'security-download', title: 'SSRF 防护', desc: '限制 ta 下载图片、语音时能访问哪些地址 —— 防止有人用一条链接诱导 ta 去访问你电脑或内网里的服务（路由器管理页、云服务器的 169.254.169.254、本机端口之类）。' },
          h(Row, { label: '防护强度', hint: '部署在服务器上、或者群里有陌生人时，用「严格」' },
            h(Seg, {
              value: mode,
              onChange: (v) => setDraft(setPath(draft, 'security.ssrfMode', v)),
              options: [{ value: 'strict', label: '严格' }, { value: 'loose', label: '宽松' }],
            })),
          mode === 'strict'
            ? h('div', { className: 'ab-note' }, '严格：解析结果里只要有一个地址落在内网段（10./127./169.254./172.16-31/192.168./100.64-127/fd00::/8 等）就拒绝。最安全；但如果你的代理 DNS 会给公网域名塞一条 IPv6 假地址，正常图片也会被拦下来。')
            : h('div', { className: 'ab-note warn' }, '宽松：只有解析结果全部是内网才拒绝。适合本机开着 fake-ip 代理、DNS 会给公网域名同时返回公网地址和 IPv6 ULA（fd00::/8）的情况。代价是「公网 + 内网混合返回」的域名会被放行 —— 别在服务器上开。'),
          h('div', { className: 'ab-muted ab-small', style: { marginTop: 6 } }, '严格模式下图片老是下不来时，先查一下这个域名是不是解析出了内网地址：nslookup -type=AAAA multimedia.nt.qq.com.cn'),
        ),
        h(Card, { fold: 'security-remote', title: '远端管理（反代部署）', desc: '默认只有本机能打开面板、调管理接口——能改配置、装模块、取联动密钥、取联动密钥，所以默认不外放。要做远端管理必须在这里显式打开，并且务必在反向代理层再加一道认证（Basic Auth / OAuth）。' },
          h(Row, { label: '允许远端访问管理接口', hint: '⚠ 打开后任何能连到插件端口的人都能改你的配置。只在反代已加认证时才开' },
            h(Switch, {
              on: (draft.security && draft.security.panelRemoteAccess) === true,
              onChange: (v) => setDraft(setPath(draft, 'security.panelRemoteAccess', v)),
            })),
          (draft.security && draft.security.panelRemoteAccess) === true
            ? h('div', { className: 'ab-note warn' }, '已允许远端管理。请确认反向代理上已经加了认证，否则等于把管理权交给任何扫到你端口的人。')
            : h('div', { className: 'ab-note' }, '只允许本机访问。直接连公网或经反代进来都会被 403 挡下。'),
          h(Row, { label: '可信反向代理地址', hint: '放在反代后面才需要填。填反代自己的地址（127.0.0.1 = 本机 nginx，172.17.0.1 = 容器网关），多个用逗号分隔' },
            h('input', {
              className: 'ab-input',
              value: (draft.security && draft.security.trustedProxy) || '',
              placeholder: '127.0.0.1',
              onChange: (e) => setDraft(setPath(draft, 'security.trustedProxy', e.target.value)),
            })),
          h(Row, { label: '面板对外域名（反代部署）', hint: '面板经反代对外时填域名（如 panel.example.com）。跨站防护把这个域名发来的请求也算「同源」，不然从远端打开面板一保存就会被 403' },
            h('input', {
              className: 'ab-input',
              value: (draft.security && draft.security.publicHostname) || '',
              placeholder: 'panel.example.com',
              onChange: (e) => setDraft(setPath(draft, 'security.publicHostname', e.target.value)),
            })),
          h('div', { className: 'ab-muted ab-small', style: { marginTop: 6 } },
            '插件判断「请求从哪来」只看 TCP 连接的对端地址——X-Forwarded-For 是客户端自己就能写的头，不能信。'
            + '放在反代后面时连接对端永远是反代自己，所以要把反代地址填进上面，插件才会采信 X-Forwarded-For 的最后一跳。'
            + '留空 = 从不相信任何转发头（最安全，适合直连暴露或纯同机）。'),
        ),
        h(Card, { fold: 'security-basics', title: '其它内置防护', desc: '这些是固定行为，暂时没有开关。' },
          h('div', { className: 'ab-muted ab-small', style: { whiteSpace: 'pre-wrap' } },
            ['· 只下载 http / https，并限制单张图片大小', '· 只从白名单里的会话收表情', '· 群管操作只认管理员，对象不能是管理员自己', '· 联动（bridge）默认关闭，开放时必须带密钥', '· 表情的改名 / 删除只对管理员开放'].join('\n')),
        ),
      )
    }

    function Logs() {
      const [items, setItems] = useState(null)
      const [level, setLevel] = useState('info')
      const [area, setArea] = useState('')
      const [auto, setAuto] = useState(true)
      const load = useCallback(() => get('/logs?limit=400&level=' + level + '&area=' + area).then((r) => setItems(r.entries || [])), [level, area])
      useEffect(() => { load(); if (!auto) return; const t = setInterval(load, 3000); return () => clearInterval(t) }, [load, auto])
      return h(Card, { title: '日志', desc: '所有后台动作都在这里，令牌和密码已自动打码。完整日志文件在 ' + '~/.dsh/plugins-data/aurabot/logs/' + '。',
        right: h('div', { className: 'ab-flex' },
          h(Select, { value: level, onChange: setLevel, width: 110, options: [['debug', '全部'], ['info', '一般'], ['warn', '警告'], ['error', '错误']].map(([value, label]) => ({ value, label })) }),
          h(Select, { value: area, onChange: setArea, width: 130, options: [['', '所有模块'], ['core', '核心'], ['chat', '聊天'], ['onebot', 'QQ 网关'], ['snowluma', 'SnowLuma'], ['sticker', '表情'], ['qzone', '空间'], ['voice', '语音'], ['imagegen', '生图'], ['mind', '心智']].map(([value, label]) => ({ value, label })) }),
          h('span', { className: 'ab-switch-row' }, h(Switch, { on: auto, onChange: setAuto }), h('span', { className: 'ab-muted ab-small' }, '自动刷新'))) },
        items === null ? h(Empty, { icon: '⏳', text: '加载中…' }) : items.length === 0 ? h(Empty, { text: '没有符合条件的日志' }) :
          h('div', { className: 'ab-logs' }, items.slice().reverse().map((e, i) => h(LogLine, { key: i, e }))))
    }

    // ---------------- 首次使用向导 ----------------
    const WIZ_STEPS = ['你们的 QQ 号', '接 QQ 网关', '连上机器人号', '完成']

    function Wizard({ st, draft, setDraft, save, toast, reload, onClose }) {
      const [step, setStep] = useState(() => { try { return Number(localStorage.getItem('aurabot.wiz') || 0) } catch (e) { return 0 } })
      const go = (i) => { setStep(i); try { localStorage.setItem('aurabot.wiz', String(i)) } catch (e) {} }
      const f = useField(draft, setDraft)
      const conn = st.onebot.state === 'connected'
      const login = st.onebot.login
      const [live, setLive] = useState('dry')
      const botQQ = draft.platforms?.qq?.botQQ || draft.botQQ
      const ownerQQ = draft.platforms?.qq?.ownerQQ || draft.ownerQQ
      const qqOk = /^\d{5,11}$/.test(botQQ || '') && /^\d{5,11}$/.test(ownerQQ || '') && botQQ !== ownerQQ
      const verified = conn && login && String(login.uin) === String(st.config.botQQ) && !st.onebot.problem
      const canNext = [qqOk, Boolean(draft.platforms?.qq?.wsUrl || st.config.platforms?.qq?.wsUrl || draft.snowluma?.wsUrl || st.config.snowluma?.wsUrl), verified, true][step]
      const next = async () => {
        if ((step === 0 || step === 1) && !(await save({ ...draft, enabled: true }))) return
        go(Math.min(step + 1, WIZ_STEPS.length - 1))
        reload()
      }
      const useExisting = async () => {
        const r = await post('/setup/done', { existingConnection: true })
        toast(r.message, r.ok ? 'ok' : 'err')
        if (r.ok) { try { localStorage.removeItem('aurabot.wiz') } catch (e) {} reload(); onClose && onClose() }
      }
      const body = [
        // 0. QQ 号
        h('div', null,
          h('p', { className: 'ab-desc' }, '大肥鱼需要一个自己的 QQ 号（机器人号），还要知道谁是ta的管理员。'),
          h(Row, { label: '机器人 QQ 号', hint: '强烈建议用小号：非官方 QQ 工具有被限制的风险' }, f.text('platforms.qq.botQQ', { placeholder: '例如 123456789' })),
          h(Row, { label: '你的 QQ 号（管理员）', hint: '群管、操作电脑这些只听管理员的' }, f.text('platforms.qq.ownerQQ', { placeholder: '你的大号' })),
          h(Row, { label: 'ta怎么称呼你' }, f.text('ownerName', { placeholder: '管理员' })),
          h(Row, { label: '工作区文件夹', hint: 'ta在 QQ 会话里读写文件的地方，' + '想放在别处就填完整路径' + '，比如 ' + exPath('Aurabot/qq-chats') + '。填完整路径，留空用默认位置。以后想换，在「连接」页能搬。聊天记录和记忆在用户目录的 .dsh 里，不在这个文件夹' }, f.text('platforms.qq.workspaceDir', { size: 'wide', placeholder: st.config.platforms?.qq?.workspaceDir || st.workspaceDir || '' })),
          (draft.platforms?.qq?.botQQ || draft.botQQ) && (draft.platforms?.qq?.ownerQQ || draft.ownerQQ) && (draft.platforms?.qq?.botQQ || draft.botQQ) === (draft.platforms?.qq?.ownerQQ || draft.ownerQQ) ? h('div', { className: 'ab-note err' }, '机器人号和管理员号不能是同一个。') : null),
        // 1. 接 QQ 网关：你自己跑的 OneBot（macOS 上一般是 OrbStack 里的 SnowLuma）
        h('div', null,
          h('p', { className: 'ab-desc' }, 'SnowLuma 没有 macOS 版：在 OrbStack（或 Docker Desktop）里用它官方的 docker-compose.yml 跑起来，打开它的远程桌面登录机器人号，再把 OneBot 的正向 WebSocket 地址（一般是 ws://127.0.0.1:3001）和令牌填在下面。NapCat、LLOneBot、Lagrange 等任何 OneBot v11 实现也可以。插件只连接，不会启动或注入任何东西。'),
          h(OneBotFields, { draft, f })),
        // 2. 连上机器人号
        h('div', null,
          h('p', { className: 'ab-desc' }, '确认你的 OneBot 服务登录的是机器人号 ' + (st.config.botQQ || '') + '，然后点「连接」。插件连上后会先核对登录的号，不是机器人号就断开。'),
          h('div', { className: 'ab-flex' },
            h(Btn, { kind: 'primary', small: true, onClick: async () => { const r = await post('/onebot/reconnect'); toast(r.message, r.ok ? 'ok' : 'err'); reload() } }, '连接'),
            h(Btn, { small: true, onClick: async () => { const r = await get('/onebot/test'); toast(r.message) } }, '测试连接')),
          conn && login ? h('div', { className: 'ab-note', style: { marginTop: 10 } }, login.uin === st.config.botQQ ? '✓ 连上了：' + login.nickname + '（' + login.uin + '）' : '⚠ 连上的是 ' + login.uin + '，不是机器人号') : h('div', { className: 'ab-muted ab-small', style: { marginTop: 10 } }, '点「连接」后稍等几秒，连上了这里会显示。')),
        // 3. 完成
        h('div', null,
          h('p', { className: 'ab-desc' }, '都准备好了！最后选一下ta怎么上线：'),
          h(Choices, { value: live, onChange: setLive, options: [
            { value: 'dry', label: '先试运行', desc: 'ta会照常思考，但只写进日志、不真的发出去。看几条没问题再在右上角关掉试运行' },
            { value: 'live', label: '直接上线', desc: '马上开始真的回 QQ 消息' },
          ] }),
          h('div', { className: 'ab-flex', style: { marginTop: 12 } },
            h(Btn, { small: true, onClick: async () => { await save({ ...draft, enabled: true, dryRun: false }); const r = await post('/test-send'); toast(r.message); await save({ ...draft, enabled: true, dryRun: live === 'dry' }) } }, '给我发一条自测消息'))),
      ][step]
      return h('div', { className: 'ab-card', style: { padding: '20px 22px' } },
        h('div', { className: 'ab-flex', style: { marginBottom: 6 } }, h('h3', { style: { margin: 0, fontSize: 16 } }, '设置向导'), h('span', { className: 'ab-muted ab-small' }, '第 ' + (step + 1) + ' / ' + WIZ_STEPS.length + ' 步 · ' + WIZ_STEPS[step]), h('div', { className: 'ab-spacer' }),
          st.config.setupDone && onClose ? h(Btn, { small: true, kind: 'ghost', onClick: onClose }, '关闭向导') : null),
        !st.config.setupDone ? h('details', { style: { marginTop: 10 } }, h('summary', { className: 'ab-small' }, '换电脑了？从备份恢复'), h('div', { style: { marginTop: 10 } }, h(Backup, { toast }))) : null,
        h('div', { className: 'ab-wiz-bar' }, WIZ_STEPS.map((s, i) => h('button', { key: s, type: 'button', className: cx('seg', i < step && 'done', i === step && 'on'), onClick: () => i <= step && go(i), title: s }, h('span', null, s)))),
        verified && !st.config.setupDone ? h('div', { className: 'ab-note', style: { marginTop: 12 } }, '机器人号已经连接并核对通过。', ' ', h(Btn, { small: true, onClick: useExisting }, '使用现有连接，进入面板')) : null,
        h('div', { style: { minHeight: 220, marginTop: 14 } }, body),
        h('div', { className: 'ab-flex', style: { marginTop: 16, borderTop: '1px solid var(--ab-line)', paddingTop: 12 } },
          step > 0 ? h(Btn, { kind: 'ghost', onClick: () => go(step - 1) }, '上一步') : null,
          h('div', { className: 'ab-spacer' }),
          step < WIZ_STEPS.length - 1
            ? h(Btn, { kind: 'primary', disabled: !canNext, onClick: next }, '下一步')
            : h(Btn, { kind: 'primary', onClick: async () => {
              if (!(await save({ ...draft, enabled: true, dryRun: live === 'dry' }))) return
              const r = await post('/setup/done'); toast(r.message, r.ok ? 'ok' : 'err')
              if (r.ok) { try { localStorage.removeItem('aurabot.wiz') } catch (e) {} reload(); onClose && onClose() }
            } }, '完成，让大肥鱼上线')))
    }

    // ---------------- 面板主体 ----------------
    const TAB_CONTENT = {
      overview: Overview, now: MindNow, mood: Mood, knowledge: Knowledge, persona: MindPeople, inner: MindInner, selfmind: Identity, mindsettings: MindSettings, platforms: Platforms,
      connect: Connect, group: Group, model: Model, asr: Asr, access: Access, diary: Diary,
      voice: Voice, stickers: Stickers, imagegen: ImageGen, song: Song, video: LocalApi,
      logs: Logs, backup: Backup, security: Security, browser: Browser, local: LocalApi, about: About,
      modules: Modules, market: Market,
    }
    const moduleSearchText = (m) => [m.description, ...(m.settings || []).flatMap((s) => [s.label, s.key, s.hint])].filter(Boolean).join(' ')
    const TAB_KEYS = {
      connect: ['platforms', 'snowluma', 'botQQ', 'workspaceDir'], platforms: ['platforms'], access: ['platforms', 'ownerQQ', 'ownerName', 'ownerLevel', 'freedom', 'approvalNotify', 'notice', 'approvalViaQQ', 'qqApi', 'longTasks', 'profilePerms', 'allow', 'drawAllow', 'subagentBackground', 'files', 'group.ownerTools', 'group.ownerToolsGroups'],
      group: ['group.wakeWords', 'group.mustMaxPerHour', 'group.ignoreAtOthers', 'group.crossRead', 'group.engagedMax', 'group.burstMax', 'group.burstWindowSec', 'group.cooldownSec', 'group.minRecentMessages', 'group.activeWindowSec', 'group.overrides', 'merge', 'titleFilter', 'chat'],
      model: ['model', 'chatModels'], voice: ['voice'], asr: ['voice.asr', 'voice.asrApi'], stickers: ['stickers'],
      imagegen: ['imageGen', 'local'], diary: ['diary', 'qzoneSocial'], mood: ['mind', 'memory'], song: ['song'],
      local: ['local'], video: ['local'], browser: ['browser'], security: ['security'], modules: ['modules', 'safeMode'],
    }

    function AurabotPage() {
      useStyle()
      const [st, setSt] = useState(null)
      const [err, setErr] = useState('')
      const [draft, setDraft] = useState(null)
      const [tab, setTab] = useState(() => {
        try {
          if (!localStorage.getItem('aurabot.persona-tab-v2')) {
            if (localStorage.getItem('aurabot.tab') === 'persona') localStorage.setItem('aurabot.tab', 'selfmind')
            if (localStorage.getItem('aurabot.tab') === 'character') localStorage.setItem('aurabot.tab', 'selfmind')
            localStorage.setItem('aurabot.persona-tab-v2', '1')
          }
          return localStorage.getItem('aurabot.tab') || 'overview'
        } catch { return 'overview' }
      })
      const [toastMsg, setToastMsg] = useState(null)
      const [jump, setJump] = useState(null)
      const [collapsedGroup, setCollapsedGroup] = useState(null)
      const [wizardOpen, setWizardOpen] = useState(false)
      const [saving, setSaving] = useState(false)
      const toastTimer = useRef(null)
      const dirtyRef = useRef(false)
      const saveRef = useRef(null)
      const writeLock = useRef(false)
      const stateRevision = useRef(0)
      const scrollRef = useRef(null)
      const toast = (m, kind) => {
        const text = String(m || '')
        const k = kind || (/失败|出错|没成功|不能|读不到|连不上/.test(text) ? 'err' : '')
        setToastMsg({ text, kind: k })
        clearTimeout(toastTimer.current)
        toastTimer.current = setTimeout(() => setToastMsg(null), 3200)
      }
      useEffect(() => () => clearTimeout(toastTimer.current), [])
      const toastView = (msg) => {
        const p = primitives()
        return h(p.Toast, {
          key: msg.kind + ':' + msg.text,
          text: msg.text,
          tone: msg.kind === 'ok' ? 'success' : undefined,
          holdMs: 2200,
          onDone: () => setToastMsg(null),
        })
      }
      const reload = useCallback(async () => {
        if (writeLock.current) return
        const revision = ++stateRevision.current
        const r = await get('/state')
        if (revision !== stateRevision.current) return
        if (!r || r.ok === false) { setErr(r?.message || '读不到插件状态'); return }
        setErr('')
        if (r.home) HOST.home = r.home
        setSt(r)
        if (!dirtyRef.current) setDraft(clone(r.config))
      }, [])
      useEffect(() => { reload(); const t = setInterval(reload, 5000); return () => { clearInterval(t); stateRevision.current++ } }, [reload])
      const go = (id, target) => {
        if (id === 'character') id = 'selfmind'
        setTab(id)
        setCollapsedGroup(null)
        setJump(target?.section || target?.setting ? { ...target } : null)
        if (!target?.section) scrollRef.current?.scrollTo(0, 0)
        try { localStorage.setItem('aurabot.tab', id) } catch {}
      }
      useEffect(() => {
        if (!jump?.section) return
        const root = scrollRef.current
        if (!root) return
        function reveal() {
          const section = document.getElementById('ab-section-' + jump.section)
          if (!root.contains(section)) return false
          for (let parent = section; parent && parent !== root; parent = parent.parentElement) {
            if (parent.tagName === 'DETAILS') parent.open = true
          }
          const focus = section.tagName === 'DETAILS' ? section.querySelector('summary') : section
          focus?.focus({ preventScroll: true })
          section.scrollIntoView({ block: 'start' })
          return true
        }
        if (reveal()) return
        const observer = new MutationObserver(() => { if (reveal()) observer.disconnect() })
        observer.observe(root, { childList: true, subtree: true })
        const timer = setTimeout(() => observer.disconnect(), 8000)
        return () => { observer.disconnect(); clearTimeout(timer) }
      }, [jump])
      const dirty = useMemo(() => !!(st && draft) && JSON.stringify(draft) !== JSON.stringify(st.config), [st, draft])
      dirtyRef.current = dirty
      const save = async (body = draft, immediate = false) => {
        if (writeLock.current) return false
        writeLock.current = true
        stateRevision.current++
        setSaving(true)
        try {
          const r = await post('/save', body)
          if (r.ok === false) { toast(r.message || '保存失败', 'err'); return false }
          setSt(r)
          setErr('')
          if (immediate && dirtyRef.current) {
            // 运行模式单独保存。用户正在编辑的表单继续保留。
            const applied = Object.fromEntries(Object.keys(body).map((key) => [key, r.config[key]]))
            setDraft((current) => ({ ...current, ...applied }))
          } else {
            dirtyRef.current = false
            setDraft(clone(r.config))
          }
          toast(r.message || '保存好了', 'ok')
          return true
        } finally {
          writeLock.current = false
          setSaving(false)
        }
      }
      saveRef.current = save
      useEffect(() => {
        const onKey = (e) => {
          if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's' && dirtyRef.current) {
            e.preventDefault()
            saveRef.current?.()
          }
        }
        window.addEventListener('keydown', onKey)
        return () => window.removeEventListener('keydown', onKey)
      }, [])

      if (!st || !draft) {
        return h('div', { className: 'ab-root' }, h('div', { className: 'ab-standalone' },
          err ? h(Card, { title: '暂时无法读取 AuraBot', desc: err, right: h(Btn, { onClick: reload }, '重试') }) : h(Empty, { text: '正在读取 AuraBot…' })))
      }
      const cfg = st.config
      const conn = st.onebot.state === 'connected' && !st.onebot.problem
      const connection = conn ? { cls: 'ok', text: 'QQ 已连接' }
        : { cls: cfg.enabled && st.onebot.state === 'connecting' ? 'warn' : cfg.enabled ? 'err' : '', text: cfg.enabled ? 'QQ 未就绪' : 'QQ 未连接' }
      const persona = st.personas.find((p) => p.id === cfg.persona.current)
      const displayName = st.onebot.login?.nickname || persona?.name || '大肥鱼'
      const props = { st, draft, setDraft, toast, reload, go, jump, connection, displayName, openWizard: () => setWizardOpen(true) }
      const showWizard = !cfg.setupDone || wizardOpen

      const mods = st.modules || []
      const tabs = visibleTabs(st)
      // 兼容声明了目标页面的扩展。未声明或目标当前不可用的面板在「扩展」里可达。
      const tabOf = (m) => m.tab === 'persona' || m.tab === 'character' ? 'selfmind' : m.tab
      const hasBuiltinPage = (id) => TABS.some((t) => t.id === id || t.modules?.includes(id))
      const customUi = mods.filter((m) => !hasBuiltinPage(m.id) && (m.running === 'user' && !m.builtin
        ? Boolean((m.settings || []).length || m.panel)
        : m.running === 'builtin' && Boolean(m.panel)))
      const embedded = (m) => tabs.some((t) => t.id === tabOf(m))
      const embeddedModules = Object.groupBy(customUi.filter(embedded), tabOf)
      const extTabs = customUi.filter((m) => !embedded(m))
        .map((m) => ({ id: 'ext:' + m.id, label: m.name, ext: m.id, group: 'extensions', search: moduleSearchText(m) }))
      const groups = NAV_GROUPS.map((g) => ({ ...g, pages: [...tabs, ...extTabs].filter((t) => t.group === g.id) }))
      const current = [...tabs, ...extTabs].find((t) => t.id === tab) || tabs[0]
      const group = groups.find((g) => g.id === current.group)
      const body = current.ext ? ExtPage : TAB_CONTENT[current.id]
      const tabDirty = (id) => {
        if (!dirty) return false
        const differs = (a, b) => JSON.stringify(a) !== JSON.stringify(b)
        if (id.startsWith('ext:')) return differs(draft.ext?.[id.slice(4)], cfg.ext?.[id.slice(4)])
        return (TAB_KEYS[id] || []).some((k) => differs(getPath(draft, k), getPath(cfg, k)))
          || customUi.some((m) => tabOf(m) === id && differs(draft.ext?.[m.id], cfg.ext?.[m.id]))
      }
      if (showWizard) {
        return h('div', { className: 'ab-root', ref: scrollRef }, h('div', { className: 'ab-standalone' },
          h(Wizard, { st, draft, setDraft, save, toast, reload, onClose: () => setWizardOpen(false) }),
          toastMsg ? toastView(toastMsg) : null))
      }
      return h('div', { className: 'ab-root', ref: scrollRef },
        h('div', { className: 'ab-workspace' },
          h(WorkspaceNav, {
            groups, current, go, dirtyOf: tabDirty, version: st.version, collapsedGroup,
            toggleGroup: (id) => setCollapsedGroup((old) => old === id ? null : id),
          }),
          h('div', { className: 'ab-stage' },
            h('header', { className: 'ab-topbar' },
              h('div', { className: 'ab-breadcrumb' }, navIcon(group.icon), group.label,
                current.id === 'overview' ? null : h(Fragment, null, h('span', { 'aria-hidden': true }, '/'), h('b', null, current.label))),
              h('div', { className: 'ab-top-actions' },
                h(FeatureFinder, { groups, go, st, embeddedModules }),
                h(RunControls, { cfg, busy: saving,
                  onToggle: (enabled) => save({ enabled }, true),
                  onMode: (mode) => save({ debug: mode === '调试模式', dryRun: mode !== '正式模式' }, true) }))),
            group.pages.length > 1 ? h(PageNav, { key: group.id, group, current, go, dirtyOf: tabDirty, expanded: collapsedGroup !== group.id }) : null,
            h('div', { key: current.id, className: 'ab-content', role: 'region', 'aria-label': current.label },
              current.id === 'overview' || current.id === 'now' ? null : h('h1', { className: 'ab-page-title' }, current.label),
              err ? h('div', { className: 'ab-note warn', role: 'status' }, err) : null,
              h(TabBoundary, { key: current.id, onHome: () => go('overview') }, h(body, { ...props, mod: current.ext, slot: current.id === 'video' ? 'video' : undefined })),
              (embeddedModules[current.id] || []).map((m) => h(Card, { key: m.id, fold: 'module-' + m.id, title: m.name },
                h(ExtPage, { ...props, mod: m.id, embedded: true }))),
              dirty ? h('div', { className: 'ab-savebar' }, h('span', { className: 'msg' }, '有改动还没保存'),
                h('kbd', { className: 'ab-kbd' }, isMacLike() ? '⌘ S' : 'Ctrl S'),
                h(Btn, { kind: 'ghost', disabled: saving, onClick: () => setDraft(clone(cfg)) }, '撤销'),
                h(Btn, { kind: 'primary', disabled: saving, onClick: () => save() }, '保存设置')) : null))),
        toastMsg ? toastView(toastMsg) : null)
    }

    /** 硬依赖缺失时的兜底页：不渲染业务面板，只说明升级路径。 */
    function MissingPrimitivesPage({ error }) {
      return h('div', { style: { padding: '28px', maxWidth: '720px', margin: '0 auto', lineHeight: 1.7, color: 'var(--ab-text, #1f2328)' } },
        h('h1', { style: { fontSize: '22px', margin: '0 0 12px' } }, 'AuraBot 界面需要 DSH UI primitives'),
        h('p', null, '当前 DSH 没有提供 ', h('code', null, 'client-ui-primitives'), '，所以面板不能加载。'),
        h('p', null, '请把 DeepSeek Harness 升级到 ', h('b', null, '0.2.2-rc.3 或更新版本'), '，然后重启 DSH。'),
        h('p', { style: { color: 'var(--ab-sub, #6b7280)', fontSize: '13px', wordBreak: 'break-word' } }, String(error?.message || error || '')))
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

    // 稳定的面板测试钩子：面板测试直接取组件，不再靠源码字符串注入。
    exports.__panelTest = { visibleTabs, TABS, TAB_CONTENT, Overview, WorkspaceNav, PageNav, MindSettings, MindMemory, MindPeople, MindSelf, MindNow, MindInner, MindLocalModel, DrawChatPermissions, Meter, MindInput, Row, Switch, Select, Card, Range, Btn }
    exports.apply = apply
    exports.inject = inject
    exports.AurabotPage = AurabotPage
    exports.WhaleIcon = WhaleIcon
    return module.exports
  },
})
