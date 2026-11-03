Changelog
=========

What changed in each braids release. The newest version is at the top. The
release workflow publishes the section of a version as its release notes.

## [Unreleased]

### Fixed
- Opening a chat with Enter from the search no longer puts an empty line
  in the composer.
- Next unread chat (Ctrl+N) clears the search and goes through all chats.
- Closing the search in a chat (Esc or ×) puts the cursor back in the
  message box.

## [0.2.0] - 2026-11-02

### New
- Search the messages of all chats from the chat list (Ctrl+Space). Results
  are highlighted, and opening one jumps to the message.
- Stickers and GIFs show inline, including Telegram's animated stickers.
- Previews for links in messages. They can be turned off in Settings.
- An emoji picker in the composer, with search and recently used emoji.
- A bar for pinned messages at the top of a chat.
- Create new groups on Telegram, WhatsApp, Signal and Matrix.
- Drag and drop files into a chat.
- Ctrl+C copies text: the selection, or the message under the mouse.
- Matrix: sign in with single sign-on (SSO and SAML) in the browser.
- Rename accounts from the sidebar, for example "Matrix" to "Work".
- Resize the chat list by dragging the divider. The sidebar has a collapse
  button.
- Favorites can be a folder, pinned at the top of the list, or both.
- Start braids at login (Settings), optionally minimized to the tray.
- braids tells you when a new version is available (Settings).
- New packages: AppImage, Flatpak and ARM64 (aarch64) builds.

### Fixed
- Only one braids window runs at a time. Starting it again brings the
  running window to the front.
- Voice messages and audio files (Opus, m4a) that the window could not play
  now play. If the system lacks the codec, they open in your audio player.
- Matrix: lists keep their `-` bullets after a message is edited.
- The selection color is visible in dark mode.
- The app icon shows up in GNOME.

## [0.1.0] - 2026-11-01

The first release.

- Telegram, WhatsApp, Signal and Matrix (with end-to-end encryption) in one
  desktop app for Linux.
- One chat list across all accounts, with folders for each messenger,
  favorites, muting, archive and "mark unread".
- Text with formatting, replies, reactions, @mentions, edit and delete.
- Photos and videos with a built-in viewer and player, files, and voice
  messages (play and record).
- Forward messages from any messenger to any other.
- Join groups by invite link. Group info, members and descriptions.
- Shared media for each chat, read receipts, typing indicators,
  notifications and an unread tray icon.
- Keyboard shortcuts for everything, all of which can be changed. Light and
  dark theme.
- Install script, .deb package and a self-contained archive.

[Unreleased]: https://github.com/pebll/braids/compare/v0.2.0...HEAD
[0.2.0]: https://github.com/pebll/braids/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/pebll/braids/releases/tag/v0.1.0
