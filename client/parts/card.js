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
