    /**
     * Empty：教学式空态 —— 图标 + 标题 + 一句解释 + 一个主行动。
     * 旧调用 `h(Empty, { text: '加载中…' })` 仍然能用（只传 text 时退化成一行）。
     */
    function Empty({ icon, title, text, action, onAction, secondary, onSecondary }) {
      const heading = title || text || ''
      const detail = title ? text : ''
      return h('div', { className: 'ab-empty', role: 'status' },
        h('div', { className: 'big', 'aria-hidden': 'true' }, icon || '🐋'),
        h('b', { className: 'ab-empty-title' }, heading),
        detail ? h('p', { className: 'ab-empty-desc' }, detail) : null,
        action || secondary
          ? h('div', { className: 'ab-empty-actions' },
            action ? h(Btn, { kind: 'primary', small: true, onClick: onAction }, action) : null,
            secondary ? h(Btn, { kind: 'ghost', small: true, onClick: onSecondary }, secondary) : null)
          : null)
    }

    /** 骨架屏：卡片 / 行 / 头像三种；`label` 给读屏用（视觉上不可见）。 */
    function Skeleton({ kind = 'row', rows = 3, label = '正在载入' }) {
      if (kind === 'card') {
        return h('div', { className: 'ab-skel-card', role: 'status', 'aria-busy': 'true', 'aria-live': 'polite' },
          h('span', { className: 'ab-sr' }, label),
          h('div', { className: 'ab-skel ab-skel-title' }),
          h('div', { className: 'ab-skel ab-skel-line' }),
          h('div', { className: 'ab-skel ab-skel-line short' }))
      }
      if (kind === 'avatar') return h('div', { className: 'ab-skel ab-skel-avatar', role: 'status', 'aria-busy': 'true' }, h('span', { className: 'ab-sr' }, label))
      return h('div', { className: 'ab-skel-rows', role: 'status', 'aria-busy': 'true', 'aria-live': 'polite' },
        h('span', { className: 'ab-sr' }, label),
        Array.from({ length: rows }, (_, i) => h('div', { key: i, className: 'ab-skel ab-skel-line' })))
    }

    /**
     * ErrorBlock：就地错误 —— 说明哪里错了、给一个重试、技术细节收进「复制诊断」。
     * 不用 Toast 替代：Toast 只报动作结果，数据取不到要留在页面上。
     */
    function ErrorBlock({ title = '这一块没读出来', message = '', hint = '', onRetry, detail = '' }) {
      const [copied, setCopied] = useState(false)
      const copy = async () => {
        try {
          await clipboard([title, message, detail].filter(Boolean).join('\n'))
          setCopied(true)
          setTimeout(() => setCopied(false), 1600)
        } catch (error) { setCopied(false) }
      }
      return h('div', { className: 'ab-errorblock', role: 'alert' },
        h('b', null, title),
        message ? h('p', null, message) : null,
        hint ? h('small', null, hint) : null,
        h('div', { className: 'ab-errorblock-actions' },
          onRetry ? h(Btn, { kind: 'primary', small: true, onClick: onRetry }, '重试') : null,
          (message || detail) ? h(Btn, { kind: 'ghost', small: true, onClick: copy }, copied ? '已复制' : '复制诊断') : null))
    }
