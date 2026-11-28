    function MindInput({ value, label, number, min, max, step, unit, onCommit, disabled, invalid }) {
      const [v, setV] = useState(value ?? '')
      useEffect(() => { setV(value ?? '') }, [value])
      const commit = () => {
        if (String(v) === String(value ?? '')) return
        if (number) {
          const n = v === '' ? null : Number(v)
          if (n !== null && !Number.isFinite(n)) return // 非数字：留在输入框里，由调用方标错
          onCommit(n)
        } else onCommit(String(v))
      }
      return h('span', { className: cx('ab-flex', number && 'ab-number-ctl'), style: { gap: 6 } },
        h('input', { className: cx('ab-input', invalid && 'bad'), type: number ? 'number' : 'text', 'aria-label': label, 'aria-invalid': invalid ? 'true' : 'false', disabled, value: v, min, max, step, style: { width: number ? 120 : 280 }, onChange: (e) => setV(e.target.value), onBlur: commit, onKeyDown: (e) => { if (e.key === 'Enter') e.target.blur() } }),
        unit ? h('span', { className: 'ab-muted' }, unit) : null)
    }

    /** 合并后的人格与自我：人格卡文件编辑 + 她的自我状态，一个入口两个视图。 */
