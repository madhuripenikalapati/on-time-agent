import { h, icon, api, toast } from './ui.mjs';
import { mountFamily } from './family.mjs';
import { mountPhone } from './phone.mjs';

const app = document.getElementById('app');
const params = new URLSearchParams(location.search);

// The installed app opens on the parent's phone screen.
if (params.get('app') === '1') {
  let phone = null;
  try { phone = localStorage.getItem('on-time:phone'); } catch {}
  if (phone) location.replace('?h=' + phone + '&view=phone');
}
if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => {});
const id = params.get('h');
const view = params.get('view');
const remembered = (() => { try { return localStorage.getItem('on-time:last'); } catch { return null; } })();

if (id && /^[A-Za-z0-9_-]{8,24}$/.test(id)) {
  try { if (view !== 'phone') localStorage.setItem('on-time:last', id); } catch {}
  if (view === 'phone') {
    document.title = 'On Time · Phone';
    mountPhone(app, id);
  } else if (view === 'stage') {
    document.title = 'On Time · Demo stage';
    const left = h('div');
    const right = h('div');
    app.append(h('div', { class: 'stage' }, left, right));
    mountPhone(left, id, { stage: true });
    mountFamily(right, id, { stage: true });
  } else {
    mountFamily(app, id);
  }
} else {
  landing();
}

function landing() {
  const start = async demo => {
    try {
      const household = await api.create(demo);
      location.href = '?h=' + household.id + (demo ? '&view=stage' : '#welcome');
    } catch (error) {
      toast(error.message, 'bad');
    }
  };
  app.append(h('div', { class: 'landing' }, h('div', { class: 'landing-inner' },
    h('a', { class: 'logo', href: './' }, h('span', { class: 'logo-mark' }, icon('logo')), 'On Time'),
    h('h1', {}, 'Your parent’s medicines, ', h('em', {}, 'checked in their language'), ' every day.'),
    h('p', { class: 'lead' }, 'Snap the prescription. On Time calls Amma at the right time in her own language (Telugu, Hindi, Tamil, Kannada, Malayalam, Marathi, Bengali, Gujarati or English), listens like a person would, shows her the right pack, and tells you how it went.'),
    h('div', { class: 'row' },
      h('button', { class: 'btn primary', onclick: () => start(true) }, 'Try the demo family'),
      h('button', { class: 'btn', onclick: () => start(false) }, 'Set up my family'),
      remembered ? h('a', { class: 'btn ghost', href: '?h=' + remembered }, 'Continue where I left off →') : null),
    h('div', { class: 'how' },
      h('div', {}, h('b', {}, '1 · Snap the prescription'), h('span', {}, 'AI drafts each medicine, dose and meal time. You check it and add a photo of each pack.')),
      h('div', {}, h('b', {}, '2 · A real call, in her language'), h('span', {}, '“సరే, సరే” and it keeps going. “ఆగండి, ఈ tablet?” and it stops and shows the pack.')),
      h('div', {}, h('b', {}, '3 · You see it live'), h('span', {}, 'Doses, callbacks, pack mix-ups and symptoms, with an English summary of every call.'))),
    h('p', { class: 'footnote' }, 'Hackathon prototype · use sample prescriptions only · On Time never gives medical advice'),
  )));
}
