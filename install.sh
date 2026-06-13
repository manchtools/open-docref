#!/bin/sh
# docref installer. Downloads the prebuilt single-file binary for your platform
# from the latest GitHub release, verifies it against the release SHA256SUMS, and
# drops it on your PATH. No Node, no npm.
#
#   curl -fsSL https://raw.githubusercontent.com/manchtools/open-docref/main/install.sh | sh
#
# Env:
#   DOCREF_INSTALL_DIR   where to install (default: ~/.local/bin)
#   GITHUB_TOKEN         needed only while the repo is private (also needs `jq`)
#
# Windows: download docref-windows-x64.exe from the releases page directly.
#
# NOTE: the checksum proves the bytes match this release, not who produced it.
# Signed releases are a planned follow-up; until then, install over HTTPS only.
set -eu

repo="manchtools/open-docref"
dir="${DOCREF_INSTALL_DIR:-$HOME/.local/bin}"
api="https://api.github.com/repos/${repo}/releases/latest"

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

# The release JSON is fetched once for the private path (asset urls need the
# API + a token). curl's exit status is captured explicitly: `set -eu` has no
# `pipefail` in POSIX sh, so a failure inside a pipe would otherwise be masked.
release_json=""
if [ -n "${GITHUB_TOKEN:-}" ]; then
	command -v jq >/dev/null 2>&1 || {
		echo "docref: a private-repo install needs 'jq'; install jq, or download '$asset' from the releases page." >&2
		exit 1
	}
	release_json=$(curl -fsSL -H "Authorization: Bearer $GITHUB_TOKEN" -H "Accept: application/vnd.github+json" "$api") || {
		echo "docref: could not reach the releases API for $repo." >&2
		exit 1
	}
fi

# Download a named release asset to a file, public or private.
download_asset() {
	name=$1
	out=$2
	if [ -n "${GITHUB_TOKEN:-}" ]; then
		# select the asset object by name and read its API url as a unit — never
		# rely on name/url field adjacency (the url precedes the name in the JSON)
		url=$(printf '%s' "$release_json" | jq -r --arg n "$name" '.assets[] | select(.name==$n) | .url')
		[ -n "$url" ] && [ "$url" != "null" ] || {
			echo "docref: no asset '$name' in the latest release." >&2
			exit 1
		}
		curl -fSL -H "Authorization: Bearer $GITHUB_TOKEN" -H "Accept: application/octet-stream" "$url" -o "$out"
	else
		curl -fSL "https://github.com/${repo}/releases/latest/download/${name}" -o "$out"
	fi
}

# Verify $1 against the $2 entry of the SHA256SUMS manifest $3; fail closed.
verify_checksum() {
	file=$1
	name=$2
	sumfile=$3
	expected=$(awk -v n="$name" '{ f=$2; sub(/^\*/, "", f); if (f==n) { print $1; exit } }' "$sumfile")
	[ -n "$expected" ] || {
		echo "docref: SHA256SUMS has no entry for '$name'; refusing to install unverified." >&2
		exit 1
	}
	if command -v sha256sum >/dev/null 2>&1; then
		actual=$(sha256sum "$file" | awk '{print $1}')
	elif command -v shasum >/dev/null 2>&1; then
		actual=$(shasum -a 256 "$file" | awk '{print $1}')
	else
		echo "docref: no sha256 tool (sha256sum/shasum) to verify the download; refusing to install." >&2
		exit 1
	fi
	[ "$expected" = "$actual" ] || {
		echo "docref: checksum mismatch for '$name'; refusing to install." >&2
		exit 1
	}
}

tmp=$(mktemp)
sums=$(mktemp)
trap 'rm -f "$tmp" "$sums"' EXIT

echo "docref: downloading $asset ..."
download_asset "$asset" "$tmp"
download_asset "SHA256SUMS" "$sums"
verify_checksum "$tmp" "$asset" "$sums"

mkdir -p "$dir"
chmod +x "$tmp"
mv "$tmp" "$dir/docref"
trap - EXIT
rm -f "$sums"

echo "docref: installed to $dir/docref"
"$dir/docref" --version >/dev/null 2>&1 && echo "docref: $($dir/docref --version) ready — run 'docref check', update with 'docref self-update'."

case ":$PATH:" in
	*":$dir:"*) ;;
	*) echo "docref: note — $dir is not on your PATH. Add it:  export PATH=\"$dir:\$PATH\"" ;;
esac
