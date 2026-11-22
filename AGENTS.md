# On Time: medicine check-in calls in the patient's own language

**Live deployment (all AI features on, no setup needed): https://vqe7ihx8pe.execute-api.us-west-2.amazonaws.com**

A family uploads an elderly person's prescription. AI drafts the medicine plan and the family checks and saves it. At each medicine time the patient's phone rings, and a voice agent speaks to them in their own language (Telugu, Hindi, Tamil, Kannada, Malayalam, Marathi, Bengali, Gujarati or English). It asks about each medicine by a simple name ("Sugar tablet"), shows the patient their own pack photo when they ask "which tablet?", and alerts the family about anything that needs a person.

Two ideas make it work:
- **"Avunu ≠ Aagandi":** the call can tell a listening sound ("సరే", "హ్మ్", "అవును") from a real interruption ("ఆగండి", "చాలు", "ఈ tablet?"). It keeps talking through the first and stops for the second. A standard voice bot stops on every sound.
- **It refuses to guess about medicine:** each prescription page is read 5 times in parallel, the readings are voted on, and each is matched against 240,000 real Indian medicines. Anything the readings don't agree on is flagged for the family, and Save stays blocked until they check it.

---

## 1. Fastest way to review: use the live site

The live site has every key configured (OpenAI, Web Push). You only need a browser: Chrome, Edge or Safari. A microphone is optional; section 5 shows how to drive a call without one.

| Touch point | URL |
|---|---|
| Landing page | `/` |
| Family dashboard (caregiver) | `/?h=<household id>` |
| Patient's phone (call screen) | `/?h=<household id>&view=phone` |
| Stage view (phone + dashboard side by side) | `/?h=<household id>&view=stage` |
| Test samples (prescription and pack photos with known answers) | `/samples/index.html` |

**Use your own household so parallel reviewers don't collide.** Each click on **Start setup** or **Open sample demo** on the landing page creates a new private household with its own link. The three ready-made language demos (`demo-telugu`, `demo-hindi`, `demo-english`) are shared by everyone: if you use them, press **Reset** first, and expect other reviewers to reset them too.

## 2. Logins (test users)

There are no accounts or passwords. A household is reached through an unguessable ID in its link, and that link is the login. Each household has two kinds of user:

| User | How to "log in" | What they do |
|---|---|---|
| **Family member / caregiver** (son, daughter, nurse, paid caretaker) | Open `/?h=<id>` | Onboarding, prescription upload and review, pack photos, Call now, live call, alerts, call history |
| **Patient** | Open `/?h=<id>&view=phone` (on their phone; installable to the Home Screen) | Receives the call, talks, sees captions and pack photos |

Ready-made households (shared, so press Reset on the landing page first):

| Language | Family dashboard | Patient's phone | Patient / greeting / main contact |
|---|---|---|---|
| Telugu | `/?h=demo-telugu` | `/?h=demo-telugu&view=phone` | Lakshmi / అమ్మ / Ravi |
| Hindi | `/?h=demo-hindi` | `/?h=demo-hindi&view=phone` | Kamla / माँजी / Rohit |
| English | `/?h=demo-english` | `/?h=demo-english&view=phone` | Lakshmi / Amma / Ravi |

Each one has the sample prescription saved (9 doses: Metformin morning and night, Amlodipine, Atorvastatin at night, Thyroxine and Pantoprazole before breakfast, Amoxicillin morning and night for 5 days, Vitamin D3 on Sundays), pack photos and tablet counts. Adding `&presenter=1` to the family link shows **Advance to next reminder**, which rings the next time of day's medicines.

## 3. End-to-end journeys

### Journey A: a family sets up a new patient (family dashboard)
1. Open `/` and choose **Start setup**.
2. Onboarding: who is setting this up (family, a caretaker, or the patient), the patient's name, the call language, how On Time greets them ("అమ్మ", "माँजी", "Amma"…), and up to 6 family members or caretakers with one main contact. Save.
3. **Medicines → Upload prescription photos or PDFs.** Use `/samples/prescription.jpg` (download it from `/samples/index.html`). Choose **Read prescription with AI**. It takes about 15–25 s: 5 readings run in parallel and are voted on.
4. Review the plan. Each medicine shows its simple name ("Sugar tablet"), what it contains, dose, meal timing and days. A line the AI wasn't sure about gets an orange **"AI wasn't sure"** card with a Confirm button. **Save plan** stays blocked until every doubt is resolved, every required field is filled, and **"I checked every medicine against the prescription"** is ticked.
5. **Medicine packs at home → Scan packs with AI.** Upload the `pack-*.jpg` files from `/samples/index.html`. Each pack is matched to its medicine by the printed label (never by the tablet's look), and the tablets still in the strip are counted. Expected counts: Metformin 7, Amlodipine 15, Atorvastatin 4, Thyroxine blank (a closed bottle can't be counted), Pantoprazole 8, Amoxicillin 10, Vitamin D3 3. Accept, then save.
6. **Today** shows the day's doses and refill dates. **Share** gives the patient's phone link.

