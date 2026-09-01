# OpenAI WebMCP Challenge

## Project

Release Gate — Agent-native software release decisions

## Challenge concept

Release Gate demonstrates how browser agents can participate in production-like software release governance through structured WebMCP capabilities without silently taking final release authority away from humans.

The application turns release evidence into deterministic system recommendations, explains where evidence came from, derives Required Actions, and preserves explicit human control over final approval or rejection.

## Hackathon story: Release Gate dogfoods itself

Release Gate now has a LIVE mode that evaluates read-only public repository evidence from:

- `github.com`
- `gitlab.com`

The dashboard starts with the existing dogfood source, `https://github.com/JankoD84/release-gate`. For that repository, a GitHub Actions workflow collects current tests, lint/build gate outcomes, npm dependency audit counts, and Git change surface, then publishes a public evidence JSON asset on the `live-evidence` GitHub Release. For other public GitHub/GitLab repositories, provider adapters normalize public Releases/tags, CI/pipeline evidence when anonymously available, and compare/change data when available.

DEMO mode remains available because deterministic safety states may not naturally occur during the judging window. It preserves controlled `GO`, `CONDITIONAL_GO`, and `NO_GO` scenarios without needing a live failing build or security issue.

## What WebMCP enables

Through the same fixed 11-tool catalog, an agent can operate against the currently active mode and selected public repository source. There are no provider-specific WebMCP tools.

- discover releases
- inspect CI evidence and provenance
- inspect test evidence and explicit unavailable states
- inspect dependency security evidence and explicit unavailable states
- inspect change-risk evidence and provenance
- request deterministic analysis with Required Actions
- inspect final human decision
- inspect audit activity

Only on explicit human intent, an agent can invoke write operations to:

- approve an eligible recommendation
- reject a release

## Safety invariants

- `SYSTEM RECOMMENDATION != HUMAN FINAL DECISION`
- `analyze_release` is read-only.
- Approval requires explicit human intent.
- Approval requires `acknowledgement=true`.
- `NO_GO` cannot be approved.
- Unknown LIVE or DEMO release IDs return `RELEASE_NOT_FOUND`.
- Missing provider evidence is never treated as `PASS`; unavailable CI/tests/security evidence uses the existing warning/`CONDITIONAL_GO` pathway.
- Provenance links are HTTPS-only and constrained to `github.com` or `gitlab.com`.
- Release Decision Packets preserve `SYSTEM RECOMMENDATION != HUMAN FINAL DECISION` and never represent blocked `NO_GO` approval attempts as approvals.
- LIVE never silently falls back to DEMO.
- Write operations are auditable.

## Demo scenarios

| Scenario | Focus | Expected behavior |
| --- | --- | --- |
| A | `GO` analysis / no automatic approval | Agent analyzes `2.4.0`, reports `GO`, and leaves human final decision `PENDING`. |
| B | `CONDITIONAL_GO` analysis / no automatic approval | Agent analyzes `2.5.0`, explains warnings, reports `CONDITIONAL_GO`, and does not approve. |
| C | `NO_GO` with blocking evidence | Agent analyzes `2.6.0`, identifies failed CI/tests/security blockers, and explains approval is blocked. |
| D | Explicit human approval | With explicit approval intent and acknowledgement, `2.5.0` records a human final decision. |
| E | Explicit human rejection | With explicit rejection intent, a release records a human `NO_GO` final decision while preserving the system recommendation. |
| F | Blocked approval of `NO_GO` | Attempting to approve `2.6.0` returns `RELEASE_BLOCKED`; no approval is stored. |
| G | Unknown release | Unknown releases return `RELEASE_NOT_FOUND` without fallback or mutation. |
| H | Live discovery | Agent discovers and reviews the current LIVE release from real GitHub evidence. |
| I | Live analysis without approval | Agent analyzes the current LIVE release, explains evidence, and leaves the human final decision `PENDING`. |
| J | Public provider switch | Human switches from a GitHub URL to a GitLab URL; the same 11 tools operate on normalized repository evidence and local decisions/activity are cleared to avoid leakage. |
| K | Required Actions and provenance | Agent explains what must be fixed or reviewed and cites available evidence sources without using provider-specific tools. |
| L | Decision Packet | Human copies Markdown or downloads JSON for a portable handoff artifact after review/decision. |

See [AGENT_EVALS.md](AGENT_EVALS.md) for detailed prompts, expected tool behavior, forbidden behavior, and pass criteria.

## Built during hackathon

Git history shows the project began from a Create Next App baseline and then added the Release Gate WebMCP reference implementation.

Verifiable work in the repository history includes:

- initialized the WebMCP Release Gate project
- added the WebMCP release evidence surface
- added the deterministic release decision engine
- hardened WebMCP decision persistence and write semantics
- added WebMCP agent evaluation coverage
- polished the Release Gate user experience for hackathon presentation
- added hybrid LIVE/DEMO evidence mode with real GitHub Actions evidence for the project itself
- added real read-only public GitHub.com and GitLab.com repository support behind the same WebMCP capability model
- added evidence provenance, deterministic Required Actions, Release Decision Packets, and a provider-neutral Agent Playbook

The WebMCP-related extension is the core of the implementation: a browser-native tool catalog for release discovery, evidence inspection with provenance, deterministic analysis with Required Actions, explicit human decision writes, final-decision reads, and audit reads. Release Gate records governance state; it does not merge code or trigger deployments.

## Tech stack

- Next.js
- React
- TypeScript
- Tailwind CSS
- WebMCP
- GitHub Actions evidence publication
- GitHub and GitLab public REST evidence adapters

## Running locally

See [README.md](README.md#local-development).

## Validation

Current validation should be checked with:

```bash
npm run test
npm run lint
npm run build
```

The WebMCP catalog remains fixed at 11 tools total, 9 read-only, and 2 write.

## Testing-environment note

Manual WebMCP/domain verification confirms the tool contracts and safety behavior in this repository. Full external agent end-to-end results can vary with the WebMCP-compatible browser/runtime and agent-inspector environment used for judging or local testing.
