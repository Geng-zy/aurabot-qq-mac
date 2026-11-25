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
