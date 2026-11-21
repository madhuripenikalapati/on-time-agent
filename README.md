# On Time

**Builders '26 · Build Creative.** Snap the prescription of someone you care for (a parent, a grandparent, a spouse, anyone on daily medicines). On Time calls them in their own language at the right time, listens the way a person would, shows them the right pack when they're unsure, and tells the family how it went.

## The journey

0. **Onboarding.** Who is setting this up (family, a paid caretaker, or the patient themself), the patient's name and how On Time should greet them on the call ("అమ్మ", "నాన్న", "Lakshmi గారు"…), and the family members and caretakers, with one main contact. The agent mentions the main contact ("Priya గారికి చెప్తాను").

1. **Prescription → plan.** Upload any number of photos or PDF pages (printed or handwritten). They are shrunk in the browser, read in batches of four, and merged, with duplicates across pages removed (up to 20 medicines). `gpt-4.1` drafts each medicine, dose, meal time and schedule (daily, Monday and Thursday, or once a week), leaving unclear fields blank. It also suggests a **simple name** for each one ("Glycomet → Sugar tablet", "Thyronorm → Thyroid tablet") so a patient who can't read brand names still knows which one is meant. Typing a medicine by hand fills in the same simple name and a plain "used for" line. Both are marked as AI suggestions until the family edits them. A family member checks and edits every field, adds a photo of each pack, and saves. A schedule the app doesn't recognise is rejected, never silently turned into "daily".
   **Courses:** "for 5 days" or "x 3 months" sets a course length, and "stat" becomes a single day. Calls stop the day after the course ends. The family sees "Day 3 of 10", then "Course finished". Refills check whether the strip will last until the end. On the last day the agent tells the patient they can stop from tomorrow.
