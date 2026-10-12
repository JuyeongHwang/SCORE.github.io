// Head-direction trajectories (supplementary Figs. 7-11) + interactive unit-sphere view from the replay data.
(function () {
  var ENVS = [['Bus', 'bus', 7], ['Cafe', 'cafe', 8], ['Crossing', 'crossing', 9], ['Mall', 'mall', 10], ['Street', 'street', 11]];
  var LABEL = { Bus: 'Bus', Cafe: 'Café', Crossing: 'Crossing', Mall: 'Mall', Street: 'Street' };
  var METHODS = ['Human', 'SCORE', 'Track'];
  var STRIDE = 8;
  var st = { env: 'Bus', cond: 'MDC', trial: 0, yaw: -35, pitch: 20 };
  var cache = {}, canvases = {};
  var $ = function (id) { return document.getElementById(id); };
  function css(n) { return getComputedStyle(document.documentElement).getPropertyValue(n).trim(); }
  function col(m) { return css(m === 'SCORE' ? '--score' : m === 'Human' ? '--human' : '--track'); }

  // tabs + static figure
  $('hr-env').innerHTML = ENVS.map(function (e) {
    return '<button role="tab" class="' + (e[0] === st.env ? 'on' : '') + '" data-env="' + e[0] + '">' + LABEL[e[0]] + '</button>';
  }).join('');
  $('hr-env').addEventListener('click', function (ev) {
    var b = ev.target.closest('button'); if (!b) return;
    st.env = b.dataset.env;
    Array.prototype.forEach.call(this.children, function (x) { x.classList.toggle('on', x === b); });
    showFigure(); load();
  });
  function showFigure() {
    var e = ENVS.filter(function (x) { return x[0] === st.env; })[0];
    $('hr-img').src = 'static/images/supp/headrot_' + e[1] + '.jpg';
    $('hr-cap').innerHTML = 'Supplementary Fig. ' + e[2] + ': head-rotation examples in the ' + LABEL[e[0]] +
      ' scenario (APC left, MDC right; two examples each) for Human, SCORE (ours) and Track.';
  }
  function seg(id, key, parse) {
    $(id).addEventListener('click', function (ev) {
      var b = ev.target.closest('button'); if (!b) return;
      st[key] = parse(b);
      Array.prototype.forEach.call(this.children, function (x) { x.classList.toggle('on', x === b); });
      load();
    });
  }
  seg('hr-cond', 'cond', function (b) { return b.dataset.cond; });
  seg('hr-trial', 'trial', function (b) { return +b.dataset.t; });
  $('hr-reset').addEventListener('click', function () { st.yaw = -35; st.pitch = 20; drawAll(); });

  // sphere canvases
  $('hr-spheres').innerHTML = METHODS.map(function (m) {
    return '<figure class="figure-card" style="background:var(--card)"><canvas data-m="' + m + '" style="width:100%;aspect-ratio:1;cursor:grab;touch-action:none"></canvas>' +
      '<figcaption style="text-align:center;margin-top:4px"><b style="color:' + col(m) + '">' + (m === 'SCORE' ? 'SCORE (ours)' : m) + '</b> <span id="hr-n-' + m + '"></span></figcaption></figure>';
  }).join('');
  $('hr-spheres').querySelectorAll('canvas').forEach(function (c) {
    canvases[c.dataset.m] = c;
    var drag = null;
    c.addEventListener('pointerdown', function (e) { drag = [e.clientX, e.clientY]; c.setPointerCapture(e.pointerId); c.style.cursor = 'grabbing'; });
    c.addEventListener('pointermove', function (e) {
      if (!drag) return;
      st.yaw += (e.clientX - drag[0]) * 0.5; st.pitch = Math.max(-89, Math.min(89, st.pitch + (e.clientY - drag[1]) * 0.5));
      drag = [e.clientX, e.clientY]; drawAll();
    });
    c.addEventListener('pointerup', function () { drag = null; c.style.cursor = 'grab'; });
  });

  function scene() { return st.env + (st.cond === 'MDC' ? 'Normal' : 'Abnormal'); }
  function load() {
    var n = scene();
    if (cache[n]) return drawAll();
    fetch('static/data/scenes/' + n + '.json').then(function (r) { return r.json(); }).then(function (d) { cache[n] = d; drawAll(); });
  }

  // world forward vector of the head (Unity: q * (0,0,1))
  function fwd(s, i) {
    var x = s[i + 3], y = s[i + 4], z = s[i + 5], w = s[i + 6];
    return [2 * (x * z + w * y), 2 * (y * z - w * x), 1 - 2 * (x * x + y * y)];
  }
  function project(v) {
    var cy = Math.cos(st.yaw * Math.PI / 180), sy = Math.sin(st.yaw * Math.PI / 180);
    var cp = Math.cos(st.pitch * Math.PI / 180), sp = Math.sin(st.pitch * Math.PI / 180);
    var x = v[0] * cy - v[2] * sy, z = v[0] * sy + v[2] * cy;
    var y = v[1] * cp - z * sp, d = v[1] * sp + z * cp;
    return [x, y, d];
  }

  function drawAll() {
    var d = cache[scene()]; if (!d) return;
    METHODS.forEach(function (m) {
      var list = d.methods[m] || [];
      var run = list[Math.min(st.trial, list.length - 1)];
      $('hr-n-' + m).textContent = run ? '· ' + run.label : '';
      draw(canvases[m], run ? run.s : null, col(m));
    });
  }

  function draw(c, s, color) {
    var dpr = window.devicePixelRatio || 1, w = c.clientWidth;
    c.width = Math.round(w * dpr); c.height = Math.round(w * dpr);
    var ctx = c.getContext('2d'); ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    var R = w * 0.4, cx = w / 2, cy = w / 2;
    var P = function (v) { var p = project(v); return [cx + p[0] * R, cy - p[1] * R, p[2]]; };
    ctx.clearRect(0, 0, w, w);
    ctx.strokeStyle = css('--line'); ctx.lineWidth = 1;
    ctx.beginPath(); ctx.arc(cx, cy, R, 0, Math.PI * 2); ctx.stroke();
    // latitude / longitude wireframe (front half only)
    function poly(fn) {
      ctx.beginPath(); var pen = false;
      for (var k = 0; k <= 72; k++) {
        var p = P(fn(k / 72 * Math.PI * 2));
        if (p[2] > 0.02) { if (pen) ctx.lineTo(p[0], p[1]); else ctx.moveTo(p[0], p[1]); pen = true; } else pen = false;
      }
      ctx.stroke();
    }
    [-60, -30, 0, 30, 60].forEach(function (lat) {
      var r = Math.cos(lat * Math.PI / 180), y = Math.sin(lat * Math.PI / 180);
      poly(function (a) { return [r * Math.sin(a), y, r * Math.cos(a)]; });
    });
    for (var lon = 0; lon < 180; lon += 30) {
      var a0 = lon * Math.PI / 180;
      poly(function (a) { return [Math.cos(a) * Math.sin(a0), Math.sin(a), Math.cos(a) * Math.cos(a0)]; });
    }
    // axes
    ctx.font = '11px Inter, system-ui, sans-serif'; ctx.fillStyle = css('--ink-3');
    [[[1.15, 0, 0], 'X'], [[0, 1.15, 0], 'Up'], [[0, 0, 1.15], 'Z']].forEach(function (a) {
      var o = P([0, 0, 0]), p = P(a[0]);
      ctx.strokeStyle = css('--ink-3'); ctx.beginPath(); ctx.moveTo(o[0], o[1]); ctx.lineTo(p[0], p[1]); ctx.stroke();
      ctx.fillText(a[1], p[0] + 3, p[1] - 3);
    });
    if (!s) return;
    var n = s.length / STRIDE, pts = [];
    for (var i = 0; i < s.length; i += STRIDE) pts.push(P(fwd(s, i)));
    // back-to-front so hidden points are drawn first and faded
    var order = pts.map(function (p, k) { return k; }).sort(function (a, b) { return pts[a][2] - pts[b][2]; });
    order.forEach(function (k) {
      var p = pts[k], t = k / Math.max(1, n - 1);
      ctx.globalAlpha = (0.25 + 0.75 * t) * (p[2] < 0 ? 0.35 : 1);
      ctx.fillStyle = color; ctx.beginPath(); ctx.arc(p[0], p[1], 2.4, 0, Math.PI * 2); ctx.fill();
    });
    ctx.globalAlpha = 1;
  }

  window.addEventListener('resize', drawAll);
  window.addEventListener('themechange', drawAll);
  showFigure(); load();
})();
