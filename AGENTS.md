# On Time: handoff for coding agents

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
