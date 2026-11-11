#!/usr/bin/env bash
# Build Mutsu's GNOME Shell: the exact gnome-shell this image ships, rebuilt
# with apply-mutsu-shell.py (the login animation waits for extensions).
#
#   build-gnome-shell.sh <output dir>
#
# Runs in a throwaway build stage of the same base image, so the version and
# build dependencies match the final image. Leaves the RPMs in <output dir>.
set -euxo pipefail
out="${1:?output dir}"
here="$(cd "$(dirname "$0")" && pwd)"
top=/tmp/mutsu-shell-rpmbuild
mkdir -p "$out" "$top"

dnf5 -y install rpm-build rpmdevtools python3 'dnf5-command(builddep)' 'dnf5-command(download)'

srpm_name="$(rpm -q --qf '%{SOURCERPM}' gnome-shell)"   # gnome-shell-51.1-1.fc45.src.rpm
nvr="${srpm_name%.src.rpm}"
work="$(mktemp -d)"
cd "$work"
dnf5 download --source "$nvr" || dnf5 download --source gnome-shell
srpm="$(ls ./*.src.rpm | head -1)"
echo "Rebuilding $srpm (installed: $nvr)"

rpm -i --define "_topdir $top" "$srpm"
spec="$top/SPECS/gnome-shell.spec"
# A release above the stock one: 1.fc45 becomes 1.mutsu1.fc45.
stock_release="$(rpm -q --qf '%{RELEASE}' gnome-shell)"
dist="$(rpm --eval '%{?dist}')"
base="${stock_release%"$dist"}"
sed -i -E "s/^Release:.*/Release:        ${base}.mutsu1%{?dist}/" "$spec"
grep -E '^Release:' "$spec"
dnf5 -y builddep "$spec"

rpmbuild --define "_topdir $top" -bp "$spec"
src="$(dirname "$(find "$top/BUILD" -path '*/js/ui/layout.js' | head -1)")/../.."
python3 "$here/apply-mutsu-shell.py" "$src"
rpmbuild --define "_topdir $top" --noprep --nocheck -bb "$spec"

find "$top/RPMS" -name '*.rpm' ! -name '*debug*' -exec cp -v {} "$out/" \;
ls -l "$out"
