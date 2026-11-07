# Voice design: live spike result

One real call on 2026-11-06, Retell `+16506493210` to the free Vapi number `+16502522121`. No human on the line, no retry.

- Retell call: `call_9039a7bf3d38365e62da073efb1`
- Vapi call: `01a1b347-f552-788a-b673-11ef98e1219b`

**Result: the design holds. No provider change is needed.**

## The three points

| Point | Result | Evidence |
|---|---|---|
| 1. A Retell number can dial the Vapi free number | **Yes** | Retell `call_status: ended`, 15.3 s. Vapi shows one `inboundPhoneCall` from `+16506493210`, `status: ended`. |
| 2. The Vapi assistant reacts to Press Digit tones | **Yes** | Vapi call messages hold `User's Keypad Entry: 2` with role `user`. Vapi adds this text itself. It arrived about 1.4 s after Retell logged the press. Retell logged `press_digit` with `digit_to_press: "2"`, `successful: true`. |
| 3. Retell retrieval gives what the `calls` table needs | **Yes** | See the mapping below. All fields were present when read after the call ended. |

The fallback for point 2 (speak the menu and advance once the caller has acted) is not needed.

### Mapping for the `calls` table (from `GET /v2/get-call/{call_id}`)

| Column | Retell field | Note |
|---|---|---|
| `mode` | none | Set to `live` by our code. |
| `to_number` | `to_number` | |
| `started_at`, `ended_at` | `start_timestamp`, `end_timestamp` | Milliseconds since epoch. |
| `recording_url` | `recording_url` | Served a real WAV (RIFF header, 733,566 bytes). |
| `transcript_json` | `transcript_object` | Each item has `role`, `content`, `words`. The other AI appears as role `user`. Use `transcript_with_tool_calls` to show the key press. |
| `outcome_json` | none | Retell does not supply it. `call-provider-tool` extracts it from the transcript. |

## Disclosure

- Retell: first utterance is role `agent` and an exact match for `DISCLOSURE_LINE`, spoken from 0.19 s to 5.87 s.
- Vapi, transcribing the audio separately: "Hi. This is an AI assistant calling on behalf of Golden Gate Noodle Company. This call is being recorded." The only difference is the period after "Hi", which is punctuation chosen by the speech-to-text.
- The Retell transcript may reflect its own text rather than the audio, so the Vapi transcript is the independent check.
- Human listen to the recording, 2026-11-06: **the disclosure sounds right.** The human did not report on whether the menu played once or twice. The assistant audio track later settled it: once (see "Mock provider line").

## Transcripts

Retell:

```
agent: Hi, this is an AI assistant calling on behalf of Golden Gate Noodle Company. This call is being recorded.
user: For billing, press two.
[press_digit 2, successful]
user: Goodbye.
```

Vapi:

```
User: Hi. This is an AI assistant calling on behalf of Golden Gate Noodle Company. This call is being recorded.
AI: For billing, press 2. For billing, press 2.
User: User's Keypad Entry: 2
AI: Goodbye.
```

## Cost of the call

**Total $0.0608:** Retell $0.0443, Vapi $0.0165.

| Retell, 16 s billed for a 15.3 s call | Cents |
|---|---|
| `retell_voice_engine` | 1.467 |
| `cartesia_tts_new` | 0.400 |
| `gpt_6_luna` | 0.085 |
| `us_twilio_telephony` | 0.400 |
| `gpt_5_6_terra_text_testing` | 2.080 |
| **`combined_cost`** | **4.432** |

| Vapi | USD |
|---|---|
| `vapi` hosting | 0.0126 |
| `stt` (Deepgram `nova-2-phonecall`) | 0.0028 |
| `tts` (Vapi `Elliot`, 21 characters billed) | 0.0011 |
| `llm` (`gpt-6-luna`) | 0.0001 |
| `transport` | 0 |
| **`cost`** | **0.0165** |

Published per-minute rates matched for the duration-based Retell lines ($0.0882 a minute).

`gpt_5_6_terra_text_testing` is a flat 2.08 cents, 47% of the Retell cost. The agent's `post_call_analysis_model` is `gpt-5.6-terra`, so this is probably post-call analysis, but neither the API nor the docs I read confirm that.

## Settings that worked

Retell (`POST /create-retell-llm`, `POST /create-agent`, `POST /v2/create-phone-call`):

