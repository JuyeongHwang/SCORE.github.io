// Action-reason traces logged from SCORE runs (static/data/examples.json) and
// time-stamped plans exported by the released code (static/data/plans/*.json).
(function () {
  var SCENE_LABEL = {
    CrossingAbnormal: 'Crossing · APC', CrossingNormal: 'Crossing · MDC', MallNormal: 'Mall · MDC',
    MallAbnormal: 'Mall · APC', CafeNormal: 'Café · MDC', CafeAbnormal: 'Café · APC',
    BusNormal: 'Bus · MDC', BusAbnormal: 'Bus · APC', StreetNormal: 'Street · MDC', StreetAbnormal: 'Street · APC'
  };
  var DRIVERS = [['Safety', '--drv-safety'], ['Interest', '--drv-interest'], ['Social schema', '--drv-social'],
                 ['Information seeking', '--drv-info'], ['Habit', '--drv-habit']];
  var items = [];

  function esc(s) { return String(s || '').replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }

  function render(i) {
    var it = items[i];
    document.querySelectorAll('#ex-list button').forEach(function (b) { b.classList.toggle('on', +b.dataset.i === i); });
    document.getElementById('ex-meta').textContent = it.meta;
    document.getElementById('ex-trace').innerHTML = it.steps.map(function (s, k) {
      var override = s.res && s.res !== 'keep';
      var scores = '';
      if (s.scores && s.scores.length === 5) {
        scores = '<div class="scores" style="margin-top:8px">' + DRIVERS.map(function (d, j) {
          return '<div><span>' + d[0] + '</span><i style="--c:var(' + d[1] + ');width:' + (s.scores[j] * 10) + '%"></i><span>' + s.scores[j] + '</span></div>';
        }).join('') + '</div>';
      }
      return '<div class="step' + (override ? ' override' : '') + '"><div class="act"><span class="n">' +
        (s.time != null ? s.time.toFixed(1) + ' s' : '#' + (k + 1)) + '</span>' + esc(s.action) + '</div>' +
        (s.explanation ? '<p>' + esc(s.explanation) + '</p>' : '') + scores +
        (s.res ? '<div class="res"><b>RES:</b> ' + (override ? 'override → <b>' + esc(s.res) + '</b>' : 'keep') +
          (s.resExplanation ? ' — ' + esc(s.resExplanation) : '') + '</div>' : '') + '</div>';
    }).join('');
  }

  function build(groups) {
    var html = '';
    groups.forEach(function (g) {
      if (!g.items.length) return;
      html += '<div class="grp">' + g.title + '</div>';
      g.items.forEach(function (it) { items.push(it); html += '<button data-i="' + (items.length - 1) + '">' + esc(it.label) + '</button>'; });
    });
    var list = document.getElementById('ex-list');
    list.innerHTML = html;
    list.addEventListener('click', function (ev) { var b = ev.target.closest('button'); if (b) render(+b.dataset.i); });
    if (items.length) render(0);
  }

  function fromPlan(p, file) {
    return {
      label: (SCENE_LABEL[p.scene] || p.scene) + ' · ' + (p.model || 'local'),
      meta: 'Time-stamped plan exported by the released code (' + (p.model || '') + '). Time = trajectory clock at which the pose is displayed; RES validated each entry 2 s earlier.',
      steps: p.plan.map(function (e) {
        return { time: e.time, action: e.action, explanation: e.explanation, scores: e.scores, res: e.resAction || null };
      })
    };
  }

  Promise.all([
    fetch('static/data/examples.json').then(function (r) { return r.json(); }),
    fetch('static/data/plans/index.json').then(function (r) { return r.ok ? r.json() : []; }).catch(function () { return []; })
  ]).then(function (res) {
    var ex = res[0], plans = res[1];
    return Promise.all(plans.map(function (f) {
      return fetch('static/data/plans/' + f).then(function (r) { return r.json(); }).then(function (p) { return fromPlan(p, f); });
    })).then(function (planItems) {
      build([
        { title: 'Single agent (DPS plan)', items: ex.single.map(function (s) {
          return { label: (SCENE_LABEL[s.scene] || s.scene) + ' · ' + s.run, meta: s.steps.length + ' decisions in order (Gemini).', steps: s.steps };
        }) },
        { title: 'Multi-agent (DPS + RES)', items: ex.multi.map(function (m) {
          var n = m.steps.filter(function (s) { return s.res && s.res !== 'keep'; }).length;
          return { label: m.scene + ' · ' + m.agent, meta: m.steps.length + ' planned actions, ' + n + ' changed by RES.', steps: m.steps };
        }) },
        { title: 'Ablation: driver removed', items: ex.ablation.map(function (a) {
          return { label: a.variant + ' · ' + a.scene, meta: 'Prompt without the ' + a.variant.replace('w/o ', '') + ' driver.', steps: a.steps };
        }) },
        { title: 'Released code · local Qwen', items: planItems }
      ]);
    });
  });
})();
