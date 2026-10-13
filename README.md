# Kinly prototype

A warm, full-screen talking face for older adults, with a family dashboard behind it. It's the first prototype for the [Kinly PRD](#how-this-maps-to-the-prd) (voice, language and access).

- **Elder screen (`/`)**: Kinly's face fills the screen. Tap the face to talk. Three big buttons: **Family** (hear messages, send one by voice), **Reminders** (today's medication and meals, "I've taken it"), **Help** (press and hold to alert the family).
- **Activities** (free, no AI voice minutes): a Today board (day, date, weather, today's plan, what's coming up), brain games (matching pairs with local foods, finish the proverb, drum memory, market maths) that adapt their difficulty and never mark anything "wrong", and gentle chair exercises with spoken counting. They speak with the phone's own voice, so they cost nothing per use.
- **Family dashboard (`/family`)**: see alerts and today's reminder status, send messages that Kinly reads aloud, read the elder's spoken replies, set reminders, quiet hours, language and the family circle.

## Signing in

Every device signs in to a household with its **household code and PIN**. The sign-in screen is always the first thing shown. After that the device stays signed in until someone chooses **Sign out** in Settings (on the elder's screen, press and hold the clock for 2 seconds). If the PIN changes, devices are sent back to sign-in.

## Running it

### On your computer (no accounts needed)

```bash
npm install
KINLY_DEV_MEMORY=1 npm run dev
```

Open the address it prints (use the `Network` one on your Android phone, same Wi-Fi) and sign in with household code `demo` and PIN `123456`. Open `/family` in a second tab to see the family side. This in-memory household resets when the dev server restarts; never set `KINLY_DEV_MEMORY` in production.

Without ElevenLabs configured, Kinly uses a **practice voice**: the phone's own speech with simple built-in rules. It understands things like "yes, I've taken it", "any messages?", "tell Esi I miss the children", "what are my reminders" and "help". Speech recognition needs Chrome.

### Live (Supabase + ElevenLabs + Vercel)

1. **Supabase**: create a project. In the SQL Editor, paste `supabase/setup.sql`, change the household code and PIN on the two marked lines, and run it. From Project Settings → API, note the Project URL and the **service_role** key.
2. **Vercel**: import this repo at vercel.com/new (the framework is detected as Vite). Before deploying, add these environment variables:
   - `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`: from step 1
   - `ELEVENLABS_API_KEY`: from ElevenLabs → Developers → API Keys
   - `KINLY_TOOL_SECRET`: any long random string
3. **Set up the voice**: open `<your site>/family`, join with your household code and PIN, and press **Set up Kinly's voice**. The app creates the Kinly agent and its five tools in your ElevenLabs account. There's no id to copy: the app finds the agent by its name, "Kinly".
4. **Alerts on family phones**: each family member opens `<your site>/family` on their phone, picks their name under "I am", and presses **Turn on alerts**. They then get a notification when the elder presses Help, says something worrying, misses a medicine, or sends them a message. The notification's **I'm on it** button tells everyone else it's handled. Alerts are free web push and need no extra accounts. On iPhone, add the site to the Home Screen first (iOS 16.4+).
5. On the Android tablet, open the site in Chrome, join the same household, then use **⋮ → Add to Home screen**. It opens full screen and keeps the screen on.

To change Kinly's personality or tools later, edit `agent/prompt.ts` or `agent/tools.json`, push, and press the setup button again (it updates the agent instead of making a new one). You can also choose the voice and model in the ElevenLabs dashboard, or set `ELEVENLABS_VOICE_ID`, `ELEVENLABS_TTS_MODEL` and `KINLY_AGENT_LLM` in Vercel. Pick the newest Claude model the agent settings list, and check that your TTS model supports Kiswahili before switching a household to it.

## Keeping voice costs down

Live voice (ElevenLabs) is billed per minute. Families can set **Live voice minutes for chatting, per day** on the dashboard. Help and medicine reminders always use the live voice; once the day's chat minutes are used, chatting continues with the free practice voice. Activities never use the live voice. Today's usage is shown on the dashboard.

## How it works

```
Elder tablet (PWA face) ──WebRTC──▶ ElevenLabs agent (ASR → Claude → TTS)
        │  /api/household, /api/session         │ webhook tools
        ▼                                        ▼
   Vercel functions (server/handlers.ts) ◀───────┘
        │
        ▼
   Supabase: one JSON document per household
        ▲
Family dashboard (/family) ── /api/household
```

- `src/shared/household.ts` is the single source of truth for state changes (`applyAction`). The screens, the API and the agent's tools all run it, so a reminder confirmed by tap, by voice or (later) over a phone call is recorded the same way.
- The agent's tools are **server webhooks**, not browser code. That is deliberate: the same agent can later be attached to a phone number (ElevenLabs + Twilio/SIP) for the PRD's telephony-first path with no rework.
- The ElevenLabs API key never reaches the device. `/api/session` mints a short-lived conversation token and passes the elder's name, today's reminders and unread-message count to the agent.
- Reminders: when one is due, the tablet chimes and Kinly asks about it. It asks again every 10 minutes, and after 30 minutes the reminder is logged as missed. A missed medication alerts the family. Quiet hours are respected.
- Kinly's face (`src/elder/KinlyFace.tsx`) is two flat, expressive eyes and a pair of lips on warm clay. Each mood sets a few numbers (how open the eyes are, squint, pupil size, smile) and springs animate towards them: relaxed at rest with the odd glance, curious widening or playful squint; wide-eyed while listening; a narrow sideways look while thinking; smiling eyes with lips that follow the voice while speaking; drooping eyes when concerned; and closed eyes on a darker clay during quiet hours.

## Project layout

```
src/elder/        face, elder screen, sheets, help button, reminder scheduler
src/family/       family dashboard
src/lib/          household data and sign-in, voice engines (ElevenLabs + practice voice)
src/shared/       data model and state logic shared with the server
server/           API handlers + Supabase store (used by Vercel and the dev server)
api/              Vercel function entry points
agent/            agent prompt and tool definitions (pushed to ElevenLabs by the setup button)
scripts/          sync-agent, create-household
tests/            vitest: state logic, practice-voice rules, scheduler, API + tools
```

`npm test` runs the tests, `npm run typecheck` the types, `npm run build` the production build.

## How this maps to the PRD

| PRD | In this prototype |
|---|---|
| VC-2 medication and meal reminders with spoken confirmation | ✅ scheduled prompts, voice or tap confirmation, logged for family |
| VC-4 escalation | ✅ Help button, distress words, missed medication → family alert with acknowledge |
| LN-2 relayed family messages | ✅ typed messages read aloud; spoken replies sent back |
| SF-1 confirm, don't guess | ✅ in the agent prompt: no medical advice, exact instructions only, escalate when unclear |
| AC-1 voice-first, no literacy needed | ✅ tap anywhere to talk, huge targets, captions optional |
| AC-2 caregiver app accessibility | partly: high contrast, large targets, screen-reader labels; no full WCAG audit yet |
| LN-1 Tier-1 languages, code-switching | partly: English + Kiswahili; African-specific ASR (Intron, Khaya) not wired yet |
| VC-1/VC-3 PSTN calls, missed-call/USSD | ⏭ next: attach a phone number to the same agent |
| HW-1 premium tablet tier | ✅ this is it |

## Prototype shortcuts (not for real users yet)

- Household access is a code and PIN, with no rate limiting or real accounts.
- Missed medicines are checked on the server every 5 minutes by a free GitHub Actions schedule (`.github/workflows/reminders.yml` calls `/api/cron/reminders`). GitHub can delay scheduled runs by a few minutes. For tighter timing, point any external cron (e.g. Supabase pg_cron or cron-job.org) at the same URL.
- The family dashboard refreshes every 5 seconds instead of using push notifications, SMS or WhatsApp.
- Health data needs proper consent, residency and retention rules (PRD PR-1) before any real pilot.
