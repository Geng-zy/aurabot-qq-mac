    function MissingPrimitivesPage({ error }) {
      return h('div', { style: { padding: '28px', maxWidth: '720px', margin: '0 auto', lineHeight: 1.7, color: 'var(--ab-text, #1f2328)' } },
        h('h1', { style: { fontSize: '22px', margin: '0 0 12px' } }, 'AuraBot 界面需要 DSH UI primitives'),
        h('p', null, '当前 DSH 没有提供 ', h('code', null, 'client-ui-primitives'), '，所以面板不能加载。'),
        h('p', null, '请把 DeepSeek Harness 升级到 ', h('b', null, '0.2.2-rc.3 或更新版本'), '，然后重启 DSH。'),
        h('p', { style: { color: 'var(--ab-sub, #6b7280)', fontSize: '13px', wordBreak: 'break-word' } }, String(error?.message || error || '')))
    }