### Journey B: the medicine-time call (patient's phone + family dashboard)
1. Open the patient's phone link in one tab and the family dashboard in another, or use the stage view (`&view=stage`) to see both side by side.
2. On the dashboard press **Call now**, or **Advance to next reminder** in presenter mode. You can also ring it with `POST /api/h/<id>/ring` and body `{"slot":"morning"}`. The phone rings.
3. Answer. The agent greets the patient in their language, asks about the meal (when any medicine is taken after food), then asks about each medicine by its simple name.
4. Things to try (spoken, or typed with the hook in section 5):
   - "Yes, I took it" / "అవును, వేసుకున్నాను" / "हाँ, ले ली": the dose is saved, then one short acknowledgment, then the next medicine.
   - A listening sound while the agent is talking ("సరే", "हाँ जी", "mm-hmm"): the agent lowers its voice for a moment and keeps going.
   - **"Wait, which tablet?" / "ఆగండి, ఈ tablet?"**: the agent stops, the patient's own pack photo appears on the phone, and the agent asks whether the label in their hand matches.
   - **"No, the name is different" / "లేదు, వేరే పేరు ఉంది"**: the agent tells them to set it aside, saves the dose as unconfirmed, and a **pack mix-up alert** appears on the family dashboard.
   - "Not yet": the agent asks them to take it now and waits on the line for up to 2 minutes.
   - A symptom ("I feel dizzy") or an emergency ("chest pain"): the family is alerted, and emergencies get "call 108". The agent never gives medical advice.
5. After the call the dashboard shows the doses ticked, the transcript, the turn-taking decisions (what was heard, the decision, and the time to yield), alerts, and an English summary.

### Journey C: automatic reminders and missed calls
- An EventBridge rule runs the scheduler every minute. At each medicine time it rings the patient's phone, unless those doses are already reported taken.
- A ring nobody answers for 3 minutes becomes a missed call. A follow-up rings later if the family allowed follow-ups.
- **Call alerts on the phone:** on the patient's phone view, tap **Turn on call alerts**. On iPhone, first use Safari → Share → Add to Home Screen (iOS 16.4+).

### Journey D: languages
Open the Hindi or English demo (Reset first) and run Journey B: the whole call, captions and phone screen are in that language. For any of the 9 languages, pick it during onboarding.

## 4. Running it from source

### Prerequisites
- **Node.js 22 or newer** (tested on 22 and 25). No `npm install`: the project has **no npm dependencies** and no build step for local runs.
- An **OpenAI API key** with access to the Realtime API, for the AI features (see below).
- Optional, for deploying: AWS SAM CLI and AWS credentials. Not needed to run or review.
- No database to install: running locally stores data as JSON files in `.data/` (created automatically). The deployed version uses DynamoDB.

### Environment variables (copy `.env.example` to `.env`)

| Variable | Required | What it's for |
|---|---|---|
| `OPENAI_API_KEY` | For the AI features | Prescription reading, simple names, pack scanning, voice calls |
| `PORT` | No (default `8091`) | Local server port |
| `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY` | No | Web Push call alerts. Without them, everything works except alerts to a closed phone app. |
| `REALTIME_MODEL`, `TRANSCRIBE_MODEL`, `VISION_MODEL`, `QUICK_MODEL`, `PACK_MODEL`, `REALTIME_VOICE`, `VISION_READS`, `VISION_EFFORT` | No | Override the default models (see the table in `README.md`) |
| `SECRET_ARN`, `TABLE_NAME`, `PUSH_SUBJECT` | AWS only | Set by `template.yaml` on Lambda. Not used locally. |

**Without a key:** the server, landing page, demo households, onboarding, typing medicines by hand, schedules, dashboard and tests all work. Prescription reading, pack scanning, simple-name suggestions and voice calls need a key. To try those without one, use the live site above, which has every key configured.

### Commands

```sh
cd on-time-agent
cp .env.example .env              # then put your OpenAI key in .env (optional, see above)
node --test test/*.test.mjs       # 91 tests, no network or key needed
node server.mjs                   # http://localhost:8091  (PORT=9000 node server.mjs to change)
```

