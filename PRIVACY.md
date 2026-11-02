# Privacy policy

*Honest Thumbnails for YouTube · last updated 1 November 2026*

Honest Thumbnails collects nothing. It has no server, no analytics and no accounts.

- Your settings (mode, toggles, muted words, trusted channels) are stored with Chrome's `storage.sync`, so they follow your Chrome profile. The developer never sees them.
- A cache of video details and summaries, your API key, and the popup's daily counts (numbers only) are stored locally on your device with `storage.local`.
- Network requests: image requests to `i.ytimg.com`, requests to `youtube.com` for video details, and (only if you enable it) requests to the AI endpoint you entered. Your API key is stored locally and sent only to that endpoint.
- Permissions: `storage` (settings and cache), `youtube.com` pages (to replace thumbnails), and an optional permission for the single AI endpoint you choose, requested only when you save it.

## Optional features that contact other services
- **SponsorBlock sponsor time (off by default):** if you turn it on in the options page, Chrome asks permission to contact `sponsor.ajay.app`. Only the first 4 characters of a SHA-256 hash of a video ID are sent, never your account or browsing history.
- **Your own AI API:** if you choose one, transcripts or descriptions of videos you ask to summarize are sent to that provider.
- **Chrome's built-in model:** runs on your device.

## Contact
Questions or concerns: open an issue at https://github.com/sub8u/honest-thumbnails/issues.

Made by Subrahmanyam KVJ.