- `start_speaker: agent`, `begin_message` set to `DISCLOSURE_LINE`
- `model: gpt-6-luna` (marked deprecated in favor of `model_config`, still accepted), `voice_id: cartesia-Cleo`
- `general_tools`: `press_digit` with `delay_ms: 500`, and `end_call`
- `max_call_duration_ms: 60000` (the minimum), `end_call_after_silence_ms: 10000` (the minimum)
- `voicemail_option: null`, `ivr_option: null`. The read-back omits both, and the call was not hung up at the menu.
- `interruption_sensitivity: 0`, so the disclosure cannot be cut off
- `override_agent_id` with `override_agent_version: 0`. An unpublished draft agent is accepted.

Vapi (`POST /assistant`, `PATCH /phone-number/{id}`):

- `firstMessageMode: assistant-waits-for-user`, with no `firstMessage`
- `keypadInputPlan: { enabled: true, timeoutSeconds: 1, delimiters: [] }`
- `maxDurationSeconds: 60`, `silenceTimeoutSeconds: 15`
- `startSpeakingPlan: { waitSeconds: 1.5 }`
- `voice: { provider: vapi, voiceId: Elliot }`, `model: { provider: openai, model: gpt-6-luna, tools: [{ type: endCall }] }`

## What later tasks must handle

- **`voice-live-line`: the assistant does not follow scripted lines exactly.** It was told to say "Key press received. Goodbye." and only "Goodbye." appears in either transcript. The fixed rep script needs a stricter prompt or a stronger model, and a full test. Handled so far in "Mock provider line", but not yet proven on the model.
- **`voice-live-line`: a tone is only proven by the platform message** `User's Keypad Entry:`, never by the model's words. Handled in `check.ts`.
- **`voice-live-caller`: the first full test must also close the line's open check** (see "Mock provider line"), and run `cli.ts readback <vapi call id>`. It is also the first time the rep script runs on the model, so budget for finding script problems there.
- **`voice-live-caller`: the Retell recording URL opens with no authentication.** The agent's `opt_in_signed_url` makes URLs expire after 24 hours by default, which conflicts with storing the URL in `calls`. Decide before any non-demo use. The expiry of the plain URL is not documented.
- **`voice-live-caller`: when Vapi ends the call, Retell reports `disconnection_reason: user_hangup`.** That is a normal ending here, not a failure, so the sim fallback must not trigger on it.
- **`voice-live-caller`: budget 2.08 cents per call** for the flat Retell line unless post-call analysis can be turned off, and confirm that it is the cause. A 15.3 s call was billed at 16 s, so expect rounding up to the second.
- **Both: this spike was minimal.** It does not prove the full script fits, or that the rep AI handles the seven lines, three promos and ticket number. The later full tests cover that.

## Mock provider line (`voice-live-line`)

Code is in `services/voice/src/live/line/`. Assistant `baytel-line` (`027a8389-219a-43c5-9329-197c34e7c7b6`) is attached to `+16502522121`. The read-back matches the design, with no transfer tool, forwarding number or fallback destination.

### Acceptance checks

| Check | Result |
|---|---|
| A real call hears the menu and reaches the rep with no human on the line | **NOT RUN.** Deferred to the first `voice-live-caller` full test, by the human's decision (2026-11-06), to save call credit. |
| Behavior matches the spike, and the transcript never claims an unrecognized tone | Config and checks are in place and tested without a call. **Not yet seen on a real call.** No script line mentions a key being received, and `check.ts` flags any line off script. |
| No call is ever forwarded to a personal phone | Met in config: confirmed by read-back and tests. `vapi.ts` also refuses to place a call. |
| As few live calls as possible, each cost logged | Met: **no live calls in this lane.** |

### Human's decisions (2026-11-06)

- The rep agrees to all seven cancellations and all three promos, with no refusal.
- The ticket number is fixed: `BT-48213`, read digit by digit.
- **No card goes on Vapi, so the text rehearsal stays NOT RUN.** The rep script first runs on the model in the first `voice-live-caller` full test. The `rehearse` command stays in the code, and a 402 from `POST /chat` stops it at once with a message saying why.

### Fixes after review (2026-11-06)

All checked with stubbed tests only. No call, chat rehearsal or `provision` was run against the real account.

