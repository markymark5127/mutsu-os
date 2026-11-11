#!/usr/bin/env bash
# Build Mutsu's GNOME Settings: the exact gnome-control-center this image
# ships, rebuilt with Mutsu's pages added (see apply-mutsu-panels.py).
#
#   build-gnome-settings.sh <output dir>
#
# Runs in a throwaway build stage of the same base image, so the version and
# build dependencies match what the final image has. Leaves the RPMs in the
# output dir; the final stage installs them over the stock package.
set -euxo pipefail
out="${1:?output dir}"
here="$(cd "$(dirname "$0")" && pwd)"
top=/tmp/mutsu-gcc-rpmbuild
mkdir -p "$out" "$top"

dnf5 -y install rpm-build rpmdevtools python3 'dnf5-command(builddep)' 'dnf5-command(download)'

srpm_name="$(rpm -q --qf '%{SOURCERPM}' gnome-control-center)"   # gnome-control-center-51.1-1.fc45.src.rpm
nvr="${srpm_name%.src.rpm}"
work="$(mktemp -d)"
cd "$work"
dnf5 download --source "$nvr" || dnf5 download --source gnome-control-center
srpm="$(ls ./*.src.rpm | head -1)"
echo "Rebuilding $srpm (installed: $nvr)"

rpm -i --define "_topdir $top" "$srpm"
spec="$top/SPECS/gnome-control-center.spec"
# Mark it as Mutsu's build, a release above the stock one.
sed -i -E 's/^(Release:\s*[^%[:space:]]+)/\1.mutsu1/' "$spec"
grep -E '^Release:' "$spec"
dnf5 -y builddep "$spec"

rpmbuild --define "_topdir $top" -bp "$spec"
src="$(dirname "$(find "$top/BUILD" -path '*/shell/cc-panel-loader.c' | head -1)")/.."
python3 "$here/apply-mutsu-panels.py" "$src"
rpmbuild --define "_topdir $top" --noprep --nocheck -bb "$spec"

find "$top/RPMS" -name '*.rpm' ! -name '*debug*' -exec cp -v {} "$out/" \;
ls -l "$out"
