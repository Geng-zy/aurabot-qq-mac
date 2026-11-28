    function ModOff({ name, go }) {
      return h(Card, { title: name }, h(Empty, {
        icon: '🧩', title: '「' + name + '」模块关着',
        text: '这一页的内容由「' + name + '」模块提供；打开它以后设置会出现在这里，聊天里对应的能力也一起恢复。',
        action: go ? '去模块管理' : undefined,
        onAction: go ? () => go('modules') : undefined,
      }))
    }
    /** 一个标签页出错时只坏这一页：显示原因和「回到概览」，不会整个面板白屏（也不会因为记住了这一页而一直白）。 */
    class TabBoundary extends React.Component {
      constructor(p) { super(p); this.state = { error: null } }
      static getDerivedStateFromError(error) { return { error } }
      componentDidCatch(error) { try { localStorage.setItem('aurabot.tab', 'overview') } catch (e) {} }
      render() {
        if (!this.state.error) return this.props.children
        return h(Card, { title: '这一页出错了' },
          h('div', { className: 'ab-note err' }, String((this.state.error && this.state.error.message) || this.state.error)),
          h('div', { className: 'ab-small ab-muted', style: { margin: '8px 0' } }, '别的页面不受影响。把这段报错截图发给作者就行。'),
          h('div', { className: 'ab-flex' },
            h(Btn, { small: true, kind: 'primary', onClick: () => this.props.onHome && this.props.onHome() }, '回到概览'),
            h(Btn, { small: true, kind: 'ghost', onClick: () => this.setState({ error: null }) }, '再试一次')))
      }
    }
    const copy = (text, toast, msg) => {
      Promise.resolve().then(() => clipboard(text)).then(() => { if (msg) toast(msg, 'ok') }, () => toast('复制失败，手动选中复制吧', 'err'))
    }

    /** 版本更新说明：插件更新交给 DSH 插件管理器，这里只在版本变化后显示一次 CHANGELOG。 */
