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
- **`voice-live-caller`: the first full test must also close the line's open check** (see "Mock provider line"), and run `cli.ts readback <vapi call id>`.
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

### What the spike's data showed, with no new call

- **The menu played once.** Vapi's assistant-only audio has speech only at 7.90-9.05 s and 14.35-14.70 s, and Retell also heard it once. The doubled text is in Vapi's message log, so log text does not prove what was spoken.
- **The 21 billed TTS characters prove nothing about this.** That count leaves out "Goodbye.", which was spoken.
- **The off-script ending was probably a skipped line, not a reworded one.** The log shows `endCall` with no words before it, then "Goodbye.", which matches the documented default `endCallMessage`. This is inferred from the log and the docs. The line now sets `endCallMessage` to its closing line, so the model does not choose those words.
- **Real keypad entries differ from speech.** The platform entry has `time == endTime` and no `duration` or `metadata`. `check.ts` uses this after the call, but the assistant's model can't see the difference, so a caller who says those exact words could still advance it.

### Open risks

- **The prompt has not run on the model.** The menu and rep lines still come from the LLM (`gpt-6-luna`, temperature 0), so word-for-word delivery is unproven. Text rehearsal is built, but `POST /chat` returned `402 payment_method_missing`, because Vapi chat needs a card on file. If the first full test finds the rep off script, try a stronger model.
- **`gpt-6-luna` may ignore temperature.** Vapi accepted and returned the setting, which doesn't show the model honors it.
- **Rep replies are not verified against the request.** The rep agrees to whatever line it is asked about, so the caller side must keep alarm lines out.

### Cost log

| Date | What | Cost |
|---|---|---|
| 2026-11-06 | Provisioning and read-backs | No call placed; no usage charge expected |
| 2026-11-06 | One `POST /chat` attempt, refused with 402 | None: it was refused before running |
| | Live calls in this lane | **0** |

### Commands

`pnpm exec tsx --env-file=.env services/voice/src/live/line/cli.ts provision | rehearse | readback <call id>`. None of them can place a call.

## Sources (read 2026-11-06)

- Retell: [create phone call](https://docs.retellai.com/api-references/create-phone-call), [get call](https://docs.retellai.com/api-references/get-call), [create agent](https://docs.retellai.com/api-references/create-agent), [create Retell LLM](https://docs.retellai.com/api-references/create-retell-llm), [press digit](https://docs.retellai.com/build/single-multi-prompt/press-digit), [versions](https://docs.retellai.com/agent/version), [pricing](https://www.retellai.com/pricing)
- Vapi: [free telephony](https://docs.vapi.ai/free-telephony), [keypad input](https://docs.vapi.ai/documentation/assistants/conversation-behavior/keypad-input-settings), [create assistant](https://docs.vapi.ai/api-reference/assistants/create), [update phone number](https://docs.vapi.ai/api-reference/phone-numbers/update), [get call](https://docs.vapi.ai/api-reference/calls/get), [pricing](https://vapi.ai/pricing), [chat quickstart](https://docs.vapi.ai/chat/quickstart)