- **`provision.ts` no longer attaches an unproven assistant.** The assistant's read-back must pass before the number is touched. Any later failure, or a failed update to an assistant already on the number, detaches it and reads the number back. If the assistant is still on the number, the error says `STILL ATTACHED`. A number on some other assistant is left alone.
- **`check.ts` needs real proof of reaching the rep.** The scripted greeting must appear after the key press. An empty message, the closing line alone, another rep line, or a greeting from before the key press all fail.
- **`check.ts` needs real proof of a tone.** A keypad entry must have both timestamps, present and equal.
- **`provision.ts` only detaches this lane's assistant.** Cleanup reads the number first and leaves it alone if anything else holds it. If that read fails, nothing is detached and the error says `CHECK BY HAND`.
- **`check.ts` needs the full disclosure first.** The caller's speech before the menu must start with `DISCLOSURE_LINE`, ignoring case and punctuation. A missing, partial or late disclosure fails.
- **`check.ts` orders a call by timestamps, not log position.** Every user and bot message needs a valid `time` and `endTime`, or the check reports it. The disclosure must end before the menu starts, the key press must come after the menu ends, and the rep's first line after it must be the greeting. Nothing but the closing line may follow the closing line.
- **`check.ts` takes exact values.** A keypad entry must match `User's Keypad Entry: <digits>` in full, and only the value `2` reaches the rep. The disclosure must end on a word boundary. Off-script text in any alphabet is flagged. A `tool_calls` entry naming no tool fails.
- **The prompt takes exact values.** The menu is left only on a message that is exactly `User's Keypad Entry: 2`, so `22` and `23` stay in the menu. A read-back ticket must have exactly the letters and digits `BT48213` in order. The rehearsal turns cover both, but rehearsal is NOT RUN.

### What the spike's data showed, with no new call

- **The menu played once.** Vapi's assistant-only audio has speech only at 7.90-9.05 s and 14.35-14.70 s, and Retell also heard it once. The doubled text is in Vapi's message log, so log text does not prove what was spoken.
- **The 21 billed TTS characters prove nothing about this.** That count leaves out "Goodbye.", which was spoken.
- **The off-script ending was probably a skipped line, not a reworded one.** The log shows `endCall` with no words before it, then "Goodbye.", which matches the documented default `endCallMessage`. This is inferred from the log and the docs. The line now sets `endCallMessage` to its closing line, so the model does not choose those words.
- **Real keypad entries differ from speech.** The platform entry has `time == endTime` and no `duration` or `metadata`. `check.ts` uses this after the call, but the assistant's model can't see the difference, so a caller who says those exact words could still advance it.

### Open risks

- **The prompt has not run on the model, and won't before the first full test.** The menu and rep lines still come from the LLM (`gpt-6-luna`, temperature 0), so word-for-word delivery is unproven. Text rehearsal is built but NOT RUN: `POST /chat` returned `402 payment_method_missing` because Vapi chat needs a card on file, and the human decided not to add one. If the first full test finds the rep off script, try a stronger model.
- **The detach in `provision.ts` has not run against Vapi.** It sends `assistantId: null`, but Vapi's public schema types that field as a string and does not document null. If Vapi rejects it, the error says `STILL ATTACHED` and the number must be detached by hand.
- **Detaching leaves other routes on the number.** A fallback, squad or workflow route stays until cleared by hand, so a call could still follow it. The error names it.
- **A successful attach replaces whatever held the number, and a later failure does not restore it.** Cleanup detaches our assistant and leaves the number with none, so the previous assistant must be re-attached by hand.
- **The disclosure check allows no word differences.** A mis-heard word on a real call shows as a problem in `readback`, and needs a human to compare it with the recording. The spike's one Vapi transcript passes, but one sample doesn't show how often this happens.
- **The updated `provision.ts` has not run against Vapi at all.**
- **`baytel-line` on Vapi still has the old prompt, which accepts any keypad message starting with `2`.** The prompt fix changes assistant config, and `provision` was not run, by the human's rule. Run `provision` before the first `voice-live-caller` full test, or that test runs the old prompt.
- **The timestamp rules have only fixture data behind them.** They assume Vapi's `time` and `endTime` share one clock across speech, keypad and bot messages, and that a bot message's `endTime` is when it stopped. Vapi's log already doubled the spike's menu text, so a real call may flag a good call, for example "the key was pressed before the menu finished". Compare any such problem with the recording, and adjust the rule if the log is wrong.
- **`gpt-6-luna` may ignore temperature.** Vapi accepted and returned the setting, which doesn't show the model honors it.
- **Rep replies are not verified against the request.** The rep agrees to whatever line it is asked about, so the caller side must keep alarm lines out.

