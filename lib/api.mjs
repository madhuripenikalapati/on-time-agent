// Transport-independent API. server.mjs (local) and aws.mjs (Lambda) both call handleApi.
import {
  InputError, newHousehold, setPlan, requestCall, advanceFollowUp, startCall, callEvent, publicView,
  isPhotoData, newId, MAX_PHOTO, MAX_MEDICINES,
} from './household.mjs';
import { buildAgent } from './agent.mjs';
import { createRealtimeSecret, extractPrescription, maxPrescriptionBody, medicineInfo, models } from './openai.mjs';
import { update } from './store.mjs';

const ID = /^[A-Za-z0-9_-]{8,24}$/;
const limits = { households: 300, calls: 250, prescriptions: 400, info: 600 };

const json = (status, data) => ({
  status,
  headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  body: JSON.stringify(data),
});
const fail = (status, error) => json(status, { error });

export const demoPlan = {
  patient: { name: 'Lakshmi', caregiverName: 'Ravi' },
  settings: { followUpMinutes: 30, allowFollowUp: true, shareWithFamily: true },
  medicines: [
    { name: 'Telma 40', strength: '40 mg', amount: '1 tablet', nickname: 'BP tablet', meal: 'breakfast', timing: 'after', time: '09:00', days: 'daily', stock: 14 },
    { name: 'Glycomet 500', strength: '500 mg', amount: '1 tablet', nickname: 'Sugar tablet', meal: 'breakfast', timing: 'after', time: '09:00', days: 'daily', stock: 9 },
    { name: 'Glycomet 500', strength: '500 mg', amount: '1 tablet', nickname: 'Sugar tablet', meal: 'lunch', timing: 'after', time: '13:30', days: 'daily', stock: 9 },
    { name: 'Shelcal 500', strength: '500 mg', amount: '1 tablet', nickname: 'Calcium tablet', meal: 'dinner', timing: 'after', time: '20:30', days: 'daily', stock: 30 },
  ],
};

