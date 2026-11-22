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
const remembered = (() => { try { return localStorage.getItem('on-time:last'); } catch { return null; } })();

if (id && /^[A-Za-z0-9_-]{8,24}$/.test(id)) {
  try { if (!view) localStorage.setItem('on-time:last', id); } catch {}
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
    mountFamily(app, id);
  }
} else {
  landing();
}

function landing() {
  let starting = false;
  const start = async (event, demo) => {
    if (starting) return;
    starting = true;
    const button = event.currentTarget;
    const label = button.textContent;
    button.disabled = true;
    button.textContent = demo ? 'Opening demo…' : 'Starting setup…';
    try {
      const household = await api.create(demo);
      location.href = '?h=' + household.id + (demo ? '&view=stage' : '#welcome');
    } catch (error) {
      toast(error.message, 'bad');
      starting = false;
      button.disabled = false;
      button.textContent = label;
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
          h('button', { class: 'btn' + (previous ? '' : ' primary'), onclick: event => start(event, false) }, 'Start setup'))),
      h('section', { class: 'landing-option' },
        h('h2', {}, 'Explore the demo'),
        h('p', {}, 'Try a Telugu reminder call and caregiver handoff using a sample medicine plan.'),
        h('button', { class: 'btn', onclick: event => start(event, true) }, 'Open sample demo'))),
    h('p', { class: 'footnote' }, 'Hackathon prototype. Use sample prescriptions.'),
  )));
}
