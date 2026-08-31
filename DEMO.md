# Release Gate Demo Script

## Demo objective

Show how Release Gate gives browser agents structured release evidence and controlled decision tools while preserving explicit human authority over final release decisions.

Target runtime: less than 3 minutes.

## Recommended sequence

| Step | Time | Action | Talking point |
| --- | ---: | --- | --- |
| 1 | 0:00–0:15 | Open the dashboard in `LIVE` mode. | Release Gate dogfoods itself with real GitHub Actions evidence from `JankoD84/release-gate` on `main`. |
| 2 | 0:15–0:35 | Show LIVE source metadata. | The current release ID is commit-specific, and evidence shows repository, branch, SHA, generated time, and workflow run. |
| 3 | 0:35–0:55 | Use WebMCP against LIVE evidence. | The same fixed 11 tools discover the current live release and inspect CI, tests, dependency audit, change risk, and recommendation. |
| 4 | 0:55–1:05 | Emphasize no approval. | The system recommendation is not the Human Final Decision; live analysis stays read-only unless a write tool is explicitly invoked. |
| 5 | 1:05–1:15 | Switch to `DEMO`. | Demo mode preserves deterministic safety scenarios that may not naturally occur during judging. |
| 6 | 1:15–1:35 | Open release `2.5.0`. | `release-250` demonstrates `CONDITIONAL_GO`: no hard blockers, but material warnings require human risk acceptance. |
| 7 | 1:35–1:55 | Explicitly approve `2.5.0`. | Approval is a human-controlled write action and requires acknowledgement. |
| 8 | 1:55–2:10 | Show final decision and activity. | The human final decision is recorded separately and appears in the audit trail. |
| 9 | 2:10–2:35 | Open release `2.6.0`. | `release-260` demonstrates `NO_GO` with failed CI, failed tests, and high-severity security blockers. |
| 10 | 2:35–2:50 | Attempt blocked approval. | `NO_GO` cannot be overridden, even with acknowledgement. |
| 11 | 2:50–3:00 | Show audit record. | Blocked approval attempts are auditable human decision activity. |

## Notes

- Keep the focus on `Evidence → System Recommendation → Human Authority → Audit`.
- LIVE evidence is real public GitHub Actions evidence for `JankoD84/release-gate` only.
- DEMO evidence is deterministic scenario data for repeatable safety demonstration.
- Do not imply the application supports arbitrary repositories, performs deployments, or uses AI model reasoning.