- There is **one process**. `server.mjs` serves the front end (`dist/`, plain ES modules, no bundler) and the API (`/api/...`), and runs the every-minute scheduler. There is no separate worker or front-end server.
- **No seeding needed.** Click **Start setup** or **Open sample demo** on `http://localhost:8091/`, or open a language demo, which creates `demo-telugu`, `demo-hindi` or `demo-english` with the sample plan and pack photos on first use. From the command line: `curl -X POST localhost:8091/api/demo/telugu -H 'content-type: application/json' -d '{"reset":true}'`.
- Voice calls need a browser with microphone access (Chrome, Edge or Safari) on `localhost` or HTTPS. Share links show the page's own address, so a phone can't open a `localhost` link: for testing on a real phone, use the live site.
- Deploying (not needed to review): `./scripts/deploy.sh`, with AWS credentials and the SAM CLI. Stack: API Gateway HTTP API + one Node 22 Lambda + DynamoDB + EventBridge (every minute) + Secrets Manager. See `template.yaml`.

## 5. Testing a call without a microphone (for automated reviewers)

Add `&debug=1` to the patient's phone link. Then, in the browser console:

```js
// 1. Before answering: give the call a silent "microphone" (no permission prompt)
const ctx = new AudioContext(); const dest = ctx.createMediaStreamDestination();
navigator.mediaDevices.getUserMedia = async () => dest.stream; await ctx.resume();
// 2. Ring it (dashboard Call now, or POST /api/h/<id>/ring {"slot":"morning"}), then answer:
document.querySelector('button[aria-label=Answer]').click();
// 3. Watch the agent, and reply as the patient by typing:
onTimeDebug.state();                       // { screen, caption, agentSpeaking, turns }
onTimeDebug.say('Yes, I had breakfast');   // wait until agentSpeaking is false and the caption ends with "?"
onTimeDebug.say('Yes, I took it');
onTimeDebug.say('Wait, which tablet?');    // the pack photo appears on the phone
onTimeDebug.say('No, the name on my strip is different');  // pack mix-up alert on the dashboard
```

Afterwards, `GET /api/h/<id>` returns the household as JSON: `calls.at(-1).transcript`, `todayDoses` and `alerts`. `scripts/live-call-test.js` runs a whole call automatically, playing recorded answers from `/samples/voice/` (paste it into the console of `/?h=demo-<telugu|hindi|english>&view=phone&debug=1` while the phone rings).

## 6. What is simulated, mocked or unfinished

- **No real login.** A household is reached through an unguessable link. A real launch would add phone-number login with an OTP.
- **The "phone call" is a web app, not a telephone call.** The patient's phone view rings through Web Push plus an in-app ringing screen, and the voice runs over WebRTC to OpenAI Realtime. On iPhone the alert is an ordinary notification (the silent switch mutes it), not a full-screen ring. Real telephony (a phone number that rings) is not built.
- **Sample data only.** The prescription and pack photos in `/samples/` are made up ("On Time Demo Clinic", "Demo Pharma"). The voice clips in `/samples/voice/` are synthetic.
- **Alerts reach the family dashboard only.** There is no SMS, WhatsApp or email.
- **API Gateway's 30-second limit:** prescription reading stops waiting at 26 s. Very messy handwriting gets many lines flagged for review, which is by design.
- **Daily caps** on the live site (households 300, calls 250, prescription reads 400 per day) protect the OpenAI budget.
- **Known small issue:** in Hindi, a reply that the speech-to-text splits in two can make the agent repeat the first medicine question once, and the short "अच्छा." acknowledgment is sometimes skipped. Telugu and English calls were tested end to end on 22 Nov 2026 (all 6 morning doses saved, the pack check and the caretaker alert work).

## 7. Where things are

`README.md` covers the product, model choices and measured results. The engineering notes below cover architecture, decisions and the code map.

| Path | What it does |
|---|---|
| `server.mjs` | Local server: static front end + API + scheduler |
| `aws.mjs`, `template.yaml` | Lambda entry point and AWS stack |
| `lib/api.mjs` | HTTP API routes and demo households |
| `lib/agent.mjs` | Per-call voice agent instructions and tools, in the patient's language |
| `lib/openai.mjs` | Prescription reading (5 readings + vote), pack scanning, Realtime secrets |
| `lib/medicines.mjs`, `lib/data/` | 240,000 Indian medicines used to check readings |
| `lib/household.mjs`, `lib/store.mjs`, `lib/scheduler.mjs`, `lib/push.mjs` | Domain model, storage, every-minute scheduler, Web Push |
| `dist/` | Front end: `app.mjs` (landing), `family.mjs` (dashboard), `phone.mjs` (call screen), `realtime.mjs` (voice call), `turns.mjs` (Avunu ≠ Aagandi), `languages.mjs` (9 languages) |
| `test/` | 91 unit tests (`node --test test/*.test.mjs`) |

