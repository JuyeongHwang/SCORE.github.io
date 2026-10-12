// Interactive replay of pre-computed head trajectories.
// Data: static/data/scenes/<Scene>.json, samples flattened as [t, x, z, qx, qy, qz, qw, bodyYawDeg] at 10 Hz.
(function () {
  var STRIDE = 8;
  var ENVS = ['Bus', 'Cafe', 'Crossing', 'Mall', 'Street'];
  var ENV_LABEL = { Bus: 'Bus', Cafe: 'Café', Crossing: 'Crossing', Mall: 'Mall', Street: 'Street' };
  var METHODS = ['SCORE', 'Human', 'Track'];
  var METHOD_NOTE = { SCORE: 'SCORE run', Human: 'VR participant', Track: 'saliency baseline' };
  var UNITY_BUILD = 'static/webgl/Build/';
  var UNITY_NAME = 'WebGL';

  var state = {
    env: 'Crossing', cond: 'APC', data: null, trial: { SCORE: 0, Human: 0, Track: 0 },
    visible: { SCORE: true, Human: true, Track: false }, u: 0, playing: false, view: 'topdown', cam: 'follow'
  };
  var cache = {};
  var unity = null, unityScene = null, unityLoading = false;

  var $ = function (id) { return document.getElementById(id); };
  var topdown = $('topdown'), chart = $('yaw-chart');

  function css(name) { return getComputedStyle(document.documentElement).getPropertyValue(name).trim(); }
  function color(m) { return css(m === 'SCORE' ? '--score' : m === 'Human' ? '--human' : '--track'); }
  function sceneName() { return state.env + (state.cond === 'MDC' ? 'Normal' : 'Abnormal'); }

  function samples(m) {
    var list = state.data && state.data.methods[m];
    if (!list || !list.length) return null;
    return list[Math.min(state.trial[m], list.length - 1)].s;
  }
  function duration(s) { return s[s.length - STRIDE]; }

  // sample at normalized progress u (linear position, nlerp quaternion)
  function at(s, u) {
    var n = s.length / STRIDE, t = u * duration(s);
    var lo = 0, hi = n - 1;
    while (hi - lo > 1) { var mid = (lo + hi) >> 1; if (s[mid * STRIDE] <= t) lo = mid; else hi = mid; }
    var a = lo * STRIDE, b = hi * STRIDE;
    var span = s[b] - s[a], f = span > 0 ? Math.min(1, Math.max(0, (t - s[a]) / span)) : 0;
    var q = [0, 0, 0, 0], d = 0;
    for (var i = 0; i < 4; i++) d += s[a + 3 + i] * s[b + 3 + i];
    var sign = d < 0 ? -1 : 1, len = 0;
    for (i = 0; i < 4; i++) { q[i] = s[a + 3 + i] * (1 - f) + sign * s[b + 3 + i] * f; len += q[i] * q[i]; }
    len = Math.sqrt(len) || 1;
    for (i = 0; i < 4; i++) q[i] /= len;
    var ya = s[a + 7], yb = s[b + 7], dy = ((yb - ya + 540) % 360) - 180;
    return { x: s[a + 1] + (s[b + 1] - s[a + 1]) * f, z: s[a + 2] + (s[b + 2] - s[a + 2]) * f, q: q, bodyYaw: ya + dy * f };
  }
  // head forward vector (Unity: q * (0,0,1)) -> yaw in degrees, atan2(x, z)
  function headYaw(q) {
    var x = q[0], y = q[1], z = q[2], w = q[3];
    var fx = 2 * (x * z + w * y), fz = 1 - 2 * (x * x + y * y);
    return Math.atan2(fx, fz) * 180 / Math.PI;
  }
  function headPitch(q) {
    var x = q[0], y = q[1], z = q[2], w = q[3];
    var fy = 2 * (y * z - w * x);
    return Math.asin(Math.max(-1, Math.min(1, fy))) * 180 / Math.PI;
  }
  function wrap(a) { return ((a + 540) % 360) - 180; }

  // ---------------- UI ----------------
  function buildControls() {
    $('env-seg').innerHTML = ENVS.map(function (e) {
      return '<button data-env="' + e + '"' + (e === state.env ? ' class="on"' : '') + '>' + ENV_LABEL[e] + '</button>';
    }).join('');
    $('env-seg').addEventListener('click', function (ev) {
      var b = ev.target.closest('button'); if (!b) return;
      state.env = b.dataset.env; setOn('env-seg', b); loadScene();
    });
    $('cond-seg').addEventListener('click', function (ev) {
      var b = ev.target.closest('button'); if (!b) return;
      state.cond = b.dataset.cond; setOn('cond-seg', b); loadScene();
    });
    Array.prototype.forEach.call($('cond-seg').children, function (b) { b.classList.toggle('on', b.dataset.cond === state.cond); });
    document.querySelectorAll('.viewer-tabs .tab').forEach(function (b) {
      b.addEventListener('click', function () {
        document.querySelectorAll('.viewer-tabs .tab').forEach(function (x) { x.classList.toggle('on', x === b); });
        state.view = b.dataset.view;
        topdown.hidden = state.view !== 'topdown';
        $('unity-wrap').hidden = state.view !== 'unity';
        $('cam-seg').hidden = state.view !== 'unity';
        draw();
      });
    });
    $('cam-seg').addEventListener('click', function (ev) {
      var b = ev.target.closest('button'); if (!b) return;
      state.cam = b.dataset.cam; setOn('cam-seg', b); pushCamera();
    });
    $('play').addEventListener('click', togglePlay);
    $('scrub').addEventListener('input', function () { state.u = this.value / 1000; state.playing = false; updatePlayIcon(); draw(); pushProgress(); });
    $('unity-load').addEventListener('click', loadUnity);
    window.addEventListener('resize', draw);
    window.addEventListener('themechange', draw);
    matchMedia('(prefers-color-scheme: dark)').addEventListener('change', draw);
  }
  function setOn(id, btn) { Array.prototype.forEach.call($(id).children, function (x) { x.classList.toggle('on', x === btn); }); }

  function buildMethodRows() {
    var d = state.data;
    $('methods').innerHTML = METHODS.map(function (m) {
      var list = d.methods[m] || [];
      var opts = list.map(function (r, i) { return '<option value="' + i + '"' + (i === state.trial[m] ? ' selected' : '') + '>' + r.label + '</option>'; }).join('');
      return '<div class="method-row" style="--c:' + color(m) + '"><input type="checkbox" id="vis-' + m + '"' + (state.visible[m] ? ' checked' : '') +
        (list.length ? '' : ' disabled') + '><span class="dot"></span><label for="vis-' + m + '"><b>' + m + '</b> <span class="muted">' +
        METHOD_NOTE[m] + '</span></label><select data-m="' + m + '" aria-label="' + m + ' trial">' + opts + '</select></div>';
    }).join('');
    METHODS.forEach(function (m) {
      $('vis-' + m).addEventListener('change', function () { state.visible[m] = this.checked; draw(); pushTracks(); pushVisibility(); pushCamera(); });
    });
    $('methods').querySelectorAll('select').forEach(function (sel) {
      sel.addEventListener('change', function () { state.trial[sel.dataset.m] = +sel.value; draw(); pushTracks(); });
    });
    $('goal').textContent = d.goal;

    var r = window.SCORE_DTW.single[state.env], c = state.cond === 'MDC' ? 0 : 1;
    var maxv = Math.max(r.IntraHuman[c][0], r.Track[c][0], r.SCORE[c][0]);
    $('dtw-mini').innerHTML = [['IntraHuman', '--ink-3'], ['Track', '--track'], ['SCORE', '--score']].map(function (p) {
      var v = r[p[0]][c][0];
      return '<tr><td style="width:84px">' + p[0] + '</td><td><span class="bar" style="--c:var(' + p[1] + ');width:' + (v / maxv * 100).toFixed(0) +
        '%"></span></td><td>' + v.toFixed(3) + '</td></tr>';
    }).join('');
  }

  function loadScene() {
    var name = sceneName();
    state.u = 0; state.playing = false; updatePlayIcon();
    var done = function (d) {
      state.data = d;
      METHODS.forEach(function (m) { state.trial[m] = Math.min(state.trial[m], Math.max(0, (d.methods[m] || []).length - 1)); });
      buildMethodRows(); draw();
      if (unity) { if (unityScene !== name) unity.SendMessage('WebReplay', 'LoadScene', name); else pushAll(); }
      if (window.SCORE_onSceneChange) window.SCORE_onSceneChange(name);
    };
    if (cache[name]) return done(cache[name]);
    fetch('static/data/scenes/' + name + '.json').then(function (r) { return r.json(); }).then(function (d) { cache[name] = d; done(d); })
      .catch(function () { $('goal').textContent = 'Could not load replay data (serve the page over http).'; });
  }

  // ---------------- playback ----------------
  var last = 0;
  function refDuration() { var s = samples('SCORE') || samples('Human'); return s ? duration(s) : 10; }
  function togglePlay() {
    if (state.u >= 1) state.u = 0;
    state.playing = !state.playing; updatePlayIcon();
    last = performance.now(); if (state.playing) requestAnimationFrame(tick);
  }
  function updatePlayIcon() {
    $('play').innerHTML = state.playing ? '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M6 4h4v16H6zM14 4h4v16h-4z"/></svg>'
      : '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M7 4v16l13-8z"/></svg>';
    $('play').setAttribute('aria-label', state.playing ? 'Pause' : 'Play');
  }
  function tick(now) {
    if (!state.playing) return;
    var dt = Math.min(0.1, (now - last) / 1000); last = now;
    state.u = Math.min(1, state.u + dt / refDuration());
    if (state.u >= 1) { state.playing = false; updatePlayIcon(); }
    draw(); pushProgress();
    if (state.playing) requestAnimationFrame(tick);
  }

  // ---------------- drawing ----------------
  function fitCanvas(c, cssHeight) {
    var dpr = window.devicePixelRatio || 1, w = c.clientWidth || c.parentNode.clientWidth;
    var h = cssHeight || Math.round(w * 9 / 16);
    if (c.width !== Math.round(w * dpr) || c.height !== Math.round(h * dpr)) { c.width = Math.round(w * dpr); c.height = Math.round(h * dpr); }
    var ctx = c.getContext('2d'); ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    return { ctx: ctx, w: w, h: h };
  }

  function draw() {
    if (!state.data) return;
    $('scrub').value = Math.round(state.u * 1000);
    $('time-label').textContent = (state.u * refDuration()).toFixed(1) + ' s';
    if (state.view === 'topdown') drawTopdown();
    drawChart();
  }

  function drawTopdown() {
    var f = fitCanvas(topdown), ctx = f.ctx, w = f.w, h = f.h;
    ctx.fillStyle = css('--bg-soft'); ctx.fillRect(0, 0, w, h);
    var vis = METHODS.filter(function (m) { return state.visible[m] && samples(m); });
    var all = METHODS.filter(function (m) { return samples(m); });
    var minx = 1e9, maxx = -1e9, minz = 1e9, maxz = -1e9;
    all.forEach(function (m) {
      var s = samples(m);
      for (var i = 0; i < s.length; i += STRIDE) {
        minx = Math.min(minx, s[i + 1]); maxx = Math.max(maxx, s[i + 1]); minz = Math.min(minz, s[i + 2]); maxz = Math.max(maxz, s[i + 2]);
      }
    });
    var pad = 2.5; minx -= pad; maxx += pad; minz -= pad; maxz += pad;
    var sc = Math.min(w / (maxx - minx), h / (maxz - minz));
    var ox = (w - (maxx - minx) * sc) / 2, oy = (h - (maxz - minz) * sc) / 2;
    var X = function (x) { return ox + (x - minx) * sc; }, Y = function (z) { return h - oy - (z - minz) * sc; };

    // grid (1 m)
    ctx.strokeStyle = css('--line'); ctx.lineWidth = 1; ctx.beginPath();
    for (var gx = Math.ceil(minx); gx <= maxx; gx++) { ctx.moveTo(X(gx), 0); ctx.lineTo(X(gx), h); }
    for (var gz = Math.ceil(minz); gz <= maxz; gz++) { ctx.moveTo(0, Y(gz)); ctx.lineTo(w, Y(gz)); }
    ctx.globalAlpha = 0.5; ctx.stroke(); ctx.globalAlpha = 1;
    ctx.fillStyle = css('--ink-3'); ctx.font = '11px Inter, system-ui, sans-serif';
    ctx.fillText('1 m grid · top-down', 10, h - 10);

    vis.forEach(function (m) {
      var s = samples(m), col = color(m);
      // full path
      ctx.strokeStyle = col; ctx.globalAlpha = 0.25; ctx.lineWidth = 2; ctx.beginPath();
      for (var i = 0; i < s.length; i += STRIDE) { if (i === 0) ctx.moveTo(X(s[1]), Y(s[2])); else ctx.lineTo(X(s[i + 1]), Y(s[i + 2])); }
      ctx.stroke();
      // gaze trail: short ticks every 1 s up to now
      ctx.globalAlpha = 0.35; ctx.lineWidth = 1.2; ctx.beginPath();
      var tNow = state.u * duration(s);
      for (i = 0; i < s.length && s[i] <= tNow; i += STRIDE * 10) {
        var yaw = headYaw([s[i + 3], s[i + 4], s[i + 5], s[i + 6]]) * Math.PI / 180;
        ctx.moveTo(X(s[i + 1]), Y(s[i + 2]));
        ctx.lineTo(X(s[i + 1] + Math.sin(yaw) * 1.2), Y(s[i + 2] + Math.cos(yaw) * 1.2));
      }
      ctx.stroke(); ctx.globalAlpha = 1;

      var p = at(s, state.u), hy = headYaw(p.q) * Math.PI / 180, r = 9 * sc / 2;
      // field-of-view wedge (60 deg)
      var fov = 30 * Math.PI / 180, L = 4;
      ctx.fillStyle = col; ctx.globalAlpha = 0.16; ctx.beginPath();
      ctx.moveTo(X(p.x), Y(p.z));
      for (var a = -fov; a <= fov + 1e-6; a += fov / 8) ctx.lineTo(X(p.x + Math.sin(hy + a) * L), Y(p.z + Math.cos(hy + a) * L));
      ctx.closePath(); ctx.fill(); ctx.globalAlpha = 1;
      // gaze line
      ctx.strokeStyle = col; ctx.lineWidth = 2.5; ctx.beginPath();
      ctx.moveTo(X(p.x), Y(p.z)); ctx.lineTo(X(p.x + Math.sin(hy) * L), Y(p.z + Math.cos(hy) * L)); ctx.stroke();
      // body
      var by = p.bodyYaw * Math.PI / 180;
      ctx.fillStyle = col; ctx.beginPath(); ctx.arc(X(p.x), Y(p.z), Math.max(5, Math.min(9, r)), 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = css('--bg'); ctx.lineWidth = 2; ctx.beginPath();
      ctx.moveTo(X(p.x), Y(p.z)); ctx.lineTo(X(p.x + Math.sin(by) * 0.45), Y(p.z + Math.cos(by) * 0.45)); ctx.stroke();
    });

    // legend
    var lx = 12, ly = 18;
    ctx.font = '12px Inter, system-ui, sans-serif';
    vis.forEach(function (m) {
      ctx.fillStyle = color(m); ctx.beginPath(); ctx.arc(lx + 5, ly - 4, 5, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = css('--ink-2');
      var p = at(samples(m), state.u), rel = wrap(headYaw(p.q) - p.bodyYaw);
      ctx.fillText(m + '  ' + (rel >= 0 ? '+' : '') + rel.toFixed(0) + '° yaw, ' + headPitch(p.q).toFixed(0) + '° pitch', lx + 15, ly);
      ly += 18;
    });
  }

  function drawChart() {
    var f = fitCanvas(chart, 140), ctx = f.ctx, w = f.w, h = f.h;
    ctx.clearRect(0, 0, w, h);
    var L = 34, R = 8, T = 8, B = 18, ph = h - T - B, pw = w - L - R, lim = 100;
    var Y = function (v) { return T + ph / 2 - Math.max(-lim, Math.min(lim, v)) / lim * ph / 2; };
    ctx.strokeStyle = css('--line'); ctx.lineWidth = 1; ctx.beginPath();
    [-90, -45, 0, 45, 90].forEach(function (v) { ctx.moveTo(L, Y(v)); ctx.lineTo(w - R, Y(v)); });
    ctx.stroke();
    ctx.fillStyle = css('--ink-3'); ctx.font = '10px Inter, system-ui, sans-serif'; ctx.textAlign = 'right';
    [-90, 0, 90].forEach(function (v) { ctx.fillText(v, L - 5, Y(v) + 3); });
    ctx.textAlign = 'left'; ctx.fillText('start', L, h - 4); ctx.textAlign = 'right'; ctx.fillText('end of path', w - R, h - 4); ctx.textAlign = 'left';

    METHODS.forEach(function (m) {
      if (!state.visible[m] || !samples(m)) return;
      var s = samples(m), dur = duration(s);
      ctx.strokeStyle = color(m); ctx.lineWidth = 1.6; ctx.beginPath();
      var prev = null;
      for (var i = 0; i < s.length; i += STRIDE) {
        var rel = wrap(headYaw([s[i + 3], s[i + 4], s[i + 5], s[i + 6]]) - s[i + 7]);
        var x = L + (s[i] / dur) * pw, y = Y(rel);
        if (prev === null || Math.abs(rel - prev) > 120) ctx.moveTo(x, y); else ctx.lineTo(x, y);
        prev = rel;
      }
      ctx.stroke();
    });
    var cx = L + state.u * pw;
    ctx.strokeStyle = css('--ink'); ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(cx, T); ctx.lineTo(cx, T + ph); ctx.stroke();
  }

  // ---------------- Unity WebGL bridge ----------------
  function loadUnity() {
    if (unity || unityLoading) return;
    unityLoading = true;
    var btn = $('unity-load'), bar = document.querySelector('#unity-overlay .progress');
    btn.hidden = true; bar.hidden = false;
    var script = document.createElement('script');
    script.src = UNITY_BUILD + UNITY_NAME + '.loader.js';
    script.onerror = function () { failUnity('The 3D build is not available yet.'); };
    script.onload = function () {
      window.onScoreSceneReady = function (scene) {
        unityScene = scene;
        if (scene !== sceneName()) unity.SendMessage('WebReplay', 'LoadScene', sceneName());
        else pushAll();
      };
      createUnityInstance($('unity-canvas'), {
        dataUrl: UNITY_BUILD + UNITY_NAME + '.data.unityweb',
        frameworkUrl: UNITY_BUILD + UNITY_NAME + '.framework.js.unityweb',
        codeUrl: UNITY_BUILD + UNITY_NAME + '.wasm.unityweb',
        streamingAssetsUrl: 'StreamingAssets',
        companyName: 'IIIXR Lab', productName: 'SCORE Replay', productVersion: '1.0'
      }, function (p) { bar.firstElementChild.style.width = Math.round(p * 100) + '%'; })
        .then(function (inst) { unity = inst; window.scoreUnity = inst; $('unity-overlay').hidden = true; })
        .catch(function (e) { failUnity(String(e)); });
    };
    document.body.appendChild(script);
  }
  function failUnity(msg) {
    unityLoading = false;
    var o = $('unity-overlay');
    o.querySelector('p').textContent = msg + ' The top-down view shows the same data.';
    o.querySelector('.progress').hidden = true;
  }
  function firstVisible() { return METHODS.filter(function (m) { return state.visible[m] && samples(m); })[0] || 'SCORE'; }
  function pushTracks() {
    if (!unity || unityScene !== sceneName()) return;
    var tracks = METHODS.filter(function (m) { return samples(m); }).map(function (m) {
      return { id: m, label: m, color: color(m), s: samples(m) };
    });
    // the first track drives the agent placed in the scene, so put the camera target first
    var fv = firstVisible();
    tracks.sort(function (a, b) { return (a.id === fv ? -1 : 0) - (b.id === fv ? -1 : 0); });
    unity.SendMessage('WebReplay', 'SetTracks', JSON.stringify({ tracks: tracks }));
  }
  function pushVisibility() {
    if (!unity || unityScene !== sceneName()) return;
    METHODS.forEach(function (m) { unity.SendMessage('WebReplay', 'SetVisible', m + '|' + (state.visible[m] ? 1 : 0)); });
  }
  function pushCamera() { if (unity && unityScene === sceneName()) unity.SendMessage('WebReplay', 'SetCamera', state.cam + ':' + firstVisible()); }
  function pushProgress() { if (unity && unityScene === sceneName() && state.view === 'unity') unity.SendMessage('WebReplay', 'SetProgress', state.u); }
  function pushAll() { pushTracks(); pushVisibility(); pushCamera(); unity.SendMessage('WebReplay', 'SetProgress', state.u); }

  buildControls();
  loadScene();
})();
