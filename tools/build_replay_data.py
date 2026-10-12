"""Builds static/data/scenes/*.json for the web replay from the recorded trajectories.

SCORE : 05_Codes/SCORE/Assets/SCOREResult/<Scene>_<k>.csv     (world pos + world head/body quats, 20 Hz)
Human : 05_Codes/SCORE/Assets/Human/HumanData/<Env><Original|Change>/*.csv
        (pos relative to the spawn point + world head quat, 50 Hz)
Track : 06_Datas/SMILE_Project/Track/<Env><Original|Change>/*.csv (t, quat; placed on the SCORE path)

Each sample is flattened as [t, x, z, qx, qy, qz, qw, bodyYawDeg] at 10 Hz.
Usage: python tools/build_replay_data.py <research-root>
"""
import glob
import json
import os
import re
import sys

import numpy as np
import pandas as pd

ROOT = sys.argv[1] if len(sys.argv) > 1 else os.path.join(os.path.dirname(__file__), "..", "..", "..")
OUT = os.path.join(os.path.dirname(__file__), "..", "static", "data", "scenes")
HZ = 10.0

ENVS = ["Bus", "Cafe", "Crossing", "Mall", "Street"]
# paper (Sec. 4.2) scenario goals
GOALS = {
    "Bus": "Find and sit in an empty seat at the back.",
    "Cafe": "Locate and sit at a table by the window.",
    "Crossing": "Cross safely to the other side.",
    "Mall": "Move from one end of the mall to the opposite side.",
    "Street": "Walk safely to the far end of the street.",
}


def yaw_of(q):
    x, y, z, w = q[:, 0], q[:, 1], q[:, 2], q[:, 3]
    return np.degrees(np.arctan2(2 * (w * y + x * z), 1 - 2 * (x * x + y * y)))


def yaw_from_path(p, t, win=0.6):
    """Walking direction (deg) from positions, smoothed over +-win seconds."""
    n = len(p)
    yaw = np.zeros(n)
    last = 0.0
    for i in range(n):
        j0 = np.searchsorted(t, t[i] - win)
        j1 = min(np.searchsorted(t, t[i] + win), n - 1)
        d = p[j1] - p[j0]
        if np.hypot(d[0], d[1]) > 0.05:
            last = np.degrees(np.arctan2(d[0], d[1]))
        yaw[i] = last
    # fill the initial stationary part with the first valid heading
    first = np.argmax(np.abs(yaw) > 0) if np.any(yaw != 0) else 0
    yaw[:first] = yaw[first]
    return yaw


def resample(t, p, q, yaw):
    tt = np.arange(0, t[-1] + 1e-6, 1.0 / HZ)
    idx = np.clip(np.searchsorted(t, tt), 0, len(t) - 1)
    qs = q[idx]
    qs = qs / np.linalg.norm(qs, axis=1, keepdims=True)
    px = np.interp(tt, t, p[:, 0])
    pz = np.interp(tt, t, p[:, 1])
    ys = yaw[idx]
    return np.column_stack([tt, px, pz, qs, ys])


def flat(arr):
    return [round(float(v), 4) for v in arr.reshape(-1)]


def load_score(scene):
    files = sorted(glob.glob(os.path.join(ROOT, "05_Codes/SCORE/Assets/SCOREResult", f"{scene}_*.csv")),
                   key=lambda f: int(re.findall(r"_(\d+)\.csv$", f)[0]))
    out = []
    for f in files:
        df = pd.read_csv(f, skipinitialspace=True)
        df.columns = [c.strip() for c in df.columns]
        n = len(df)
        t = df["Time"].values if "Time" in df.columns else np.arange(n) * 0.05
        p = df[["HeadBodyposx", "HeadBodyposz"]].values
        q = df[["HeadRotx", "HeadRoty", "HeadRotz", "HeadRotw"]].values
        by = yaw_of(df[["BodyRotx", "BodyRoty", "BodyRotz", "BodyRotw"]].values)
        k = re.findall(r"_(\d+)\.csv$", f)[0]
        out.append({"label": f"Run {k}", "s": flat(resample(t, p, q, by))})
    return out


def qmul(a, b):
    ax, ay, az, aw = a
    bx, by, bz, bw = b.T
    return np.column_stack([aw * bx + ax * bw + ay * bz - az * by,
                            aw * by - ax * bz + ay * bw + az * bx,
                            aw * bz + ax * by - ay * bx + az * bw,
                            aw * bw - ax * bx - ay * by - az * bz])


def human_frame_rotation(folder, score_ref):
    """Some VR sessions were recorded in a rotated local frame (e.g. Mall is turned by 180 deg).
    Returns the yaw (multiple of 90 deg) that aligns the mean human displacement with the SCORE path."""
    files = glob.glob(os.path.join(ROOT, "05_Codes/SCORE/Assets/Human/HumanData", folder, "*.csv"))
    ends = np.mean([pd.read_csv(f)[["BodyPositionX", "BodyPositionZ"]].values[-1] for f in files], axis=0)
    rs = np.array(score_ref["s"]).reshape(-1, 8)
    d = rs[-1, 1:3] - rs[0, 1:3]
    theta = np.degrees(np.arctan2(d[0], d[1]) - np.arctan2(ends[0], ends[1]))
    return float(np.round(theta / 90.0) * 90.0) % 360.0