---

# Engineering notes (for coding agents working on the code)

Read this first, then `README.md` (product, models, journey). This file covers how the code is built, deployed and tested, what was decided and why, and what is left.

## The project

**On Time** is a hackathon entry (Equal AI × OpenAI "Builders '26", Build Creative theme). **Code freeze: Sunday 22 Nov 2026, 2 PM IST.** Judging is on a working end-to-end demo, being AI-native, and craft.

- **What it does:** a family uploads an elderly person's prescription. AI drafts the medicine plan, and the family checks and saves it. At each medicine time, the patient's phone rings, and a voice agent talks to them in their own language (9 languages). It asks about doses, shows the pack photo when they ask "which tablet?", and alerts the family.
- **Core idea, "Avunu ≠ Aagandi":** turn-taking that tells a listening sound ("సరే", "హ్మ్", "అవును") from a real interruption ("ఆగండి", "చాలు", "ఈ tablet?"). A standard voice bot stops on every sound. On Time keeps talking through listening sounds and stops on real interruptions.
- **Live site:** https://vqe7ihx8pe.execute-api.us-west-2.amazonaws.com
- **Test samples page:** `/samples/index.html` has a made-up prescription and 7 pack photos with known answers.
- **Repository:** https://github.com/madhuripenikalapati/on-time-agent (public). **Never commit secrets or real patient data.**

## Stack

- **Plain ES modules, no framework, no npm dependencies.** Node 22+. The browser code in `dist/` is served as is; there is no bundler.
- **AWS** (SAM, stack `on-time-agent-pilot`, region `us-west-2`, `template.yaml`): one Lambda (`aws.handler`, Node 22, arm64, 30 s timeout), an API Gateway HTTP API (**30 s hard limit per request**), one DynamoDB table (`Households`, pay-per-request, TTL attribute `expires`: households 30 days, quotas 2 days), an EventBridge rule `rate(1 minute)` that runs the scheduler, and Secrets Manager secret `on-time-agent-pilot` (`OPENAI_API_KEY`, `PILOT_PASSWORD`, VAPID keys).
- **The AWS account is a temporary hackathon workshop account** (`WSParticipantRole`) and will be shut down after the event. Console and CLI logins expire within hours, so don't plan on deploying from a laptop.
- **OpenAI:**

| Job | Model / setting |
|---|---|
| Voice calls | `gpt-realtime-2.1`, voice `marin`, speed 0.9, WebRTC from the browser with an ephemeral client secret |
| Caller speech-to-text | `gpt-transcribe` in the call's language |
| Prescription reading | `gpt-5.6-sol`, low reasoning, **5 parallel readings + vote** (see below) |
| Simple names ("Sugar tablet") | `gpt-5.2`, low reasoning (`models.quick`) |
| Pack scanning | `gpt-5.2`, grid counting |

## Deploy: automatic

- **Every push to `main` deploys** (`.github/workflows/deploy.yml`, about 3 minutes). It runs the tests, then `scripts/deploy.sh`: `scripts/build.sh` (copies `aws.mjs`, `lib/`, `dist/` to `build/`, drops `dist/_test`, runs tests, refuses to package anything that looks like an API key), then `sam deploy`, then a check that the live site returns 200.
- It uses the repository secrets `AWS_ACCESS_KEY_ID` and `AWS_SECRET_ACCESS_KEY`, for the IAM user `on-time-deploy`.
- **To check a deploy:** `curl` a live file and grep for your change, for example `curl -s <site>/family.mjs | grep -c '<new text>'`. Unauthenticated GitHub API calls are rate-limited to 60 an hour.
- **By hand, only with valid AWS credentials:** `./scripts/deploy.sh`.

## Run and test locally

```sh
echo "OPENAI_API_KEY=sk-..." > .env   # gitignored. Never commit, print or log it.
node server.mjs                      # http://localhost:8091 (PORT to change). Data in .data/ (gitignored)
node --test test/*.test.mjs          # 91 tests, all must pass (the deploy runs them too)
```

- **Share links use the page's own address.** On localhost they show localhost, which a phone can't open. For phone testing, always use the live site.
- `dist/_test/` (gitignored) is for local test files only.
- `?debug=1` on the phone view exposes `window.onTimeDebug.say(text)` (injects a caller utterance as text) and `.state()`.
- **Call testing without a microphone:** replace `navigator.mediaDevices.getUserMedia` with a stream from `AudioContext.createMediaStreamDestination()`, and play recorded clips into it to simulate the caller.
- **Rings expire:** an unanswered ring becomes a missed call after 3 minutes. Re-ring before re-testing.
- **Shell is zsh:** `set -- $var` does not word-split. Use `for a b in ...` or `${=var}`.

