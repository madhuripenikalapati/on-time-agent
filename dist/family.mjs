// The family dashboard: today's doses, live calls, alerts, the medicine plan and call history.
import {
  h, icon, api, poll, time, dateTime, ago, day, slotLabel, slotEmoji, slotOf, whenText, statusPill,
  shrinkImage, fileToBase64, packCard, toast,
} from './ui.mjs';
import { DAY_OPTIONS, runsOn, dosesPerWeek } from './schedule.mjs';

const alertCopy = {
  pack_mismatch: ['💊', 'Needs help checking the pack'],
  symptom: ['🩺', 'Mentioned a symptom'],
  missed_dose: ['⏰', 'Missed dose'],
  emergency: ['🚨', 'Possible emergency'],
  other: ['ℹ️', 'Needs attention'],
};

export function mountFamily(root, id, { stage = false } = {}) {
  let data = null;
  let tab = ['today', 'medicines', 'calls'].includes(location.hash.slice(1)) ? location.hash.slice(1) : 'today';
  let editor = null; // draft of the medicine plan while editing
  let suggestNamesFor = () => {}; // set while the medicines editor is open
  let busy = false;

  const tabs = Object.fromEntries(['today', 'medicines', 'calls'].map(name => [name,
    h('button', { class: 'tab', role: 'tab', onclick: () => select(name) }, { today: 'Today', medicines: 'Medicines', calls: 'Calls' }[name])]));
  const who = h('div', { class: 'who' });
  const top = h('header', { class: 'topbar' }, h('div', { class: 'inner' },
    h('a', { class: 'logo', href: stage ? '#' : './' }, h('span', { class: 'logo-mark' }, icon('logo')), 'On Time'),
    h('nav', { class: 'tabs', role: 'tablist' }, Object.values(tabs)),
    h('div', { class: 'spacer' }),
    who,
  ));
  const body = h('main', { class: 'shell' });
  root.append(top, body);

  const live = () => data?.calls?.[0]?.status === 'live' && Date.now() - data.calls[0].startedAt < 20 * 60_000;
  const poller = poll(id, fresh => { data = fresh; render(); }, {
    interval: () => (live() || data?.ring ? 1000 : 2500),
    onError: error => { if (!data) body.replaceChildren(h('div', { class: 'card' }, error.message)); },
  });

  function select(name) {
    tab = name;
    if (!stage) history.replaceState(null, '', '#' + name);
    if (name === 'medicines') editor = null;
    render();
  }

  const phoneUrl = () => location.origin + location.pathname + '?h=' + id + '&view=phone';
  const familyUrl = () => location.origin + location.pathname + '?h=' + id;

  async function act(task, success) {
    if (busy) return;
    busy = true;
    try {
      data = await task();
      if (success) toast(success);
      render();
    } catch (error) {
      toast(error.message, 'bad');
    } finally {
      busy = false;
    }
  }

  function render() {
    if (!data) return;
    for (const [name, el] of Object.entries(tabs)) el.setAttribute('aria-selected', String(name === tab));
    const name = data.patient.name;
    who.replaceChildren(h('span', { class: 'name' }, (data.patient.caregiverName ? data.patient.caregiverName + ' · caring for ' : 'Caring for ') + name), h('span', { class: 'avatar' }, name[0]));
    if (tab === 'today') body.replaceChildren(today());
    else if (tab === 'calls') body.replaceChildren(calls());
    else if (!editor) body.replaceChildren(medicines());
  }

  // ---------- Today ----------
  function today() {
    const name = data.patient.name;
    const doses = data.todayDoses ?? {};
    const weekday = new Date(data.serverTime + 5.5 * 3600e3).getUTCDay();
    const scheduled = data.medicines.filter(m => runsOn(m.days, weekday));
    const taken = scheduled.filter(m => doses[m.id]?.status === 'taken').length;
    const call = data.calls[0];
    const openAlerts = data.alerts.filter(a => !a.resolved);

    let headline;
    if (live()) headline = 'On a call with ' + name + ' right now';
    else if (data.ring) headline = 'Ringing ' + name + '’s phone…';
    else if (!data.medicines.length) headline = 'Add ' + name + '’s medicines to begin';
    else if (taken === scheduled.length) headline = name + ' has taken every dose today';
    else headline = taken + ' of ' + scheduled.length + ' doses reported today';

    const slotSelect = h('select', { 'aria-label': 'Which medicines to ask about' },
      ['morning', 'afternoon', 'night'].map(slot => h('option', { value: slot, selected: slot === data.slot }, slotLabel[slot] + ' medicines')));

    const hero = h('section', { class: 'card hero' },
      h('div', { class: 'label' }, new Date(data.serverTime).toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long' })),
      h('h2', {}, headline),
      h('div', { class: 'phone-status' },
        data.phones
          ? '🔔 ' + name + '’s phone has call alerts on' + (data.settings.autoCalls !== false && data.nextCall ? ' · next automatic call at ' + data.nextCall.time + ' (' + slotLabel[data.nextCall.slot].toLowerCase() + ')' : data.settings.autoCalls === false ? ' · automatic calls are off' : '')
          : '📵 ' + name + '’s phone isn’t set up yet: open ' + name + '’s phone link on her phone and tap “Turn on call alerts”.'),
      h('div', { class: 'meta' }, call ? 'Last check-in ' + ago(call.startedAt, data.serverTime) + ({ failed: ' · didn’t connect', missed: ' · not answered', declined: ' · ' + name + ' declined' }[call.status] ?? '') : 'No check-in calls yet'),
      h('div', { class: 'row' },
        data.ring
          ? h('button', { class: 'btn', onclick: () => act(() => api.cancelRing(id)) }, 'Cancel call')
          : h('button', { class: 'btn primary', disabled: live() || !data.medicines.length, onclick: () => act(async () => {
              const result = await api.ring(id, { slot: slotSelect.value });
              toast(result.phonesRung ? 'Calling ' + name + '’s phone · alert sent' : 'Ringing ' + name + '’s phone screen');
              return result;
            }) }, icon('phone'), 'Call ' + name + ' now'),
        slotSelect,
        h('a', { class: 'btn', href: phoneUrl(), target: '_blank', rel: 'noopener' }, 'Open ' + name + '’s phone ↗'),
      ),
    );

    const left = [hero];
    if (live() || (call && call.status === 'live')) left.push(liveCard(call));
    if (openAlerts.length) left.push(h('section', { class: 'card' },
      h('div', { class: 'card-head' }, h('h2', {}, 'Needs your attention'), h('span', { class: 'pill bad' }, openAlerts.length)),
      openAlerts.map(alert => {
        const [emoji, title] = alertCopy[alert.kind] ?? alertCopy.other;
        const med = data.medicines.find(m => m.id === alert.medicineId);
        return h('div', { class: 'alert ' + alert.kind },
          h('span', { class: 'icon' }, emoji),
          h('div', {}, h('strong', {}, title + (med ? ' · ' + med.name : '')), h('span', {}, alert.note), h('div', { class: 'small' }, ago(alert.at, data.serverTime))),
          h('button', { class: 'btn small', onclick: () => act(() => api.resolve(id, alert.id), 'Marked as handled') }, 'Handled'),
        );
      })));
    if (data.followUp) {
      const due = data.followUp.at <= data.serverTime;
      left.push(h('section', { class: 'followup' },
        h('div', {}, h('strong', {}, due ? 'Follow-up call is due' : 'Calling back at ' + time(data.followUp.at)),
          h('div', { class: 'small' }, data.followUp.reason || 'The patient asked for a callback.')),
        h('div', { class: 'row' },
          h('button', { class: 'btn small primary', onclick: () => act(() => api.advance(id), 'Follow-up is ringing now') }, '⏩ Advance demo clock'),
          h('button', { class: 'btn small ghost', onclick: () => act(() => api.cancelFollowUp(id)) }, 'Cancel'))));
    }
    left.push(h('section', { class: 'card' },
      h('div', { class: 'card-head' }, h('div', {}, h('h2', {}, 'Today’s medicines'), h('p', { class: 'hint' }, 'What ' + name + ' told On Time on the phone.'))),
      data.medicines.length ? h('div', { class: 'dose-list' }, scheduled.map(m => {
        const dose = doses[m.id];
        const [label, kind] = dose ? statusPill[dose.status] : ['Not asked yet', ''];
        return h('div', { class: 'dose' },
          h('span', { class: 'when', title: slotLabel[slotOf(m)] }, slotEmoji[slotOf(m)]),
          h('div', {}, h('strong', {}, (m.nickname ? m.nickname + ' · ' : '') + m.name + (m.strength ? ' ' + m.strength : '')), h('span', { class: 'detail' }, [m.amount, whenText(m), m.use].filter(Boolean).join(' · '))),
          h('div', { class: 'row' }, h('span', { class: 'pill ' + kind }, label + (dose ? ' · ' + time(dose.at) : ''))));
      })) : h('div', { class: 'row' }, h('button', { class: 'btn primary', onclick: () => select('medicines') }, 'Add medicines')),
    ));

    const right = [];
    const lastDone = data.calls.find(c => c.status === 'ended' && c.summary);
    right.push(h('section', { class: 'card' },
      h('div', { class: 'card-head' }, h('h2', {}, 'Latest call summary'), lastDone && h('span', { class: 'pill info' }, 'Translated from Telugu')),
      lastDone
        ? [h('p', { class: 'summary' }, lastDone.summary), h('p', { class: 'summary-meta' }, dateTime(lastDone.startedAt) + ' · ' + (lastDone.kind === 'followup' ? 'Follow-up call' : 'Scheduled call') + ' · ' + duration(lastDone))]
        : h('p', { class: 'muted' }, 'After each call you’ll see a short English summary here.')));
    const refills = refillLines();
    if (refills.length) right.push(h('section', { class: 'card' }, h('h2', {}, 'Refills'), h('div', { class: 'dose-list' }, refills)));
    right.push(h('section', { class: 'card share' },
      h('h2', {}, 'Share'),
      h('p', { class: 'hint' }, 'Open the family view on your phone, or set up ' + name + '’s phone. In Chrome, use the address bar’s share icon to show a QR code.'),
      copyRow('Family view', familyUrl()),
      copyRow(name + '’s phone', phoneUrl()),
    ));
    return h('div', { class: 'grid' }, h('div', { class: 'stack' }, left), h('div', { class: 'stack' }, right));
  }

  function liveCard(call) {
    const lines = call.transcript.slice(-12);
    return h('section', { class: 'card live' },
      h('div', { class: 'card-head' }, h('div', {}, h('h2', {}, 'Live call'), h('p', { class: 'hint' }, 'Started ' + time(call.startedAt) + (call.kind === 'followup' ? ' · follow-up' : ''))), h('span', { class: 'pill live' }, 'LIVE')),
      lines.length ? h('div', { class: 'transcript te' }, lines.map(line => h('div', { class: 'line ' + line.who }, h('span', { class: 'who' }, line.who === 'agent' ? 'On Time' : data.patient.name), line.text)))
        : h('p', { class: 'muted' }, 'Connecting…'),
      call.turns.length ? h('div', { class: 'turns' }, call.turns.slice(-5).map(turnChip)) : null,
    );
  }

  function refillLines() {
    const lead = 10;
    // The same medicine taken at several meals shares one strip.
    const packs = new Map();
    for (const m of data.medicines.filter(m => m.stock !== null && m.stock !== undefined)) {
      const key = (m.name + '|' + m.strength).toLowerCase();
      const use = (/^½|half|^0?\.5/i.test(m.amount) ? 0.5 : (parseFloat(m.amount) || 1)) * dosesPerWeek(m.days) / 7;
      const pack = packs.get(key) ?? { name: m.name, stock: m.stock, perDay: 0 };
      pack.perDay += use;
      pack.stock = Math.min(pack.stock, m.stock);
      packs.set(key, pack);
    }
    return [...packs.values()].map(m => {
      const daysLeft = Math.floor(m.stock / m.perDay);
      const runOut = data.serverTime + daysLeft * 86400e3;
      const remind = runOut - lead * 86400e3;
      const urgent = remind <= data.serverTime;
      return h('div', { class: 'dose' },
        h('span', { class: 'when' }, '📦'),
        h('div', {}, h('strong', {}, m.name), h('span', { class: 'detail' }, m.stock + ' left · runs out around ' + day(runOut))),
        h('span', { class: 'pill ' + (urgent ? 'warn' : '') }, urgent ? 'Refill now' : 'Refill by ' + day(remind)));
    });
  }

  function copyRow(label, url) {
    return h('div', {},
      h('div', { class: 'small muted' }, label),
      h('div', { class: 'share-link' }, h('code', {}, url),
        h('button', { class: 'btn small', onclick: async () => { await navigator.clipboard?.writeText(url); toast('Link copied'); } }, icon('copy'), 'Copy')));
  }

  // ---------- Calls ----------
  function calls() {
    const name = data.patient.name;
    return h('div', {},
      h('div', { class: 'page-head' }, h('div', {}, h('h1', {}, 'Calls'), h('p', {}, 'Every check-in with ' + name + ', with what she said and how On Time handled the conversation.'))),
      h('section', { class: 'card' }, data.calls.length ? data.calls.map(call => h('div', { class: 'call-item' },
        h('div', { class: 'row' },
          h('strong', {}, dateTime(call.startedAt)),
          h('span', { class: 'pill' }, call.kind === 'followup' ? 'Follow-up' : slotLabel[call.slot] + ' check-in'),
          h('span', { class: 'pill ' + ({ live: 'live', ended: 'good', failed: 'bad', missed: 'warn', declined: 'warn' }[call.status] ?? '') }, { live: 'LIVE', ended: duration(call), failed: 'Didn’t connect', missed: 'Not answered', declined: 'Declined' }[call.status] ?? call.status)),
        call.summary ? h('p', {}, call.summary) : null,
        call.outcomes.length ? h('div', { class: 'row' }, call.outcomes.map(o => {
          const med = data.medicines.find(m => m.id === o.medicineId);
          const [label, kind] = statusPill[o.status];
          return h('span', { class: 'pill ' + kind }, (med?.name ?? 'Medicine') + ' · ' + label);
        })) : null,
        call.transcript.length ? h('details', {}, h('summary', {}, 'Transcript and turn-taking'),
          h('div', { class: 'transcript te' }, call.transcript.map(line => h('div', { class: 'line ' + line.who }, h('span', { class: 'who' }, line.who === 'agent' ? 'On Time' : name), line.text))),
          call.turns.length ? h('div', { class: 'turns' }, call.turns.map(turnChip)) : null) : null,
      )) : h('p', { class: 'muted' }, 'No calls yet. Use “Call ' + name + ' now” on the Today tab.')),
    );
  }

  // ---------- Medicines ----------
  function medicines() {
    editor = structuredClone({ patient: data.patient, settings: data.settings, medicines: data.medicines });
    const list = h('div', { class: 'med-editor' });
    const pages = h('div', { class: 'pages' });
    const status = h('div', { 'aria-live': 'polite' });
    let chosen = [];
    const reviewed = h('input', { type: 'checkbox' });

    const drawList = () => list.replaceChildren(...editor.medicines.map((m, index) => medCard(m, index, drawList)),
      h('div', { class: 'row' }, h('button', { class: 'btn', onclick: () => { editor.medicines.push({ name: '', meal: 'breakfast', timing: 'after', days: 'daily', amount: '1 tablet' }); drawList(); } }, icon('plus'), 'Add medicine')));

    const fileInput = h('input', { type: 'file', multiple: true, accept: 'image/png,image/jpeg,image/webp,application/pdf', onchange: () => choose(Array.from(fileInput.files)) });
    const readButton = h('button', { class: 'btn primary', disabled: true, onclick: read }, icon('sparkle'), 'Read prescription with AI');
    const drop = h('label', { class: 'dropzone' }, fileInput,
      h('strong', {}, 'Upload prescription photos or PDFs'),
      h('span', { class: 'muted small' }, 'As many pages as you have · printed or handwritten · AI drafts every medicine for you to check'));
    drop.addEventListener('dragover', event => { event.preventDefault(); drop.classList.add('over'); });
    drop.addEventListener('dragleave', () => drop.classList.remove('over'));
    drop.addEventListener('drop', event => { event.preventDefault(); drop.classList.remove('over'); choose([...chosen, ...Array.from(event.dataTransfer.files)]); });

    function choose(files) {
      chosen = files.filter(f => ['image/png', 'image/jpeg', 'image/webp', 'application/pdf'].includes(f.type));
      pages.replaceChildren(...chosen.map((f, i) => h('div', { class: 'page' },
        f.type === 'application/pdf' ? h('div', { class: 'pdf' }, 'PDF') : h('img', { src: URL.createObjectURL(f), alt: f.name }),
        h('button', { class: 'remove-page', 'aria-label': 'Remove page', onclick: event => { event.preventDefault(); choose(chosen.filter((_, j) => j !== i)); } }, '×'))));
      readButton.disabled = !chosen.length;
      readButton.replaceChildren(icon('sparkle'), chosen.length > 1 ? 'Read ' + chosen.length + ' pages with AI' : 'Read prescription with AI');
      const bigPdf = chosen.find(f => f.type === 'application/pdf' && f.size > 3_500_000);
      status.replaceChildren(bigPdf ? h('p', { class: 'notice warn' }, bigPdf.name + ' is larger than 3.5 MB. Split it, or upload photos of its pages instead.') : '');
    }

    // Photos are shrunk in the browser, then pages are read in batches of up to four.
    async function preparePages() {
      return Promise.all(chosen.map(async f => f.type === 'application/pdf'
        ? { type: f.type, data: await fileToBase64(f) }
        : { type: 'image/jpeg', data: (await shrinkImage(f, 1800, 0.85)).split(',')[1] }));
    }
    function batches(prepared) {
      const groups = [];
      let current = [];
      let size = 0;
      for (const page of prepared) {
        const bytes = page.data.length * 0.75;
        // A PDF always goes on its own: mixed with photos, the model tends to read only the photos.
        if (page.type === 'application/pdf') { if (current.length) groups.push(current); groups.push([page]); current = []; size = 0; continue; }
        if (current.length && (current.length === 4 || size + bytes > 3_000_000)) { groups.push(current); current = []; size = 0; }
        current.push(page);
        size += bytes;
      }
      if (current.length) groups.push(current);
      return groups;
    }

    async function read() {
      readButton.disabled = true;
      const progress = text => { readButton.replaceChildren(icon('sparkle'), text); status.replaceChildren(h('p', { class: 'notice' }, text)); };
      try {
        if (chosen.some(f => f.type === 'application/pdf' && f.size > 3_500_000)) throw new Error('Split large PDFs, or upload photos of their pages.');
        progress('Preparing ' + chosen.length + ' page' + (chosen.length > 1 ? 's' : '') + '…');
        const groups = batches(await preparePages());
        const rows = [];
        const notes = [];
        let done = 0;
        for (const group of groups) {
          progress('Reading pages ' + (done + 1) + (group.length > 1 ? '–' + (done + group.length) : '') + ' of ' + chosen.length + '…');
          const draft = await api.prescription(group);
          rows.push(...draft.medicines);
          if (draft.notes) notes.push(draft.notes);
          done += group.length;
        }
        // The same medicine and timing on two pages is one row.
        const seen = new Set();
        const unique = rows.filter(row => {
          // "Glycomet", "Tab. Glycomet 500 mg" and "GLYCOMET 500" are the same medicine.
          const base = String(row.name ?? '').toLowerCase().replace(/\btab(let)?s?\b\.?|\bcap(sule)?s?\b\.?/g, '').replace(/\d+(\.\d+)?\s*(mg|mcg|g|iu|k|ml)?\b/g, '').replace(/[^a-z]/g, '');
          const key = [base, row.meal, row.timing, row.days].map(v => String(v ?? '').toLowerCase()).join('|');
          if (seen.has(key)) return false;
          seen.add(key);
          return true;
        }).slice(0, 20);
        if (!unique.length) throw new Error('No medicines could be read. Add them by hand below.');
        editor.medicines = unique.map(row => ({
          name: row.name ?? '', strength: row.strength ?? '', amount: row.amount ?? '',
          nickname: row.nickname ?? '', use: row.use ?? '', aiNickname: Boolean(row.nickname || row.use),
          meal: row.meal ?? '', timing: row.timing ?? '', time: row.time ?? '', days: row.days ?? '', source: row.source ?? '', stock: '',
        }));
        reviewed.checked = false;
        drawList();
        await suggestNames(editor.medicines.filter(m => !m.nickname || !m.use));
        status.replaceChildren(h('p', { class: 'notice' }, '✨ Drafted ' + unique.length + ' medicine' + (unique.length > 1 ? 's' : '') + ' from ' + chosen.length + ' page' + (chosen.length > 1 ? 's' : '') + '. Check every highlighted field against the prescription, then save.' + (notes.length ? ' Note: ' + notes.join(' ') : '')));
      } catch (error) {
        status.replaceChildren(h('p', { class: 'notice bad' }, error.message));
      } finally {
        readButton.disabled = !chosen.length;
        readButton.replaceChildren(icon('sparkle'), chosen.length > 1 ? 'Read ' + chosen.length + ' pages with AI' : 'Read prescription with AI');
      }
    }

    // Ask AI what each medicine is for and suggest the name Amma knows it by.
    async function suggestNames(meds) {
      const named = meds.filter(m => m.name?.trim());
      if (!named.length) return;
      try {
        const { medicines: info } = await api.medicineInfo(named.map(m => m.name.trim()));
        named.forEach((m, i) => {
          const found = info.find(row => row.name?.trim().toLowerCase() === m.name.trim().toLowerCase()) ?? info[i];
          if (!found) return;
          if (found.nickname && (!m.nickname || m.aiNickname)) { m.nickname = found.nickname; m.aiNickname = true; }
          if (found.use && (!m.use || m.aiNickname)) m.use = found.use;
        });
        drawList();
      } catch { /* suggestions are optional */ }
    }
    suggestNamesFor = suggestNames;

    const field = (label, input, cls = '') => h('label', { class: 'field ' + cls }, label, input);
    const patientName = h('input', { value: editor.patient.name, maxlength: 40 });
    const caregiverName = h('input', { value: editor.patient.caregiverName, maxlength: 40, placeholder: 'e.g. Ravi' });
    const followMinutes = h('input', { type: 'number', min: 1, max: 180, value: editor.settings.followUpMinutes });
    const allowFollow = h('input', { type: 'checkbox', checked: editor.settings.allowFollowUp });
    const autoCalls = h('input', { type: 'checkbox', checked: editor.settings.autoCalls !== false });
    const share = h('input', { type: 'checkbox', checked: editor.settings.shareWithFamily });

    const save = h('button', { class: 'btn primary', onclick: async () => {
      if (!reviewed.checked) { toast('Tick “I checked this against the prescription” first.', 'bad'); return; }
      const missing = editor.medicines.find(m => !m.name || !m.meal || !m.timing || !m.days);
      if (missing) { toast('Fill the name, meal, timing and days for ' + (missing.name || 'every medicine') + '.', 'bad'); return; }
      editor.patient = { ...editor.patient, name: patientName.value.trim() || 'Amma', caregiverName: caregiverName.value.trim() };
      editor.settings = { followUpMinutes: Number(followMinutes.value) || 30, allowFollowUp: allowFollow.checked, shareWithFamily: share.checked, autoCalls: autoCalls.checked };
      save.disabled = true;
      try {
        data = await api.savePlan(id, { ...editor, medicines: editor.medicines.map(({ source, aiNickname, ...m }) => m) });
        toast('Plan saved. On Time will use it on the next call.');
        editor = null;
        tab = 'today';
        if (!stage) history.replaceState(null, '', '#today');
        render();
      } catch (error) {
        toast(error.message, 'bad');
      } finally {
        save.disabled = false;
      }
    } }, 'Save plan');

    drawList();
    const missingNames = editor.medicines.filter(m => !m.nickname || !m.use);
    if (missingNames.length) suggestNames(missingNames);
    const names = ['BP tablet', 'Sugar tablet', 'Cholesterol tablet', 'Thyroid tablet', 'Heart tablet', 'Kidney tablet', 'B12 tablet', 'Vitamin D tablet', 'Calcium tablet', 'Iron tablet', 'Gas tablet', 'Pain tablet', 'Sleep tablet', 'Blood thinner', 'Antibiotic'];
    return h('div', {},
      h('datalist', { id: 'nicknames' }, names.map(value => h('option', { value }))),
      h('div', { class: 'page-head' }, h('div', {}, h('h1', {}, 'Medicines'), h('p', {}, 'Upload the prescription, check what AI drafted, and add a photo of each pack so ' + data.patient.name + ' can match it on the call.'))),
      h('div', { class: 'stack' },
        h('section', { class: 'card' }, h('div', { class: 'card-head' }, h('h2', {}, 'Prescription')), drop, pages, h('div', { class: 'row' }, readButton), status),
        h('section', { class: 'card' }, h('div', { class: 'card-head' }, h('div', {}, h('h2', {}, 'Medicine plan'), h('p', { class: 'hint' }, 'Highlighted fields were unclear or missing. The simple name is what On Time says on the call (“Sugar tablet”), so Amma doesn’t need to read brand names.'))), list),
        h('section', { class: 'card' }, h('h2', {}, 'Calls'), h('p', { class: 'hint' }, 'How On Time talks to ' + data.patient.name + '.'),
          h('div', { class: 'settings' },
            field('Patient’s name', patientName), field('Your name (shown to the agent)', caregiverName), field('Call back after (minutes)', followMinutes)),
          h('div', { class: 'stack' },
            h('label', { class: 'check' }, autoCalls, 'Call automatically at each medicine time'),
            h('label', { class: 'check' }, allowFollow, 'Allow a follow-up call if a dose isn’t taken yet'),
            h('label', { class: 'check' }, share, 'Share call results with family'))),
        h('div', { class: 'savebar' }, h('label', { class: 'check' }, reviewed, 'I checked this against the prescription'), save),
      ),
    );
  }

  function medCard(m, index, redraw) {
    const set = key => event => { m[key] = event.target.value; event.target.closest('.field')?.classList.toggle('missing', !event.target.value); };
    const input = (key, attrs = {}) => h('input', { value: m[key] ?? '', oninput: set(key), ...attrs });
    const select = (key, options) => h('select', { onchange: set(key) },
      h('option', { value: '' }, 'Select'), options.map(([value, label]) => h('option', { value, selected: m[key] === value }, label)));
    const f = (label, control, key, cls = '') => h('label', { class: 'field ' + cls + (key && !m[key] ? ' missing' : '') }, label, control);
    const photoInput = h('input', { type: 'file', accept: 'image/*', capture: 'environment', onchange: async () => {
      const file = photoInput.files[0];
      if (!file) return;
      try { m.photo = await shrinkImage(file); redraw(); } catch (error) { toast(error.message, 'bad'); }
    } });
    return h('div', { class: 'med' },
      h('div', { class: 'pack-slot' },
        h('label', { class: 'pack-thumb', title: 'Add a photo of the pack' }, photoInput,
          m.photo ? h('img', { src: m.photo, alt: 'Pack photo' }) : h('span', { class: 'add' }, icon('camera'), h('br'), 'Add pack photo')),
        m.photo ? h('button', { class: 'btn small ghost', onclick: () => { m.photo = ''; redraw(); } }, 'Remove photo') : null),
      h('div', { class: 'fields' },
        f('Medicine (as written)', input('name', { placeholder: 'e.g. Glycomet 500', maxlength: 60, onchange: () => { if (!m.nickname || m.aiNickname) suggestNamesFor([m]); } }), 'name', 'wide'),
        f(m.aiNickname ? 'Simple name · AI suggested, please check' : 'Simple name (what Amma calls it)', input('nickname', { placeholder: 'e.g. Sugar tablet', maxlength: 40, list: 'nicknames', oninput: event => { m.nickname = event.target.value; m.aiNickname = false; } }), 'nickname', 'wide' + (m.aiNickname ? ' suggested' : '')),
        f('Strength', input('strength', { placeholder: '40 mg', maxlength: 40 }), 'strength'),
        f('Dose', input('amount', { placeholder: '1 tablet', maxlength: 40 }), 'amount'),
        f('With meal', select('meal', [['breakfast', 'Breakfast'], ['lunch', 'Lunch'], ['dinner', 'Dinner']]), 'meal'),
        f('Timing', select('timing', [['after', 'After meal'], ['before', 'Before meal'], ['fixed', 'Fixed time']]), 'timing'),
        f('Usual time', input('time', { type: 'time' })),
        f('Days', select('days', DAY_OPTIONS), 'days'),
        f('Tablets left', input('stock', { type: 'number', min: 0, step: 0.5, placeholder: 'count' })),
        h('div', { class: 'field' }, ' ', h('button', { class: 'btn small danger', onclick: () => { editor.medicines.splice(index, 1); redraw(); } }, 'Remove')),
        f(m.aiNickname ? 'Used for · AI suggested' : 'Used for', input('use', { placeholder: 'e.g. Blood sugar (diabetes)', maxlength: 80 }), null, 'wide' + (m.aiNickname ? ' suggested' : '')),
        m.source ? h('div', { class: 'source' }, 'Read from prescription: “' + m.source + '”') : null,
      ),
    );
  }

  return { stop: () => poller.stop(), refresh: () => poller.now() };
}

export function turnChip(turn) {
  const verdict = { backchannel: 'kept talking', yield: 'stopped and listened', answer: 'answer', noise: 'ignored' }[turn.decision];
  return h('span', { class: 'turn ' + turn.decision, title: turn.reason || '' }, '“' + turn.heard + '” → ' + verdict + (turn.decision === 'yield' && turn.ms ? ' · ' + turn.ms + ' ms' : ''));
}

function duration(call) {
  if (!call.endedAt) return '';
  const seconds = Math.round((call.endedAt - call.startedAt) / 1000);
  return Math.floor(seconds / 60) + ':' + String(seconds % 60).padStart(2, '0');
}
