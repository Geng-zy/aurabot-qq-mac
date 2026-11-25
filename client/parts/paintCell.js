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
