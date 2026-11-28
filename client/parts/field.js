    /**
     * Field：统一文本输入（input / textarea）。
     * 无障碍要点（现代 Web 指南）：
     *  - 错误只在用户交互之后出现（`:user-invalid`），为此组件内同步 `aria-invalid`；
     *  - 错误文案的 id 只在「正在显示」时进 `aria-describedby`（隐藏文本也会被读出来）；
     *  - 错误本身不是 live region，用页面上唯一的 polite 播报器（见 announceFieldError）。
     */
    let fieldSeq = 0
    const fieldAnnouncer = { el: null, timer: null }
    function announceFieldError(text) {
      const doc = typeof document !== 'undefined' ? document : null
      if (!doc) return
      if (!fieldAnnouncer.el) {
        const box = doc.createElement('div')
        box.setAttribute('aria-live', 'polite')
        box.className = 'ab-sr'
        doc.body.append(box)
        fieldAnnouncer.el = box
      }
      clearTimeout(fieldAnnouncer.timer)
      fieldAnnouncer.el.textContent = ''
      // 等读屏把焦点所在的控件读完再播
      fieldAnnouncer.timer = setTimeout(() => { fieldAnnouncer.el.textContent = text }, 500)
    }

    function Field({ label, hint, error, textarea, rows = 4, value, onChange, placeholder, disabled, readOnly, secret, id, inputMode, autoComplete, onBlur }) {
      const auto = useId()
      const fid = id || 'ab-field-' + (++fieldSeq) + '-' + String(auto).replace(/[^a-zA-Z0-9_-]/g, '')
      const errId = fid + '-err'
      const hintId = fid + '-hint'
      const ref = useRef(null)
      const [shown, setShown] = useState(false)
      // 用户交互之后才把错误显示出来（和 CSS 的 :user-invalid 同一时刻）
      useEffect(() => {
        const el = ref.current
        if (!el) return
        const sync = (announce) => {
          const invalid = el.matches?.(':user-invalid') || Boolean(error)
          setShown(invalid)
          const ids = [hint ? hintId : '', invalid ? errId : ''].filter(Boolean).join(' ')
          if (ids) el.setAttribute('aria-describedby', ids)
          else el.removeAttribute('aria-describedby')
          if (invalid) {
            el.setAttribute('aria-invalid', 'true')
            if (announce) announceFieldError((label ? label + '：' : '') + (error || '这项没填对'))
          } else {
            el.setAttribute('aria-invalid', 'false')
          }
        }
        const onLeave = () => sync(true)
        el.addEventListener('blur', onLeave, true)
        el.addEventListener('change', onLeave, true)
        el.addEventListener('input', () => sync(false))
        sync(false)
        return () => {
          el.removeEventListener('blur', onLeave, true)
          el.removeEventListener('change', onLeave, true)
        }
      }, [error, hint, label])
      const common = {
        id: fid, ref, value: value ?? '', placeholder, disabled, readOnly,
        'aria-invalid': shown ? 'true' : 'false',
        'data-error': errId,
        inputMode, autoComplete,
        onBlur,
        onChange: (e) => onChange && onChange(e.target.value),
      }
      return h('div', { className: cx('ab-field', shown && 'bad') },
        label ? h('label', { htmlFor: fid }, label) : null,
        textarea ? h('textarea', { ...common, rows, className: 'ab-textarea' }) : h('input', { ...common, type: secret ? 'password' : 'text', className: 'ab-input' }),
        hint ? h('small', { id: hintId, className: 'ab-field-hint' }, hint) : null,
        h('small', { id: errId, className: 'ab-field-error' }, error || ''))
    }

    /**
     * SaveBar：底部保存条三态 —— 有改动 / 保存中 / 已保存。
     * 只做「提示 + 动作」，不抢焦点：用户可能正在输入。
     */
    function SaveBar({ state = 'dirty', onSave, onReset, saving, isMac, note }) {
      if (state === 'saved') {
        return h('div', { className: 'ab-savebar saved', role: 'status' }, h('span', { className: 'msg' }, note || '已保存'))
      }
      return h('div', { className: 'ab-savebar', role: 'status' },
        h('span', { className: 'msg' }, note || '有改动还没保存'),
        h('kbd', { className: 'ab-kbd' }, isMac ? '⌘ S' : 'Ctrl S'),
        h(Btn, { kind: 'ghost', disabled: saving, onClick: onReset }, '撤销'),
        h(Btn, { kind: 'primary', disabled: saving, onClick: onSave }, saving ? '保存中…' : '保存设置'))
    }
