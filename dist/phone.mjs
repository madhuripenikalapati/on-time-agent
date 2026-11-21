// Amma's phone: waits for a call, rings, and runs the live conversation in her language.
import { h, icon, api, poll, time, slotOf, packCard } from './ui.mjs';
import { VoiceCall } from './realtime.mjs';
import { takenOn } from './schedule.mjs';
import { turnChip } from './family.mjs';
import { languageOf, fill } from './languages.mjs';

// Screen text in the patient's language (from dist/languages.mjs).
function strings(code) {
  const ui = languageOf(code).ui;
  return {
    ...ui,
    hello: address => fill(ui.hello, { address }),
    readyEn: 'Tap once so the phone can ring and hear you',
    noMic: 'Microphone is blocked. Allow it in the browser’s site settings and reload.',
  };
}

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
  let packNode = null;
  let turns = [];
  let agentState = 'speaking';
  let error = '';
  let queue = [];
  let flushTimer = null;
  let clockTimer = null;
  let advancing = false;
  let unanswered = null;

  // Always the current patient's language, even if the family changes it.
  const T = new Proxy({}, { get: (_, key) => strings(data?.patient?.language)[key] });
  const phone = h('div', { class: 'phone' });
  root.append(h('div', { class: 'phone-page' }, phone));

  const poller = poll(id, fresh => {
    data = fresh;
    if (screen === 'idle' && data.ring) ring();
    // Opened from a call alert (or already ringing): go straight to the ringing screen.
    // The Answer tap itself unlocks audio and the microphone.
    if (screen === 'locked' && data.ring) { screen = 'ringing'; render(); }
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
        h('div', { class: 'greet te' }, T.hello(data?.patient?.callName || name + languageOf(data?.patient?.language).honorific)),
        h('button', { class: 'btn ready-btn te', onclick: () => unlock() }, T.ready),
        h('div', { class: 'soft small' }, T.readyEn),
        error ? h('div', { class: 'error-banner' }, error) : null)];
    }
    if (screen === 'idle') {
      const next = nextMedicine();
      return [h('div', { class: 'center' },
        h('div', { class: 'big-time' }, new Date().toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' }).replace(/\s?[ap]m/i, '')),
        h('div', { class: 'greet te' }, T.hello(data?.patient?.callName || name + languageOf(data?.patient?.language).honorific)),
        h('div', { class: 'soft te' }, T.idle),
        next ? h('div', { class: 'next' }, next.photo ? h('img', { class: 'next-photo', src: next.photo, alt: 'Photo of the ' + next.name + ' strip' }) : null, h('span', { class: 'soft small te' }, T.next), h('strong', { class: 'next-name' }, next.name), h('span', { class: 'soft small' }, [next.brand, next.amount, next.when].filter(Boolean).join(' · '))) : null,
        data?.followUp ? h('div', { class: 'soft small' }, 'Follow-up call at ' + time(data.followUp.at)) : null,
      ),
      stage ? null : setupCard()];
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
      pack ? packView() : null,
      h('div', { class: 'caption te', 'aria-live': 'polite' }, caption || '…', heard ? h('span', { class: 'you' }, '🗣 ' + heard) : null),
      h('div', { class: 'turn-strip' }, turns.slice(-3).map(turnChip)),
      error ? h('div', { class: 'error-banner' }, error) : null,
      h('div', { class: 'call-foot' }, h('button', { class: 'round hangup', 'aria-label': 'Hang up', onclick: () => voice?.hangUp('hung-up') }, icon('phone'))),
    )];
  }

  // The pack card is built once per show_pack and reused across renders. Rebuilding it on every
  // caption update reloaded the photo and replayed its slide-in animation, so it flickered.
  function packView() {
    if (packNode?.medicineId !== pack.id) {
      const node = h('div', {}, packCard(pack), h('div', { class: 'pack-card pack-actions' },
        h('button', { class: 'btn small', onclick: () => packAnswer(true) }, '✓ Label matches'),
        h('button', { class: 'btn small', onclick: () => packAnswer(false) }, 'Different / can’t read')));
      node.medicineId = pack.id;
      // Animate in once; a re-inserted node must not replay the animation.
      node.addEventListener('animationend', () => node.classList.add('settled'), { once: true });
      packNode = node;
    }
    return packNode;
  }

  function nextMedicine() {
    if (!data?.medicines?.length) return null;
    const taken = data.todayDoses ?? {};
    const order = ['morning', 'afternoon', 'night'];
    const weekday = new Date(data.serverTime + 5.5 * 3600e3).getUTCDay();
    const open = data.medicines.filter(m => takenOn(m, data.today) && taken[m.id]?.status !== 'taken')
      .sort((a, b) => order.indexOf(slotOf(a)) - order.indexOf(slotOf(b)));
    // The next one by time of day; earlier ones still open come after (they were missed).
    const now = order.indexOf(data.slot);
    const m = open.find(x => order.indexOf(slotOf(x)) >= now) ?? open[0];
    return m ? { photo: m.photo || '', name: m.nickname || m.name, brand: m.nickname ? m.name : '', amount: m.amount, when: (m.timing === 'before' ? 'Before ' : m.timing === 'after' ? 'After ' : 'At ') + (m.timing === 'fixed' ? m.time : m.meal) } : null;
  }

  let startedAt = 0;
  function timer() {
    const s = Math.floor((Date.now() - startedAt) / 1000);
    return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0');
  }

  // ---- Install as an app, and turn on call alerts (push) ----
  let installEvent = null;
  let alertsOn = false;
  let setupMessage = '';
  const standalone = () => matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
  const isIos = /iphone|ipad|ipod/i.test(navigator.userAgent);
  window.addEventListener('beforeinstallprompt', event => { event.preventDefault(); installEvent = event; if (screen === 'idle') render(); });
  if (!stage) {
    try { localStorage.setItem('on-time:phone', id); } catch {}
    caches?.open('on-time').then(cache => cache.put('/__household', new Response(id))).catch(() => {});
    navigator.serviceWorker?.ready.then(reg => reg.pushManager?.getSubscription()).then(sub => { alertsOn = Boolean(sub) && Notification.permission === 'granted'; if (screen === 'idle') render(); }).catch(() => {});
  }

  async function turnOnAlerts() {
    setupMessage = '';
    try {
      if (!('PushManager' in window) || !navigator.serviceWorker) {
        throw new Error(isIos && !standalone() ? 'On iPhone, first add On Time to the Home Screen (Share → Add to Home Screen), then open it from there.' : 'This browser cannot show call alerts.');
      }
      if (await Notification.requestPermission() !== 'granted') throw new Error('Alerts were not allowed. Allow notifications for this site in settings.');
      const { publicKey } = await (await fetch('/api/push-key')).json();
      const reg = await navigator.serviceWorker.ready;
      const subscription = (await reg.pushManager.getSubscription())
        ?? await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: publicKey });
      const response = await fetch('/api/h/' + id + '/push', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ subscription: subscription.toJSON() }) });
      if (!response.ok) throw new Error((await response.json()).error || 'Could not turn on alerts.');
      alertsOn = true;
      setupMessage = 'Call alerts are on. The phone will ring at medicine time, even if this app is closed.';
    } catch (error) {
      setupMessage = error.message;
    }
    render();
  }

  function setupCard() {
    const install = !standalone() && (installEvent
      ? h('button', { class: 'btn', onclick: async () => { installEvent.prompt(); await installEvent.userChoice.catch(() => {}); installEvent = null; render(); } }, '📲 Install On Time app')
      : isIos ? h('div', { class: 'soft small' }, '📲 To install: Share → Add to Home Screen') : null);
    return h('div', { class: 'setup' },
      install,
      alertsOn
        ? h('div', { class: 'setup-ok' }, '🔔 Call alerts on')
        : h('button', { class: 'btn', onclick: turnOnAlerts }, '🔔 Turn on call alerts'),
      setupMessage ? h('div', { class: 'soft small' }, setupMessage) : null);
  }

  async function unlock(quiet = false) {
    error = '';
    try {
      audioContext = new (window.AudioContext || window.webkitAudioContext)();
      await audioContext.resume();
      microphone = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
      screen = 'idle';
      clockTimer ??= setInterval(() => { if (screen === 'idle') render(); }, 15000);
    } catch (e) {
      error = e?.name === 'NotAllowedError' ? T.noMic : 'Could not start audio: ' + e.message;
    }
    render();
    if (!quiet && data?.ring) ring();
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
    // Nobody picked up within 45 seconds: a missed call.
    clearTimeout(unanswered);
    unanswered = setTimeout(async () => {
      if (screen !== 'ringing') return;
      stopRinging('idle');
      try { data = await api.missed(id, 'no_answer'); } catch {}
      render();
    }, 45000);
    cycle();
    ringer = setInterval(cycle, 3000);
    if (navigator.userActivation?.hasBeenActive) navigator.vibrate?.([400, 200, 400, 2000, 400, 200, 400]);
  }

  function stopRinging(next) {
    clearTimeout(unanswered);
    clearInterval(ringer);
    ringer = null;
    if (navigator.userActivation?.hasBeenActive) navigator.vibrate?.(0);
    if (next) { screen = next; render(); }
  }

  async function decline() {
    stopRinging('idle');
    try { data = await api.missed(id, 'declined'); } catch {}
    render();
  }

  async function answer() {
    if (!microphone) {
      await unlock(true);
      if (!microphone) { screen = 'locked'; render(); return; }
    }
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
      const lang = languageOf(data.patient?.language);
      const farewell = { language: lang.name, done: lang.phrases.goodbye, callback: fill(lang.phrases.goodbyeCallback, { minutes: '<N>' }) };
      voice = new VoiceCall({ secret: started.secret.value, microphone, mode, onTool, onUpdate, farewell });
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
      case 'agent-caption': {
        // Captions arrive word by word: update the text in place instead of re-rendering the screen.
        caption = event.text;
        const box = phone.querySelector('.caption');
        if (screen === 'call' && box?.firstChild?.nodeType === Node.TEXT_NODE) { box.firstChild.nodeValue = caption || '…'; return; }
        break;
      }
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
