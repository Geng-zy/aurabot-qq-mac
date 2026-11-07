# 逐句挪八度的拼接（2026-11-07）。
# 同一条人声按不同八度各换一遍声，key_plan.py 标出的句子用挪过八度的那一遍，其余用原调那一遍。
# 接缝在 key_plan.py 找的换人那一刻（音高跳变处），前后各多留 0.08 秒、40 毫秒淡入淡出。
# 用法：python octave_splice.py <输出 wav> <原调换声 wav> '<句子 JSON：[[开始秒, 结束秒, 半音], ...]>' <半音>=<换声 wav> ...
import json, sys

import numpy as np
import soundfile as sf

PAD, RAMP = 0.08, 0.04


def main(out_p, base_p, segs_json, *alts):
    y, sr = sf.read(base_p, always_2d=True)
    alt = {}
    for a in alts:
        o, p = a.split('=', 1)
        z, sr2 = sf.read(p, always_2d=True)
        if sr2 != sr:
            raise SystemExit(f'采样率不一致：{p}')
        n = len(y)
        z = z[:n] if len(z) >= n else np.pad(z, ((0, n - len(z)), (0, 0)))
        alt[int(o)] = z[:, :y.shape[1]] if z.shape[1] >= y.shape[1] else np.repeat(z[:, :1], y.shape[1], 1)
    out = y.copy()
    t = np.arange(len(y)) / sr
    used = 0.0
    for a, b, o in json.loads(segs_json):
        if int(o) not in alt:
            continue
        a, b = a - PAD, b + PAD
        w = np.clip(np.minimum(t - a, b - t) / RAMP, 0, 1)[:, None]
        out = (1 - w) * out + w * alt[int(o)]
        used += b - a
    sf.write(out_p, out, sr, subtype='PCM_16')
    print(json.dumps({'spliced_sec': round(used, 1)}))


if __name__ == '__main__':
    main(*sys.argv[1:])
