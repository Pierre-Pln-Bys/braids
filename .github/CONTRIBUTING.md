Contributing to braids
======================

Thanks for helping! braids is a small project, so every bug report, idea and
pull request makes a difference.

Reporting bugs and ideas
------------------------

- **Bugs**: [open an issue](https://github.com/pebll/braids/issues/new/choose)
  with your braids version (Settings → About), your distribution, the
  messenger(s) involved and what happened. The log is in
  `~/.config/braids/log.txt`; read it before attaching it and remove
  anything private.
- **Ideas**: open a feature request. Check `doc/BACKLOG.md` first, it lists
  features that are already agreed but not scheduled.
- **Security problems**: please don't open a public issue; contact the
  maintainer (@pebll) privately first.

Your first contribution
-----------------------

Issues labelled
[good first issue](https://github.com/pebll/braids/labels/good%20first%20issue)
are small and self-contained, most of them in the app's UI (Svelte and
TypeScript), which you can run in a normal browser without any messenger
account:

    ./make.sh --no-telegram --no-signal build    # braidsd, much faster without these
    build/bin/braidsd --confdir /tmp/braidsconf &
    cd app && npm install
    BRAIDS_CONFDIR=/tmp/braidsconf npm run dev    # the UI on http://localhost:1420
    npm run check && npm run test:ui              # type check and UI tests

In the UI, add a "Dummy" account (any phone number, code `1234`): it fills
braids with demo chats, so you can work on the UI without real accounts. See `app/README.md` for the details and for running
the desktop window (`npm run tauri dev`).

How braids is built
-------------------

    app/          the desktop app: Tauri (Rust) shell + Svelte 5 UI
    src/braidsd   the core daemon the app talks to (C++, JSON-RPC API)
    lib/*chat     one library per messenger (C++, Go for WhatsApp/Signal/Matrix)
    doc/          requirements, architecture, API, design

Read `doc/ARCHITECTURE.md` for the big picture and `doc/API.md` for the
interface between the app and the daemon. `CLAUDE.md` has a compact overview
of the layout and the build commands.

Pull requests
-------------

- For anything bigger than a small fix, open an issue first so we can agree
  on the approach.
- Keep pull requests focused on one change, with tests where it makes sense
  (`tests/braidsd` for the daemon, `app/tests/ui.mjs` for the UI).
- Run the checks you touched: `./make.sh --no-telegram tests` for the
  daemon, `npm run check && npm run test:ui` for the app.
- Code style: C++ as in nchat (2-space indent, braces on their own lines,
  `m_` members, `p_` parameters; `./make.sh src` formats), Go with `gofmt`.
- Protocol libraries (`lib/*chat`) stay free of UI concerns; they talk to the
  core only through `lib/common/src/protocol.h`.
- Never log secrets (tokens, passwords, keys) or message text.
- New files start with the braids copyright header (see existing files).

By contributing you agree that your contribution is licensed under the GNU
AGPL v3 (see LICENSE).