def place_on_path(t, p, q, ref):
    """Moves a human trial onto the SCORE reference path, keeping the head motion.

    Position: the point of the reference path at the same fraction of distance walked
    (pauses and pace of the participant are kept). Head: the orientation relative to the
    participant's walking direction is re-applied to the reference walking direction."""
    rs = np.array(ref["s"]).reshape(-1, 8)
    seg = np.hypot(np.diff(rs[:, 1]), np.diff(rs[:, 2]))
    rarc = np.concatenate([[0], np.cumsum(seg)]); rarc /= max(rarc[-1], 1e-6)
    hseg = np.hypot(np.diff(p[:, 0]), np.diff(p[:, 1]))
    harc = np.concatenate([[0], np.cumsum(hseg)]); harc /= max(harc[-1], 1e-6)
    ryaw = np.unwrap(np.radians(rs[:, 7]))
    new_p = np.column_stack([np.interp(harc, rarc, rs[:, 1]), np.interp(harc, rarc, rs[:, 2])])
    new_yaw = np.degrees(np.interp(harc, rarc, ryaw))
    old_yaw = yaw_from_path(p, t)
    d = np.radians(new_yaw - old_yaw) / 2
    # yaw-only change of frame, applied in world space: q' = Ry(new - old) * q
    new_q = np.array([qmul((0.0, np.sin(a), 0.0, np.cos(a)), q[i:i + 1])[0] for i, a in enumerate(d)])
    return new_p, new_q, new_yaw


def load_human(folder, origin, theta=0.0, ref=None):
    files = sorted(glob.glob(os.path.join(ROOT, "05_Codes/SCORE/Assets/Human/HumanData", folder, "*.csv")),
                   key=lambda f: int(re.findall(r"(\d+)\.csv$", f)[0]))
    out = []
    for f in files:
        df = pd.read_csv(f)
        n = len(df)
        t = np.arange(n) * 0.02
        p = df[["BodyPositionX", "BodyPositionZ"]].values
        q = df[["HeadRotationX", "HeadRotationY", "HeadRotationZ", "HeadRotationW"]].values
        if theta:
            r = np.radians(theta)
            p = np.column_stack([p[:, 0] * np.cos(r) + p[:, 1] * np.sin(r), -p[:, 0] * np.sin(r) + p[:, 1] * np.cos(r)])
            q = qmul((0.0, np.sin(r / 2), 0.0, np.cos(r / 2)), q)
        p = p + origin
        k = re.findall(r"(\d+)\.csv$", f)[0]
        if ref is not None:
            p, q, yaw = place_on_path(t, p, q, ref)
        else:
            yaw = yaw_from_path(p, t)
        out.append({"label": f"P{int(k):02d}", "s": flat(resample(t, p, q, yaw))})
    return out


def load_track(folder, ref):
    """Track has no positions: place it on the SCORE reference path by normalised time."""
    files = sorted(glob.glob(os.path.join(ROOT, "06_Datas/SMILE_Project/Track", folder, "*.csv")))
    rs = np.array(ref["s"]).reshape(-1, 8)
    out = []
    for f in files:
        df = pd.read_csv(f, header=None)
        t = df[0].values
        q = df[[1, 2, 3, 4]].values
        u = t / t[-1]
        ru = rs[:, 0] / rs[-1, 0]
        p = np.column_stack([np.interp(u, ru, rs[:, 1]), np.interp(u, ru, rs[:, 2])])
        yaw = np.interp(u, ru, np.unwrap(np.radians(rs[:, 7])))
        k = re.findall(r"(\d+)\.csv$", f)[0]
        out.append({"label": f"Run {k}", "s": flat(resample(t, p, q, np.degrees(yaw)))})
    return out


def main():
    os.makedirs(OUT, exist_ok=True)
    index = []
    for env in ENVS:
        for cond, unity, folder in (("MDC", "Normal", "Original"), ("APC", "Abnormal", "Change")):
            scene = env + unity
            score = load_score(scene)
            if not score:
                print("skip", scene)
                continue
            s0 = np.array(score[0]["s"][:8])
            origin = np.array([s0[1], s0[2]])
            theta = human_frame_rotation(env + folder, score[0])
            human = load_human(env + folder, origin, theta, ref=score[0])
            track = load_track(env + folder, score[0])
            data = {"scene": scene, "env": env, "cond": cond, "goal": GOALS[env], "humanFrameYaw": theta,
                    "methods": {"SCORE": score, "Human": human, "Track": track}}
            with open(os.path.join(OUT, scene + ".json"), "w") as fp:
                json.dump(data, fp, separators=(",", ":"))
            index.append({"scene": scene, "env": env, "cond": cond,
                          "counts": {k: len(v) for k, v in data["methods"].items()}})
            print(scene, index[-1]["counts"])
    with open(os.path.join(OUT, "index.json"), "w") as fp:
        json.dump(index, fp, indent=1)


if __name__ == "__main__":
    main()
