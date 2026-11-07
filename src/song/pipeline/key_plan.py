# 按她的音域给整首歌定调，再逐句挪八度（2026-11-07）。
# 测出原唱人声的音高，加上插件给的变调（女声歌 0、男声歌 +12），看换声后落在哪。
# 1. 逐段挪八度：每一处看前后 1 秒的中间音，低于 200 Hz（她最低的 5% 约 218 Hz，一直这么低就发哑）的那一段
#    升一个八度（原唱低于 100 Hz 才升两个，见 pick_up）；高于 600 Hz 或高过 G5 超过半秒，降一个八度。挪整八度和伴奏仍然合得上。
#    男女对唱时男声那几句、歌里插进来的低沉男声 / 很高的伴唱，都靠这一步拉回她的音区。主唱、伴唱分开算。
# 2. 整首定调：挪完八度后（挪八度算代价，优先整首挪），要求高于 G5（784 Hz，作者模型开始发哑）的音累计不超过 1 秒；
#    最低的 10% 不低于 220 Hz；中间的音不高于 360 Hz（她本人一半的音在 286~414 Hz，中位 347）。
#    不满足就整首挪，挑违反最少、挪得最少的（最多降 6、升 3 个半音）；伴奏由 song-convert.mjs 跟着一起挪。
#    （第一版只看中间的音，《演员》降 5 个半音低音段太沉；第二版中间音上限 420，《演员》仍偏高，2026-11-07 改 400）
#    （第一版按整句判断：对唱里男女声连着唱、伴唱轨里停顿短，《春娇与志明》伴唱的男声大半没挪到，2026-11-07 改成按 1 秒窗）
# 主唱、伴唱各自判断哪里偏低（对唱重叠时两个人在不同轨），升几个八度全首统一（同一句漏到两条轨里也挪成同一个八度）。
# 段落边界放在换人的那一刻（前后半秒内音高跳得最大处），不等停顿：对唱常常无缝衔接。
#    （上一版逐秒判断、每段各挑 12 或 24：一句里来回翻八度、男声段两种音色轮流出现，2026-11-07 改）
# 用法：python key_plan.py <主唱 wav> <插件给的变调> [伴唱 wav]
# 打印 JSON：{"shift": 整首额外挪几个半音（人声、伴奏一起）, "octave": 人声另外挪几个半音（0 / ±12，只挪人声）, "lead": [[开始秒, 结束秒, 挪几个半音], ...], "back": [...], ...}
import json, os, sys

import numpy as np

# Applio 在哪：插件通过环境变量告诉脚本（翻唱环境里的 Applio 文件夹）；单独运行时默认 ~/Applio
APPLIO = os.environ.get('AURABOT_APPLIO') or os.path.expanduser('~/Applio')
sys.path.insert(0, APPLIO)

FLOOR_P10 = 220.0   # 最低的 10% 不低于 220 Hz（她本人最低的 10% 约 234 Hz）
MED_MAX = 360.0     # 中间的音不高于 360 Hz（她本人中位 347；2026-11-07 从 400 降：《天龙八部之宿敌》401 Hz 尖细，《春娇与志明》女声段、《演员》也嫌高）
TOL = 0.5           # 差半个半音以内不算
CEIL_HZ, CEIL_SEC = 784.0, 1.0
DOWN_MAX, UP_MAX = 6, 3
FPS = 100  # RMVPE 每秒 100 帧
PITCH_LIMIT = 24  # Applio 变调上限（±24 半音）

FOLD_LOW, FOLD_LOW_MAX = 200.0, 520.0    # 低于 200 升八度（升两个八度时升完不超过 520）。试过 235：《演员》主歌被挪高一个八度，太尖
FOLD_HIGH, FOLD_HIGH_MIN = 600.0, 250.0  # 高于 600 降八度（降完不低于 250）
FOLD_CEIL_SEC = 0.5       # 一句里高过 G5 超过半秒也降
FOLD_PENALTY = 10.0       # 挪八度是补救，不是首选：挪掉 10% 的音算违反 1 个半音，整首定调优先选挪得少的
FOLD_FREE = 0.03          # 挪的不到 3% 不算代价（零星几个低音，不该为它把整首调抬高；《小幸运》曾因此被升 2）


