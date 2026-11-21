// Amma's phone: waits for a call, rings, and runs the live Telugu conversation.
import { h, icon, api, poll, time, slotOf, packCard } from './ui.mjs';
import { VoiceCall } from './realtime.mjs';
import { runsOn } from './schedule.mjs';
import { turnChip } from './family.mjs';

const T = {
  ready: 'ఫోన్ సిద్ధం చేయడానికి నొక్కండి',
  readyEn: 'Tap once so the phone can ring and hear you',
  hello: name => 'నమస్కారం, ' + name + ' గారు',
  idle: 'మందుల సమయానికి On Time కాల్ చేస్తుంది',
  next: 'తదుపరి మందు',
  calling: 'On Time కాల్ చేస్తోంది…',
  answer: 'ఎత్తండి',
  decline: 'వద్దు',
  connecting: 'కలుపుతోంది…',
  ended: 'కాల్ ముగిసింది',
  speaking: 'మాట్లాడుతోంది',
  listening: 'వింటోంది',
  noMic: 'Microphone is blocked. Allow it in the browser’s site settings and reload.',
};

export function mountPhone(root, id, { stage = false } = {}) {
  let data = null;
  let screen = 'locked';
  let microphone = null;
  let audioContext = null;
  let ringer = null;
  let voice = null;
  let call = null;
  let mode = 'ontime';
  let caption = '';
  let heard = '';
  let pack = null;
  let turns = [];
  let agentState = 'speaking';
  let error = '';
  let queue = [];
  let flushTimer = null;
  let clockTimer = null;
  let advancing = false;

  const phone = h('div', { class: 'phone' });
  root.append(h('div', { class: 'phone-page' }, phone));

  const poller = poll(id, fresh => {
    data = fresh;
    if (screen === 'idle' && data.ring) ring();
    if (screen === 'ringing' && !data.ring) stopRinging('idle');
    if (screen === 'idle' && data.followUp && data.followUp.at <= data.serverTime && !advancing) {
      advancing = true;
      api.advance(id).catch(() => {}).finally(() => { advancing = false; });
    }
    if (['idle', 'locked'].includes(screen)) render();
  }, { interval: 1200 });

  function render() {
    phone.replaceChildren(statusBar(), ...view().filter(Boolean));
  }

  function statusBar() {
    return h('div', { class: 'status' }, h('span', {}, time(Date.now())), h('span', {}, '📶 🔋'));
  }

  function view() {
    const name = data?.patient?.name ?? 'Amma';
    if (screen === 'locked') {
      return [h('div', { class: 'center' },
        h('div', { class: 'orb' }, icon('logo')),
        h('div', { class: 'greet te' }, T.hello(name)),
        h('button', { class: 'btn ready-btn te', onclick: unlock }, T.ready),
        h('div', { class: 'soft small' }, T.readyEn),
        error ? h('div', { class: 'error-banner' }, error) : null)];
    }
    if (screen === 'idle') {
      const next = nextMedicine();
      return [h('div', { class: 'center' },
        h('div', { class: 'big-time' }, new Date().toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' }).replace(/\s?[ap]m/i, '')),
        h('div', { class: 'greet te' }, T.hello(name)),
        h('div', { class: 'soft te' }, T.idle),
        next ? h('div', { class: 'next' }, h('span', { class: 'soft small te' }, T.next), h('strong', { class: 'next-name' }, next.name), h('span', { class: 'soft small' }, [next.brand, next.amount, next.when].filter(Boolean).join(' · '))) : null,
        data?.followUp ? h('div', { class: 'soft small' }, 'Follow-up call at ' + time(data.followUp.at)) : null,
      ),
      stage ? null : h('div', { class: 'call-foot' }, h('span', { class: 'soft small' }, 'Keep this screen open'))];
    }
    if (screen === 'ringing') {
      return [h('div', { class: 'center' },
        h('div', { class: 'caller' }, h('div', { class: 'orb ringing' }, icon('phone')), h('div', { class: 'name' }, 'On Time'), h('div', { class: 'soft te' }, T.calling)),
        h('div', { class: 'answer-row' },
          h('div', { class: 'caller' }, h('button', { class: 'round decline', 'aria-label': 'Decline', onclick: decline }, icon('x')), h('span', { class: 'round-label te' }, T.decline)),
          h('div', { class: 'caller' }, h('button', { class: 'round accept', 'aria-label': 'Answer', onclick: answer }, icon('phone')), h('span', { class: 'round-label te' }, T.answer))),
      )];
    }
    if (screen === 'connecting') {
      return [h('div', { class: 'center' }, h('div', { class: 'orb speaking' }, icon('phone')), h('div', { class: 'te' }, T.connecting))];
    }
    if (screen === 'ended') {
      return [h('div', { class: 'center' }, h('div', { class: 'orb' }, icon('check')), h('div', { class: 'greet te' }, T.ended), error ? h('div', { class: 'error-banner' }, error) : null)];
    }
    // In call
    const orbClass = 'orb ' + (agentState === 'ducked' ? 'ducked' : agentState === 'speaking' ? 'speaking' : '');
    return [h('div', { class: 'in-call' },
      h('div', { class: 'row' }, h('span', { class: 'pill live' }, timer()), h('div', { class: 'spacer' }),
        h('div', { class: 'mode', role: 'group', 'aria-label': 'Turn-taking' },
          h('button', { 'aria-pressed': String(mode === 'ontime'), onclick: () => setMode('ontime') }, 'On Time turn-taking'),
          h('button', { 'aria-pressed': String(mode === 'standard'), onclick: () => setMode('standard') }, 'Standard bot'))),
      h('div', { class: 'caller' }, h('div', { class: orbClass }, icon('logo')),
        h('div', { class: 'soft small te' }, agentState === 'listening' || agentState === 'ducked' ? T.listening : T.speaking)),
      pack ? h('div', {}, packCard(pack), h('div', { class: 'pack-card pack-actions' },
        h('button', { class: 'btn small', onclick: () => packAnswer(true) }, '✓ Label matches'),
        h('button', { class: 'btn small', onclick: () => packAnswer(false) }, 'Different / can’t read'))) : null,
      h('div', { class: 'caption te', 'aria-live': 'polite' }, caption || '…', heard ? h('span', { class: 'you' }, '🗣 ' + heard) : null),
      h('div', { class: 'turn-strip' }, turns.slice(-3).map(turnChip)),
      error ? h('div', { class: 'error-banner' }, error) : null,
      h('div', { class: 'call-foot' }, h('button', { class: 'round hangup', 'aria-label': 'Hang up', onclick: () => voice?.hangUp('hung-up') }, icon('phone'))),
    )];
  }

  function nextMedicine() {
    if (!data?.medicines?.length) return null;
    const taken = data.todayDoses ?? {};
    const order = ['morning', 'afternoon', 'night'];
    const weekday = new Date(data.serverTime + 5.5 * 3600e3).getUTCDay();
    const open = data.medicines.filter(m => runsOn(m.days, weekday) && taken[m.id]?.status !== 'taken')
      .sort((a, b) => order.indexOf(slotOf(a)) - order.indexOf(slotOf(b)));
    const m = open[0];
    return m ? { name: m.nickname || m.name, brand: m.nickname ? m.name : '', amount: m.amount, when: (m.timing === 'before' ? 'Before ' : m.timing === 'after' ? 'After ' : 'At ') + (m.timing === 'fixed' ? m.time : m.meal) } : null;
  }

  let startedAt = 0;
  function timer() {
    const s = Math.floor((Date.now() - startedAt) / 1000);
    return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0');
  }

  async function unlock() {
    error = '';
    try {
      audioContext = new (window.AudioContext || window.webkitAudioContext)();
      await audioContext.resume();
      microphone = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
      screen = 'idle';
      clockTimer = setInterval(() => { if (screen === 'idle') render(); }, 15000);
    } catch (e) {
      error = e?.name === 'NotAllowedError' ? T.noMic : 'Could not start audio: ' + e.message;
    }
    render();
    if (data?.ring) ring();
  }

  // Indian ring cadence: 400/450 Hz, 0.4s on, 0.2s off, 0.4s on, 2s off.
  function ring() {
    screen = 'ringing';
    render();
    if (!audioContext) return;
    const burst = start => {
      for (const freq of [400, 450]) {
        const osc = audioContext.createOscillator();
        const gain = audioContext.createGain();
        osc.frequency.value = freq;
        gain.gain.value = 0.06;
        osc.connect(gain).connect(audioContext.destination);
        osc.start(start);
        osc.stop(start + 0.4);
      }
    };
    const cycle = () => { const t = audioContext.currentTime; burst(t); burst(t + 0.6); };
    cycle();
    ringer = setInterval(cycle, 3000);
    navigator.vibrate?.([400, 200, 400, 2000, 400, 200, 400]);
  }

  function stopRinging(next) {
    clearInterval(ringer);
    ringer = null;
    navigator.vibrate?.(0);
    if (next) { screen = next; render(); }
  }

  async function decline() {
    stopRinging('idle');
    try { data = await api.cancelRing(id); } catch {}
    render();
  }

  async function answer() {
    stopRinging('connecting');
    error = '';
    caption = '';
    heard = '';
    pack = null;
    turns = [];
    agentState = 'speaking';
    try {
      const started = await api.startCall(id, {});
      call = started.call;
      data = started.household;
      voice = new VoiceCall({ secret: started.secret.value, microphone, mode, onTool, onUpdate });
      await voice.connect();
      startedAt = Date.now();
      screen = 'call';
      render();
      const tick = setInterval(() => { if (screen !== 'call') clearInterval(tick); else phone.querySelector('.pill.live')?.replaceChildren(timer()); }, 1000);
    } catch (e) {
      error = e.message;
      voice?.hangUp('failed');
      api.cancelRing(id).catch(() => {});
      screen = 'ended';
      render();
      setTimeout(() => { if (screen === 'ended') { screen = 'idle'; render(); } }, 5000);
    }
  }

  function setMode(next) {
    mode = next;
    voice?.setMode(next);
    render();
  }

  function packAnswer(matches) {
    voice?.tell(matches
      ? '(On screen, the patient tapped: the label on the pack in my hand matches.)'
      : '(On screen, the patient tapped: the label is different or I cannot read it.)');
    pack = null;
    render();
  }

  function enqueue(event) {
    queue.push(event);
    clearTimeout(flushTimer);
    flushTimer = setTimeout(flush, 700);
  }
  async function flush() {
    if (!queue.length || !call) return;
    const events = queue.splice(0, 20);
    try { await api.events(id, call.id, events); } catch {}
  }
  async function send(event) {
    await flush();
    const result = await api.events(id, call.id, [event]);
    data = result;
    return result.result?.[0] ?? { ok: true };
  }

  async function onTool(name, args) {
    switch (name) {
      case 'record_dose':
        return send({ type: 'dose', medicineId: args.medicine_id, status: args.status, note: args.note ?? '' });
      case 'show_pack': {
        const medicine = data.medicines.find(m => m.id === args.medicine_id);
        if (!medicine) return { ok: false, error: 'Unknown medicine' };
        pack = medicine;
        render();
        return { ok: true, shown: { name: medicine.name, strength: medicine.strength, amount: medicine.amount }, photo_saved: Boolean(medicine.photo) };
      }
      case 'schedule_callback':
        return send({ type: 'followup', minutes: args.minutes, reason: args.reason });
      case 'flag_for_family':
        return send({ type: 'alert', kind: args.kind, note: args.note, medicineId: args.medicine_id });
      case 'end_call':
        return send({ type: 'end', summary: args.summary });
      default:
        return { ok: false, error: 'Unknown tool' };
    }
  }

  function onUpdate(event) {
    switch (event.type) {
      case 'agent-caption': caption = event.text; break;
      case 'agent-said': enqueue({ type: 'transcript', who: 'agent', text: event.text }); break;
      case 'caller-said': heard = event.text; enqueue({ type: 'transcript', who: 'patient', text: event.text }); break;
      case 'turn': turns.push(event); enqueue({ type: 'turn', heard: event.heard, decision: event.decision, ms: event.ms }); break;
      case 'agent-speaking': agentState = 'speaking'; break;
      case 'agent-quiet': case 'agent-stopped': agentState = 'listening'; break;
      case 'duck': agentState = event.on ? 'ducked' : (voice?.agentSpeaking ? 'speaking' : 'listening'); break;
      case 'caller-speaking': if (!voice?.agentSpeaking) agentState = 'listening'; break;
      case 'error': error = event.message; break;
      case 'closed': return ended(event.reason);
      default: return;
    }
    if (screen === 'call') render();
  }

  async function ended(reason) {
    await flush();
    if (reason !== 'ended' && call) {
      try { await api.events(id, call.id, [{ type: 'end', summary: '' }]); } catch {}
    }
    voice = null;
    call = null;
    screen = 'ended';
    render();
    setTimeout(() => { if (screen === 'ended') { screen = 'idle'; error = ''; render(); } }, 3500);
  }

  // Test hook: ?debug=1 lets a tester type a caller reply instead of speaking it.
  if (new URLSearchParams(location.search).get('debug') === '1') {
    window.onTimeDebug = {
      say: text => { heard = text; enqueue({ type: 'transcript', who: 'patient', text }); voice?.tell(text); },
      state: () => ({ screen, caption, agentSpeaking: voice?.agentSpeaking, turns }),
    };
  }

  render();
  return { stop() { poller.stop(); clearInterval(clockTimer); stopRinging(); voice?.hangUp(); } };
}
