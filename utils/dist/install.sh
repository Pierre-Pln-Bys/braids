#!/bin/sh

# install.sh
#
# Copyright (c) 2026 braids contributors
#
# braids is distributed under the GNU AGPL v3 license, see LICENSE for details.
#
# Installs (or updates) braids for the current user, no root needed:
#
#   curl -fsSL https://raw.githubusercontent.com/pebll/braids/main/utils/dist/install.sh | sh
#
#   ~/.local/share/braids/          the app (bin/braids, bin/braidsd, lib/...)
#   ~/.local/bin/braids             command
#   ~/.local/share/applications/    menu entry
#
# Options (after "sh -s --" when piped):
#   --uninstall      remove braids (keeps accounts and messages in ~/.config/braids)
#   --purge          remove braids and ~/.config/braids
#   --version vX.Y.Z install that release instead of the latest
#   --pr N           install the test build of pull request N (made by the
#                    Preview workflow for every pull request)
#   --branch NAME    install the test build of a branch (Preview workflow run
#                    by hand on that branch)
# Running the script again without options goes back to the latest release.
#
# Environment:
#   BRAIDS_TARBALL   install from this local braids-linux-<arch>.tar.gz instead
#                    of downloading the latest release
#   BRAIDS_VERSION   a release tag (e.g. v0.2.0) instead of the latest

set -eu

REPO="pebll/braids"
DATA="${XDG_DATA_HOME:-${HOME}/.local/share}"
DEST="${DATA}/braids"
BIN="${HOME}/.local/bin"
APPS="${DATA}/applications"
ICONS="${DATA}/icons/hicolor"

say() { printf '%s\n' "$*"; }
die() { printf 'braids install: %s\n' "$*" >&2; exit 1; }

# GNOME and others read icons through the icon cache when the folder has one
# (often created by other apps): new icons only show after it is rebuilt
refresh_desktop() {
  if command -v gtk-update-icon-cache >/dev/null 2>&1 && [ -d "${ICONS}" ]; then
    gtk-update-icon-cache -q -f -t "${ICONS}" >/dev/null 2>&1 || true
  fi
  command -v update-desktop-database >/dev/null 2>&1 && update-desktop-database "${APPS}" >/dev/null 2>&1 || true
}

uninstall() {
  rm -rf "${DEST}"
  rm -f "${BIN}/braids" "${APPS}/braids.desktop" "${ICONS}/128x128/apps/braids.png" "${ICONS}/256x256/apps/braids.png" \
    "${ICONS}/scalable/apps/braids.svg"
  refresh_desktop
  say "braids removed."
}

TAG="${BRAIDS_VERSION:-}"
while [ $# -gt 0 ]; do
  case "$1" in
    --uninstall) uninstall; say "Accounts and messages are kept in ~/.config/braids."; exit 0 ;;
    --purge) uninstall; rm -rf "${XDG_CONFIG_HOME:-${HOME}/.config}/braids"; say "Accounts and messages removed."; exit 0 ;;
    --version) [ $# -ge 2 ] || die "--version needs a release, e.g. --version v0.3.0"; TAG="$2"; shift ;;
    --pr)
      [ $# -ge 2 ] || die "--pr needs a pull request number, e.g. --pr 16"
      case "$2" in *[!0-9]* | "") die "--pr needs a pull request number, e.g. --pr 16" ;; esac
      TAG="pr-$2"; shift ;;
    --branch)
      [ $# -ge 2 ] || die "--branch needs a branch name"
      # the Preview workflow's tag: branch- and the name with / and other
      # characters as -
      TAG="branch-$(printf '%s' "$2" | tr -c 'A-Za-z0-9._-' '-')"; shift ;;
    *) die "unknown option $1 (use --pr N, --branch NAME, --version vX.Y.Z, --uninstall or --purge)" ;;
  esac
  shift
done

[ "$(uname -s)" = "Linux" ] || die "braids is available for Linux only for now."
ARCH="$(uname -m)"
case "${ARCH}" in
  x86_64 | aarch64) ;;
  arm64) ARCH="aarch64" ;;
  *) die "braids is available for x86_64 and aarch64 (ARM64) only (this is ${ARCH})." ;;
esac

TMP="$(mktemp -d)"
trap 'rm -rf "${TMP}"' EXIT INT TERM

if [ -n "${BRAIDS_TARBALL:-}" ]; then
  cp "${BRAIDS_TARBALL}" "${TMP}/braids.tar.gz"