def load_range():
    """音色档案里的音域（插件通过 AURABOT_VOICE_PROFILE 传 JSON 文件路径）。没有档案就用大肥鱼的数值。"""
    path = os.environ.get('AURABOT_VOICE_PROFILE') or ''
    try:
        with open(path, encoding='utf-8') as fh:
            return json.load(fh).get('range') or {}
    except (OSError, ValueError):
        return {}


_R = load_range()
FLOOR_P10 = float(_R.get('floorP10', FLOOR_P10))
MED_MAX = float(_R.get('medMax', MED_MAX))
CEIL_HZ = float(_R.get('ceilHz', CEIL_HZ))
FOLD_LOW = float(_R.get('foldLow', FOLD_LOW))
FOLD_LOW_MAX = float(_R.get('foldLowMax', FOLD_LOW_MAX))
FOLD_HIGH = float(_R.get('foldHigh', FOLD_HIGH))
FOLD_HIGH_MIN = float(_R.get('foldHighMin', FOLD_HIGH_MIN))
# 伴奏没法变调（找不到 rubberband）时，插件传 0：整首不挪，只挪八度
if os.environ.get('AURABOT_KEY_SHIFT') == '0':
    DOWN_MAX = UP_MAX = 0


def f0_of(path, pitch, model):
    import librosa
    y, _ = librosa.load(path, sr=16000, mono=True)
    return model.infer_from_audio(y, thred=0.03) * 2 ** (pitch / 12)


WIN = 0.5                 # 每一帧看前后各 0.5 秒有声部分的中间音，判断这一段是不是离她音区太远
MIN_RUN = 1.0             # 挪八度的一段至少 1 秒，短的并进旁边（太短会在一句里来回翻八度）
CENTER = float(_R.get('center', 347.0))  # 她平时的中间音（数据集中位数）；换别的音色用音色档案里的


def _runs(lab):
    runs, s = [], 0
    for i in range(1, len(lab) + 1):
        if i == len(lab) or lab[i] != lab[s]:
            runs.append([s, i, int(lab[s])])
            s = i
    return runs


