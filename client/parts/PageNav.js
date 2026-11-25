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
