# 换声后按「她本人的声音」逐首校正音色（2026-11-06）。
# 作者 v1 模型换出来的声音，中频（约 0.8~2 kHz）普遍比她本人重，听着发闷；每首歌偏多少不一样。
# 做法：在她舒服的音区（300~520 Hz）里，比较这首换声结果和她数据集的各频段能量，
# 按差值做一条平滑的均衡曲线（只做 8 成，压最多 9 dB、补最多 3 dB），线性相位滤波，响度保持不变。
# 这首歌她音区里的音不够 3 秒时，用 7 首测试歌的平均偏差。
# 参照（她本人各频段的能量）放在音色档案的 tone 里（插件通过 AURABOT_VOICE_PROFILE 传档案路径）；
# 没有档案或档案里没有 tone 就跳过，不校正。档案由 voice_profile.py 从这个音色的数据集生成。
# 用法：python tone_match.py <换声后的 wav>（原地改写），最后一行打印 JSON 摘要。
import json, os, sys

import numpy as np
import soundfile as sf
from scipy.signal import firwin2, oaconvolve

# Applio 在哪：插件通过环境变量告诉脚本（翻唱环境里的 Applio 文件夹）；单独运行时默认插件的安装位置 ~/Aurabot/rvc/Applio
APPLIO = os.environ.get('AURABOT_APPLIO') or os.path.expanduser('~/Aurabot/rvc/Applio')
sys.path.insert(0, APPLIO)

EDGES = [250, 400] + [round(630 * 2 ** (k / 3)) for k in range(15)]   # 630 Hz 起每 1/3 倍频程一段，到 16 kHz
FIRST_BAND = 2                  # 从 630 Hz 那一段开始校正
NO_BOOST_BELOW = 4              # 630~1000 Hz 那两段只压不补
PITCH_LO, PITCH_HI = 300, 520   # 只比她舒服音区里的帧
MIN_FRAMES = 300                # 至少 3 秒
STRENGTH = 0.9                  # 每遍校正 9 成，避免过头
PASSES = 2                      # 校正后再量一遍，补上剩下的
MAX_CUT, MAX_BOOST = -9.0, 3.0
SR_A = 44100


def _rmvpe():
    from rvc.lib.predictors.RMVPE import RMVPE0Predictor
    return RMVPE0Predictor(os.path.join(APPLIO, 'rvc/models/predictors/rmvpe.pt'), device='cpu')


def band_profile(y, sr, model):
    """返回 (各频段占比 dB, 帧数)。y 为单声道。"""
    import librosa
    if sr != SR_A:
        y = librosa.resample(y, orig_sr=sr, target_sr=SR_A)
    f0 = model.infer_from_audio(librosa.resample(y, orig_sr=SR_A, target_sr=16000), thred=0.03)
    S = np.abs(librosa.stft(y, n_fft=4096, hop_length=441)) ** 2
    fr = librosa.fft_frequencies(sr=SR_A, n_fft=4096)
    t = np.minimum(np.arange(S.shape[1]), len(f0) - 1)
    sel = (f0[t] > PITCH_LO) & (f0[t] < PITCH_HI)
    if sel.sum() == 0:
        return None, 0
    Ss = S[:, sel]
    tot = Ss.sum(0) + 1e-12
    bands = np.array([Ss[(fr >= a) & (fr < b)].sum(0) / tot for a, b in zip(EDGES[:-1], EDGES[1:])])
    return 10 * np.log10(np.median(bands, 1) + 1e-12), int(sel.sum())


def reference(model=None):
    """音色档案里的音色参照；没有就返回 None（不校正）。"""
    path = os.environ.get('AURABOT_VOICE_PROFILE') or ''
    try:
        with open(path, encoding='utf-8') as fh:
            tone = json.load(fh).get('tone')
    except (OSError, ValueError):
        return None
    return tone if tone and tone.get('bands_db') else None