1b. **Scan the packs at home.** Photograph every strip or box. `gpt-4.1` reads each label, matches it to a medicine in the plan (never by the tablet's look), and counts the pockets that still hold a tablet. A closed box is left blank rather than guessed. The family reviews each match and count. The photo becomes that medicine's pack picture, so when the patient asks "ఈ tablet?" they see their own strip, and the tablet count drives refill reminders.
2. **A real Telugu phone conversation.** At the scheduled time, the patient's phone rings. A Realtime voice agent (`gpt-realtime` over WebRTC) holds a natural Telugu conversation grounded in the saved plan. It can record a dose, show the pack, schedule a callback and alert the family through tool calls.
3. **The family sees it live.** The dashboard (any device) shows each dose as the patient reports it, the live transcript, alerts such as a pack mix-up or a new symptom, refill dates, and an English summary of every call.

## Models, chosen by testing

| Job | Model | Why |
|---|---|---|
| Live Telugu call (listen, talk, tools, summary) | `gpt-realtime-2.1`, voice `marin`, a little slower for elders | Newest realtime model; much better Telugu than the original `gpt-realtime`. Voice chosen by recording 3 Telugu phrasebook lines in all 10 voices, transcribing them back for clarity, and having `gpt-audio-1.5` rank them head to head for native-sounding Telugu: `marin` scored highest overall |
| Turning the caller's speech into text | `gpt-transcribe`, Telugu | Newest transcription model |
| Reading prescriptions (photos, PDFs) | `gpt-5.6-sol`, low reasoning, **read three times and voted** | On a real handwritten Indian prescription (8 medicines), seven models were compared. `gpt-5.2` called Met XL 50 (a BP tablet) a "Sugar tablet"; `gpt-5.6-sol` got it right in every run. Single readings still slipped now and then on look-alike names, so each page is read three times at once and the code takes the majority. A line the readings disagree on is highlighted with all three readings and gets no simple name until the family checks it. 16–21 s per page |
| Simple names ("Sugar tablet") and "used for" | `gpt-5.2`, low reasoning | `gpt-4.1-mini` called an antibiotic (Lyncipro) a "Sugar tablet"; `gpt-5.2` didn't |
| Pack scanning (match + tablets left) | `gpt-5.2` with grid counting | 6/6 on real pack photos; `gpt-4.1` missed two |
| Turn-taking (Avunu ≠ Aagandi) | No model: rules in the browser | Instant and the same every time |

Each prescription page is read in its own request, all pages in parallel, and the three readings of a page also run in parallel. Real pages took 6–21 s each, under the 30 s request limit.

## Tested on real pack photos

Six openly licensed photos from Wikimedia Commons, with the truth worked out by hand:

| Photo | Truth | Result |
|---|---|---|
| A single loose tablet (Biogesic), no pack | No match: never identify a loose tablet by its look | No match ✅ |
| Metformin box with two strips cut off by the frame | Can't be counted | Matched to Glycomet (same generic); "at least 10 visible", low confidence ✅ |
| Siofor 500 (German metformin), one full strip | 10 | Matched to Glycomet, noted as a different brand; 10 ✅ |
| Neorelax MR, a real Indian strip, foil side only | Tablets not visible | Matched; count left blank ✅ |
| Valaciclovir 500 with a Japanese label | 6 | Matched to Valcivir 500; 6 ✅ |
| Zumenon 2 mg: one strip with 3 popped, one full | 53 | 53 ✅ |

Asking the model for a total gave wrong counts with "high confidence" (50 for 53, 7 for 6). Now the model only describes each strip as a grid, its few empty pockets, and whether it is fully in view. The code does the arithmetic and sets the confidence. `gpt-5.2` got all six right this way, and `gpt-4.1` missed two.

## Nine languages

Calls, the patient's phone screen and the call alert work in **Telugu, Hindi, Tamil, Kannada, Malayalam, Marathi, Bengali, Gujarati and English**. The family picks the language and the greeting ("माँजी", "அம்மா", "Lakshmi గారు"…) during onboarding.

- The Telugu phrasebook was written by hand. The others were generated once with `gpt-5.2` (high reasoning) from one English source and stored in `dist/languages.mjs`, so nothing is improvised live. Every phrase and placeholder is checked. Where verbs mark gender (Hindi, Marathi, Gujarati), the agent uses the feminine form to match its voice.
- Turn-taking knows each language's listening sounds and stop words. Generated word lists were reviewed: "ठीक है" was removed from Hindi stop words, and "മതി" (enough) was moved from Malayalam listening sounds to stop words.
- Speech-to-text runs in the call's language. Captions keep all Indian scripts and drop anything else.
- Verified with live calls in Telugu, Hindi and Tamil, including the safety-net goodbye.

## An app on the patient's phone, with alarm-style call alerts

- **Install:** open the patient's phone link (`?h=<id>&view=phone`) on their phone. On Android, tap **Install On Time app**. On iPhone, use Share → Add to Home Screen, then open it from the home screen.
- **Turn on call alerts** on that screen (one permission prompt). From then on the phone buzzes like an incoming call, even when the app is closed. Tapping the alert opens the ringing screen; one tap on **ఎత్తండి** answers.
- **Automatic calls:** an EventBridge rule runs every minute. At each medicine time (the earliest time among that part of the day's medicines) it rings the phone, unless those doses are already reported taken. A ring nobody answers for 3 minutes becomes a missed call, and a follow-up rings later if the family allowed it. Follow-ups after a meal or an untaken dose ring automatically too. **Call now** on the family dashboard uses the same alert.
- Alerts are Web Push with no payload: the push only wakes the phone, which then asks the server who is calling. Only a signed VAPID token is needed (Node's built-in crypto, no libraries). Push addresses are never sent back to browsers.

## Avunu ≠ Aagandi: Telugu turn-taking

Standard voice bots treat every sound the same. They stop on every "హ్మ్", or they talk over a real "ఆగండి". On Time runs its own turn-taking layer (`dist/turns.mjs`, `dist/realtime.mjs`) on top of the Realtime model. OpenAI's server voice detector is switched off, because over WebRTC it cuts the agent's audio on any sound, even with `interrupt_response` off. The browser detects when the caller starts and stops speaking, lowers the agent's voice at once, and sends each finished utterance for Telugu transcription. Then it decides: a listening sound means keep going, and anything else means yield.

| The caller says | While the agent is… | On Time | A standard bot |
|---|---|---|---|
| "సరే", "అవును", "హ్మ్" | explaining | lowers its voice for a moment, then **keeps going** | stops mid-sentence |
| "అవును" | waiting after a question | **records the answer** | same |
| "ఆగండి, ఈ tablet?" | explaining | **stops at once**, then shows the pack | stops, but also stops on every "హ్మ్" |
| "సరే సరే… చాలు" | explaining | keeps listening through "సరే", **yields at "చాలు"** | stops at the first "సరే" |
| pressure-cooker whistle, its own echo | explaining | ignores it | stops |

The call screen has a **Standard bot** switch, so you can hear the difference on the same call. Every decision is logged on the call (what was heard, the decision, and the time to yield).

## Safety boundaries

- The agent only asks about medicines a person reviewed and saved. It never gives medical advice, changes a dose, or identifies a loose tablet by its look.
- An unclear or mixed answer ("అవును, కానీ…") is never recorded as taken.
- A label mismatch asks the patient to set the pack aside and check with the pharmacist or family. A symptom or an emergency word alerts the family, and emergencies get "call 108".
- Follow-up calls happen only if the family allowed them. Changing the plan cancels a pending follow-up.
- Hackathon prototype: use sample prescriptions only.

## Run locally

```sh
echo "OPENAI_API_KEY=sk-..." > .env   # gitignored; never commit it
node server.mjs                      # http://localhost:8091
node --test test/*.test.mjs
```

Run `node --test test/*.test.mjs` (43 tests). Open `/` and choose **Try the demo family**. That opens the **stage** view: the patient's phone on the left and the family dashboard on the right, which is the best layout for a projector. Use **Call Lakshmi now**, then answer on the phone. Voice calls need a microphone and Chrome, Edge or Safari. Open the phone view on a real phone with `?h=<id>&view=phone`.

## Deploy (AWS)

**Automatic:** every push to `main` runs the tests and deploys (`.github/workflows/deploy.yml`), using the repository secrets `AWS_ACCESS_KEY_ID` and `AWS_SECRET_ACCESS_KEY` of a deploy-only IAM user. **By hand:** `./scripts/deploy.sh` does the same from any machine with AWS credentials and checks the live site afterwards.


The stack is API Gateway (HTTP API), one Node 22 Lambda, DynamoDB for households, and Secrets Manager for the OpenAI key. The browser connects straight to OpenAI with a 10-minute client secret, so call audio never passes through the Lambda.

```sh
./scripts/build.sh     # packages only app code into build/ and on-time-agent-deploy.zip
sam deploy --stack-name on-time-agent-pilot --capabilities CAPABILITY_IAM \
  --resolve-s3 --parameter-overrides PilotSecretArn=<secret ARN with OPENAI_API_KEY>
```

From AWS CloudShell, upload `on-time-agent-deploy.zip`, unzip it, and run the same `sam deploy` command. Daily caps on new households, calls and prescription reads are enforced in DynamoDB. Also set a monthly budget on the OpenAI project.

## Code map

| Path | What it does |
|---|---|
| `dist/turns.mjs` | Telugu turn-taking classifier (listening sound, stop, question, echo, noise) |
| `dist/realtime.mjs` | WebRTC call to OpenAI Realtime, ducking, yield, tool loop |
| `dist/phone.mjs` | The patient's phone: ring, answer, live captions, pack card |
| `dist/family.mjs` | Family dashboard: today, live call, alerts, medicines editor, call history |
| `lib/agent.mjs` | Per-call agent instructions and tools, built from the saved plan |
| `lib/household.mjs` | Plan, doses, calls, follow-ups and alerts (pure, unit-tested) |
| `lib/openai.mjs` | Realtime client secrets and prescription reading |
| `lib/api.mjs` | HTTP API shared by `server.mjs` (local) and `aws.mjs` (Lambda) |
| `lib/store.mjs` | File store (local) and DynamoDB store with optimistic locking and quotas |
| `lib/scheduler.mjs` | Every-minute scheduler: medicine-time rings, follow-ups, missed calls |
| `lib/push.mjs` | Payload-free Web Push with VAPID |
| `dist/sw.js`, `dist/manifest.webmanifest` | Installable app and the call-style alert |
