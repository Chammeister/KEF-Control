# Security Policy

KEF Control is a small, unofficial, community-built project. Security issues are
taken seriously and fixed on a best-effort basis.

## Supported versions

Fixes are applied to the **latest release** only.

| Version | Supported |
|---------|-----------|
| Latest  | Yes       |
| Older   | No        |

## Reporting a vulnerability

Please report security issues **privately** instead of opening a public issue:

1. Go to the repository's **Security** tab and choose **Report a vulnerability**
   (GitHub private vulnerability reporting).
2. Include a description, steps to reproduce, and the potential impact.

You'll get an acknowledgement as soon as possible. As a volunteer project there's
no formal SLA, but credible reports are prioritised and fixed promptly where
feasible. Responsible disclosure is appreciated.

## Good to know about the threat model

- **Local network only.** The app controls speakers using KEF's own HTTP API on
  the local network. That API is unauthenticated by design, so anyone already on
  your LAN can control the speaker regardless of this app - that's a property of
  the speaker, not a vulnerability in this project. Keep the speaker on a trusted
  network.
- **No secrets, no cloud.** The app stores no passwords or tokens and sends no
  data to any external service. Only non-sensitive UI preferences (speaker IP,
  theme, window position) are saved locally.
- **Unsigned builds.** Released installers are not code-signed or notarised, which
  is why Windows SmartScreen and macOS Gatekeeper warn on first launch. You can
  build from source if you prefer to verify and run your own binary.
