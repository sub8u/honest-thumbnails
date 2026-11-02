# Chrome Web Store listing: Honest Thumbnails

Copy these into the Developer Dashboard (https://chrome.google.com/webstore/devconsole).
Upload the zip made by `./package.sh` (it leaves out `docs/`, `store/` and `tests/`).

## Store listing tab

**Name:** Honest Thumbnails for YouTube

**Summary** (from manifest, 124 of 132 characters):
Swap clickbait YouTube thumbnails for a real frame or an honest title card. Calm titles, optional AI summaries, no tracking.

**Category:** Productivity → Tools *(alternative: Lifestyle → Entertainment)*

**Language:** English

**Description:**

```
See what a video is, not what it shouts.

Honest Thumbnails swaps over-edited, clickbait YouTube thumbnails for something honest, and calms down shouty titles.

THUMBNAILS
• Real frame: an early, middle or late frame from the video instead of the designed thumbnail.
• Title card: title, channel, views and age, tinted per channel. Hover for likes, chapters and a clickbait flag.
• Peek: hold Alt over a thumbnail to see the original for a moment.

TITLES
• Calm titles: no ALL CAPS shouting, emoji spam or "!!!".
• Clickbait flag: a small ⚠ on titles that use well-known clickbait phrasing.

SUMMARIES (OPTIONAL)
• A one-line gist and key points for any video. If the title promises "7 tips", you get the 7 tips.
• Uses Chrome's built-in on-device model, or your own API key or local model (OpenAI, Gemini, OpenRouter, Ollama, LM Studio).
• Chapters work as a free summary, no AI needed.
• A summary panel under the player on video pages, with a copy button.

YOUR FEED, YOUR RULES
• Hide Shorts and Mixes.
• Dim videos you've already watched.
• Mute words in titles or channel names.
• Trusted channels keep their original thumbnails.
• Alt+Shift+H turns everything on or off.

PRIVATE BY DESIGN
No accounts, no analytics, no servers of ours. Settings stay in your browser. Summaries leave your device only if you choose your own API, and only to the endpoint you enter.

Free and open source (MIT): https://github.com/sub8u/honest-thumbnails
Made by Subrahmanyam KVJ. Not affiliated with YouTube or Google.
```

**Graphics** (all in this folder):
- Store icon 128×128: `../icons/icon128.png`
- Screenshots 1280×800: `screenshot-1-before-after.png`, `screenshot-2-title-cards.png`, `screenshot-3-real-frames.png`, `screenshot-4-controls.png`
- Small promo tile 440×280: `promo-small-440x280.png`

**Official URL / Homepage:** https://github.com/sub8u/honest-thumbnails
**Support URL:** https://github.com/sub8u/honest-thumbnails/issues

## Privacy practices tab

**Single purpose:**
Replace clickbait YouTube thumbnails and titles with honest alternatives (a real video frame or an informative title card), with optional summaries of the video.

**Permission justifications:**

| Permission | Justification |
|---|---|
| `storage` | Saves the user's settings (mode, toggles, muted words, trusted channels), a local cache of video details and summaries, and the user's own API key on their device. |
| Host access to `youtube.com` (content script) | Needed to replace thumbnails and titles on YouTube pages and to read public video details (description, chapters, captions) from youtube.com for the title card and summaries. |
| Optional host permissions (`https://*/*`, `http://localhost/*`, `http://127.0.0.1/*`) | Requested only when the user enters their own AI endpoint in Settings, and only for that one host (e.g. api.openai.com or a local Ollama server). Also requested for sponsor.ajay.app only if the user turns on the SponsorBlock option. Nothing is requested by default. |

**Remote code:** No, I am not using remote code. *(All JavaScript is in the package; the extension only fetches data.)*

**Data usage:** tick nothing in the "collects" list. The extension does not collect or transmit user data to the developer.
If the reviewer asks: video text the user chooses to summarize is sent only to the AI endpoint the user configured, which the user controls.

Certify all three statements (not sold to third parties; not used for unrelated purposes; not used for creditworthiness).

**Privacy policy URL:** https://github.com/sub8u/honest-thumbnails/blob/main/PRIVACY.md

## Notes for review

The broad optional host permission is the thing most likely to slow review. If it does, a fallback is to replace
`https://*/*` with a fixed list of supported providers (api.openai.com, generativelanguage.googleapis.com, openrouter.ai)
plus localhost, at the cost of other custom endpoints.
