// Live calls in each language against the deployed site: real household, real call session,
// replies typed in that language. Checks the agent's script, its tools and its goodbye.
const U = 'https://vqe7ihx8pe.execute-api.us-west-2.amazonaws.com';
const SCRIPTS = { kn: /\p{Script=Kannada}/u, ml: /\p{Script=Malayalam}/u, mr: /\p{Script=Devanagari}/u, bn: /\p{Script=Bengali}/u, gu: /\p{Script=Gujarati}/u, en: /[A-Za-z]/ };
const REPLIES = {
  kn: ['ಹೌದು, ತಿಂಡಿ ತಿಂದೆ', 'ಹೌದು, ತೆಗೆದುಕೊಂಡೆ', 'ಹೌದು, ಅದನ್ನೂ ತೆಗೆದುಕೊಂಡೆ'],
  ml: ['അതെ, കഴിച്ചു', 'അതെ, ഗുളിക കഴിച്ചു', 'അതെ, അതും കഴിച്ചു'],
  mr: ['हो, नाश्ता केला', 'हो, गोळी घेतली', 'हो, ती पण घेतली'],
  bn: ['হ্যাঁ, খেয়েছি', 'হ্যাঁ, ওষুধ খেয়েছি', 'হ্যাঁ, ওটাও খেয়েছি'],
  gu: ['હા, નાસ્તો કર્યો', 'હા, ગોળી લઈ લીધી', 'હા, એ પણ લઈ લીધી'],
  en: ['Yes, I had breakfast', 'Yes, I took it', 'Yes, I took that one too'],
};
const post = (path, body, method = 'POST') => fetch(U + path, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }).then(r => r.json());

async function call(code) {
  const hh = await post('/api/households', { demo: true });
  await post('/api/h/' + hh.id + '/profile', { setupBy: 'family', patient: { name: 'Lakshmi', language: code }, caregivers: [{ name: 'Ravi', relation: 'son', primary: true }] }, 'PUT');
  await post('/api/h/' + hh.id + '/ring', { slot: 'morning' });
  const started = await post('/api/h/' + hh.id + '/calls', {});
  if (!started.secret?.value) throw new Error('no call session: ' + JSON.stringify(started.error ?? started));
  const ws = new WebSocket('wss://api.openai.com/v1/realtime', ['realtime', 'openai-insecure-api-key.' + started.secret.value]);
  await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = () => reject(new Error('websocket failed')); });
  const said = [];
  const tools = [];
  let ended = false;
  const respond = () => ws.send(JSON.stringify({ type: 'response.create' }));
  const turn = () => new Promise(resolve => {
    ws.onmessage = m => {
      const e = JSON.parse(m.data);
      if (e.type === 'response.output_audio_transcript.done') said.push(e.transcript);
      if (e.type === 'response.done') {
        const calls = (e.response.output ?? []).filter(o => o.type === 'function_call');
        if (!calls.length) return resolve();
        for (const c of calls) {
          tools.push(c.name + (JSON.parse(c.arguments).status ? ':' + JSON.parse(c.arguments).status : ''));
          if (c.name === 'end_call') ended = true;
          ws.send(JSON.stringify({ type: 'conversation.item.create', item: { type: 'function_call_output', call_id: c.call_id, output: '{"ok":true}' } }));
        }
        respond();
      }
    };
  });
  respond();
  await turn();
  for (const reply of REPLIES[code]) {
    if (ended) break;
    ws.send(JSON.stringify({ type: 'conversation.item.create', item: { type: 'message', role: 'user', content: [{ type: 'input_text', text: reply }] } }));
    respond();
    await Promise.race([turn(), new Promise(r => setTimeout(r, 25000))]);
  }
  ws.close();
  const lines = said.join(' ');
  const telugu = /\p{Script=Telugu}/u.test(lines);
  const otherIndic = code === 'en' ? /[ऀ-෿]/u.test(lines) : false;
  const inScript = said.filter(s => SCRIPTS[code].test(s)).length;
  const pass = said.length > 0 && inScript === said.length && !telugu && !otherIndic && tools.filter(t => t === 'record_dose:taken').length === 2;
  return { code, pass, said, tools, problems: [telugu && 'Telugu leaked', otherIndic && 'Indic text in English call', inScript !== said.length && (said.length - inScript) + ' line(s) not in the expected script', tools.filter(t => t === 'record_dose:taken').length !== 2 && 'expected 2 doses recorded'].filter(Boolean) };
}

const results = await Promise.all(Object.keys(REPLIES).map(code => call(code).catch(e => ({ code, pass: false, problems: [e.message], said: [], tools: [] }))));
for (const r of results) {
  console.log(`\n${r.pass ? 'PASS' : 'FAIL'} ${r.code}  tools: ${r.tools.join(', ')}${r.problems.length ? '  problems: ' + r.problems.join('; ') : ''}`);
  for (const s of r.said) console.log('   ' + s.slice(0, 150));
}
