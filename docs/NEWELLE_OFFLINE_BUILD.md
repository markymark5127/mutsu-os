# Offline Newelle and Ollama packaging

The Linux build host prepares Newelle, its GNOME Flatpak runtime, GUI API dependencies, and Qwen 3.5 9B through Ollama. No personal models, credentials, chats or settings are copied from the build host.

Run `dbus-run-session -- bash packaging/prepare-newelle.sh` and `just build` on a Linux build host. The build recipe also runs `packaging/prepare-local-model.sh`. GitHub Actions prepares both bundles automatically before restoring its temporary host namespace policy. OCI deployment imports OSTree objects and copies prepared Flatpak deployments without launching a Flatpak sandbox.

Newelle is installed into the image during the build. Its compressed archive remains available for first-boot recovery. The first-boot completion marker is recorded only after checking the installed app, and prevents reinstalling an app that the user subsequently removes.

The offline model is pinned as `qwen3.5:9b`, with a verified manifest and every layer checked against its SHA-256 digest. The official Ollama CPU runtime is pinned and checksum verified. Model and runtime licenses are included. Ignored `vendor/local-ai/` contains the generated payload; weights are not committed to Git. The model layers occupy approximately 6.6 GB, in addition to the runtime and OS. A tablet with 16 GB RAM is recommended.

`mutsu-local-model.service` seeds writable model storage from the image and starts Ollama at `127.0.0.1:11435`, with cloud features disabled. Existing Ollama installations on port 11434 can continue to run. Boot readiness checks inspect model metadata without sending prompts. Host preparation additionally requires a successful generic inference smoke test before marking the payload complete.

At graphical login, automatic per-user setup installs bundled Python dependencies, configures Newelle through its native settings API, creates a private API token, starts its headless GUI API and checks authenticated readiness before recording successful pairing. Failures retry. Fresh users and the online Newelle demo default to the bundled Qwen model. Custom providers, other models and remote Ollama endpoints are retained. No first-boot internet access, model download or manual Pair action is needed for this path.

Prepared payloads are reused only when their completion fingerprint matches the preparation sources. Move a stale vendor payload aside to refresh it. Source tests cover configuration, dependency compatibility, readiness, and model integrity. A successful Linux preparation, image build and fresh offline VM boot are still required to verify the complete installed experience.
