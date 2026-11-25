    function MindInput({ value, label, number, min, max, step, unit, onCommit, disabled }) {
      const [v, setV] = useState(value ?? '')
      useEffect(() => { setV(value ?? '') }, [value])
      const commit = () => {
        if (String(v) === String(value ?? '')) return
        if (number) onCommit(v === '' ? null : Number(v))
        else onCommit(String(v))
      }
      return h('span', { className: cx('ab-flex', number && 'ab-number-ctl'), style: { gap: 6 } },
        h('input', { className: 'ab-input', type: number ? 'number' : 'text', 'aria-label': label, disabled, value: v, min, max, step, style: { width: number ? 120 : 280 }, onChange: (e) => setV(e.target.value), onBlur: commit, onKeyDown: (e) => { if (e.key === 'Enter') e.target.blur() } }),
        unit ? h('span', { className: 'ab-muted' }, unit) : null)
    }

    /** 合并后的人格与自我：人格卡文件编辑 + 她的自我状态，一个入口两个视图。 */
