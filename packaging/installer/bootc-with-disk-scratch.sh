#!/usr/bin/bash
# Installer-only bootc wrapper. The live dracut /var/tmp is RAM-backed and
# cannot stage Mutsu's large offline OCI image; use target-disk scratch instead.
set -Eeuo pipefail

original=/usr/libexec/mutsu-bootc-original
if [[ ! -x "$original" ]]; then
    echo 'Mutsu installer error: original bootc executable is missing' >&2
    exit 1
fi

# Everything except the Anaconda payload installation is passed through.
if [[ "${1-}" != install || "${2-}" != to-filesystem ]]; then
    exec "$original" "$@"
fi

# Never guess which filesystem is safe to write. Anaconda formats and mounts
# its selected destination before invoking bootc; we never partition or format.
target="${*: -1}"
if [[ "$target" != /mnt/sysimage ]] || \
   [[ "$(findmnt -n -M "$target" -o TARGET || true)" != "$target" ]]; then
    echo "Mutsu installer error: expected mounted Anaconda destination /mnt/sysimage, got '$target'" >&2
    exit 1
fi

# Import may temporarily need most of the image size in addition to the
# deployed image. Fail before writing if there is not enough margin.
available="$(df -B1 --output=avail -- "$target" | tail -n 1 | tr -d '[:space:]')"
min_free=$((48 * 1024 * 1024 * 1024))
if [[ ! "$available" =~ ^[0-9]+$ ]] || (( available < min_free )); then
    echo 'Mutsu installer error: need at least 48 GiB free on the selected installation filesystem for image plus scratch storage.' >&2
    exit 1
fi

parent="$target/lost+found"
scratch=''
created_parent=0
mounted=0
cleanup() {
    local status=$?
    trap - EXIT
    if (( mounted )); then
        if ! umount /var/tmp; then
            echo 'Mutsu installer error: failed to unmount temporary image scratch' >&2
            status=1
        fi
    fi
    if [[ -n "$scratch" ]]; then
        # bootc may have finalized the destination read-only.
        if [[ ! -w "$parent" ]]; then
            mount -o remount,rw "$target" || status=1
        fi
        if ! rm -rf -- "$scratch"; then
            echo 'Mutsu installer error: failed to remove temporary image scratch' >&2
            status=1
        fi
    fi
    if (( created_parent )); then
        rmdir -- "$parent" || true
    fi
    exit "$status"
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

# bootc explicitly exempts lost+found from its empty-root check. Scratch
# under any ordinary destination directory would make installation fail.
if [[ -L "$parent" ]]; then
    echo 'Mutsu installer error: target lost+found must not be a symlink' >&2
    exit 1
fi
if [[ ! -d "$parent" ]]; then
    mkdir -- "$parent"
    created_parent=1
fi
scratch="$(mktemp -d -- "$parent/mutsu-bootc-scratch.XXXXXXXX")"
mount --bind "$scratch" /var/tmp
mounted=1
if [[ "$(stat -c %d /var/tmp)" != "$(stat -c %d "$target")" ]]; then
    echo 'Mutsu installer error: scratch is not on the destination filesystem' >&2
    exit 1
fi
printf 'Mutsu installer: bootc scratch on destination disk (%s available)\n' "$(df -h --output=avail "$target" | tail -n 1 | xargs)" >&2
"$original" "$@"