## Code map

| Path | What it does |
|---|---|
| `lib/household.mjs` | Pure domain model: plan, `sanitizeMedicine`, doses, calls, follow-ups, alerts, `publicView`, `RELATIONS` |
| `lib/agent.mjs` | `buildAgent(doc, call)`: per-call instructions and tools in the patient's language (phrasebook from `dist/languages.mjs`) |
| `lib/openai.mjs` | Realtime secrets, `extractPrescription` (5 reads + `voteReadings` + `expandPatterns`), `medicineInfo`, `readPacks` |
| `lib/api.mjs` | HTTP routes shared by `server.mjs` (local) and `aws.mjs` (Lambda), daily quotas |
| `lib/store.mjs` | File store (local) and DynamoDB store, optimistic locking, blobs for pack photos |
| `lib/scheduler.mjs` | Every-minute scheduler: medicine-time rings, missed calls after 3 minutes, follow-ups |
| `lib/push.mjs` | Payload-free Web Push with VAPID (node:crypto, no libraries) |
| `lib/static.mjs` | Static files with a strict CSP: **no inline scripts or styles**. Use classes in `styles.css`, never `style=` attributes |
| `dist/app.mjs` | Router and landing page |
| `dist/family.mjs` | Family dashboard: Today, Medicines editor (prescription upload and review, pack scan), Calls, onboarding wizard, Share card |
| `dist/phone.mjs` | The patient's phone: ring, answer, live call, captions, pack card |
| `dist/realtime.mjs` | `VoiceCall`: WebRTC to OpenAI Realtime, client-side voice detection, ducking, yield, tool loop, safety nets |
| `dist/turns.mjs` | `classifyTurn`: listening sound vs stop word vs question vs correction vs echo |
| `dist/languages.mjs` | 9 language packs (phrasebook, UI strings, listening sounds, stop words, greetings), generated once and hand-fixed |
| `dist/schedule.mjs` | Days (daily, Mon/Thu, weekly), courses ("for N days") |
| `dist/sw.js`, `dist/manifest.webmanifest` | Installable app and call-style notifications |
| `dist/samples/` | Made-up test prescription and pack photos |

## Decisions, and why (don't undo them without a reason)

1. **OpenAI's server voice detection is off** (`turn_detection: null`). Over WebRTC it cut the agent off on any sound, even with `interrupt_response` false. The browser detects speech instead (`VoiceDetector`: RMS, 100 ms to start, 850 ms to end), lowers the agent's voice at once, and decides when the transcript arrives. Speech longer than 2 s always yields.
2. **Turn rules** (`dist/turns.mjs`): no regex or keyword intent detection beyond these lists, and stop words always win. One short unrecognised word while the agent talks counts as a listening sound, because "సరే" was transcribed as "సన్నీ" in real audio. Negations ("కాదు") and "what?" always take the floor.
3. **Safety nets in the call:** a dose can't be recorded in the same turn the question was asked; there's a forced goodbye in the patient's language; an idle closer ends silent calls. The agent never gives medical advice; symptoms and emergencies alert the family ("call 108" for emergencies).
4. **Prescription reading is built to never say a wrong simple name:**
   - Each page is read **5 times in parallel** (`gpt-5.6-sol`, low reasoning, 16–23 s per page, under the 30 s limit).
   - `voteReadings` lines the readings up medicine by medicine. A **name or simple name is kept only if 3 of 4 or 4 of 5 agree.** Weaker agreement sets `doubt` (all readings, joined by " / ") and blanks the simple name.
   - Why: gpt-5.2 called Met XL 50 (a BP tablet) a "Sugar tablet", and a single gpt-5.6-sol reading sometimes read Glimy M1 (sugar) as "Cilny M" (a BP brand).
   - The model copies the written **dose pattern** ("1-0-1") and `expandPatterns` builds the breakfast/lunch/dinner rows in code, because readings sometimes dropped the night dose.
   - Simple names must come from the medicine itself, never from the department or the other medicines on the page.
   - Before/after food that isn't written defaults to **after the meal**, labelled in the editor.