def build_reference(model, files, pitch_range=None):
    """从这个音色的数据集（干声录音）算出参照，给 voice_profile.py 用。pitch_range 是她舒服的音区 [低, 高] Hz。"""
    global PITCH_LO, PITCH_HI
    import librosa
    if pitch_range:
        PITCH_LO, PITCH_HI = [float(x) for x in pitch_range]
    profs, n = [], 0
    for p in files:
        y, sr = librosa.load(p, sr=SR_A, mono=True)
        pr, k = band_profile(y, sr, model)
        if pr is not None:
            profs.append((pr, k))
            n += k
    ref = {'edges': EDGES, 'pitch_range': [PITCH_LO, PITCH_HI], 'files': len(files), 'frames': n,
           'bands_db': [float(x) for x in np.sum([p * k for p, k in profs], 0) / n],
           # 这首歌她音区里的音不够时用的平均偏差（有测试数据再填）
           'fallback_dev_db': None}
    return ref


def eq_curve(gains_db, sr, taps=4097):
    centers = [np.sqrt(a * b) for a, b in zip(EDGES[:-1], EDGES[1:])]
    nyq = sr / 2
    f = [0.0, 150.0] + centers + [min(18000.0, nyq * 0.95), nyq]
    g = [0.0, 0.0] + list(gains_db) + [gains_db[-1], gains_db[-1]]
    # 在对数频率上插值，再给 firwin2 一条细的曲线
    grid = np.unique(np.concatenate([[0.0], np.geomspace(20, nyq, 400), [nyq]]))
    lf = np.log10(np.maximum(f, 1.0))
    gi = np.interp(np.log10(np.maximum(grid, 1.0)), lf, g)
    return firwin2(taps, grid / nyq, 10 ** (gi / 20))


def main(path):
    y, sr = sf.read(path, always_2d=True)
    mono = y.mean(1)
    global PITCH_LO, PITCH_HI
    ref = reference()
    if ref is None:
        print(json.dumps({'tone_match': 'skipped', 'reason': '这个音色没有音色参照（音色档案里没有 tone）'}, ensure_ascii=False))
        return
    PITCH_LO, PITCH_HI = [float(x) for x in ref.get('pitch_range') or [PITCH_LO, PITCH_HI]]
    model = _rmvpe()
    rms = lambda a: np.sqrt(np.mean(a ** 2) + 1e-12)
    z, total, mode, n0 = y, np.zeros(len(EDGES) - 1), None, 0
    for it in range(PASSES):
        out, n = band_profile(z.mean(1), sr, model)
        if it == 0:
            n0 = n
        if out is not None and n >= MIN_FRAMES:
            dev, mode = out - np.array(ref['bands_db']), mode or 'song'
        elif it == 0 and ref.get('fallback_dev_db'):
            dev, mode = np.array(ref['fallback_dev_db']), 'fallback'
        elif it == 0:
            print(json.dumps({'tone_match': 'skipped', 'frames': n}))
            return
        else:
            break
        # 630 Hz 以下是基音所在，随唱的音高变，不代表音色，不校正
        dev = np.array(dev, dtype=float)
        dev[:FIRST_BAND] = 0.0
        dev[FIRST_BAND:] -= np.median(dev[FIRST_BAND:])   # 只看相对的高低，不管整体音量
        step = -STRENGTH * dev
        # 相邻频段平滑一下：1/3 倍频程里只有一两个泛音，单段的高低有一部分是旋律造成的，不全是音色
        step[FIRST_BAND:] = np.convolve(np.pad(step[FIRST_BAND:], 1, mode='edge'), [0.25, 0.5, 0.25], 'valid')
        total = np.clip(total + step, MAX_CUT, MAX_BOOST)
        total[:NO_BOOST_BELOW] = np.minimum(total[:NO_BOOST_BELOW], 0.0)   # 1 kHz 以下只压不补，补了会发沉
        total[:FIRST_BAND] = 0.0
        h = eq_curve(total, sr)
        d = (len(h) - 1) // 2
        z = np.stack([oaconvolve(y[:, c], h)[d:d + len(y)] for c in range(y.shape[1])], 1)
        z *= rms(y) / rms(z)                   # 响度不变
        if mode == 'fallback':
            break
    gains = total
    peak = np.abs(z).max()
    if peak > 0.99:
        z *= 0.99 / peak
    sf.write(path, z, sr, subtype='PCM_16')
    print(json.dumps({'tone_match': mode, 'frames': n0, 'gains_db': [round(float(x), 1) for x in gains]}, ensure_ascii=False))


if __name__ == '__main__':
    main(sys.argv[1])
