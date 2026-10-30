# Offline Newelle packaging

Newelle, its GNOME Flatpak runtime and its GUI API Python dependencies are
prepared on the Linux build host. OCI RUN instructions do not invoke
Flatpak or bubblewrap, and do not need extra container capabilities.

On a Linux host with Flatpak, a session bus, Python, curl, tar and zstd:

```
dbus-run-session -- bash packaging/prepare-newelle.sh
just build
```

GitHub Actions installs these tools and runs preparation automatically.
Ubuntu's temporary namespace-policy adjustment applies only to the host
preparation step and is restored before the container build starts.

Preparation uses a dedicated temporary Flatpak installation. Only that
installation, its public Flathub signing information and the downloaded
API packages are staged in ignored `vendor/newelle/`. User credentials,
models, chats, settings and personal Flatpaks are not included.
Full Flatpak references and commit IDs are recorded in
`/usr/share/mutsu-os/build-info/newelle-source.txt` in the image.

The image stores a compressed archive under `/usr/share/mutsu-os/newelle/`.
Before the first login, a system service imports its OSTree objects and
copies the already-prepared deployments into the system installation.
Other apps and remote configuration are retained. No download is required.
The completion marker is written only after `flatpak info` confirms the app;
it also prevents reinstalling an app that the user later removes.

The GUI API bundle remains in `/usr/share/mutsu-os/newelle-gui-api/`.
Per-user setup copies those packages locally and checks the authenticated
API before reporting successful pairing. Models remain separately configured.

The staged payload is reused only when its completion marker matches both
preparation scripts. Move `vendor/newelle/` aside to refresh the payload or
after an interrupted preparation; the scripts never delete an existing payload.

Source tests simulate offline deployment and failed imports. A successful
host preparation, image build and fresh offline VM boot are still required
to validate the complete installation path.
