# On Time

**Builders '26 · Build Creative.** Snap a parent's prescription. On Time calls them in Telugu at the right time, listens the way a person would, shows them the right pack when they're unsure, and tells the family how it went.

## The journey

1. **Prescription → plan.** Upload any number of photos or PDF pages (printed or handwritten). They are shrunk in the browser, read in batches of four, and merged, with duplicates across pages removed (up to 20 medicines). `gpt-4.1` drafts each medicine, dose, meal time and schedule (daily, Monday and Thursday, or once a week), leaving unclear fields blank. It also suggests a **simple name** for each one ("Glycomet → Sugar tablet", "Thyronorm → Thyroid tablet") so a patient who can't read brand names still knows which one is meant. Typing a medicine by hand fills in the same simple name and a plain "used for" line. Both are marked as AI suggestions until the family edits them. A family member checks and edits every field, adds a photo of each pack, and saves. A schedule the app doesn't recognise is rejected, never silently turned into "daily".
2. **A real Telugu phone conversation.** At the scheduled time, the patient's phone rings. A Realtime voice agent (`gpt-realtime` over WebRTC) holds a natural Telugu conversation grounded in the saved plan. It can record a dose, show the pack, schedule a callback and alert the family through tool calls.
3. **The family sees it live.** The dashboard (any device) shows each dose as the patient reports it, the live transcript, alerts such as a pack mix-up or a new symptom, refill dates, and an English summary of every call.

## Avunu ≠ Aagandi: Telugu turn-taking

Standard voice bots treat every sound the same. They stop on every "హ్మ్", or they talk over a real "ఆగండి". On Time runs its own turn-taking layer (`dist/turns.mjs`, `dist/realtime.mjs`) on top of the Realtime model. The server is configured to neither auto-reply nor auto-interrupt.

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

Open `/` and choose **Try the demo family**. That opens the **stage** view: the patient's phone on the left and the family dashboard on the right, which is the best layout for a projector. Use **Call Lakshmi now**, then answer on the phone. Voice calls need a microphone and Chrome, Edge or Safari. Open the phone view on a real phone with `?h=<id>&view=phone`.

## Deploy (AWS)

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
