// Paste into the phone page (?h=demo-xx&view=phone&debug=1) while it is ringing. Answers, then
// plays "ate" to the meal question and "took" to each dose question. Result in window.__run.
window.__run = { status: 'starting', played: [] };
(async () => {
  const lang = { 'demo-telugu': 'te', 'demo-hindi': 'hi', 'demo-english': 'en' }[new URLSearchParams(location.search).get('h')];
  const meal = { te: /టిఫిన్|భోజనం/, hi: /नाश्ता|खाना|भोजन/, en: /breakfast|lunch|dinner|eat/i }[lang];
  const st = () => window.onTimeDebug.state();
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const until = async (f, ms = 40000) => { const t = Date.now(); while (!f()) { if (Date.now() - t > ms) return false; await sleep(100); } return true; };
  const ctx = new AudioContext();
  const dest = ctx.createMediaStreamDestination();
  navigator.mediaDevices.getUserMedia = async () => dest.stream;
  const clip = {};
  for (const n of ['ate', 'took']) clip[n] = await ctx.decodeAudioData(await (await fetch('/samples/voice/' + lang + '-' + n + '.wav')).arrayBuffer());
  const play = n => new Promise(r => { const s = ctx.createBufferSource(); s.buffer = clip[n]; s.connect(dest); s.onended = r; s.start(); });
  await ctx.resume();
  await until(() => st().screen === 'ringing' || document.querySelector('button[aria-label=Answer]'));
  for (let i = 0; i < 3 && st().screen !== 'call'; i++) { document.querySelector('button[aria-label=Answer]')?.click(); await sleep(1500); }
  await until(() => st().screen === 'call');
  window.__run.status = 'in call';
  for (let round = 0; round < 12; round++) {
    // Wait for the agent to finish a question.
    const asked = await until(() => st().screen !== 'call' || (!st().agentSpeaking && /[?？]\s*$/.test(st().caption || '')), 45000);
    if (!asked || st().screen !== 'call') break;
    await sleep(700);
    if (st().agentSpeaking) continue;
    const which = meal.test(st().caption) ? 'ate' : 'took';
    window.__run.played.push(which + ' ← ' + (st().caption || '').slice(-60));
    await play(which);
    // Wait for the agent to react before looking for the next question.
    await until(() => st().agentSpeaking || st().screen !== 'call', 15000);
    await until(() => !st().agentSpeaking || st().screen !== 'call', 30000);
  }
  await until(() => st().screen !== 'call', 30000);
  window.__run.status = 'done';
})().catch(e => { window.__run.status = 'error ' + e.message; });
'started';
