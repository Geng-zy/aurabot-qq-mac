    function RemoteBackup({ toast }) {
      const [s, setS] = useState(null)
      const [form, setForm] = useState(null)
      const set = (k) => (e) => setForm((old) => ({ ...old, [k]: k === 'keep' ? Math.max(1, Math.round(Number(e.target.value) || 1)) : (k === 'enabled' || k === 'autoCreate' || k === 'forceOverwrite' || k === 'webdavConfigOnly' ? e.target.checked : e.target.value) }))
      const load = (refreshForm = false) => get('/backup/remote/state').then((st) => {
        if (!st.ok) { if (refreshForm) toast(st.message || '读不到云备份设置', 'err'); return }
        setS(st)
        if (!refreshForm) return
        const v = st.remote || {}
        setForm({
          provider: v.provider === 'webdav' ? 'webdav' : 'gitee',
          enabled: !!v.enabled, owner: v.owner || '', repo: v.repo || '', token: '', branch: v.branch || 'master',
          time: v.time || '03:30', keep: v.keep || 10, autoCreate: v.autoCreate !== false, forceOverwrite: !!v.forceOverwrite,
          webdavUrl: v.webdav?.url || '', webdavUsername: v.webdav?.username || '', webdavPassword: '', webdavConfigOnly: v.webdav?.configOnly === true,
        })
      })
      useEffect(() => { load(true) }, [])
      const running = Boolean(s && s.job && s.job.running)
      useEffect(() => { if (!running) return; const t = setInterval(load, 1000); return () => clearInterval(t) }, [running])
      const call = (p, body) => fetch(API + p, { method: 'POST', headers: { 'x-aurabot-backup': '1', 'content-type': 'application/json' }, body: JSON.stringify(body || {}) }).then((r) => r.json()).catch((error) => ({ ok: false, message: '备份请求失败：' + error.message }))
      const after = (r2, refreshForm = false) => { toast(r2.ok ? (r2.message || '好了') : r2.message, r2.ok ? 'ok' : 'err'); load(r2.ok && refreshForm) }
      if (!form) return null
      const job = s && s.job
      const webdav = form.provider === 'webdav'
      const Input = (k, placeholder, type) => h('input', { className: 'ab-input', type: type || 'text', placeholder, value: form[k], onChange: set(k), style: { minWidth: 0 } })
      const Field = (label, k, placeholder, type) => h('div', { style: { flex: 1, minWidth: 0 } },
        h('div', { className: 'ab-small ab-muted', style: { marginBottom: 2 } }, label),
        Input(k, placeholder, type))
      const saveBody = () => {
        const b = { provider: form.provider, enabled: form.enabled, time: form.time, keep: form.keep }
        if (webdav) {
          b.webdav = { url: form.webdavUrl.trim(), username: form.webdavUsername.trim(), configOnly: form.webdavConfigOnly, ...(form.webdavPassword ? { password: form.webdavPassword } : {}) }
        } else {
          Object.assign(b, { owner: form.owner.trim(), repo: form.repo.trim(), branch: form.branch.trim() || 'master', autoCreate: form.autoCreate, forceOverwrite: form.forceOverwrite })
          if (form.token) b.token = form.token
        }
        return b
      }
      return h(Card, { fold: 'backup-cloud', title: '云备份（Gitee / WebDAV）', desc: '每天到点自动打包一份备份，推到你的私有仓库或 WebDAV，换电脑或坏盘时也能找回来。' },
        h(Seg, {
          value: form.provider,
          onChange: (v) => setForm({ ...form, provider: v }),
          options: [{ value: 'gitee', label: 'Gitee 私有仓库' }, { value: 'webdav', label: 'WebDAV' }],
        }),
        webdav
          ? h('div', { className: 'ab-note warn', style: { margin: '10px 0' } }, '⚠️ 备份里有全部聊天记录、记忆和账号凭证。WebDAV 请用自己可控的私有网盘，并尽量走 HTTPS；插件会自动创建 aurabot-backups 文件夹，只把 zip 上传到你的服务器，不会传给第三方。')
          : h('div', { className: 'ab-note warn', style: { margin: '10px 0' } }, '⚠️ 仓库必须是「私有」的！备份里有你全部的聊天记录、记忆和账号凭证，推到公开仓库等于把它们挂到网上。推送前会先向 Gitee 核实仓库确实是私有的，公开仓库一律拒绝推。'),
        h('div', { className: 'ab-flex', style: { alignItems: 'center' } },
          h('label', { className: 'ab-small', style: { display: 'flex', gap: 6, alignItems: 'center', cursor: 'pointer' } }, h('input', { type: 'checkbox', checked: form.enabled, onChange: set('enabled') }), '每天自动备份并推送'),
          form.enabled ? h('span', { className: 'ab-small ab-muted' }, '下次：' + (s && s.nextAt ? String(s.nextAt).slice(0, 16).replace('T', ' ') : '到点就跑')) : null),
        webdav
          ? h('div', null,
            h('div', { className: 'ab-flex', style: { marginTop: 10 } },
              Field('服务器地址', 'webdavUrl', 'https://dav.jianguoyun.com/dav/')),
            h('div', { className: 'ab-flex', style: { marginTop: 8 } },
              Field('用户名', 'webdavUsername', '坚果云账号邮箱 / WebDAV 用户名'),
              Field('密码/应用授权码', 'webdavPassword', s && s.remote && s.remote.webdav && s.remote.webdav.hasPassword ? '已保存，留空就不改' : '坚果云：账户信息 → 安全选项 → 添加应用密码', 'password')),
            h('div', { className: 'ab-small ab-muted', style: { marginTop: 6 } }, '会自动在服务器根目录创建 aurabot-backups 文件夹；填到已有文件夹也可以。'),
            h('label', { className: 'ab-small', style: { display: 'flex', gap: 6, alignItems: 'center', cursor: 'pointer', marginTop: 10 } },
              h('input', { type: 'checkbox', checked: form.webdavConfigOnly, onChange: set('webdavConfigOnly') }), '仅备份配置文件（不含画作、表情、截图等媒体）'),
            h('div', { className: 'ab-small ab-muted', style: { marginTop: 4, lineHeight: 1.7 } },
              '勾选后打包 config.json、人格、心智核心（她的记忆、情绪、性格、关系）、日记、模块配置、聊天流水和当前工作区 DSH 会话；不包含画作 imagegen、表情 stickers、旧版截图、外部模块数据、语音缓存、模块库代码、日志和缓存。上传的 zip 会明显更小；远端保留份数对完整备份和仅配置备份分别计算。'))
          : h('div', null,
            h('div', { className: 'ab-flex', style: { marginTop: 10 } },
              Field('Gitee 用户名', 'owner', '如 gitee.com/小鱼 里的「小鱼」'),
              Field('仓库名（私有）', 'repo', '如 aurabot-backup，没有会自动建'),
              Field('分支（一般不用改）', 'branch', 'master')),
            h('div', { className: 'ab-flex', style: { marginTop: 8 } },
              Field('Gitee 私人令牌', 'token', s && s.remote && s.remote.hasToken ? '已保存，留空就不改' : '下面第 2 步生成的那串', 'password')),
            h('div', { className: 'ab-flex', style: { marginTop: 8, alignItems: 'center', flexWrap: 'wrap' } },
              h('label', { className: 'ab-small', style: { display: 'flex', gap: 6, alignItems: 'center', cursor: 'pointer' } }, h('input', { type: 'checkbox', checked: form.autoCreate, onChange: set('autoCreate') }), '仓库不存在时自动建（建的就是私有，推荐开）'),
              h('label', { className: 'ab-small', style: { display: 'flex', gap: 6, alignItems: 'center', cursor: 'pointer' } }, h('input', { type: 'checkbox', checked: form.forceOverwrite, onChange: set('forceOverwrite') }), '允许覆盖已有内容的仓库'))),
        h('div', { className: 'ab-flex', style: { marginTop: 8 } },
          Field('每天几点备份', 'time', '如 03:30'),
          Field('远端留几份', 'keep', '如 10')),
        h('div', { className: 'ab-flex', style: { marginTop: 10, alignItems: 'center' } },
          h('span', { className: 'ab-flex' },
            h(Btn, { small: true, kind: 'primary', disabled: running, onClick: async () => after(await call('/backup/remote/config', saveBody()), true) }, '保存设置'),
            h(Btn, { small: true, disabled: running, onClick: async () => { if (!confirm('现在就把最新备份推到 ' + (webdav ? 'WebDAV' : 'Gitee') + '？（不会重新打包，推 backups 里最新的一份）')) return; after(await call('/backup/push')) } }, running ? '推送中…' : '立即推送'))),
        job && job.error ? h('div', { className: 'ab-note err', style: { marginTop: 10 } }, '推送失败：' + job.error) : null,
        job && job.result ? h('div', { className: 'ab-small ab-muted', style: { marginTop: 10 } }, '上次推送：' + job.result.message) : null,
        h('details', { style: { marginTop: 10 } },
          h('summary', { className: 'ab-small', style: { cursor: 'pointer' } }, webdav ? '📖 WebDAV 怎么填（点这里收起）' : '📖 第一次用？跟着下面 4 步做（点这里收起）'),
          webdav
            ? h('div', { className: 'ab-small ab-muted', style: { marginTop: 8, lineHeight: 1.8 } },
              h('div', null, h('b', null, '第 1 步 · 服务器地址：'), '坚果云填 https://dav.jianguoyun.com/dav/（带 /dav/，只填域名根目录会 HTTP 410）；其他网盘填 WebDAV 根地址。'),
              h('div', null, h('b', null, '第 2 步 · 用户名和密码/应用授权码：'), '坚果云用户名就是账号邮箱；密码不是登录密码，去网页端「账户信息 → 安全选项 → 添加应用密码」生成一个，填到第二栏。'),
              h('div', null, h('b', null, '第 3 步 · 保存并试推：'), '点「保存设置」，再点「立即推送」。成功后每天按设置时间自动上传，远端按「留几份」清理旧 zip。'),
              h('div', { style: { marginTop: 6 } }, '插件会自动创建 aurabot-backups 文件夹；如果服务器不允许根目录建目录，可以先手动建好再把地址填到该文件夹。'))
            : h('div', { className: 'ab-small ab-muted', style: { marginTop: 8, lineHeight: 1.8 } },
              h('div', null, h('b', null, '第 1 步 · 注册 Gitee：'), '打开 ', h('a', { href: 'https://gitee.com/signup', target: '_blank', rel: 'noreferrer' }, 'gitee.com'), ' 注册一个账号（手机号或邮箱都行，免费的）。'),
              h('div', null, h('b', null, '第 2 步 · 生成令牌：'), '登录后点右上角头像 →「设置」→ 左侧「安全设置」→「私人令牌」→「+ 生成新令牌」，勾选 ', h('b', null, 'projects'), ' 权限后提交，把显示出来的那串字符复制粘贴到上面的「Gitee 私人令牌」里（只显示一次，丢了就重新生成一个）。'),
              h('div', null, h('b', null, '第 3 步 · 准备 git：'), 'Mac 上 git 跟着苹果的「命令行开发者工具」一起装：打开「终端」输入 ', h('code', null, 'git --version'), ' 回车，没装的话系统会弹窗问要不要安装，点「安装」等它装完，然后重启 DSH。能显示版本号就说明装过了，跳过这步。'),
              h('div', null, h('b', null, '第 4 步 · 填上面的表格：'), '「Gitee 用户名」填你个人主页地址 gitee.com/ 后面那串；「仓库名」自己起一个，比如 aurabot-backup；「私人令牌」粘第 2 步的；勾上「每天自动备份并推送」，点「保存设置」。仓库让插件自动建就行（建出来就是私有的）。如果自己在 Gitee 网页上建，右上角「+」→ 新建仓库时务必选 ', h('b', null, '「私有」'), '，不要勾「设置初始化 README」。'),
              h('div', { style: { marginTop: 6 } }, '弄完点一次「立即推送」试试，提示「已推送」就成功了，之后每天都会自动备份。备份超过 95MB 会自动分成若干卷推送（文件名带 .part01、.part02…）；恢复时把各卷按顺序合并回一个 zip 再导入——Windows 命令示例：copy /b aurabot-backup-xxx.zip.part01+aurabot-backup-xxx.zip.part02+… 完整的.zip')),
        h('div', { className: 'ab-small ab-muted', style: { marginTop: 10 } }, webdav ? 'WebDAV 密码只存在本机配置里，不会展示；推送由插件直接上传，不经过第三方。' : '令牌只存在本机配置里，不会上传；推送走电脑上装的 git。有报错看上面的红字，一般都是令牌权限没勾对或 git 没装。')))
    }

    /** 备份：打包数据目录，换电脑时导入，重启 DSH 后换上。 */

    /** 浏览器：需要浏览器的功能（逛网页 / 平台验证）走哪个浏览器。 */
