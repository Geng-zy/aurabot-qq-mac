# 判断是不是男女对唱（2026-11-08）。
# 分男女声的模型（Sucial 的 chorus male/female）会把女歌手较低、较实的声音也分进「男声」那条：
# 只比两条的响度，《小幸运》《光年之外》（女声独唱）都被误判成对唱。所以还要看音高：
#   男声那条单独唱（比女声那条响 6 dB 以上）、音高低于 230 Hz（男声音区）的累计 ≥ 5 秒，
#   并且女声那条单独唱、音高高于 280 Hz 的累计 ≥ 10 秒，才算男女对唱。
# 8 首实测（男声音区秒 / 女声音区秒）：对唱《一点》34/20、《小酒窝》10/31、《春娇与志明》58/51、《屋顶》7.2/39，
#   女声独唱《小幸运》2.6/60、《光年之外》2.7/42，男声独唱《演员》67/0.1，《WakaWaka》（带男声合唱）9.8/45 算对唱。
# 用法：python gender_check.py <女声 wav> <男声 wav>
# 打印 JSON：{"duet": true/false, "male_low_sec": ..., "female_high_sec": ...}
import json, os, sys

import numpy as np

# Applio 在哪：插件通过环境变量告诉脚本（翻唱环境里的 Applio 文件夹）；单独运行时默认插件的安装位置 ~/Aurabot/rvc/Applio
APPLIO = os.environ.get('AURABOT_APPLIO') or os.path.expanduser('~/Aurabot/rvc/Applio')
sys.path.insert(0, APPLIO)

FPS = 100
ABS_DB = -45.0      # 太轻的不算在唱
SOLO_DB = 6.0       # 比另一条响 6 dB 以上才算这条在单独唱
MALE_HZ = 230.0
FEMALE_HZ = 280.0
MALE_MIN_SEC = 5.0
FEMALE_MIN_SEC = 10.0


def main(female_p, male_p):
    import librosa
    from rvc.lib.predictors.RMVPE import RMVPE0Predictor
    model = RMVPE0Predictor(os.path.join(APPLIO, 'rvc/models/predictors/rmvpe.pt'), device='cpu')
    out = {}
    for name, p in (('female', female_p), ('male', male_p)):
        y, _ = librosa.load(p, sr=16000, mono=True)
        f0 = model.infer_from_audio(y, thred=0.03)
        db = 20 * np.log10(librosa.feature.rms(y=y, frame_length=800, hop_length=160)[0] + 1e-9)
        out[name] = (f0, db)
    (ff, fd), (mf, md) = out['female'], out['male']
    n = min(len(ff), len(fd), len(mf), len(md))
    ff, fd, mf, md = ff[:n], fd[:n], mf[:n], md[:n]
    m_solo = (md > ABS_DB) & (md - fd > SOLO_DB) & (mf > 0)
    f_solo = (fd > ABS_DB) & (fd - md > SOLO_DB) & (ff > 0)
    male_low = float((m_solo & (mf < MALE_HZ)).sum() / FPS)
    female_high = float((f_solo & (ff > FEMALE_HZ)).sum() / FPS)
    duet = male_low >= MALE_MIN_SEC and female_high >= FEMALE_MIN_SEC
    print(json.dumps({'duet': bool(duet), 'male_low_sec': round(male_low, 1), 'female_high_sec': round(female_high, 1)}))


if __name__ == '__main__':
    main(sys.argv[1], sys.argv[2])
