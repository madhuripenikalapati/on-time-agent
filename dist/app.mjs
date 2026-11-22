import { h, icon, api, toast } from './ui.mjs';
import { mountFamily } from './family.mjs';
import { mountPhone } from './phone.mjs';

const app = document.getElementById('app');
const params = new URLSearchParams(location.search);

// The installed app opens on the patient's phone screen.
if (params.get('app') === '1') {
  let phone = null;
  try { phone = localStorage.getItem('on-time:phone'); } catch {}
  if (phone) location.replace('?h=' + phone + '&view=phone');
}
// Pages without a family (the landing page) install the general app.
if (!params.get('h')) document.head.append(h('link', { rel: 'manifest', href: '/manifest.webmanifest' }));
if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => {});
const id = params.get('h');
const view = params.get('view');
const presenter = params.get('presenter') === '1';
const remembered = (() => { try { return localStorage.getItem('on-time:last'); } catch { return null; } })();

if (id && /^[A-Za-z0-9_-]{8,24}$/.test(id)) {
  try { if (!view && !presenter) localStorage.setItem('on-time:last', id); } catch {}
  // "Add to Home Screen" then opens this family's page, not the landing page. The link is added
  // here, never in index.html: iPhone reads it as the page loads, before code could change it.
  if (view !== 'stage') document.head.append(h('link', { rel: 'manifest', href: '/api/h/' + id + (view === 'phone' ? '/manifest-phone' : '/manifest-family') }));
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
    mountFamily(app, id, { presenter });
  }
} else {
  landing();
}

function landing() {
  let starting = false;
  const start = async (event, mode) => {
    if (starting) return;
    starting = true;
    const button = event.currentTarget;
    const label = button.textContent;
    button.disabled = true;
    button.textContent = mode === 'setup' ? 'Starting setup…' : 'Opening demo…';
    try {
      const household = await api.create(mode === 'sample');
      const route = { sample: '&view=stage', presenter: '&presenter=1#welcome', setup: '#welcome' };
      location.href = '?h=' + household.id + route[mode];
    } catch (error) {
      toast(error.message, 'bad');
      starting = false;
      button.disabled = false;
      button.textContent = label;
    }
  };
  // Reset starts the demo family fresh (doses, calls, alerts) but keeps its links and phone alerts.
  const openDemo = async (event, key, reset, suffix) => {
    const button = event.currentTarget;
    if (reset && !confirm('Reset the ' + key + ' demo? Today\'s doses, calls and alerts are cleared. Links and phone alerts stay.')) return;
    button.disabled = true;
    try {
      const response = await fetch('/api/demo/' + key, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ reset }) });
      const household = await response.json();
      if (!response.ok) throw new Error(household.error || 'Could not open the demo.');
      if (reset) { toast('The ' + key + ' demo is fresh again.'); button.disabled = false; return; }
      location.href = '?h=' + household.id + suffix;
    } catch (error) {
      toast(error.message, 'bad');
      button.disabled = false;
    }
  };
  const previous = /^[A-Za-z0-9_-]{8,24}$/.test(remembered ?? '');
  app.append(h('main', { class: 'landing' }, h('div', { class: 'landing-inner' },
    h('a', { class: 'logo', href: './' }, h('span', { class: 'logo-mark' }, icon('logo')), 'On Time'),
    h('h1', {}, 'Medicine reminders in ', h('em', {}, 'your language')),
    h('p', { class: 'lead' }, 'Set up check-in calls for yourself or someone you care for. Review the prescription, add medicine pack photos, and see which doses were reported or need follow-up.'),
    h('div', { class: 'landing-options' },
      h('section', { class: 'landing-option' },
        h('h2', {}, 'Manage a medicine plan'),
        h('p', {}, 'For patients, family members, nurses and paid caregivers.'),
        h('div', { class: 'row' },
          previous ? h('a', { class: 'btn primary', href: '?h=' + remembered }, 'Continue setup or open plan') : null,
          h('button', { class: 'btn' + (previous ? '' : ' primary'), onclick: event => start(event, 'setup') }, 'Start setup'))),
      h('section', { class: 'landing-option' },
        h('h2', {}, 'Explore the demo'),
        h('p', {}, 'Try a Telugu reminder call and caregiver handoff using a sample medicine plan.'),
        h('div', { class: 'row' },
          h('button', { class: 'btn', onclick: event => start(event, 'sample') }, 'Open sample demo'),
          h('button', { class: 'btn', onclick: event => start(event, 'presenter') }, 'Start presenter demo')))),
    // Fixed demo families, one language each, with the sample prescription already saved.
    h('section', { class: 'landing-option demo-langs' },
      h('h2', {}, 'Language demos'),
      h('p', {}, 'Ready-made families with the sample prescription and pack photos. Each one calls in its own language only.'),
      ...[['telugu', 'Telugu demo · తెలుగు'], ['hindi', 'Hindi demo · हिन्दी'], ['english', 'English demo']].map(([key, label]) => h('div', { class: 'row demo-lang' },
        h('button', { class: 'btn primary', onclick: event => openDemo(event, key, false, '&presenter=1') }, label),
        h('button', { class: 'btn small', onclick: event => openDemo(event, key, false, '&view=stage') }, 'Stage view'),
        h('button', { class: 'btn small ghost', onclick: event => openDemo(event, key, true, '') }, 'Reset')))),
    h('p', { class: 'footnote' }, 'Hackathon prototype. Use sample prescriptions.'),
  )));
}