def regions_of(g):
    """找出离她音区太远的大段：每一帧看前后 1 秒的中间音，低于 FOLD_LOW 记作低、高于 FOLD_HIGH 记作高。
    边界挪到前后半秒内音高跳得最大的那一帧（换人的那一刻；对唱常常无缝衔接，不等停顿）。
    夹在低段旁边的短高段（多半是男声段里夹的女声伴唱）不单独降。返回 [(开始帧, 结束帧, -1 低 / 1 高)]。"""
    n = len(g)
    voiced = np.flatnonzero(g > 0)
    if len(voiced) == 0:
        return []
    lg = np.log2(g[voiced])
    w = int(WIN * FPS)
    side = np.zeros(len(voiced), dtype=int)
    for j, i in enumerate(voiced):
        a, b = np.searchsorted(voiced, i - w), np.searchsorted(voiced, i + w, side='right')
        m = 2 ** float(np.median(lg[a:b]))
        side[j] = -1 if m < FOLD_LOW else (1 if m > FOLD_HIGH else 0)
    idx = np.clip(np.searchsorted(voiced, np.arange(n)), 0, len(voiced) - 1)
    prev = np.clip(idx - 1, 0, len(voiced) - 1)
    near = np.where(np.abs(voiced[prev] - np.arange(n)) < np.abs(voiced[idx] - np.arange(n)), prev, idx)
    lab = side[near]
    for _ in range(5):
        runs = _runs(lab)
        changed = False
        for r in range(len(runs)):
            a, b, o = runs[r]
            if b - a < MIN_RUN * FPS and len(runs) > 1:
                nb = runs[r - 1][2] if r > 0 else runs[r + 1][2]
                if nb != o:
                    lab[a:b] = nb
                    changed = True
        if not changed:
            break
    # 相邻帧音高跳变（只看有声的前后帧）
    lgf = np.where(g > 0, np.log2(np.maximum(g, 1e-9)), np.nan)

    def refine(t):
        lo, hi = max(1, t - w), min(n - 1, t + w)
        best, bt = 0.0, t
        last = None
        for i in range(lo, hi):
            if not np.isnan(lgf[i]):
                if last is not None and i - last <= 30:
                    d = abs(lgf[i] - lgf[last])
                    if d > best:
                        best, bt = d, i
                last = i
        return bt if best >= 0.4 else t   # 跳了 5 个半音以上才算换人，否则保持原位置

    runs = _runs(lab)
    out = []
    for r, (a, b, sd) in enumerate(runs):
        if sd == 0:
            continue
        if sd > 0 and ((r > 0 and runs[r - 1][2] < 0) or (r + 1 < len(runs) and runs[r + 1][2] < 0)) and b - a < 4 * FPS:
            continue
        a2 = refine(a) if a > 0 else a
        b2 = refine(b) if b < n else b
        if b2 - a2 >= MIN_RUN * FPS and (g[a2:b2] > 0).sum() > 0:
            out.append((a2, b2, sd))
    return out


def pick_up(vs):
    """所有偏低段统一升几个八度。默认升一个八度（2026-11-07 《春娇与志明》试听：升两个八度落在她最高的那段音，不如升一个自然）；
    只有升一个八度后中间音仍低于 FOLD_LOW（原唱特别低沉，低于 100 Hz）才升两个，且升完不超过 FOLD_LOW_MAX、超过 G5 的不到 3%"""
    v = np.concatenate(vs) if vs else np.array([])
    if len(v) == 0:
        return 12
    m = float(np.median(v))
    if m * 2 < FOLD_LOW and m * 4 <= FOLD_LOW_MAX and (v * 4 > CEIL_HZ).mean() <= 0.03:
        return 24
    return 12


def fold(f0, k, up=None):
    """整首挪 k 个半音后逐段挪八度。偏低段统一挪 up 个半音（不给就按这条轨自己算），偏高段降 12。"""
    g = f0 * 2 ** (k / 12)
    regs = regions_of(g)
    lows = [g[a:b][g[a:b] > 0] for a, b, sd in regs if sd < 0]
    o_up = up if up is not None else pick_up(lows)
    segs = []
    for a, b, sd in regs:
        if sd < 0:
            segs.append((a, b, o_up))
        else:
            v = g[a:b][g[a:b] > 0]
            if float(np.median(v)) / 2 >= FOLD_HIGH_MIN:
                segs.append((a, b, -12))
    out = g.copy()
    for a, b, o in segs:
        out[a:b] *= 2 ** (o / 12)
    return segs, out


