#!/bin/sh
# docref installer. Downloads the prebuilt single-file binary for your platform
# from the latest GitHub release and drops it on your PATH. No Node, no npm.
#
#   curl -fsSL https://raw.githubusercontent.com/manchtools/open-docref/main/install.sh | sh
#
# Env:
#   DOCREF_INSTALL_DIR   where to install (default: ~/.local/bin)
#   GITHUB_TOKEN         needed only while the repo is private
#
# Windows: download docref-windows-x64.exe from the releases page directly.
set -eu

repo="manchtools/open-docref"
dir="${DOCREF_INSTALL_DIR:-$HOME/.local/bin}"

os=$(uname -s)
arch=$(uname -m)
case "$os" in
	Linux) os=linux ;;
	Darwin) os=darwin ;;
	*) echo "docref: unsupported OS '$os' — on Windows, download docref-windows-x64.exe from the releases page." >&2; exit 1 ;;
esac
case "$arch" in
	x86_64 | amd64) arch=x64 ;;
	aarch64 | arm64) arch=arm64 ;;
	*) echo "docref: unsupported architecture '$arch'." >&2; exit 1 ;;
esac
asset="docref-${os}-${arch}"

tmp=$(mktemp)
trap 'rm -f "$tmp"' EXIT

echo "docref: downloading $asset ..."
if [ -n "${GITHUB_TOKEN:-}" ]; then
	# private repo: resolve the asset's API url, then fetch the bytes
	api="https://api.github.com/repos/${repo}/releases/latest"
	asset_api=$(curl -fsSL -H "Authorization: Bearer $GITHUB_TOKEN" -H "Accept: application/vnd.github+json" "$api" \
		| tr ',' '\n' | grep -A1 "\"name\": \"$asset\"" | grep '"url"' | head -1 \
		| sed 's/.*"url": *"\([^"]*\)".*/\1/')
	[ -n "$asset_api" ] || { echo "docref: no asset '$asset' in the latest release." >&2; exit 1; }
	curl -fSL -H "Authorization: Bearer $GITHUB_TOKEN" -H "Accept: application/octet-stream" "$asset_api" -o "$tmp"
else
	curl -fSL "https://github.com/${repo}/releases/latest/download/${asset}" -o "$tmp"
fi

mkdir -p "$dir"
chmod +x "$tmp"
mv "$tmp" "$dir/docref"
trap - EXIT

echo "docref: installed to $dir/docref"
"$dir/docref" --version >/dev/null 2>&1 && echo "docref: $($dir/docref --version) ready — run 'docref check', update with 'docref self-update'."

case ":$PATH:" in
	*":$dir:"*) ;;
	*) echo "docref: note — $dir is not on your PATH. Add it:  export PATH=\"$dir:\$PATH\"" ;;
esac
