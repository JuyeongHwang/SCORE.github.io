// Runs the SCORE DPS prompts (VLM perception -> LLM planning) against the visitor's own Ollama server.
// The prompts are the ones used in SingleFutureVLMLLMConnector.cs.
(function () {
  var $ = function (id) { return document.getElementById(id); };
  var SAMPLES = [
    { img: 'crossing_taxi', goal: 'Cross safely to the other side.',
      objects: 'SM_Env_Road_Crossing_06, SM_Env_Road_Bare_04, SM_Veh_Taxi_01, SM_Prop_TrafficLight_01, SM_Prop_Manhole_07, BusinessMan, Policeman' },
    { img: 'cafe', goal: 'Locate and sit at a table by the window.',
      objects: 'SM_Prop_Cafe_Table_01, SM_Prop_Cafe_Chair_01 (14), SM_Prop_Cafe_Chair_01 (15), SM_Bld_Window_Large_01, SM_Prop_Cafe_Counter_01, SM_Prop_Shopping_Bag_01, Character_BusinessWoman' },
    { img: 'street_ahead', goal: 'Walk safely to the far end of the street. You have a habit of looking at the sky.',
      objects: 'SM_Env_Sidewalk_01, SM_Veh_Car_Muscle_01, SM_Prop_Shopping_Cart_01, SM_Prop_Streetlight_01, SM_Prop_Sign_Sale_01, SM_Env_Tree_Palm_01' },
    { img: 'street_sky', goal: 'Walk safely to the far end of the street. You have a habit of looking at the sky.',
      objects: 'SM_Prop_Streetlight_01, SM_Env_Tree_Palm_01, SM_Bld_Shop_Roof_01, SM_Env_Sky_Clouds' },
    { img: 'mall_people', goal: 'Move from one end of the mall to the opposite side.',
      objects: 'Character_Male_Hoodie, Character_BusinessWoman, SM_Sign_Canvas_Banner_05, SM_Prop_Mall_Map_01, SM_Bld_Wall_Glass_Door_Double_01, SM_Prop_Pillar_01' }
  ];
  var current = 0, imageB64 = null, historyLog = '';

  function vlmPrompt(goal, memory, objects) {
    return '\nYou are a person navigating through an environment. You understand that vision plays a crucial role in interacting with appropriately with your surroundings-both to discover interesting things and to avoid potential dangers. And be careful-if your neck twists too far, you stop looking human.\n\n' +
      'Here is the information currently available to you:\n-Cognitive goal: ' + goal + '\n-Current Memory: ' + memory + '\n-Object List: ' + objects + '\n\n' +
      '#Stage 1: Memory Update\nYour task is to match the given image input with the provided object list and generate updated descriptions for each object.\n\n' +
      '### Strategy:\n0. Do not add any information about objects that are not in the provided object list. And Do not change the object name in list.\n' +
      '1. Update the memory with information about the top 10 objects from the object list that are most closely related to the cognitive goal.\n' +
      '2. If new information is observed about these objects (e.g., updated position, state, or attributes), incorporate it into the memory.\n' +
      '3. Retain any previously known information that remains valid and is not contradicted by new observations.\n' +
      '4. If an object is relevant to the Cognitive Goal, include that in the memory update.\n\n' +
      '# Stage 2: Visual Summary\n- The images were captured every 0.2 seconds to reflect your changing visual perspective.\n' +
      '- Summarize the visual changes across the image sequence and provide a concise explanation of the current situation.\n' +
      '- Do you observe any moving objects? If so, include them in the memory update.\n\n' +
      '### STRICT NAMING POLICY\nYou must **never** introduce, reference, or invent any object or entity name that does **not** appear verbatim in the **"Object List"** above.\n\n' +
      'Output Format:\n\n## Final Output Format:\n---MEMORY---\n[Name1 : explain1, \nName2 : explain2, \nName3 : explain3, \n...]\n\n---SUMMARY---\n[Your summary here]\n';
  }

  function llmPrompt(goal, memory, objects, summary, history, pitch, yaw) {
    return '\nYou are a person navigating through an environment. You understand that vision plays a crucial role in interacting with appropriately with your surroundings-both to discover interesting things and to avoid potential dangers. And be careful-if your neck twists too far, you stop looking human.\n\n' +
      'Here is the information currently available to you:\n\n- Cognitive goal: ' + goal + '\n- Current Memory: ' + memory + '\n- Object list: ' + objects +
      '\n- Visual Information Summary: ' + summary + '\n- History Decision Actions: ' + history +
      '\n- Your head is turned(x: ' + pitch + ', y: ' + yaw + ') degrees away from your body.\n\n' +
      '# Decision Making\n\n### Instructions:\n\n## Step 1: Task Manager\n1. **Cognitive Goal Analysis**: Break down the cognitive goal into specific and actionable subtasks.\n' +
      '2. **Subtask Objectives**: Create five subtasks, each focusing on one of the following dimensions:\n' +
      '   - **Safety**: Actions that minimize risk or ensure physical security.\n   - **Interest**: Actions that fulfill curiosity or inquisitiveness.\n' +
      '   - **Social Schema**: Actions aligned with social norms.\n' +
      '   - **Information-Seeking**: Actions aimed at acquiring more details or clarifying uncertain aspects of the environment. If the object list is insufficient, consider exploring the environment to gather additional information.\n' +
      '   - **Habit**: Common human routines.\n\n## Step 2: Decision and Action\n1. **Decision Process**:\n' +
      '   - Check whether the cognitive goal can be addressed using any object from the Object List.\n   - If not, or if exploration would better serve the goal, choose to explore based on the context.\n\n' +
      '2. **Action Types**:\n   - For known objects: Output must be **"Looking at<object name>"**. Only include object names from the "Object List". And Do not add any explanations or descriptions after the action.\n' +
      '   - For exploration: Output must be **"Search <direction>"**, where direction ∈[left, right, up, down, forward]. Only one direction can be selected.\n\n' +
      '### Final Constraints: \n- You must only select from the "Object List" when focusing on an object.\n- If an action has already occurred twice, clearly explain why a new action was selected this time.\n' +
      '- Include in Explanation why you chose the action\n- Balanced exploration: Use exploration appropriately - don\'t over-rely on the same strategy.\n\n' +
      '# Final Scoring Instruction\nAfter deciding the action, distribute a total of 10 points across the five subtasks (Safety, Interest, Social Schema, Information-Seeking, Habit) to indicate your focus. \n\n' +
      'Output Format:\n\n## Final Output Format:\n---REASONING---\n[Your reasoning process here]\n\n---Scores---\n[SafetyScore, InterestScore, SocialSchemaScore, InformationSeekingScore, HabitScore]";\n\n' +
      '---Explanation---\n[Your explanation here]\n\n---Action---\n[Your final action here - either "Looking at <object name>" or "Search <direction>"]';
  }

  function pick(text, re) { var m = text.match(re); return m ? m[1].trim() : ''; }
  function stripThink(t) { return t.replace(/<think>[\s\S]*?<\/think>/g, '').trim(); }
  function cleanAction(a) { return a.split('\n')[0].replace(/^[\s\[\]*"'`]+|[\s\[\]*"'`.]+$/g, ''); }
  function esc(s) { return String(s || '').replace(/[&<>]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]; }); }
  function status(msg, cls) { var s = $('ol-status'); s.textContent = msg; s.className = 'status' + (cls ? ' ' + cls : ''); }
  function base() { return $('ol-url').value.replace(/\/+$/, ''); }

  function chat(prompt, images) {
    var msg = { role: 'user', content: prompt };
    if (images) msg.images = images;
    return fetch(base() + '/api/chat', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: $('ol-model').value, messages: [msg], stream: false, think: false, options: { temperature: 0.7, num_ctx: 8192 } })
    }).then(function (r) {
      if (!r.ok) return r.text().then(function (t) { throw new Error('HTTP ' + r.status + ': ' + t); });
      return r.json();
    }).then(function (j) { return stripThink((j.message && j.message.content) || ''); });
  }

  function connect() {
    status('Connecting to ' + base() + ' …');
    return fetch(base() + '/api/tags').then(function (r) { return r.json(); }).then(function (j) {
      var names = (j.models || []).map(function (m) { return m.name; });
      if (!names.length) { status('Connected, but no models are installed. Run: ollama pull qwen3-vl:8b', 'err'); return; }
      var sel = $('ol-model'), prev = sel.value;
      sel.innerHTML = names.map(function (n) { return '<option>' + esc(n) + '</option>'; }).join('');
      var pref = names.indexOf(prev) >= 0 ? prev : (names.filter(function (n) { return /vl/i.test(n); })[0] || names[0]);
      sel.value = pref;
      status('Connected · ' + names.length + ' model(s). Pick a vision-language model (e.g. qwen3-vl).', 'ok');
    }).catch(function () {
      status('Could not reach Ollama. Is it running with OLLAMA_ORIGINS set to this page\'s origin (' + location.origin + ')?', 'err');
    });
  }

  function loadImage(name) {
    return fetch('static/images/fov/' + name + '.jpg').then(function (r) { return r.blob(); }).then(function (b) {
      return new Promise(function (res) { var fr = new FileReader(); fr.onload = function () { res(fr.result.split(',')[1]); }; fr.readAsDataURL(b); });
    });
  }

  function select(i) {
    current = i; historyLog = '';
    var s = SAMPLES[i];
    $('ol-goal').value = s.goal; $('ol-objects').value = s.objects; $('ol-memory').value = '';
    document.querySelectorAll('#fov-pick img').forEach(function (im, k) { im.classList.toggle('on', k === i); });
    imageB64 = null;
    loadImage(s.img).then(function (b) { if (current === i) imageB64 = b; });
    showPrompts();
  }

  function showPrompts() {
    var pose = $('ol-pose').value.split(',');
    $('ol-prompts').textContent = '=== VLM (Perception Module) ===\n' + vlmPrompt($('ol-goal').value, $('ol-memory').value, $('ol-objects').value) +
      '\n\n=== LLM (Planning Module) ===\n' + llmPrompt($('ol-goal').value, '<VLM memory>', $('ol-objects').value, '<VLM summary>', historyLog,
        (pose[0] || '0').trim(), (pose[1] || '0').trim());
  }

  function run() {
    var goal = $('ol-goal').value, objects = $('ol-objects').value, pose = $('ol-pose').value.split(',');
    var btn = $('ol-run'); btn.classList.add('disabled');
    var t0 = performance.now();
    status('1/2 · VLM is describing the view …');
    $('ol-out').innerHTML = '<p class="muted">Waiting for the model … the first call can take a while because the model has to be loaded.</p>';
    var mem, summary, vlmSec;
    (imageB64 ? Promise.resolve(imageB64) : loadImage(SAMPLES[current].img)).then(function (img) {
      return chat(vlmPrompt(goal, $('ol-memory').value, objects), [img]);
    }).then(function (vlm) {
      vlmSec = (performance.now() - t0) / 1000;
      mem = pick(vlm, /---MEMORY---([\s\S]*?)---SUMMARY---/) || vlm;
      summary = pick(vlm, /---SUMMARY---\s*([\s\S]*)/);
      status('2/2 · LLM is reasoning over the five drivers …');
      t0 = performance.now();
      return chat(llmPrompt(goal, mem, objects, summary, historyLog, (pose[0] || '0').trim(), (pose[1] || '0').trim()));
    }).then(function (llm) {
      var llmSec = (performance.now() - t0) / 1000;
      var scores = (pick(llm, /---Scores---\s*\[?([0-9,\s]+)\]?/) || '').split(',').map(function (x) { return parseInt(x, 10); }).filter(function (x) { return !isNaN(x); });
      var expl = pick(llm, /---Explanation---([\s\S]*?)---Action---/);
      var action = cleanAction(pick(llm, /---Action---\s*([\s\S]*)/));
      var reasoning = pick(llm, /---REASONING---([\s\S]*?)---Scores---/);
      historyLog += 'Explanation: ' + expl + '\nAction: ' + action + '\n';
      $('ol-memory').value = mem;
      render({ action: action, expl: expl, scores: scores, reasoning: reasoning, mem: mem, summary: summary, raw: llm });
      status('Done · VLM ' + vlmSec.toFixed(1) + ' s, LLM ' + llmSec.toFixed(1) + ' s. Memory and history are kept for the next decision.', 'ok');
      showPrompts();
    }).catch(function (e) {
      status('Request failed: ' + e.message + '. Check that Ollama runs with OLLAMA_ORIGINS=' + location.origin, 'err');
    }).then(function () { btn.classList.remove('disabled'); });
  }

  function render(o) {
    var D = [['Safety', '--drv-safety'], ['Interest', '--drv-interest'], ['Social schema', '--drv-social'], ['Information seeking', '--drv-info'], ['Habit', '--drv-habit']];
    var sc = o.scores.length === 5 ? '<div class="scores">' + D.map(function (d, i) {
      return '<div><span>' + d[0] + '</span><i style="--c:var(' + d[1] + ');width:' + (o.scores[i] * 10) + '%"></i><span>' + o.scores[i] + '</span></div>';
    }).join('') + '</div>' : '<div class="val muted">(no scores parsed)</div>';
    $('ol-out').innerHTML =
      '<div class="out-block"><h5>Action</h5><span class="action-chip">' + esc(o.action || '(no action parsed)') + '</span></div>' +
      '<div class="out-block"><h5>Driver allocation (10 points)</h5>' + sc + '</div>' +
      '<div class="out-block"><h5>Explanation</h5><div class="val">' + esc(o.expl) + '</div></div>' +
      '<details class="out-block"><summary>Reasoning</summary><div class="val" style="margin-top:8px">' + esc(o.reasoning) + '</div></details>' +
      '<details class="out-block"><summary>Perception memory (VLM)</summary><div class="val" style="margin-top:8px">' + esc(o.mem) +
      (o.summary ? '\n\nSummary: ' + esc(o.summary) : '') + '</div></details>' +
      (o.action ? '' : '<details class="out-block" open><summary>Raw output</summary><div class="val">' + esc(o.raw) + '</div></details>');
  }

  // init
  var origin = location.origin.indexOf('http') === 0 ? location.origin : 'https://juyeonghwang.github.io';
  $('origins-sh').textContent = 'OLLAMA_ORIGINS="' + origin + '" ollama serve';
  $('origins-ps').textContent = '[Environment]::SetEnvironmentVariable("OLLAMA_ORIGINS", "' + origin + '", "User")\n' +
    'Stop-Process -Name "ollama app","ollama" -Force; Start-Process "$env:LOCALAPPDATA\\Programs\\Ollama\\ollama app.exe"';
  $('fov-pick').innerHTML = SAMPLES.map(function (s, i) {
    return '<img src="static/images/fov/' + s.img + '.jpg" alt="Agent view sample ' + (i + 1) + '" data-i="' + i + '">';
  }).join('');
  $('fov-pick').addEventListener('click', function (e) { if (e.target.dataset.i) select(+e.target.dataset.i); });
  ['ol-goal', 'ol-objects', 'ol-memory', 'ol-pose'].forEach(function (id) { $(id).addEventListener('input', showPrompts); });
  $('ol-check').addEventListener('click', connect);
  $('ol-run').addEventListener('click', run);
  select(0);
})();
