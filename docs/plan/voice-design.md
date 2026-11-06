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
- Human listen to the first seconds of the recording: **pending**.

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

- **`voice-live-line`: the assistant does not follow scripted lines exactly.** It was told to say "Key press received. Goodbye." and only "Goodbye." appears in either transcript. It was told to say the menu once and Vapi logged it twice, while Retell heard it once and only 21 TTS characters were billed, so whether it actually played twice is unresolved. The fixed rep script needs a stricter prompt or a stronger model, and a full test.
- **`voice-live-line`: a tone is only proven by the platform message** `User's Keypad Entry:`, never by the model's words.
- **`voice-live-caller`: the Retell recording URL opens with no authentication.** The agent's `opt_in_signed_url` makes URLs expire after 24 hours by default, which conflicts with storing the URL in `calls`. Decide before any non-demo use. The expiry of the plain URL is not documented.
- **`voice-live-caller`: when Vapi ends the call, Retell reports `disconnection_reason: user_hangup`.** That is a normal ending here, not a failure, so the sim fallback must not trigger on it.
- **`voice-live-caller`: budget 2.08 cents per call** for the flat Retell line unless post-call analysis can be turned off, and confirm that it is the cause. A 15.3 s call was billed at 16 s, so expect rounding up to the second.
- **Both: this spike was minimal.** It does not prove the full script fits, or that the rep AI handles the seven lines, three promos and ticket number. The later full tests cover that.

## Sources (read 2026-11-06)

- Retell: [create phone call](https://docs.retellai.com/api-references/create-phone-call), [get call](https://docs.retellai.com/api-references/get-call), [create agent](https://docs.retellai.com/api-references/create-agent), [create Retell LLM](https://docs.retellai.com/api-references/create-retell-llm), [press digit](https://docs.retellai.com/build/single-multi-prompt/press-digit), [versions](https://docs.retellai.com/agent/version), [pricing](https://www.retellai.com/pricing)
- Vapi: [free telephony](https://docs.vapi.ai/free-telephony), [keypad input](https://docs.vapi.ai/documentation/assistants/conversation-behavior/keypad-input-settings), [create assistant](https://docs.vapi.ai/api-reference/assistants/create), [update phone number](https://docs.vapi.ai/api-reference/phone-numbers/update), [get call](https://docs.vapi.ai/api-reference/calls/get), [pricing](https://vapi.ai/pricing)
