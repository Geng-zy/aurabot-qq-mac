    /*
     * 语义 token —— 面板里唯一允许写颜色字面量的地方。
     *
     * 三层：宿主 token（字体/滚动条）→ 这里的语义 token → 组件类。
     * 深色只覆盖这一组值，组件里不出现十六进制颜色（test/client-tokens.test.js 会拦）。
     * 命名按用途，不按颜色：surface/card/text/dim/line/accent/ok/warn/err/focus/hover/rail。
     */
    const AB_TOKENS = `
:root,.ab-root{
  color-scheme:light;
  --ab-bg:#f2f3ee;--ab-card:#fffefa;--ab-card-2:#eef2eb;--ab-text:#212c27;--ab-sub:#4e6057;--ab-dim:#596b60;
  --ab-deep:#205b4a;--ab-sea:#2e7763;--ab-sky:#588b78;--ab-foam:#e9f2eb;--ab-foam-2:#dbece1;
  --ab-line:#e0e6dd;--ab-line-2:#c9d6cc;--ab-hover:#edf3ed;--ab-ok:#277a5c;--ab-warn:#99651e;--ab-err:#af4440;
  --ab-rail:#e8eee6;--ab-rail-label:#465b50;--ab-rail-active:#d8e8df;
  --ab-rail-ink:#243e34;--ab-rail-border:#cddbd1;--ab-rail-mark:#306a57;--ab-rail-mark-bg:#dce9df;--ab-rail-accent:#2e7763;
  --ab-shadow:0 1px 2px #18382a06,0 8px 26px #18382a06;--ab-radius:18px;
  --ab-on-accent:#ffffff;--ab-on-dark:#f9fcf2;--ab-unsaved:#e0a75b;--ab-ink-shadow:#09181033;--ab-ink-shadow-2:#123a2f24;
  --ab-warn-bg:#b7870018;--ab-warn-line:#b7870040;--ab-warn-text:#9a6700;
  --ab-cover-from:#123b35e8;--ab-cover-mid:#10382f79;--ab-cover-to:#123c2c04;--ab-cover-base:#17493f;
  --ab-cover-text:#edf6eb;--ab-cover-body:#dfede5;--ab-cover-strong:#f7fcf0;--ab-cover-border:#e4f1dca3;
  --ab-cover-link-bg:#eaf3e9;--ab-cover-link-ink:#1c3d32;--ab-cover-link-hover:#fffdf1;
  --ab-cover-ring:#fff4d8b0;--ab-cover-ring-2:#f6f3db34;--ab-cover-halo:#f6f3db22;--ab-cover-portrait-bg:#f5f1df;
  --ab-cover-ok:#a5edbb;--ab-cover-err:#ffa79e;--ab-cover-warn:#f4cd96;--ab-cover-dim:#c7d0c6;
  --ab-psec-1:#4f9a8c;--ab-psec-2:#8a7bc0;--ab-psec-3:#c08a4a;--ab-psec-4:#5f8fc7;--ab-psec-5:#c47a90;
  --ab-psec-6:#6f9f68;--ab-psec-7:#5c6fae;--ab-psec-8:#b9775a;--ab-psec-9:#8d9450;--ab-psec-10:#a173b5;
  --ab-quick:140ms;--ab-reveal:220ms;--ab-ease:cubic-bezier(.2,.75,.25,1)
}
body[data-ds-dark-theme] .ab-root{
  color-scheme:dark;
  --ab-bg:#141b19;--ab-card:#1c2522;--ab-card-2:#242f2a;--ab-text:#edf2ec;--ab-sub:#b1c2b8;--ab-dim:#a0b4a9;
  --ab-deep:#afdec8;--ab-sea:#68b89e;--ab-sky:#82c6ae;--ab-foam:#263a32;--ab-foam-2:#304940;
  --ab-line:#303b35;--ab-line-2:#46564e;--ab-hover:#2a3630;--ab-ok:#91d9b2;--ab-warn:#ecc289;--ab-err:#f3a09b;
  --ab-rail:#191f1d;--ab-rail-label:#aebfb5;--ab-rail-active:#2a4037;
  --ab-rail-ink:#edf4ed;--ab-rail-border:#334039;--ab-rail-mark:#b6e5ce;--ab-rail-mark-bg:#29463b;--ab-rail-accent:#85c8ac;
  --ab-shadow:0 10px 28px #00000013;
  --ab-on-accent:#0c1512;--ab-on-dark:#0f1a16;--ab-unsaved:#e8b878;--ab-ink-shadow:#00000055;--ab-ink-shadow-2:#0000003d;
  --ab-warn-bg:#ecc2891f;--ab-warn-line:#ecc2894d;--ab-warn-text:#ecc289;
  --ab-cover-from:#0d211ceb;--ab-cover-mid:#0b1b1780;--ab-cover-to:#0c1f1805;--ab-cover-base:#0f2a24;
  --ab-cover-text:#dceae2;--ab-cover-body:#c8d9d0;--ab-cover-strong:#eef6ef;--ab-cover-border:#e4f1dc3d;
  --ab-cover-link-bg:#1d3229;--ab-cover-link-ink:#dff0e4;--ab-cover-link-hover:#264134;
  --ab-cover-ring:#fff4d83d;--ab-cover-ring-2:#f6f3db1a;--ab-cover-halo:#f6f3db14;--ab-cover-portrait-bg:#16241f;
  --ab-cover-ok:#8fd8a8;--ab-cover-err:#f3a09b;--ab-cover-warn:#ecc289;--ab-cover-dim:#7e8f86
}
`

    /* 浏览器自身那几块也要跟着配色走：选区、插入符、滚动条、数字等宽。 */
    const AB_BROWSER_UI = `
.ab-root::selection,.ab-root *::selection{background:var(--ab-foam-2);color:var(--ab-text)}
.ab-root{caret-color:var(--ab-sea);scrollbar-width:thin;scrollbar-color:var(--ab-line-2) transparent}
.ab-root::-webkit-scrollbar{width:10px;height:10px}
.ab-root::-webkit-scrollbar-thumb{background:var(--ab-line-2);border-radius:8px;border:2px solid transparent;background-clip:content-box}
.ab-root::-webkit-scrollbar-thumb:hover{background:var(--ab-dim);background-clip:content-box}
.ab-root::-webkit-scrollbar-track{background:transparent}
.ab-num{font-variant-numeric:tabular-nums}
@media (prefers-reduced-motion:reduce){
  .ab-root *,.ab-root *::before,.ab-root *::after{animation-duration:1ms !important;animation-iteration-count:1 !important;transition-duration:1ms !important}
}
`