5. **The editor enforces review:** the steps (upload → AI fills in → you check) and a warning are shown up front. The prescription photo stays next to the plan. `doubt` lines get an orange "AI wasn't sure" card with a Confirm button and are skipped for simple-name auto-suggest. **Save is blocked** until every doubt is resolved, every required field is filled (Save names the medicine and scrolls to it), and "I checked every medicine against the prescription" is ticked.
6. **Packs:** the model only describes each strip as a grid with its empty pockets, and the code does the arithmetic. A strip that's cut off, or a closed box or bottle, gets no count. A pack is never identified by how the tablet looks.
7. **No login.** A family is reached by an unguessable ID in the link: `?h=<id>` is the family dashboard, `?h=<id>&view=phone` is the patient's phone. Family members and caretakers are names and relations in the household (up to 6, one main contact), not accounts. A real launch would add phone-number login with an OTP.
8. **Push alerts carry no payload.** The service worker fetches who is calling. On iPhone, alerts need iOS 16.4+ and the app added to the Home Screen from Safari. iOS shows an ordinary notification, not a full-screen ring.
9. **The patient's phone screen** stays simple: the turn-taking chips appear only on the family dashboard. The pack card is cached and captions update in place, because a full re-render made the photo flicker.
10. **Wording** is about any loved one ("Medicines for the people you love"), not only parents or "Amma".

## Status (22 Nov 2026, late morning: demo very soon)

### Demo setup (use this for the demo)
- **Three fixed demo families**, each locked to one language, pre-filled with the sample prescription (9 rows: Metformin morning and night, Amlodipine, Atorvastatin night, Thyroxine and Pantoprazole before breakfast, Amoxicillin morning and night for 5 days, Vitamin D3 on Sundays), pack photos and tablet counts:
  - Telugu: `/?h=demo-telugu` (Lakshmi, greeted అమ్మ), phone `/?h=demo-telugu&view=phone`
  - Hindi: `/?h=demo-hindi` (Kamla, greeted माँजी), phone `/?h=demo-hindi&view=phone`
  - English: `/?h=demo-english` (Lakshmi, greeted Amma), phone `/?h=demo-english&view=phone`
- The landing page has **Language demos** with Open, Stage view and **Reset** for each. `POST /api/demo/<telugu|hindi|english>` with `{"reset":true}` rebuilds the family: today's doses, calls and alerts are cleared, and the links and the phone's call alerts are kept. **Reset each demo before presenting**, otherwise doses taken in rehearsal mean there's nothing left to ask.
- Code: `DEMOS` and `buildDemo` in `lib/api.mjs`. Small pack photos are in `lib/demo/` (under the 160 KB photo limit).
- To start a call: dashboard **Call now**, or `POST /api/h/<id>/ring {"slot":"morning"}`. An unanswered ring becomes a missed call after 3 minutes.
- **Presenter mode** (`&presenter=1`) shows **"Advance to next reminder"**: it rings the next time of day's medicines (morning, then night) without changing the clock. The landing page's language-demo buttons open in presenter mode. Direct links: `/?h=demo-telugu&presenter=1`, `/?h=demo-hindi&presenter=1`, `/?h=demo-english&presenter=1`. Presenter mode also turns automatic calls off when the plan is saved, so nothing rings unexpectedly mid-demo.
- **Demo routine:** Reset → open the presenter link on the laptop → the iPhone shows `…?h=demo-<lang>&view=phone` (installed to the Home Screen from Safari, with call alerts on) → Advance to next reminder → answer on the iPhone.

### Latest call behaviour (owner's explicit request)
- **Nothing is said before a dose is saved.** The reply to a dose question uses `tool_choice: 'required'` (`callerTurn` in `dist/realtime.mjs`): the agent may only call `record_dose`, `wait_for_patient`, `ask_dose`, `flag_for_family`, `show_pack` or `reply_out_loud`. The last one is new (in `lib/agent.mjs`) and covers questions and chat.
- **After a saved "taken", only the short yes line is said:** Telugu plays the recorded `dist/confirm-te.wav` ("మంచిది అండి"), and the agent is told not to thank or acknowledge again. Hindi and English say exactly their phrasebook yes line ("अच्छा." / "Good."). This is in the `record_dose` output note in `runTools`.
- **A two-breath answer counts once.** "అవును… వేసుకున్నాను" is transcribed as two utterances. A short reply (3 words or fewer, no question, stop word or correction) within 6 s of a save, with no question open, is kept as part of the same answer and gets no response (`savedAt` in `dist/realtime.mjs`). Before this fix, the agent improvised "one moment, it's still saving" and asked a medicine twice.
- "Not yet": the agent says "can you take it now? I'll stay on the line", calls `wait_for_patient`, and waits up to 2 minutes. If the tablets have run out, the family gets a refill alert and no callback.
- The other session (Codex) added the structured dose flow (`ask_dose`, app-spoken questions, 8 s repeat, `interpret_pack_reply`, greeting played first). Don't undo it.