### Cost log

| Date | What | Cost |
|---|---|---|
| 2026-11-06 | Provisioning and read-backs | No call placed; no usage charge expected |
| 2026-11-06 | One `POST /chat` attempt, refused with 402 | None: it was refused before running |
| | Live calls in this lane | **0** |

### Commands

`pnpm exec tsx --env-file=.env services/voice/src/live/line/cli.ts provision | rehearse | readback <call id>`. None of them can place a call. With no card on Vapi, `rehearse` stops at its first request with a 402 message.

## Live caller (`voice-live-caller`)

Code is in `services/voice/src/live/caller/`. **One real call has run (2026-11-07, Retell `call_5063699ba3b221ad214366fd7ff`, Vapi `01a1b4ea-f9a6-7000-91d4-86fc33175855`).** Both sides were provisioned for it. The test script passed, but the line check did not. See below.

### Acceptance checks

| Check | Result |
|---|---|
| A real call reaches the line and completes with no human on it | **Met.** 160.9 s, ended `agent_hangup`. |
| The disclosure is first, word for word, in recording and transcript | **Met.** See "Disclosure check" below. Vapi's independent check reported "the caller did not open with the full disclosure"; the recording overrides it. |
| `ALLOWED_CALL_NUMBERS` holds only the Vapi number, and any other number never dials | Met on stubs: zero requests for another number, an empty or wider list, or any other path that places a call. The real call went to the Vapi number. |
| A ticket number is saved in `calls.outcome_json` with `calls.mode=live` | **Met.** `BT-48213`, with all seven lines and three promo accounts. |
| The cost of each live call is logged, and calls are kept short | Logged, about $0.45. **Not short:** 161 s against the demo script's 50 s. |
| A forced failure falls back to sim automatically, with the on-screen label | Met on stubs, including an empty `RETELL_API_KEY`, which sends no request. The label is proven on the row. `panels-action` has not shipped the panel that shows it. |

### Disclosure check

Evidence from the recording of the one real call, which is mono and 160.9 s:

- **Human listen, relayed by the orchestrator, verbatim:** "okay it looks good".
- **Whisper `small.en`, whole recording, 0.00 to 6.06 s:** "Hi, this is an AI assistant calling on behalf of Golden Gate Noodle Company." "This call is being recorded."
- **Whisper `base.en` and `medium.en`, the first 8.2 s cut out on its own, identical text:** "Hi, this is an AI assistant calling on behalf of Golden Gate Noodle Company. This call is being recorded."
- **Order:** the audio level shows the disclosure ending at about 5.9 s and the next speech starting at about 8.2 s. That speech is the menu: "Thanks for calling Baytel Business. For billing, press 2." (`small.en` and `medium.en`).

The transcripts ran locally, so the audio went to no outside service.

**The discrepancy:** the recording shows the full disclosure before the menu, so Vapi's report does not reflect what the recording holds. As the line's open risks say, this check allows no word differences and a problem needs comparing with the recording. Why Vapi's check failed is not confirmed, because `cli.ts` does not print Vapi's text and it was not re-read. This is Retell's recording, so it does not show what reached Vapi's end in the first moments of the call.

### Human's decisions (2026-11-06, relayed by the orchestrator)

- **During a call the screen shows an in-progress row, and the whole transcript when the call ends.** No tunnel. Retell only gives the transcript after the call ends (`get-call`), and its live webhook needs a public URL.
- **The read-back is short:** it counts the lines and accounts. Each item already has the rep's own yes.
- **A call that ends normally with no ticket is a failed live call.** The partial row stays, and sim takes over with the label.
- **`recording_url` is stored plain.** Revisit before any non-demo use.

### How it behaves

- **One call per action, ever.** The row goes in before the dial, so a retry or crash cannot pay for a second call. `scripts/voice-live-test.ts` uses a throwaway database, so each run is a fresh call, and it needs `--place-real-call`.
- **The row starts empty of speech.** It holds only `status` rows until the call ends, then Retell's own record, so it never claims speech that has not happened.
- **The Retell call id is on the row** as a `status` row, for reading back by hand.
- **A call is judged on content, not on why it ended.** `user_hangup` with a ticket is good. `max_duration_reached` with no ticket is not.
- **`provision` prints `RETELL_CALLER_AGENT_ID` and `RETELL_CALLER_AGENT_VERSION`, which must be set in the environment.** The engine reads both at call time and refuses to dial without them.

