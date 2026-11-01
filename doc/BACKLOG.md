braids — Backlog
================

Agreed features not scheduled in a milestone yet. Newest first.

- **Shared media**: per chat (images, files, links in the info panel) and
  maybe a global view across all chats and accounts.
- **Loading / outdated indicator**: show when chats are being fetched and when
  the shown state may be stale (e.g. after the computer slept, until the
  protocols have reconnected and synced).
- **Optimized message lists**: virtualized rendering for very long chats.
- **Web version**: braids in the browser. The UI already runs in a browser
  (Vite dev bridge); a real web version needs braidsd on a server the user
  runs (it holds the sessions and keys), an authenticated WebSocket transport
  instead of the local socket, and TLS. A hosted service is not planned
  (it would hold everyone's message keys).
- **Other platforms**: macOS (builds already, needs signing/notarization and
  a .dmg), Windows (C++ core and Go libraries need porting; Tauri supports it),
  Linux ARM64 and Flatpak/AppImage packages; mobile is out of scope (the
  protocols' mobile apps are the primary devices).

- **Custom groups**: user-defined chat groups/folders beyond All, Favorites
  and Archived.
- **Custom muting rules**: notification rules instead of only per-chat mute,
  e.g. mute personal chats during work hours, notify only for favorites,
  don't notify for groups.
- **Join Signal groups by invite link**: signalmeow has no API for it
  (needs the group join flow with the invite password).
- **Vim mode**: postponed; plan proposed (LIST / NORMAL / INSERT modes,
  doc/REQUIREMENTS.md §4), open questions on folder switching, Esc in
  INSERT, count prefixes and indicator position.
