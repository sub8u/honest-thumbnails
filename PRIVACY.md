# Privacy Policy for Honest Thumbnails for YouTube

Last updated: 1 November 2026

Honest Thumbnails has no accounts, no analytics, no tracking and no servers run by the developer. The developer never
receives any of your data. This policy explains what the extension stores on your device and the few cases, all started
by you, where something leaves it.

## What data the extension handles

- **Settings:** your display mode, on/off switches, summary language, muted words, trusted channels (their name and
  handle), and, if you set one up, your AI service's address and model name.
- **Your AI API key:** only if you choose your own AI service in Settings.
- **A cache of video details and summaries:** the title, channel, view count, chapters and summary of up to your 400
  most recent videos, so the extension doesn't fetch or summarize the same video twice.
- **A pause end time:** if you press Pause, the time it should switch back on.
- **A welcome flag:** a note that the welcome page has been shown, so it opens only once.
- **Counters:** how many summaries you've made today (to enforce the daily limit you set) and the popup's daily counts
  of thumbnails swapped, titles flagged and videos hidden. These are numbers only.

## How data is stored

- Settings are stored with Chrome's sync storage, so they follow your Chrome profile across your devices. Chrome sync
  is run by Google under your Google account; the developer has no access to it.
- Your API key, the cache, the pause end time and the counters are stored only on this device, in Chrome's local extension storage.
  The API key is never synced.

## How data is used

Everything is used only to make the extension's features work: replacing thumbnails, showing title cards, calming
titles, hiding what you've muted, and producing summaries you ask for.

## When data leaves your device

1. **YouTube.** To build title cards and summaries, the extension reads the public page of a video from youtube.com
   (description, chapters, list of captions) and thumbnail images from YouTube's image server, the same way your
   browser already does when you watch YouTube.
2. **Your own AI service (off by default).** If you choose "My own API" in Settings, then when you ask for a summary,
   the video's title, channel name and captions (or its description if captions aren't available) are sent to the
   address you entered, together with your API key. Nothing is sent until you press Summarize or Summarize visible.
   That service's own privacy policy applies to what it receives, for example
   [OpenAI](https://openai.com/policies/privacy-policy), [Google Gemini](https://policies.google.com/privacy) or
   [OpenRouter](https://openrouter.ai/privacy). Local models (Ollama, LM Studio) run on your own computer.
3. **Chrome's on-device model.** If you choose "On-device", summaries are made by Chrome on your computer and nothing
   is sent anywhere.
4. **SponsorBlock (off by default).** If you turn on sponsor times, the extension asks
   [SponsorBlock](https://sponsor.ajay.app) for community-reported sponsor segments. It sends only the first 4
   characters of a SHA-256 hash of the video ID, which matches many videos at once, and never your account or browsing
   history. See SponsorBlock's [privacy policy](https://gist.github.com/ajayyy/aa9f8ded2b573d4f73a3ffa0ef74f796).

## Third-party services

None by default. The only services the extension can contact are YouTube, the AI service you choose and SponsorBlock,
and the last two only if you turn them on.

## Data sharing

The developer does not receive, sell or share your data. Data goes only where described above, and only to the
services you chose.

## Data retention and deletion

- The cache keeps your newest 400 videos and drops older ones automatically. Clear it any time with
  **Settings → Extras → Cached details and summaries → Clear**.
- Remove muted words and trusted channels in Settings, and your API key by clearing the field and saving.
- Uninstalling the extension deletes everything it stored on your device. Synced settings are removed from your
  Chrome profile when the extension is removed from it.

## Changes to this policy

If the extension's data practices change, this policy is updated first, with a new "Last updated" date, and the
change is noted in the [changelog](CHANGELOG.md) and the Chrome Web Store release notes.

## Contact

Questions or concerns about privacy: open an issue at https://github.com/sub8u/honest-thumbnails/issues

Made by Subrahmanyam KVJ.