### Open risks

- **The line check failed on the one real call, and the causes are not confirmed.** `checkLineCall` reported the disclosure problem above, "the rep did not open with its greeting" with the greeting logged as "paytel billing...", and seven "off script" entries for "yes that is canceled". The seven look like spelling only, since the check does not treat "canceled" and "cancelled" as equal the way `extractOutcome` does. The recording settles the disclosure (see "Disclosure check") but not why the check failed. The greeting is not settled by transcript: `small.en` heard "Baytel billing", `base.en` heard "Beto Billing", and `medium.en` missed those words.
- **The caller spoke over the rep's account question** on that call. The rep still accepted the account. The human has heard the recording, and the prompt is unchanged in this lane. The human wants the caller to answer the rep's questions instead of following a fixed script, which is a new lane after this one ships.
- **One real call is one sample.** Speech-to-text also gave "Baytown Billing" and an added "Um", which changed no outcome.
- **`extractOutcome` needs the rep's exact words.** If Retell's speech-to-text turns "that is" into "that's", the item stays out, and with no ticket the call falls back.
- **Normalising only handles single digits.** "Double five" or "seven thousand one" leaves the item out.
- **Vapi's share of the run budget is an estimate** ($0.07 a minute, about $0.19 on the real call, which matched). The real figure comes from `cli.ts readback`.
- **The live agent dials `RETELL_CALLER_AGENT_VERSION`, the version `provision` read back.** Whether an updated draft stays on the same version is not confirmed.
- **The call took 161 s, and the demo script gives a call 50 s.** Seven lines and three promos, one at a time, will not fit that. This is the rehearsal decision noted in `HANDOVER.md`.

### Cost log

| Date | What | Cost |
|---|---|---|
| 2026-11-07 | Full test 1, 160.9 s: Retell $0.2575, Vapi $0.19, both from read-back | **$0.4475** |

### Commands

Each of these talks to a paid account. Run one only with the word for that exact step.

- `pnpm exec tsx --env-file=.env services/voice/src/live/caller/cli.ts provision | readback <retell call id> | readback-line <retell start ms>`
- `pnpm exec tsx --env-file=.env scripts/voice-live-test.ts --place-real-call` **places a real call**

## Caller answers (`voice-caller-answers`)

The caller now answers the rep's questions from a fact sheet, then returns to its request. **Not proven on the model:** no live call and no provisioning ran in this lane, by the human's rule. Both sides must be re-provisioned before a real call, or it runs the old prompts.

### Rules

| Rule | Enforced by |
|---|---|
| Disclosure is fixed text and first | `begin_message` and `problemWith`, unchanged |
| Only code-checked data on the sheet | `facts.ts` reads the database after `checkPlan`. Alarm lines and contact details never get in, proven by a test |
| Never invents a fact, never claims to be a person | **The prompt only.** Code cannot stop words on a live call |
| Nothing beyond the approved items | The prompt, then the off-plan check: a yes to anything outside the plan fails the live call, and sim takes over with the label |
| `extractOutcome` decides what counts | `outcome.ts` is unchanged. Requests stay word for word, so the number and the yes stay on adjacent rows |

### Human's decisions (2026-11-07, relayed by the orchestrator)

- **Authorised:** "Yes. Linda Park, the account holder, approved these changes on November 7, 2026. I'm an AI assistant acting for Golden Gate Noodle Co." The name and date come from the approval record. The rep's fixed question asks who, so that answer leaves out "Yes."
- **Unknown:** "Linda Park, the account holder, can confirm that, and your question is on the record of this call. For today, may I continue with the approved changes?"
- **Beyond approved:** "Linda Park approved only these changes, so anything else is Linda Park's decision, and it is on the record of this call. May I continue with the approved changes?"
- A rep never hears about the dashboard. No callback is promised, because the product cannot make one. No text-to-owner follow-up.
- **Approved by a process, not the owner:** a live call refuses to dial and falls back to sim. A sim call says "This test run was approved automatically on <date>, not by a person." `pnpm run:local` is the case that does this.
- **One rep turn with both questions:** "Thanks. What's the service address, and who authorized these changes?" It is in the live script and the sim. The rep accepts any answer, because it has no data to check against.

