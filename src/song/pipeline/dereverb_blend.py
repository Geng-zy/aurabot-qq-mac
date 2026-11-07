# 去混响后按段挑着用（2026-11-06）。
# 去混响模型偶尔会在某些段落把人声弄出杂音（实测《小幸运》后半段，去混响后噪声度比原来高 15~20 dB），
# 换声会把杂音放大。这里逐帧比较「去混响后」和「原来」的噪声度（频谱平坦度）：
# 去混响后没变噪的地方用去混响的，变噪 3 dB 以上就逐渐换回原来的，变噪 9 dB 以上完全用原来的；过渡 0.3 秒平滑。
# 用法：python dereverb_blend.py <原人声> <去混响后> <输出>，打印 JSON 摘要。
import json, sys

import numpy as np
import soundfile as sf


def main(orig_p, dr_p, out_p):
    import librosa
    from scipy.ndimage import uniform_filter1d
    o, sr = sf.read(orig_p, always_2d=True)
    d, sr2 = sf.read(dr_p, always_2d=True)
    if sr2 != sr:
        d = librosa.resample(d.T, orig_sr=sr2, target_sr=sr).T
    if d.shape[1] != o.shape[1]:
        d = np.repeat(d.mean(1, keepdims=True), o.shape[1], 1)
    n = min(len(o), len(d))
    o, d = o[:n], d[:n]
    hop = 512
    flat = lambda x: librosa.feature.spectral_flatness(y=x.mean(1), n_fft=2048, hop_length=hop)[0]
    fo, fd = flat(o), flat(d)
    m = min(len(fo), len(fd))
    win = max(1, int(0.3 * sr / hop))
    r = 10 * np.log10(uniform_filter1d(fd[:m], win) + 1e-10) - 10 * np.log10(uniform_filter1d(fo[:m], win) + 1e-10)
    w = np.clip(1 - (r - 3) / 6, 0, 1)
    w = uniform_filter1d(w, win)
    ws = np.interp(np.arange(n), np.arange(m) * hop, w)[:, None]
    z = ws * d + (1 - ws) * o
    sf.write(out_p, z, sr, subtype='PCM_16')
    print(json.dumps({'dereverb_used': round(float(np.mean(w)), 3), 'fallback_sec': round(float((w < 0.5).sum() * hop / sr), 1)}))


if __name__ == '__main__':
    main(*sys.argv[1:4])
