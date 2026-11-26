    /**
     * 把接口返回直接提示给管理员：成功绿色、失败红色，文案取 message。
     * 原来 18 处写的是 notify(r)，改造时容易漏掉一半。
     */
    // toast 是页面组件拿到的 prop（在 aurabotPage.js 里创建），所以显式收进来
    function notify(toast, result, fallback = '好了') {
      const ok = Boolean(result && result.ok)
      toast((result && result.message) || (ok ? fallback : '没成功'), ok ? 'ok' : 'err')
      return ok
    }

    /**
     * 密钥输入框的占位文案：服务端不会回显密钥，只回一个 `<path>Set` 布尔。
     * 已保存过 → 提示「不改就留空」；没保存过 → 用调用方给的示例。
     */
    function secretPlaceholder(saved, { savedText = '已保存（不改就留空）', fallback = '没有就留空' } = {}) {
      return saved ? savedText : fallback
    }

    function useField(draft, setDraft) {
      return {
        sw: (path, extra) => h(Switch, { on: !!getPath(draft, path), onChange: (v) => setDraft(setPath(draft, path, v)), ...(extra || {}) }),
        text: (path, props) => h('input', { className: cx('ab-input', props && props.size), value: getPath(draft, path) ?? '', placeholder: props && props.placeholder, type: (props && props.type) || 'text', onChange: (e) => setDraft(setPath(draft, path, e.target.value)) }),
        // 密钥框：type 固定 password，占位文案按 `<path>Set` 自动切换（密钥不回显，留空 = 沿用旧值）
        secret: (path, props = {}) => h('input', {
          className: cx('ab-input', props.size),
          type: 'password',
          value: getPath(draft, path) ?? '',
          placeholder: secretPlaceholder(getPath(draft, path + 'Set'), props),
          onChange: (e) => setDraft(setPath(draft, path, e.target.value)),
        }),
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
