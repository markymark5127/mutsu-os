#!/usr/bin/env bash
# Test the same raw, DD-written USB boot path used on real UEFI hardware.
# Optical -cdrom boot is NOT sufficient: El Torito can work while the
# USB partition table lacks an accessible EFI System Partition.
set -euo pipefail

ISO="${1:?usage: test-usb-boot.sh ISO [timeout_seconds]}"
TIMEOUT="${2:-600}"
LOG="${QEMU_LIVE_LOG:-qemu-usb-boot.log}"

[[ -s "$ISO" ]] || { echo "::error::ISO not found: $ISO"; exit 1; }
OVMF_CODE=""
OVMF_VARS=""
for f in /usr/share/OVMF/OVMF_CODE_4M.fd /usr/share/OVMF/OVMF_CODE.fd /usr/share/edk2/ovmf/OVMF_CODE.fd; do
  [[ -f "$f" ]] && { OVMF_CODE="$f"; break; }
done
for f in /usr/share/OVMF/OVMF_VARS_4M.fd /usr/share/OVMF/OVMF_VARS.fd /usr/share/edk2/ovmf/OVMF_VARS.fd; do
  [[ -f "$f" ]] && { OVMF_VARS="$f"; break; }
done
[[ -n "$OVMF_CODE" && -n "$OVMF_VARS" ]] || {
  echo "::error::OVMF firmware missing"
  exit 77
}

VARS="$(mktemp)"
PIDFILE="$(mktemp)"
cp "$OVMF_VARS" "$VARS"
cleanup() {
  if [[ -s "$PIDFILE" ]]; then
    kill "$(cat "$PIDFILE")" 2>/dev/null || true
  fi
  rm -f "$VARS" "$PIDFILE"
}
trap cleanup EXIT

ACCEL=tcg
CPU=max
if [[ -w /dev/kvm ]]; then
  ACCEL=kvm
  CPU=host
fi
: >"$LOG"
qemu-system-x86_64 \
  -name mutsu-usb-boot \
  -machine q35 -accel "$ACCEL" -cpu "$CPU" -m 3072 -smp 2 \
  -drive "if=pflash,format=raw,readonly=on,file=$OVMF_CODE" \
  -drive "if=pflash,format=raw,file=$VARS" \
  -device qemu-xhci,id=usb-controller \
  -drive "if=none,id=usb-image,format=raw,readonly=on,file=$ISO" \
  -device usb-storage,drive=usb-image,bootindex=1 \
  -serial "file:$LOG" -display none -pidfile "$PIDFILE" -daemonize

echo ">>> Boot testing raw USB ISO: $ISO ($ACCEL, timeout ${TIMEOUT}s)"
deadline=$(( $(date +%s) + TIMEOUT ))
while (( $(date +%s) < deadline )); do
  if [[ -s "$PIDFILE" ]] && ! kill -0 "$(cat "$PIDFILE")" 2>/dev/null; then
    echo "::error::QEMU exited before USB boot completed"
    exit 1
  fi
  if grep -aq "Kernel panic" "$LOG"; then
    echo "::error::USB boot encountered kernel panic"
    exit 1
  fi
  if grep -aqE "emergency mode|Emergency Shell" "$LOG"; then
    echo "::error::USB boot entered emergency mode"
    exit 1
  fi
  if grep -aq "login:" "$LOG"; then
    echo ">>> Raw USB UEFI boot reached live login"
    exit 0
  fi
  sleep 10
done
echo "::error::Raw USB UEFI boot did not reach live login"
grep -aE "Tacklebox|sysroot|Failed|emergency" "$LOG" | tail -20 || true
exit 1
