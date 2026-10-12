// DTW numbers from the paper (Tables 1-5). [mean, 95% CI]
window.SCORE_DTW = {
  single: {
    Bus:      { IntraHuman: [[0.2845, .0259], [0.3289, .0294]], Track: [[0.4733, .0233], [0.4518, .0186]], SCORE: [[0.4591, .0243], [0.4029, .0249]] },
    Cafe:     { IntraHuman: [[0.3195, .0246], [0.3338, .0261]], Track: [[0.6367, .0200], [0.6550, .0307]], SCORE: [[0.4234, .0251], [0.5072, .0283]] },
    Crossing: { IntraHuman: [[0.1709, .0174], [0.1919, .0225]], Track: [[0.5611, .0213], [0.6504, .0223]], SCORE: [[0.2760, .0191], [0.4662, .0241]] },
    Mall:     { IntraHuman: [[0.5051, .0202], [0.2819, .0296]], Track: [[0.8337, .0355], [0.8284, .0183]], SCORE: [[0.5405, .0299], [0.4569, .0303]] },
    Street:   { IntraHuman: [[0.2491, .0205], [0.2984, .0248]], Track: [[0.5999, .0340], [0.5912, .0335]], SCORE: [[0.4705, .0298], [0.3778, .0397]] }
  },
  multi: {
    Zara01:      { Track: [0.5632, .0255], SCORE: [0.3616, .1015] },
    Zara02:      { Track: [0.4325, .0231], SCORE: [0.2657, .0832] },
    Students003: { Track: [0.5621, .0311], SCORE: [0.4471, .0956] }
  },
  responsiveness: {
    Bus:      [[0.4330, .0916], [0.4182, .0652], [0.4029, .0249]],
    Cafe:     [[0.5505, .1495], [0.5255, .0877], [0.5072, .0283]],
    Crossing: [[0.4961, .0723], [0.4832, .0555], [0.4662, .0241]],
    Mall:     [[0.4909, .0728], [0.4724, .0598], [0.4569, .0303]],
    Street:   [[0.4875, .0642], [0.4322, .0601], [0.3778, .0397]]
  },
  ablation: {
    variants: ['SCORE', 'w/o all drivers', 'w/o Interest', 'w/o Information seeking', 'w/o Safety', 'w/o Social schema', 'w/o Habit', 'w/o LLM', 'w/o RES'],
    // per env: [MDC, APC] means in the order of variants
    Bus:      [[0.4591, 0.4029], [0.4868, 0.5770], [0.4622, 0.4571], [0.4621, 0.4771], [0.4713, 0.4176], [0.4515, 0.4871], [0.4719, 0.4470], [0.4681, 0.4864], [0.5594, 0.4202]],
    Cafe:     [[0.4234, 0.5072], [0.6024, 0.5625], [0.4521, 0.5141], [0.4736, 0.5570], [0.4701, 0.5166], [0.4417, 0.5270], [0.4320, 0.5161], [0.4726, 0.5303], [0.6517, 0.5798]],
    Crossing: [[0.2760, 0.4662], [0.5976, 0.5559], [0.3321, 0.4772], [0.3021, 0.4871], [0.4700, 0.5536], [0.3147, 0.4899], [0.2819, 0.4771], [0.3793, 0.5955], [0.5601, 0.4953]],
    Mall:     [[0.5405, 0.4569], [0.5820, 0.6434], [0.5721, 0.6570], [0.5551, 0.4802], [0.5601, 0.4613], [0.5721, 0.5002], [0.5723, 0.4901], [0.5848, 0.5559], [0.5081, 0.4542]],
    Street:   [[0.4705, 0.3778], [0.4754, 0.5409], [0.4741, 0.4999], [0.4722, 0.4752], [0.4713, 0.4352], [0.4777, 0.4912], [0.4773, 0.4510], [0.4775, 0.3853], [0.5167, 0.4150]]
  }
};

(function () {
  var D = window.SCORE_DTW;
  var ENV_LABEL = { Bus: 'Bus', Cafe: 'Café', Crossing: 'Crossing', Mall: 'Mall', Street: 'Street' };
  function cell(v, best, cls) {
    return '<td class="' + (best ? 'best ' : '') + (cls || '') + '">' + v[0].toFixed(4) +
      (v[1] != null ? '<span class="ci">±' + v[1].toFixed(4).replace(/^0/, '') + '</span>' : '') + '</td>';
  }

  // Table 1
  var h = '<tr><th>Scenario</th><th>Method</th><th>MDC</th><th>APC</th></tr>';
  Object.keys(D.single).forEach(function (env) {
    var r = D.single[env];
    ['IntraHuman', 'Track', 'SCORE'].forEach(function (m, i) {
      h += '<tr>' + (i === 0 ? '<td rowspan="3" class="l"><b>' + ENV_LABEL[env] + '</b></td>' : '') +
        '<td class="l' + (m === 'IntraHuman' ? ' ih' : '') + '">' + (m === 'SCORE' ? 'SCORE (ours)' : m) + '</td>';
      for (var c = 0; c < 2; c++) {
        var best = m === 'SCORE' && r.SCORE[c][0] < r.Track[c][0];
        h += cell(r[m][c], best, m === 'IntraHuman' ? 'ih' : '');
      }
      h += '</tr>';
    });
  });
  document.getElementById('tab-single').innerHTML = h;

  // Table 2
  h = '<tr><th>Scene</th><th>Track</th><th>SCORE (ours)</th></tr>';
  Object.keys(D.multi).forEach(function (s) {
    h += '<tr><td class="l">' + s + '</td>' + cell(D.multi[s].Track, false) + cell(D.multi[s].SCORE, true) + '</tr>';
  });
  document.getElementById('tab-multi').innerHTML = h;

  // Table 3
  h = '<tr><th>Scenario</th><th>MDC-MDC</th><th>MDC-APC</th><th>APC-APC</th></tr>';
  Object.keys(D.responsiveness).forEach(function (env) {
    var r = D.responsiveness[env];
    h += '<tr><td class="l">' + ENV_LABEL[env] + '</td>' + cell(r[0]) + cell(r[1]) + cell(r[2], true) + '</tr>';
  });
  document.getElementById('tab-resp').innerHTML = h;

  // Table 4 (means only)
  var A = D.ablation, envs = ['Bus', 'Cafe', 'Crossing', 'Mall', 'Street'];
  h = '<tr><th>Variant</th>' + envs.map(function (e) { return '<th colspan="2">' + ENV_LABEL[e] + '</th>'; }).join('') + '</tr>';
  h += '<tr><th></th>' + envs.map(function () { return '<th>MDC</th><th>APC</th>'; }).join('') + '</tr>';
  A.variants.forEach(function (v, i) {
    h += '<tr><td class="l">' + v + '</td>';
    envs.forEach(function (e) {
      for (var c = 0; c < 2; c++) {
        var val = A[e][i][c];
        var min = Math.min.apply(null, A[e].map(function (r) { return r[c]; }));
        h += '<td class="' + (val === min ? 'best' : '') + '">' + val.toFixed(4) + '</td>';
      }
    });
    h += '</tr>';
  });
  document.getElementById('tab-ablation').innerHTML = h;
})();