export async function handleApi(request, { store, key }) {
  const { method, path, headers } = request;
  const parts = path.split('/').filter(Boolean); // ['api', ...]
  const route = parts.slice(1);

  if (method === 'GET' && route[0] === 'status') {
    return json(200, { openai: Boolean(key), realtime: models.realtime, voice: models.voice });
  }

  let body = {};
  if (method === 'POST' || method === 'PUT') {
    if (headers['sec-fetch-site'] && !['same-origin', 'none'].includes(headers['sec-fetch-site'])) {
      return fail(403, 'Requests must come from the app.');
    }
    if (!/^application\/json(\s*;|$)/i.test(headers['content-type'] ?? '')) return fail(415, 'Expected JSON.');
    const limit = route[0] === 'prescription' ? maxPrescriptionBody : route[2] === 'plan' ? 4_000_000 : 400_000;
    if (request.body.length > limit) return fail(413, 'Request too large.');
    try { body = JSON.parse(request.body || '{}'); } catch { return fail(400, 'Invalid JSON.'); }
  }

  try {
    if (method === 'POST' && route[0] === 'prescription' && route.length === 1) {
      if (!key) return fail(503, 'Prescription reading needs the OpenAI key on the server.');
      if (!(await store.quota('rx#' + today(), limits.prescriptions))) return fail(429, 'Daily prescription limit reached.');
      try {
        return json(200, await extractPrescription(body.files, key));
      } catch (error) {
        if (error instanceof TypeError) return fail(400, error.message);
        throw error;
      }
    }

    if (method === 'POST' && route[0] === 'medicine-info' && route.length === 1) {
      if (!key) return fail(503, 'Medicine lookup needs the OpenAI key on the server.');
      if (!(await store.quota('info#' + today(), limits.info))) return fail(429, 'Daily lookup limit reached.');
      try {
        return json(200, { medicines: await medicineInfo(body.names, key) });
      } catch (error) {
        if (error instanceof TypeError) return fail(400, error.message);
        throw error;
      }
    }

    if (method === 'POST' && route[0] === 'households' && route.length === 1) {
      if (!(await store.quota('hh#' + today(), limits.households))) return fail(429, 'Daily limit reached.');
      const doc = newHousehold();
      if (body.demo) setPlan(doc, demoPlan);
      const saved = await store.put(doc, 0);
      return json(201, publicView(saved));
    }

    if (route[0] !== 'h' || !ID.test(route[1] ?? '')) return fail(404, 'Not found.');
    const id = route[1];
    const action = route.slice(2);

    if (method === 'GET' && action.length === 0) {
      const doc = await store.get(id);
      return doc ? json(200, publicView(doc)) : fail(404, 'Household not found.');
    }

    const mutate = async change => {
      const outcome = await update(store, id, change);
      return outcome ? json(200, { ...publicView(outcome.doc), result: outcome.result ?? null }) : fail(404, 'Household not found.');
    };

    if (method === 'GET' && action[0] === 'photo' && ID.test(action[1] ?? '') && action.length === 2) {
      const photo = await store.getBlob('photo#' + id + '#' + action[1]);
      const match = photo?.match(/^data:(image\/(?:jpeg|png|webp));base64,(.+)$/);
      if (!match) return fail(404, 'Photo not found.');
      return { status: 200, headers: { 'Content-Type': match[1], 'Cache-Control': 'private, max-age=86400' }, body: Buffer.from(match[2], 'base64'), binary: true };
    }

    if (method === 'PUT' && action[0] === 'plan') {
      if (!(await store.get(id))) return fail(404, 'Household not found.');
      const medicines = Array.isArray(body.medicines) ? body.medicines.slice(0, MAX_MEDICINES + 1) : [];
      // New pack photos are stored on their own; the plan keeps a short link to each.
      for (const medicine of medicines) {
        if (typeof medicine?.photo !== 'string' || !medicine.photo.startsWith('data:')) continue;
        if (!isPhotoData(medicine.photo)) return fail(400, 'Pack photos must be JPEG, PNG or WebP images.');
        if (medicine.photo.length > MAX_PHOTO) return fail(413, 'A pack photo is too large.');
        const photoId = newId(8);
        await store.putBlob('photo#' + id + '#' + photoId, medicine.photo);
        medicine.photo = '/api/h/' + id + '/photo/' + photoId;
      }
      return mutate(doc => { setPlan(doc, { ...body, medicines }); });
    }
    if (method === 'POST' && action[0] === 'ring') return mutate(doc => requestCall(doc, body));
    if (method === 'POST' && action[0] === 'cancel-ring') return mutate(doc => { doc.ring = null; });
    if (method === 'POST' && action[0] === 'advance') return mutate(doc => advanceFollowUp(doc));
    if (method === 'POST' && action[0] === 'cancel-followup') return mutate(doc => { doc.followUp = null; });
    if (method === 'POST' && action[0] === 'alerts' && action[2] === 'resolve') {
      return mutate(doc => {
        const alert = doc.alerts.find(a => a.id === action[1]);
        if (!alert) throw new InputError('Unknown alert.');
        alert.resolved = true;
      });
    }

    if (method === 'POST' && action[0] === 'calls' && action.length === 1) {
      if (!key) return fail(503, 'Voice calls need the OpenAI key on the server.');
      if (!(await store.quota('call#' + today(), limits.calls))) return fail(429, 'Daily call limit reached.');
      let agent;
      const outcome = await update(store, id, doc => {
        const call = startCall(doc, body);
        agent = buildAgent(doc, call);
        return call;
      });
      if (!outcome) return fail(404, 'Household not found.');
      const call = outcome.result;
      let secret;
      try {
        secret = await createRealtimeSecret(agent, key);
      } catch (error) {
        console.error(error.message, error.detail ?? '');
        await update(store, id, doc => {
          const failed = doc.calls.find(c => c.id === call.id);
          if (failed) { failed.status = 'failed'; failed.endedAt = Date.now(); }
        });
        return fail(502, 'Could not connect the voice call. Try again.');
      }
      return json(200, {
        call,
        secret,
        medicines: agent.due.map(({ photo, ...m }) => ({ ...m, hasPhoto: Boolean(photo) })),
        household: publicView(outcome.doc),
      });
    }

    if (method === 'POST' && action[0] === 'calls' && ID.test(action[1] ?? '') && action[2] === 'events') {
      const events = Array.isArray(body.events) ? body.events.slice(0, 20) : [];
      return mutate(doc => events.map(event => {
        try { return callEvent(doc, action[1], event); } catch (error) {
          if (error instanceof InputError) return { ok: false, error: error.message };
          throw error;
        }
      }));
    }

    return fail(404, 'Not found.');
  } catch (error) {
    if (error instanceof InputError) return fail(400, error.message);
    console.error(error.message, error.detail ?? '');
    return fail(502, 'Something went wrong. Try again.');
  }
}

function today() {
  return new Date().toISOString().slice(0, 10);
}