### What Vapi's record shows

One read-only `GET /call/01a1b4ea-f9a6-7000-91d4-86fc33175855`, 2026-11-07. Times are seconds from the first message.

- **The opening flag was speech-to-text.** Vapi logged "Hi. This is an **AIS** assistant calling on behalf of Golden Gate Noodle Company. This call is being recorded." The check allows no word differences, so one misheard word fails it. The recording already shows the right words. The rule stays as it is, so a real difference is still caught, and it can raise this false alarm again.
- **The greeting flag is the same kind of thing.** Vapi logged "Paytel billing? Can I have the account number, please?" and "Baytel Business" for the menu, so the rep's logged lines are heard, not the script's text. Not changed in this lane.
- **The overlap was small.** The rep's greeting ran 17.55 to 20.03 s and the caller started at 19.91 s, 0.12 s early. On every other turn the caller started about 1 to 2 s after the rep ended. This is Vapi's clock, not Retell's recording, so what was heard could differ. **`responsiveness` stays unset:** it adds a wait to every turn, and one small overlap in 16 turns does not earn that. The new prompt also says to wait until the rep has finished, which is unproven.

### Time

| Measure | Before | After | Added |
|---|---|---|---|
| Sim, one run each, real model | 161.2 s, 33 model calls | 178.7 s, 35 model calls | **+17.5 s, +2 model calls** |
| Live, estimated only | 160.9 s | about 179 s | **about 18 s** |

- **One run each is rough.** At the baseline's average of 4.9 s a model call, the 2 added calls explain about 10 s. The other 7.5 s looks like model latency: the "after" run has one 16 s gap between rows that has nothing to do with this change.
- **The live figure is arithmetic from the real call's speech rates:** about 12 s for the 33-word answer, 3 s for the 11-word question, and 3 s for two gaps.
- The call was already three times the demo's 50 s, and this makes it longer.

### Open risks

- **None of the new behaviour has run on `gpt-6-luna`.** Stubs prove the code around the prompt, not what the model says.
- **A freer caller may reword a request or merge two.** That leaves items out, and with no ticket the call falls back to sim.
- **The rep has a new turn, and its script has only run on the model once.** If it asks late, the question could split a request from its yes, and that item stays out. That is the safe side, but it would show as a lost item.
- **An answer can be wrong without anything catching it.** The rep accepts anything, so a wrong address would only show in the transcript.
- **Grouped digits now join only when they make a phone number.** "70 01" for an account stays apart and leaves the item out, on the safe side. Before this change it joined. The caller reads single digits, so this should not arise from its own speech, but speech-to-text decides that.
- **`RETELL_CALLER_AGENT_VERSION` after re-provisioning is unconfirmed.** Retell's create-agent page does not say what an update does to the version.

### Cost log

| Date | What | Cost |
|---|---|---|
| 2026-11-07 | One read-only Vapi GET | No call placed; no usage charge expected |
| 2026-11-07 | Two sim runs on the Claude Code login | Estimated $0.78 and $0.86 of login usage, no voice credit |
| | Live calls and provisioning in this lane | **0** |

## Sources (read 2026-11-06)

- Retell: [create phone call](https://docs.retellai.com/api-references/create-phone-call), [get call](https://docs.retellai.com/api-references/get-call), [create agent](https://docs.retellai.com/api-references/create-agent), [create Retell LLM](https://docs.retellai.com/api-references/create-retell-llm), [press digit](https://docs.retellai.com/build/single-multi-prompt/press-digit), [versions](https://docs.retellai.com/agent/version), [pricing](https://www.retellai.com/pricing)
- Vapi: [free telephony](https://docs.vapi.ai/free-telephony), [keypad input](https://docs.vapi.ai/documentation/assistants/conversation-behavior/keypad-input-settings), [create assistant](https://docs.vapi.ai/api-reference/assistants/create), [update phone number](https://docs.vapi.ai/api-reference/phone-numbers/update), [get call](https://docs.vapi.ai/api-reference/calls/get), [pricing](https://vapi.ai/pricing), [chat quickstart](https://docs.vapi.ai/chat/quickstart)
