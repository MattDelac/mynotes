# Security Policy

MyNotes is a zero-knowledge, end-to-end-encrypted note-taking app. The server is a relay: it
stores and broadcasts opaque ciphertext and cannot read plaintext. Please report any issue that
would break this promise seriously — the whole point of the product is that plaintext never
leaves a device without the key.

## Supported versions

Only the latest release on `main` is supported. There are no long-term support branches.

## Reporting a vulnerability

Please use **GitHub private vulnerability reporting** (Security → Report a vulnerability) rather
than a public issue or PR, so the fix can ship before details are public.

Please include:

- The affected component (web client, `api`, crypto, relay protocol, build/CI, infra).
- Steps to reproduce and the impact. For a crypto or protocol issue, a description of the
  threat model you assume (e.g. "server is malicious", "attacker can observe the wire") is
  especially useful.
- Whether the issue requires a compromised server or only a passive network observer.

You can expect an initial acknowledgment within 5 business days and a status update as the
investigation proceeds.

## Scope

The following are generally **not** vulnerabilities:

- Server operators running old images with known-fixed issues (upgrade to `:latest`).
- Abuse/DoS without an exploit (rate limits and TTL are operator-tunable; see
  `docs/SELFHOST.md` for the runbook).
- Key material in the URL fragment being visible to anyone you share the link with — that is by
  design.
