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
