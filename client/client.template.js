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
