# Release Gate Demo Script

## Demo objective

Show how Release Gate gives browser agents structured release evidence and controlled decision tools while preserving explicit human authority over final release decisions.

Target runtime: less than 3 minutes.

## Recommended sequence

| Step | Time | Action | Talking point |
| --- | ---: | --- | --- |
| 1 | 0:00–0:15 | Open the dashboard. | Release Gate is an agent-native release decision workflow with human control. |
| 2 | 0:15–0:35 | Show the three release recommendation states. | `2.4.0` is `GO`, `2.5.0` is `CONDITIONAL_GO`, and `2.6.0` is `NO_GO`. |
| 3 | 0:35–0:45 | Open release `2.5.0`. | This is the conditional release used for safe approval. |
| 4 | 0:45–1:05 | Show evidence → `CONDITIONAL_GO`. | CI passes, but flaky tests and medium change risk require human review. |
| 5 | 1:05–1:20 | Show human final decision is `PENDING`. | A system recommendation is not a human final decision. |
| 6 | 1:20–1:45 | Demonstrate WebMCP agent/tool interaction. | The agent can inspect releases, evidence, analysis, final decision, and audit activity through structured tools. |
| 7 | 1:45–2:00 | Explicitly approve `2.5.0`. | Approval is a human-controlled write action and requires acknowledgement. |
| 8 | 2:00–2:15 | Show human final decision and activity. | The decision is recorded and visible in the audit trail. |
| 9 | 2:15–2:30 | Open release `2.6.0`. | This release has hard blockers. |
| 10 | 2:30–2:45 | Show `NO_GO` blockers. | Failed CI, failed tests, and high-severity security findings block approval. |
| 11 | 2:45–2:55 | Demonstrate blocked approval. | `NO_GO` cannot be overridden. |
| 12 | 2:55–3:00 | Show audit record. | Blocked approval attempts are auditable human decision activity. |

## Notes

- Keep the focus on `Evidence → System Recommendation → Human Authority → Audit`.
- Do not describe the synthetic demo evidence as live CI, GitHub, scanner, or deployment data.
- Do not imply the application performs autonomous deployment or AI model reasoning.
