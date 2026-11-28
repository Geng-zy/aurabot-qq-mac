    /**
     * 页内分区锚点条：把 FIND_SECTIONS 里这一页的分区摆成一行可点的胶囊。
     * 折叠分区（<details>）点一下就展开并滚到视野；用 aria-current="location" 标出当前分区。
     * 只有一两个分区、或这一页没登记分区时不渲染 —— 免得每页都多一条没用的横条。
     */
    function SectionNav({ pageId, go, sections, activeId }) {
      const list = (sections || []).filter((s) => s && s[0])
      if (list.length < 2) return null
      return h('nav', { className: 'ab-section-nav', 'aria-label': '本页分区' },
        h('span', { className: 'ab-section-nav-label' }, '分区'),
        list.map(([id, label]) => h('button', {
          key: id, type: 'button',
          'aria-current': activeId === id ? 'location' : undefined,
          onClick: () => go(pageId, { section: id }),
        }, label)))
    }
