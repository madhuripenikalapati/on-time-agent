// Small DOM helpers, icons, formatters and the API client. No innerHTML with data.

export function h(tag, props = {}, ...children) {
  const el = document.createElement(tag);
  for (const [key, value] of Object.entries(props ?? {})) {
    if (value === undefined || value === null || value === false) continue;
    if (key === 'class') el.className = value;
    else if (key === 'dataset') Object.assign(el.dataset, value);
    else if (key.startsWith('on')) el.addEventListener(key.slice(2), value);
    else if (key in el && typeof value !== 'string') el[key] = value;
    else el.setAttribute(key, value === true ? '' : value);
  }
  for (const child of children.flat(Infinity)) {
    if (child === null || child === undefined || child === false) continue;
    el.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
  return el;
}

const SVG = 'http://www.w3.org/2000/svg';
const paths = {
  phone: 'M6.6 10.8a15.1 15.1 0 0 0 6.6 6.6l2.2-2.2a1 1 0 0 1 1-.25 11.4 11.4 0 0 0 3.6.57 1 1 0 0 1 1 1V20a1 1 0 0 1-1 1A17 17 0 0 1 3 4a1 1 0 0 1 1-1h3.5a1 1 0 0 1 1 1c0 1.25.2 2.45.57 3.57a1 1 0 0 1-.25 1z',
  pill: 'M10.5 20.5 3.5 13.5a5 5 0 0 1 7-7l7 7a5 5 0 0 1-7 7zM8.5 8.5l7 7',
  clock: 'M12 7v5l3 2M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0z',
  logo: 'M12 13V8.5M12 13l3.5 2.2M8 3h8M20 13a8 8 0 1 1-16 0 8 8 0 0 1 16 0z',
  upload: 'M12 16V4m0 0-4 4m4-4 4 4M4 16v3a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-3',
  camera: 'M4 8h3l2-3h6l2 3h3v11H4zM12 17a4 4 0 1 0 0-8 4 4 0 0 0 0 8z',
  copy: 'M9 9h10v10H9zM5 15V5h10',
  check: 'M5 12.5 10 17 19 7',
  x: 'M6 6l12 12M18 6 6 18',
  sparkle: 'M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8z',
  mic: 'M12 15a3 3 0 0 0 3-3V6a3 3 0 0 0-6 0v6a3 3 0 0 0 3 3zm6-3a6 6 0 0 1-12 0m6 6v3',
  plus: 'M12 5v14M5 12h14',
};
export function icon(name, filled = name === 'phone') {
  const svg = document.createElementNS(SVG, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('aria-hidden', 'true');
  const path = document.createElementNS(SVG, 'path');
  path.setAttribute('d', paths[name]);
  if (filled) path.setAttribute('fill', 'currentColor');
  else {
    path.setAttribute('fill', 'none');
    path.setAttribute('stroke', 'currentColor');
    path.setAttribute('stroke-width', '2');
    path.setAttribute('stroke-linecap', 'round');
    path.setAttribute('stroke-linejoin', 'round');
  }
  svg.append(path);
  return svg;
}

export const time = ms => new Date(ms).toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' });
export const dateTime = ms => new Date(ms).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });
export const day = ms => new Date(ms).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
export function ago(ms, now = Date.now()) {
  const minutes = Math.round((now - ms) / 60000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return minutes + ' min ago';
  return time(ms);
}

export const slotLabel = { morning: 'Morning', afternoon: 'Afternoon', night: 'Night' };
export const slotEmoji = { morning: '🌅', afternoon: '☀️', night: '🌙' };
export const mealLabel = { breakfast: 'breakfast', lunch: 'lunch', dinner: 'dinner' };
export function whenText(m) {
  if (m.timing === 'fixed') return 'at ' + (m.time || '—');
  return (m.timing === 'before' ? 'Before ' : 'After ') + mealLabel[m.meal] + (m.time ? ' · ' + m.time : '');
}
export function slotOf(m) {
  if (m.timing !== 'fixed' && m.meal) return { breakfast: 'morning', lunch: 'afternoon', dinner: 'night' }[m.meal];
  const hour = Number(String(m.time || '09').slice(0, 2));
  return hour < 11 ? 'morning' : hour < 17 ? 'afternoon' : 'night';
}
export const statusPill = {
  taken: ['Taken', 'good'],
  not_taken: ['Not taken yet', 'warn'],
  unsure: ['Unconfirmed', 'bad'],
};

async function call(method, path, body) {
  const response = await fetch(path, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : {},
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || 'Request failed (' + response.status + ')');
  return data;
}
export const api = {
  status: () => call('GET', '/api/status'),
  create: demo => call('POST', '/api/households', { demo }),
  get: id => call('GET', '/api/h/' + id),
  savePlan: (id, plan) => call('PUT', '/api/h/' + id + '/plan', plan),
  saveProfile: (id, profile) => call('PUT', '/api/h/' + id + '/profile', profile),
  scanPacks: (id, photos, medicines) => call('POST', '/api/h/' + id + '/packs', { photos, medicines }),
  ring: (id, body) => call('POST', '/api/h/' + id + '/ring', body),
  cancelRing: id => call('POST', '/api/h/' + id + '/cancel-ring', {}),
  missed: (id, reason) => call('POST', '/api/h/' + id + '/missed', { reason }),
  advance: id => call('POST', '/api/h/' + id + '/advance', {}),
  cancelFollowUp: id => call('POST', '/api/h/' + id + '/cancel-followup', {}),
  acknowledge: (id, alertId) => call('POST', '/api/h/' + id + '/alerts/' + alertId + '/acknowledge', {}),
  resolve: (id, alertId) => call('POST', '/api/h/' + id + '/alerts/' + alertId + '/resolve', {}),
  startCall: (id, body) => call('POST', '/api/h/' + id + '/calls', body),
  events: (id, callId, events) => call('POST', '/api/h/' + id + '/calls/' + callId + '/events', { events }),
  prescription: files => call('POST', '/api/prescription', { files }),
  medicineInfo: names => call('POST', '/api/medicine-info', { names }),
};

// Polls a household and calls onData with each fresh copy.
export function poll(id, onData, { interval = 2000, onError } = {}) {
  let stopped = false;
  let timer;
  let version = -1;
  const tick = async () => {
    try {
      const data = await api.get(id);
      if (data.version !== version || data.followUp) { version = data.version; onData(data); }
    } catch (error) { onError?.(error); }
    if (!stopped) timer = setTimeout(tick, typeof interval === 'function' ? interval() : interval);
  };
  tick();
  return { stop() { stopped = true; clearTimeout(timer); }, now: () => { clearTimeout(timer); tick(); } };
}

export function toast(message, kind = '') {
  const el = h('div', { class: 'toast ' + kind, role: 'status' }, message);
  document.body.append(el);
  setTimeout(() => el.classList.add('show'), 10);
  setTimeout(() => { el.classList.remove('show'); setTimeout(() => el.remove(), 300); }, 3200);
}

// Downscale a photo so it fits comfortably in the household record.
export function shrinkImage(file, max = 640, quality = 0.72) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      const scale = Math.min(1, max / Math.max(img.width, img.height));
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(img.width * scale);
      canvas.height = Math.round(img.height * scale);
      canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
      URL.revokeObjectURL(url);
      resolve(canvas.toDataURL('image/jpeg', quality));
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Could not read that image.')); };
    img.src = url;
  });
}

export const fileToBase64 = file => new Promise((resolve, reject) => {
  const reader = new FileReader();
  reader.onload = () => resolve(String(reader.result).split(',')[1]);
  reader.onerror = () => reject(new Error('Could not read ' + file.name));
  reader.readAsDataURL(file);
});

export function packCard(medicine) {
  return h('div', { class: 'pack-card' },
    medicine.nickname ? h('div', { class: 'pack-nickname' }, medicine.nickname) : null,
    medicine.photo
      ? h('img', { src: medicine.photo, alt: 'Saved photo of the ' + medicine.name + ' pack' })
      : h('div', { class: 'mock-pack' }, h('strong', {}, medicine.name), h('span', { class: 'muted' }, medicine.strength || ''), h('span', { class: 'small muted' }, 'No pack photo saved')),
    h('dl', {},
      h('div', {}, h('dt', {}, 'Name'), h('dd', {}, medicine.name)),
      h('div', {}, h('dt', {}, 'Strength'), h('dd', {}, medicine.strength || '—')),
      h('div', {}, h('dt', {}, 'Dose'), h('dd', {}, medicine.amount || '—')),
    ),
  );
}