else
  command -v curl >/dev/null 2>&1 || die "curl is needed."
  if [ -n "${TAG}" ]; then
    URL="https://github.com/${REPO}/releases/download/${TAG}/braids-linux-${ARCH}.tar.gz"
  else
    URL="https://github.com/${REPO}/releases/latest/download/braids-linux-${ARCH}.tar.gz"
  fi
  say "Downloading ${URL}"
  if ! curl -fL --progress-bar -o "${TMP}/braids.tar.gz" "${URL}"; then
    case "${TAG}" in
      pr-* | branch-*) die "no test build found for ${TAG}: it is made by the Preview workflow (about 15 minutes after a push), see https://github.com/${REPO}/actions/workflows/preview.yml" ;;
      *) die "download failed." ;;
    esac
  fi
  curl -fsSL -o "${TMP}/braids.tar.gz.sha256" "${URL}.sha256" || die "checksum download failed."
  EXPECTED="$(cut -d ' ' -f 1 "${TMP}/braids.tar.gz.sha256")"
  ACTUAL="$(sha256sum "${TMP}/braids.tar.gz" | cut -d ' ' -f 1)"
  [ "${EXPECTED}" = "${ACTUAL}" ] || die "checksum mismatch, not installing."
fi

tar -C "${TMP}" -xzf "${TMP}/braids.tar.gz" || die "could not unpack the download."
[ -x "${TMP}/braids/bin/braids" ] || die "unexpected archive contents."

# replace the previous version; a running braidsd is restarted by the app
# when it notices the newer binary
mkdir -p "${DATA}" "${BIN}" "${APPS}" "${ICONS}/128x128/apps" "${ICONS}/256x256/apps" "${ICONS}/scalable/apps"
rm -rf "${DEST}.new"
mv "${TMP}/braids" "${DEST}.new"
rm -rf "${DEST}"
mv "${DEST}.new" "${DEST}"

ln -sf "${DEST}/bin/braids" "${BIN}/braids"
sed "s|^Exec=.*|Exec=${DEST}/bin/braids|" "${DEST}/share/applications/braids.desktop" > "${APPS}/braids.desktop"
cp "${DEST}/share/icons/hicolor/128x128/apps/braids.png" "${ICONS}/128x128/apps/braids.png"
cp "${DEST}/share/icons/hicolor/256x256/apps/braids.png" "${ICONS}/256x256/apps/braids.png"
[ -f "${DEST}/share/icons/hicolor/scalable/apps/braids.svg" ] && cp "${DEST}/share/icons/hicolor/scalable/apps/braids.svg" "${ICONS}/scalable/apps/braids.svg"
refresh_desktop

say "braids $(cat "${DEST}/share/braids-version" 2>/dev/null || true) installed to ${DEST}"
if [ -f "${DEST}/share/braids-build" ]; then
  say "This is a test build: $(cat "${DEST}/share/braids-build")"
  say "Back to the latest release: curl -fsSL https://pebll.github.io/braids/install.sh | sh"
fi

# system libraries the app needs (the rest ships with braids)
MISSING=""
for lib in libwebkit2gtk-4.1.so.0 libgtk-3.so.0 libsqlite3.so.0 libmagic.so.1 libgstreamer-1.0.so.0; do
  ldconfig -p 2>/dev/null | grep -q "${lib}" || MISSING="${MISSING} ${lib}"
done
if ! ldconfig -p 2>/dev/null | grep -q -e libayatana-appindicator3.so.1 -e libappindicator3.so.1; then
  MISSING="${MISSING} libayatana-appindicator3.so.1"
fi
if [ -n "${MISSING}" ]; then
  say ""
  say "Missing system libraries:${MISSING}"
  say "Install them with your package manager, e.g.:"
  say "  Debian/Ubuntu: sudo apt install libwebkit2gtk-4.1-0 libayatana-appindicator3-1 libsqlite3-0 libmagic1 gstreamer1.0-plugins-good gstreamer1.0-libav"
  say "  Fedora:        sudo dnf install webkit2gtk4.1 libayatana-appindicator-gtk3 sqlite-libs file-libs gstreamer1-plugins-good gstreamer1-libav"
  say "  Arch:          sudo pacman -S webkit2gtk-4.1 libayatana-appindicator sqlite file gst-plugins-good gst-libav"
fi

# videos (H.264, most MP4s) and AAC audio need GStreamer's libav plugin
HAS_LIBAV=""
for f in /usr/lib/*/gstreamer-1.0/libgstlibav.so /usr/lib64/gstreamer-1.0/libgstlibav.so /usr/lib/gstreamer-1.0/libgstlibav.so; do
  [ -e "${f}" ] && HAS_LIBAV=1
done
if [ -z "${MISSING}" ] && [ -z "${HAS_LIBAV}" ]; then
  say ""
  say "To play videos (MP4), install GStreamer's libav plugin, e.g.:"
  say "  Debian/Ubuntu: sudo apt install gstreamer1.0-libav"
  say "  Fedora:        sudo dnf install gstreamer1-plugin-libav"
  say "  Arch:          sudo pacman -S gst-libav"
fi

case ":${PATH}:" in
  *":${BIN}:"*) say "Start it from your app menu or with: braids" ;;
  *) say "Start it from your app menu or with: ${BIN}/braids  (${BIN} is not in your PATH)" ;;
esac
