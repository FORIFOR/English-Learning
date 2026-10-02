# Verification record

Date: 2026-10-02 UTC · Node.js v24.19.0

## Passed

`npm run check`: syntax checks and **57/57 tests passed** on the final source.

- 18 audio-state tests: real onstart vs pending; final onend vs completion; per-utterance and per-session stale callbacks; rapid repeated starts; stop/cancel; pending/speaking/gap pause and resume; preserved remaining gap time; startup/completion watchdogs; synchronous and asynchronous speech failure; unavailable speech; local English voice preference and empty-voice fallback
- 12 progress tests: absent/corrupt/inaccessible storage; invalid schema and unknown lesson IDs; exact write/read-back; silent/quota/readback failures; one-day retry and 3/7/14/30-day intervals; due-date boundaries; count and label behavior
- 9 lesson-schema tests: 8 unique original lessons, 42 lines, 24 speaking prompts, Japanese translations, sound notes, valid answer indices, and deterministic practice/listening sequences
- 16 app integration/accessibility declarations tests using a **minimal DOM stub**, not a browser: boot without autoplay; listening pause/restart; cancel on navigation; interrupted listening/segment → speaking; text-only learning and transfer; save once; failed/denied storage; background interruption; speech errors/unavailable/empty voices; focus after answering; reduced motion; stale transitions; external hash navigation; native controls/skip link/focus CSS
- 2 direct local-server handler tests: app files and MIME types; security headers; no external connections; documentation/tests/arbitrary paths not exposed

## Not verified

**No real browser or device pass is claimed. No screenshots were captured.**

Real-browser rendering, end-to-end HTTP access, and device audio behavior have not been verified. The local-server tests exercise the request handler directly.

Remaining release gates:

1. Render at 320, 375, 390, 768, and 1440px; confirm no horizontal overflow, long-title clipping, button overlap, or unreadable Japanese text
2. Test at 200% zoom / enlarged text, with keyboard only, screen reader, and Reduced Motion enabled
3. Test real English voices and audio output on Safari/iOS, Chrome/Android, and desktop browsers, including delayed voice enumeration and no installed English voice
4. Listen to all 42 lines at three playback rates; confirm pronunciation, pauses, stable continuation, and audible model answers
5. Pause/resume and repeat during every handsfree phase; switch lessons/modes mid-utterance and mid-gap; use Back/Forward; lock/background/return
6. Check real browser storage blocked/quota/private-mode behavior and reload persistence
7. Review learning content and language levels with an English-teaching expert before production

## Product limitations surfaced in the UI

- Device speech synthesis, not prerecorded natural audio
- Sound-linking explanations may not be fully realized by a synthetic voice
- No microphone, recognition, or speech score
- Foreground-only use; losing visibility pauses practice and requires a user to resume
- Completion records learning/review activity, not certified understanding or pronunciation ability
- Text-only completion explicitly states that a completed listen was not recorded
- Local browser storage only, with a warning when save/read-back fails

## Implementation review

There are no npm dependencies, remote fonts, remote images, analytics, paid APIs, account setup, payment code, or public-hosting configuration. All instructional text is included in the source. The system speech engine may itself require network access depending on the OS voice selected; the app cannot guarantee offline voice availability.

The primary surface stays mounted. Its content changes on user navigation/answers, actual speech events, explicitly labeled response-time windows, and verified storage results. View transitions have stale-update guards, and reduced motion disables spatial animation.
