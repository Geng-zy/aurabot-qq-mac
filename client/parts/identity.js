    function Identity({ st, toast, reload, jump }) {
      const [mode, setMode] = useState(() => { try { return localStorage.getItem('aurabot.identity.mode') || 'self' } catch { return 'self' } })
      useEffect(() => { if (jump?.section === 'self-persona') setMode('persona') }, [jump])
      const pick = (v) => { setMode(v); try { localStorage.setItem('aurabot.identity.mode', v) } catch {} }
      return h('div', { className: 'ab-grid' },
        h(Card, { title: '人格与自我', desc: '人格卡是叙述底稿；名字、小名、自我描述和故事是她的自我记录。改名字/小名会双向同步。' },
          h(Seg, { value: mode, onChange: pick, options: [{ value: 'self', label: '自我与性格' }, { value: 'persona', label: '人格卡与头像' }] })),
        mode === 'persona' ? h(Persona, { st, toast, reload }) : h(MindSelf, { toast }))
    }

    /** 心智设置：按参数表生成。每项写着默认值、依据和改了有什么影响，可以单独恢复默认。 */
