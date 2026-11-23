// 不指定构图时保留原 size；只映射明确选择的构图，不替接口静默改尺寸。
export const SHAPE_SIZE = {
  square: '1024x1024',
  portrait: '1024x1536',
  landscape: '1536x1024',
  wide: '1536x864',
}

// 面板和工具都提供的常用尺寸；2K/4K 是本次需求新增档位。
// 自定义接口仍可使用任意 WxH 的 imageGen.size；这里只约束工具显式传参。
export const SIZE_OPTIONS = ['512x512', '768x1024', '1024x768', '1024x1024', '1024x1536', '1536x1024', '1536x864', '2048x2048', '4096x4096']

export function normalizeRequestedSize(value) {
  const s = String(value || '').trim().toLowerCase().replace(/[×*]/g, 'x').replace(/\s+/g, '')
  const m = /^(\d{3,5})x(\d{3,5})$/.exec(s)
  return m ? `${m[1]}x${m[2]}` : ''
}

export function pickShape(shape, config) {
  if (Object.hasOwn(SHAPE_SIZE, shape)) return shape
  return Object.hasOwn(SHAPE_SIZE, config.shape) ? config.shape : 'her'
}

export function imageSizeFor(shape, config) {
  return SHAPE_SIZE[pickShape(shape, config)] || config.size
}

// 各后端实际可接受的尺寸。没列出的（custom / local / comfyui）交给后端自己的 workflow/参数决定。
const COMMON = ['1024x1024', '1024x1536', '1536x1024']
export const PROVIDER_SIZES = {
  seedream: [...COMMON, '864x1152', '1152x864', '1280x720', '720x1280', '2048x2048', '4096x4096'],
  xai: ['1024x1024', '1024x1792', '1792x1024'],
  gemini: [...COMMON, '1344x768', '768x1344'],
  sensenova: COMMON,
}

export function sizesForProvider(provider) {
  return PROVIDER_SIZES[provider] || SIZE_OPTIONS
}

/** 把工具请求的尺寸收敛到 provider 真正接受的档位；比例优先，其次面积。 */
export function fitSizeForProvider(provider, size, shape) {
  const allowed = PROVIDER_SIZES[provider]
  if (!allowed || !size) return size
  if (allowed.includes(size)) return size
  const dims = (v) => { const [w, h] = String(v).split('x').map(Number); return { w, h, ratio: w / h, area: w * h } }
  const want = dims(size)
  return [...allowed].sort((a, b) => {
    const da = dims(a), db = dims(b)
    return Math.abs(Math.log(da.ratio / want.ratio)) - Math.abs(Math.log(db.ratio / want.ratio)) || Math.abs(da.area - want.area) - Math.abs(db.area - want.area)
  })[0]
}
