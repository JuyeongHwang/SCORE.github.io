# SCORE project page

Static site for *How Does a Virtual Agent Decide Where to Look? Symbolic Cognitive Reasoning for
Embodied Head Rotation* (SIGGRAPH Asia 2025). Served by GitHub Pages from the repository root.

```
index.html
static/css/score.css
static/js/results.js        DTW tables (paper numbers)
static/js/replay.js         2D top-down replay, yaw chart, Unity WebGL bridge
static/js/headrot.js        supplementary Figs. 7-11 + interactive unit-sphere view
static/js/examples.js       action-reason traces (examples.json, plans/*.json)
static/data/scenes/*.json   replay data (built by tools/build_replay_data.py)
static/data/examples.json   logged action-reason pairs from SCORE runs
static/videos/              supplementary video
static/data/plans/          optional: time-stamped plans exported by the Unity code (+ index.json)
static/webgl/Build/         Unity WebGL build of the study scenes (SCORE_WebReplay project)
```

## Rebuilding the data

```
python tools/build_replay_data.py <research-root>
```

## Rebuilding the 3D replay

The WebGL build comes from `05_Codes/SCORE_WebReplay`, a copy of the Unity project with API keys
removed and the environment packs moved out of `Resources/`:

```
Unity -batchmode -quit -projectPath SCORE_WebReplay -buildTarget WebGL -executeMethod WebReplayBuild.BuildWebGL
```

then copy `Build/WebGL/Build/*` to `static/webgl/Build/`. The page drives the build with
`SendMessage("WebReplay", "LoadScene" | "SetTracks" | "SetProgress" | "SetCamera" | "SetVisible", ...)`.

## Adding a time-stamped plan from the released code

Run a scene with the Unity code, copy
`Assets/SCOREResult/<name>_plan.json` to `static/data/plans/`, add a `"scene"` and `"model"` field,
and list the file name in `static/data/plans/index.json`.

## Local preview

```
python -m http.server 8791
```