### Live call test (no microphone needed)
- `scripts/live-call-test.js`: paste it into the browser console on `/?h=demo-<lang>&view=phone&debug=1` while the phone rings. It answers the call, then plays synthetic caller answers from `/samples/voice/<te|hi|en>-<ate|took>.wav`: "ate" to the meal question and "took" to each dose question. Progress is in `window.__run`. Afterwards, read the transcript with `GET /api/h/demo-<lang>` → `calls.at(-1).transcript`.
- **Last result, Telugu, before the two-breath fix:** greeting → breakfast question → every medicine asked by its simple name → "మంచిది అండి." after each save, no "thanks for confirming", 6 morning doses saved, correct goodbye. Two issues, both from the two-breath answer: "still saving" improvisation, and Thyroid and Vitamin D asked twice. Fixed in 75895a5 and deployed, but **not yet re-tested. Re-run Telugu, then Hindi and English.**

### Prescription reading (done)
- `gpt-5.6-sol`, low effort, 5 readings in parallel. The vote happens at 21 s, with a hard stop at 26 s (API Gateway's limit is 30 s).
- Each reading is matched to 240,000 real Indian medicines (`lib/medicines.mjs`, data in `lib/data/medicines.tsv.gz`, MIT; rebuild with `scripts/build-medicines.mjs`). Readings are compared by what they contain, not by spelling. A different real medicine or strength still flags (even 4 to 1). Three or more readings that agree on a real medicine win over a smudged reading that matches nothing. A line no reading could name is always flagged. The editor shows "Contains …".
- The sample reads 7 of 7 with 0 flags in about 13 s. A real messy handwritten page flags 4–5 of 8 lines, with no wrong simple names.

### Other recent features
- Days: any weekday set (`"mon,wed,fri"`), `daily`, or `alt` (every other day from `startDate`), using weekday chips in the editor (`dist/schedule.mjs`).
- Replace / Add when reading a new prescription; **Remove all medicines**; each day's dose counts once against the tablet count, and a corrected dose puts the tablet back.
- iPhone: each family gets its own install manifest (`/api/h/<id>/manifest-phone`), so the Home Screen icon opens that family's call screen. The phone re-registers call alerts every time it opens. The ringtone is louder.

### Uncommitted
- `dist/family.mjs`: a one-line onboarding hint edit from the Codex session. It's theirs; leave it unless asked.

### Left to do
1. Re-run the live call test in Telugu, Hindi and English (above), and fix anything it shows.
2. The owner tests on their iPhone: install `demo-telugu&view=phone` from Safari to the Home Screen, turn on call alerts, then **Call now**.
3. After the hackathon: delete the IAM user `on-time-deploy` and rotate the OpenAI key and `PILOT_PASSWORD`.

## Working style the owner expects

- Direct and honest. "Done" means tested end to end, not just written. Say what wasn't verified.
- Fix bugs straight away. Keep explanations short and practical.
- No keyword or regex hacks for understanding language: ground the model in real data instead.
- Every change goes through a push, which deploys. Check it on the live site afterwards.

## Appendix: everything else a new session needs

### Getting the full conversation, not just these notes
These notes summarise a very long build session. On the **same Mac**, the original Claude Code conversation can be resumed with its whole history: run `claude --resume` in this folder and pick the On Time session, or use the desktop app's session list. On another machine, `git pull` and start from these notes.

### Infrastructure and secrets (never print or commit secret values)
- AWS: a hackathon workshop account (role `WSParticipantRole`), region `us-west-2`, SAM stack `on-time-agent-pilot`. **The account is shut down after the hackathon.** The live URL is https://vqe7ihx8pe.execute-api.us-west-2.amazonaws.com
- Secrets Manager `on-time-agent-pilot` holds `OPENAI_API_KEY`, `PILOT_PASSWORD` and the VAPID keys. Only the Lambda reads it.
- Deploys: GitHub Actions on every push to `main`, using the repository secrets `AWS_ACCESS_KEY_ID` and `AWS_SECRET_ACCESS_KEY` of the IAM user `on-time-deploy`. Laptop AWS logins (`aws login`) expire within hours, so don't rely on them.
- **Manual fallback if Actions breaks:** run `./scripts/build.sh` to make `on-time-agent-deploy.zip`. In the AWS console's CloudShell: Actions → Upload file, then `cd ~ && rm -rf ontime && mkdir ontime && cd ontime && unzip -q ~/on-time-agent-deploy.zip && sam deploy --stack-name on-time-agent-pilot --capabilities CAPABILITY_IAM --resolve-s3 --no-confirm-changeset --no-fail-on-empty-changeset --region us-west-2 --parameter-overrides PilotSecretArn=$(aws secretsmanager describe-secret --secret-id on-time-agent-pilot --query ARN --output text)`
- The Lambda has 1536 MB of memory (about one vCPU) so medicine matching stays fast.
- Checking a deploy without GitHub's rate-limited API: `curl -s <site>/<file> | grep -c '<new text>'`.

### Test assets
- `dist/samples/` (public): `prescription.jpg`, a made-up "On Time Demo Clinic" prescription for Lakshmi Devi with 7 medicines; `pack-*.jpg`, matching strips with known tablets left (Metformin 7, Amlodipine 15, Atorvastatin 4, Thyroxine a closed bottle so blank, Pantoprazole 8, Amoxicillin 10, Vitamin D3 3); `voice/*.wav`, synthetic caller answers; `index.html`, a page for saving them to a phone. The owner also has copies in `~/Downloads/on-time-test-samples`.
- `lib/demo/`: the same pack photos, shrunk, for the demo families.
- `dist/_test/` (gitignored, local only): real openly licensed prescriptions and packs from Wikimedia, plus Telugu answer clips (sare, hmm, avunu, aagandi, chaalu, tinnanu, vesukunnanu).
- **The owner's father's real prescription is deliberately NOT in the repository** (it has a real name, phone number and address). Never add it. Never show it in the demo.

### Dev scripts (`scripts/dev/`, read the key from `OPENAI_API_KEY` in the environment)
- `live-prescriptions.mjs [label=image.jpg …]`: reads prescriptions through the live API and prints each line, whether it's flagged, what it contains, and the time.
- `compare-models.mjs`: runs `extractPrescription` with `VISION_MODEL`, `VISION_EFFORT` and `VISION_READS` from the environment.
- `replay-not-yet.mjs`: text replay of a call against the live agent. It doesn't mirror the app's structured `ask_dose` flow, so prefer `scripts/live-call-test.js` in the browser.
- `make-voice-clips.mjs`: records synthetic caller answers in the app's voice through a live call session.
- `generate-samples.mjs`: makes the sample prescription and pack photos with `gpt-image-2` (fictional clinic, "Demo Pharma", "for testing only").
- `lang/`: how `dist/languages.mjs` was made. `generate.mjs` uses `gpt-5.2` (high) from `source.mjs`, then `build.mjs` applies the fixes and writes the file. **`dist/languages.mjs` is now the source of truth:** lines were added by hand after the last build (the `takeNow` line in 9 languages, ನಮಸ್ಕಾರ/നമസ്കാരം/নমস্কার greetings), and re-running `build.mjs` would drop them. `calls.mjs` runs a text call in each language.
- `voices/`: how the voice `marin` was chosen (all 10 voices scored for Telugu naturalness and clarity).

### Measured results worth quoting in the pitch
- Turn-taking with real audio: a standard bot stopped on 3 of 3 listening sounds (సరే, హ్మ్, అవును); On Time on 0 of 3, and still yields on "ఆగండి".
- Prescription models on a real handwritten Indian prescription: `gpt-5.2` called Met XL 50 (a BP tablet) a "Sugar tablet". `gpt-5.6-sol` got it right. `gpt-5.5` at high effort was also right but took 149 s. Five readings plus matching against 240,000 real medicines means no wrong simple names: what it can't read, it flags.
- Pack scanning: 7 of 7 sample packs matched with correct counts, and 6 of 6 on real Wikimedia photos.
- One-line pitch: **"It refuses to guess about medicine"** and **"Avunu ≠ Aagandi"**.

### Known limitations (be honest if asked)
- No login: a family is reached by an unguessable link. A real launch would add phone-number OTP.
- iPhone: a web app can't ring like a real phone call. The alert is a notification, the silent switch mutes it, and the volume follows the media volume.
- Very messy handwriting flags many lines for review. That's by design.
- API Gateway's 30 s limit: prescription reading stops waiting at 26 s.

### Owner's working style (from earlier sessions)
- Direct and blunt. Fix bugs straight away, keep updates short, no long explanations.
- "Done" means tested end to end on the live site. Say plainly what wasn't tested.
- Don't chain extra fixes or sleep for minutes inside commands: fix what was asked, push, report, and *ask* about anything else you found.
- Another agent (Codex) works on the same repository in parallel. **`git pull` before editing**, read files fresh, and don't overwrite its work.
- No keyword or regex hacks for understanding language: ground the model in real data instead.

### Ideas not built yet
- Let scanned pack photos resolve flagged prescription lines (a printed label is easier to read than handwriting).
- A hint on the empty pack-photo box pointing to "scan all packs at once".