def main(lead_p, pitch, back_p=None):
    from rvc.lib.predictors.RMVPE import RMVPE0Predictor
    model = RMVPE0Predictor(os.path.join(APPLIO, 'rvc/models/predictors/rmvpe.pt'), device='cpu')
    f = f0_of(lead_p, pitch, model)
    if (f > 0).sum() < 3 * FPS:
        print(json.dumps({'shift': 0, 'lead': [], 'back': [], 'reason': '人声太少，不挪'}))
        return

    f_in = f

    def cost(oct_, k):
        f = f_in * 2 ** (oct_ / 12)
        _, g = fold(f, k)
        moved = (g != f * 2 ** (k / 12)) & (g > 0)
        folded = float(moved.sum() / max(1, (g > 0).sum()))
        # 整首的调按没挪八度的部分（主要那个人）来定；挪了八度的段各自已经放到她音区里了，不再拿来拉整首的调
        keep = (g > 0) & ~moved
        g = g[keep] if keep.sum() >= 0.3 * (g > 0).sum() else g[g > 0]
        p10, p50 = np.percentile(g, 10), np.percentile(g, 50)
        low = max(0.0, 12 * np.log2(FLOOR_P10 / p10) - TOL)    # 低音段太低（发闷、发沉）
        high = max(0.0, 12 * np.log2(p50 / MED_MAX) - TOL)     # 整体太高（费劲、发尖）
        ceil = 100.0 if (g > CEIL_HZ).sum() / FPS > CEIL_SEC else 0.0
        return ceil + low + high + FOLD_PENALTY * max(0.0, folded - FOLD_FREE)

    # 人声整首还可以多挪一个八度（只挪人声，伴奏不动，和伴奏照样合得上）：插件按歌手猜男女给 +12，
    # 李玉刚这种用假声唱的「男歌手」原唱本来就高，再 +12 会太尖（2026-11-07《刚好遇见你》+12 后中间音 552 Hz、20 秒高过 G5）
    # 只允许撤回插件加的 +12，不往上加（女声歌再升八度会太尖；《光年之外》试过会被升一个八度再降 6）
    octs = [0, -12] if pitch >= 12 else [0]
    cands = range(-DOWN_MAX, UP_MAX + 1)
    oct_, k = min(((o, k) for o in octs for k in cands), key=lambda t: (round(cost(*t), 2), t[0] != 0, abs(t[1]), t[1] > 0))
    f = f_in * 2 ** (oct_ / 12)
    pitch = pitch + oct_
    sec = lambda segs: [[round(a / FPS, 2), round(b / FPS, 2), o] for a, b, o in segs]
    fb = f0_of(back_p, pitch - oct_, model) * 2 ** (oct_ / 12) if back_p else None
    # 主唱、伴唱各自判断哪里偏低，但升几个八度全首统一（同一句漏到两条轨里也会挪成同一个八度）
    gl = f * 2 ** (k / 12)
    vs = [gl[a:b][gl[a:b] > 0] for a, b, sd in regions_of(gl) if sd < 0]
    if fb is not None:
        gb = fb * 2 ** (k / 12)
        vs += [gb[a:b][gb[a:b] > 0] for a, b, sd in regions_of(gb) if sd < 0]
    up = pick_up(vs)
    # Applio 最多只能变调 ±24 个半音：插件变调 + 整首挪 + 升八度超过就少升一个八度（2026-11-07）
    while up > 12 and pitch + k + up > PITCH_LIMIT:
        up -= 12
    lead_segs, g = fold(f, k, up)
    g0 = f_in[f_in > 0]
    g = g[g > 0]
    ok = lambda segs: [x for x in segs if abs(pitch + k + x[2]) <= PITCH_LIMIT]   # 还超就那几段不挪
    lead_segs = ok(lead_segs)
    res = {'shift': int(k), 'octave': int(oct_), 'up': up, 'lead': sec(lead_segs), 'back': sec(ok(fold(fb, k, up)[0])) if fb is not None else [],
           'median_hz': [round(float(np.median(g0))), round(float(np.median(g)))],
           'above_g5_sec': [round(float((g0 > CEIL_HZ).sum() / FPS), 1), round(float((g > CEIL_HZ).sum() / FPS), 1)],
           'low10_hz': [round(float(np.percentile(g0, 10))), round(float(np.percentile(g, 10)))]}
    res['folded_sec'] = [round(sum(b - a for a, b, _ in res[s]), 1) for s in ('lead', 'back')]
    print(json.dumps(res, ensure_ascii=False))


if __name__ == '__main__':
    main(sys.argv[1], float(sys.argv[2]), sys.argv[3] if len(sys.argv) > 3 else None)
