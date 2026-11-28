    function apply(ctx) {
      const slots = ctx.get('slots')
      if (slots === undefined) return
      try {
        primitives()
      } catch (error) {
        slots.inject('main', () => slots.register({ name: 'main', key: PANEL_ID }, () => h(MissingPrimitivesPage, { error })))
        slots.inject('sidebar.panellist', () => slots.register({ name: 'sidebar.panellist', id: PANEL_ID, order: 20, label: () => 'Aurabot' }, WhaleIcon))
        return
      }
      // 写法同 DSH 自带的「自动化任务」（order 10）和「插件」（order 0）：排在它们后面
      slots.inject('main', () => slots.register({ name: 'main', key: PANEL_ID }, AurabotPage))
      slots.inject('sidebar.panellist', () => slots.register({ name: 'sidebar.panellist', id: PANEL_ID, order: 20, label: () => 'Aurabot' }, WhaleIcon))
      // 动作结果挂到窗口层：切页、关面板都不会把提示留在半路上。
      try {
        slots.inject('shell.overlay', () => slots.register({ name: 'shell.overlay', id: PANEL_ID + '-toasts' }, Toaster))
      } catch (error) {
        // 宿主没有这个座位时用面板自己的 Toast（toastBus 里 hosted() 仍为 false）
      }
    }
