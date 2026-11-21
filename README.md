# On Time Agent

Builders ’26 · Build Creative. A synthetic reviewed medicine plan becomes a Telugu browser check-in, a labeled pack card, and a live caregiver update.

Open the hosted site or serve `dist` over HTTP. Open the caregiver view in another tab of the same browser. Start a check-in and try the example replies or use a browser with Telugu speech recognition. Ask “Aagandi, ee tablet?” to open the pack. Try a mismatched label or a complete answer to the dose question. Use “Inka breakfast cheyyaledu” at the meal question to schedule a follow-up. Advance the demo clock to try it without waiting.

The prototype uses prerendered Telugu agent audio, browser speech recognition when available, and rule-based Telugu turn handling. Typed replies exercise the same decisions. The caregiver feed and reviewed synthetic plan are persisted in local browser storage, including an optional small uploaded pack photo. A callback timer runs while the patient page is open. The demo uses one medicine and starts the first call manually. Use only synthetic data. A real phone connection, multi-device sharing, production authentication, prescription extraction, refill and appointment scheduling, voice cloning, and measured voice benchmarking are outside this implementation.

## Judge flow

Download the synthetic sample prescription, upload its TXT file (or use **Load sample**), review the draft fields, optionally add a synthetic pack image, and save. PDF and image uploads are previewed locally and require manual entry or review. No OCR is used. Start the Telugu browser check-in and open the caregiver view in a second tab. The refill estimate uses today's count and the reviewed frequency, assuming the next dose is still due. Recount any time the estimate needs to change. Refill and appointment reminders are browser dashboard cards that update while the page is open. No phone or notification service is used. Do not upload real patient data.

## OpenAI-assisted replies (local)

Run `node server.mjs` with `OPENAI_API_KEY` configured in the server environment, then open http://localhost:8091. Use only synthetic check-ins: caller reply text and the current conversation phase are sent to OpenAI for intent classification. Keep the key out of browser code. OpenAI interprets varied replies, and the app keeps the safe demo prompts, documented care-plan constraints, and final-confirmation rules. The static judge site continues to work with its original local rules.

## AWS pilot

This stack serves the browser demo and OpenAI interpretation from one HTTPS origin. It requires a dedicated Secrets Manager secret containing JSON keys `OPENAI_API_KEY` (fresh project key) and `PILOT_PASSWORD` (a generated password of at least 24 characters). Use the default Secrets Manager encryption or grant the Lambda role access to the specific customer-managed key separately. Sign in with username `pilot`. Keep the pilot limited to synthetic data. Only the reply text and conversation phase go to OpenAI. The app does not log request bodies.

With AWS CLI authenticated via SSO and AWS SAM CLI installed, run from this directory:

```sh
sam validate
sam deploy --guided --stack-name on-time-agent-pilot --capabilities CAPABILITY_IAM
```

Select an AWS region and supply the Secrets Manager ARN when prompted. SAM may upload a deployment ZIP to a managed S3 bucket. Use the `PilotUrl` output after deploying. Keep the deployment small and set spend alerts in AWS and OpenAI. The API has request throttling and bounded Lambda concurrency. These controls limit traffic and do not set a billing ceiling.

The shared pilot login is for synthetic testing. Real patient use needs individual identities and caregiver permissions, a protected data store with a retention policy, reliable background scheduling, and applicable clinical and privacy review. There is no real telephony or cross-device patient data in this stack.
