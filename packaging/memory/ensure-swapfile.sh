#!/bin/bash
# Mutsu OS backup swap: a 4 GB swap file on disk at a lower priority than
# zram, so it is only used once the compressed RAM swap is full. It gives a
# machine that runs out of memory room to slow down instead of having
# programs closed by the out-of-memory killer.
set -eu

dir=/var/swap
file=$dir/swapfile
size_mib=${MUTSU_SWAPFILE_MIB:-4096}
# Leave this much free space on /var beyond the swap file itself.
reserve_mib=10240

if grep -q "^$file " /proc/swaps; then
    exit 0
fi

if [ ! -f "$file" ]; then
    avail_mib=$(( $(df --output=avail -k /var | tail -n 1) / 1024 ))
    if [ "$avail_mib" -lt $(( size_mib + reserve_mib )) ]; then
        echo "Only ${avail_mib} MiB free on /var; not creating a swap file."
        exit 0
    fi
    trap 'rm -f "$file"' ERR
    if [ "$(stat -f -c %T /var)" = btrfs ]; then
        # Own subvolume so snapshots of /var never include the swap file.
        [ -d "$dir" ] || btrfs subvolume create "$dir"
        btrfs filesystem mkswapfile --size "${size_mib}m" "$file"
    else
        mkdir -p "$dir"
        fallocate -l "${size_mib}M" "$file"
        chmod 600 "$file"
        mkswap "$file"
    fi
    trap - ERR
fi

chmod 600 "$file"
# The SELinux policy has no label rule for /var/swap, so set the swap file
# label every boot; a relabel would otherwise leave it as var_t and swapon
# would be denied.
chcon -t swapfile_t "$file" 2>/dev/null || true
swapon --priority 10 "$file"
