    function useStyle() {
      useEffect(() => {
        // 交给 DSH 的样式归属：热更新时旧 <style> 会被宿主清掉，新模块重新注入。
        // 老版本留下的无主 style 先移除，否则 getElementById 会一直复用它，CSS 永远不刷新。
        const old = document.getElementById('aurabot-style')
        if (old) {
          if (old.dataset && old.dataset.plugin === 'dsh-aurabot-qq') return
          old.remove()
        }
        const el = document.createElement('style')
        el.id = 'aurabot-style'
        el.dataset.plugin = 'dsh-aurabot-qq'
        el.textContent = CSS
        document.head.appendChild(el)
      }, [])
    }

    // ---------------- 图标 ----------------
