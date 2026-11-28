    function ListArea({ value, onChange, placeholder, numbers }) {
      const parse = (t) => t.split(numbers ? /[\n,，;；\s]+/ : /[\n,，;；]+/).map((s) => s.trim()).filter(Boolean)
      const [text, setText] = useState(value.join('\n'))
      // 号码名单：非纯数字的项当场标出来，并且不写进草稿（免得保存了也连不上）
      const invalidOf = (items) => (numbers ? items.filter((x) => !/^\d{4,15}$/.test(x)) : [])
      const bad = invalidOf(parse(text))
      const external = value.join('\n')
      const lastExternal = useRef(external)
      useEffect(() => {
        // 外面改了（保存、撤销、重新载入）才覆盖；框里还有非法项时不覆盖，免得错误跟着消失
        if (external === lastExternal.current) return
        lastExternal.current = external
        if (!invalidOf(parse(text)).length) setText(external)
      }, [external])
      const commit = (next, { blur = false } = {}) => {
        const items = parse(next)
        const wrong = invalidOf(items)
        onChange(items.filter((x) => !wrong.includes(x)))
        if (blur && !wrong.length) setText(items.join('\n'))
      }
      return h('div', { className: 'ab-listarea' },
        h('textarea', {
          className: cx('ab-textarea', bad.length && 'bad'), style: { minHeight: 60 }, placeholder, value: text,
          'aria-invalid': bad.length ? 'true' : 'false',
          onChange: (e) => { setText(e.target.value); commit(e.target.value) },
          onBlur: () => commit(text, { blur: true }),
        }),
        bad.length ? h('small', { className: 'ab-row-err', role: 'alert' }, '这些不是有效号码，已跳过：' + bad.join('、')) : null)
    }

    // 绑定到草稿配置的控件
