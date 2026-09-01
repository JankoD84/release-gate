# Release Gate Demo Script

## Demo objective

Show how Release Gate gives browser agents structured release-candidate evidence and controlled decision tools while preserving explicit human authority over final merge-readiness/release decisions.

Target runtime: less than 3 minutes.

## Recommended sequence

| Step | Time | Action | Talking point |
| --- | ---: | --- | --- |
| 1 | 0:00–0:15 | Open the dashboard in `LIVE` mode. | Release Gate starts from a real public GitHub or GitLab repository identity and looks for open PR/MR candidates first. |
| 2 | 0:15–0:25 | Show the public repository selector and LIVE provider label. | LIVE accepts public GitHub.com and GitLab.com URLs without credentials. If no open PR/MR exists, it falls back to releases/tags. |
| 3 | 0:25–0:45 | Copy the Agent Playbook “Merge-readiness review” prompt. | Ask: “Review this open change for merge. Explain evidence, sources and required actions. Do not approve or reject anything.” |
| 4 | 0:45–1:10 | Use WebMCP against the active candidate. | The agent composes existing tools such as `get_release`, evidence tools, `analyze_release`, and `get_final_decision`. No new tool is needed. |
| 5 | 1:10–1:30 | Open the candidate detail page. | Show source/target branch, head SHA, recommendation, evidence provenance links, and explicit unavailable evidence where provider data is missing. |
| 6 | 1:30–1:45 | Show Required Actions. | The user can immediately see what must be fixed or reviewed next. |
| 7 | 1:45–2:05 | Approve an eligible recommendation with acknowledgement. | Approval records Release Gate authorization only; it does not approve reviews, merge code, trigger pipelines, or deploy. |
| 8 | 2:05–2:20 | Show Human Final Decision. | System Recommendation and Human Final Decision remain separate. |
| 9 | 2:20–2:35 | Copy Markdown and/or Download JSON Decision Packet. | The packet is a portable handoff artifact with evidence, provenance, actions, and decision state. |
| 10 | 2:35–2:55 | Briefly open `DEMO` release `2.6.0` and attempt approval. | `NO_GO` cannot be approved; the packet/final decision remains pending and the blocked attempt is auditable. |
| 11 | 2:55–3:00 | Close on the product story. | Real repository → verifiable evidence → agent investigation → deterministic recommendation → Required Actions → human authority → auditable packet. |

## Notes

- Keep the focus on `Real public PR/MR candidate → Verifiable evidence → Agent investigation → Deterministic recommendation → Required Actions → Human authority → Decision Packet`.
- LIVE evidence is real public GitHub/GitLab repository candidate evidence: open PR/MR first, release/tag fallback when no open candidate exists.
- DEMO evidence is deterministic scenario data for repeatable GO, CONDITIONAL_GO, NO_GO and human-governance demonstration.
- Do not imply the application supports private repositories, arbitrary/self-hosted hosts, deployments, tokens, PR/MR merge/approval, or AI model reasoning.
