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
node --test test/*.test.mjs          # 63 tests, all must pass (the deploy runs them too)
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

## Status (21 Nov 2026, night)

**Done and verified on the live site:**
- calls in all 9 languages;
- real-audio turn-taking: Standard bot stopped on 3 of 3 listening sounds, On Time on 0 of 3, and On Time yields on "ఆగండి";
- prescription reading:
  - the sample: 7 of 7 correct in about 12 s;
  - a real messy handwritten prescription: no wrong simple names, with hard lines flagged;
- pack scanning on the 7 samples: all matched with correct counts;
- courses, weekly doses, onboarding, scheduler rings, missed calls, alerts, the Share card, iPhone layout fixes, automatic deploys.

**Not yet verified, and the biggest risk:** a real iPhone with a real voice. That means install to the Home Screen, notifications, microphone and speaker, and a whole call. The owner is testing this now.

**Left to do:**
1. Fix whatever the iPhone test finds.
2. Slides: problem → Avunu ≠ Aagandi before/after (3 of 3 vs 0 of 3) → how it works → "it refuses to guess about medicine".
3. A 2–3 minute demo script, and a backup screen recording of a full call.
4. **Use the sample prescription in the demo, never a real one.**
5. After the hackathon: delete the IAM user `on-time-deploy`, rotate the OpenAI key and `PILOT_PASSWORD` (they were shared during the build), and expect the AWS account to be closed.

## Working style the owner expects

- Direct and honest. "Done" means tested end to end, not just written. Say what wasn't verified.
- Fix bugs straight away. Keep explanations short and practical.
- No keyword or regex hacks for understanding language: ground the model in real data instead.
- Every change goes through a push, which deploys. Check it on the live site afterwards.
