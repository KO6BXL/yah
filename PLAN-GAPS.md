# PLAN Gaps

This file tracks implementation gaps between `PLAN-FOR-FUTURE.md`, `PLAN-FOR-MEMORY.md`, and the current `new-plans` branch.

The branch already has the foundation: structured context nodes, structured memory records, file-backed stores, Discord thread flow, `/complete`, basic thread completion summaries, janitor runs, and a read-only dashboard snapshot. The remaining work is mostly turning those pieces into an enforced, dashboard-managed lifecycle.

## Checkboxes

- [ ] 1. Dashboard Editing and Configuration
- [ ] 2. Approval Workflow
- [ ] 3. Discord Category Bootstrap
- [ ] 4. Channel Creation and Per-Channel Configuration
- [ ] 5. Tool and Skill Boundaries
- [ ] 6. Retrieval and Context Assembly
- [ ] 7. Topic Summaries and Fact Index
- [ ] 8. Janitor Maturity
- [ ] 9. Conflict Handling
- [ ] 10. Permissions and Team Use
- [ ] 11. Agent Memory Write Integration
- [ ] 12. Provider and Legacy Surface Cleanup

## 1. Dashboard Editing and Configuration

Current state:

- `src/dashboard/dashboard.ts` serves `/`, `/api/dashboard`, and `/api/config`.
- The dashboard exposes inspectable snapshots only.

Missing:

- Edit task memory.
- Edit working memory.
- Archive and restore memory.
- Mark memory deleted through a user-controlled flow.
- Move memory between scopes.
- Search memory from the dashboard.
- Configure categories, channels, restrictions, janitor interval, and per-channel environment/tool settings.

Implementation notes:

- Keep detailed memory/config editing in the dashboard, not Discord.
- Add focused API routes before expanding the HTML UI.
- Preserve audit events for every write.

## 2. Approval Workflow

Current state:

- `MemoryStore` enforces proposal rules for category, task, and procedural memory.
- Pending approvals are visible in the dashboard snapshot.

Missing:

- Approve proposal.
- Reject proposal.
- Edit then approve proposal.
- Move proposal to a lower scope.
- Record approval actor and timestamp.
- Enforce approval permissions from `ContextPermissions`.

Implementation notes:

- Category writes should remain proposed until explicitly approved.
- Task and procedural memory should remain user-owned.
- Approval actions should append audit events.

## 3. Discord Category Bootstrap

Current state:

- Discord startup requires `channelId` to point at a text channel inside an existing category.
- The category and channel are registered after startup validation.

Missing:

- Create a `YAH` category when the bot is added to a server.
- Keep using the category ID even if the user renames the category.
- Dashboard-managed category selection/rename handling.

Implementation notes:

- Avoid requiring Discord commands for setup beyond lightweight notifications.
- Keep support for an explicitly configured existing category/channel if useful.

## 4. Channel Creation and Per-Channel Configuration

Current state:

- Channels are registered when they are encountered.
- Channel task and working memory fields exist.

Missing:

- Dashboard flow to create/manage YAH channels.
- Per-channel task memory editing.
- Per-channel restrictions.
- Per-channel tool/skill/environment configuration.
- Clear channel boundary enforcement.

Implementation notes:

- Channels should remain strongly separated.
- Cross-channel sharing should happen only through approved category memory or explicit filesystem artifacts.

## 5. Tool and Skill Boundaries

Current state:

- `SkillsStore` can load skills from the YAH data directory.
- `MainAgent` creates thread backends using the same broad setup path.

Missing:

- Restrict skills/tools by channel.
- Prevent inappropriate tools from being available in channels like Email or Personal.
- Represent channel environment/tool policy in config/storage.
- Feed channel-specific resource loading into agent session creation.

Implementation notes:

- Prefer a simple allowlist model first.
- Make the active channel policy visible in the dashboard.

## 6. Retrieval and Context Assembly

Current state:

- `ContextAssembly` injects base instructions, category/channel/thread context, working memory, active non-working memory, and conflict guidance.
- Memory ordering prefers approved, higher-confidence, newer records.

Missing:

- Topic summaries.
- Fact index search.
- Semantic search or SQLite full-text search.
- Source excerpts only when needed.
- Pinned block size limits.
- Retrieval that explicitly prefers nearer scopes when matching query relevance.

Implementation notes:

- Keep first retrieval version simple.
- SQLite full-text search is enough before embeddings.
- Do not inject entire thread logs into future prompts.

## 7. Topic Summaries and Fact Index

Current state:

- Thread logs are retained as raw evidence.
- Episodic memories can be created from thread completion and janitor runs.
- Memory search is basic substring filtering.

Missing:

- A distinct topic summary layer.
- A searchable fact index for semantic, episodic, procedural, and artifact memories.
- Update logic for topic summaries after thread completion or janitor runs.

Implementation notes:

- Topic summaries sit between raw logs and durable facts.
- Durable facts should point back to source evidence.

## 8. Janitor Maturity

Current state:

- Janitor runs per channel.
- It skips channels with no relevant activity.
- It archives stale working memory, summarizes completed threads, proposes candidates, deduplicates exact candidate repeats, and writes digests.

Missing:

- Better candidate extraction.
- Merge duplicate memories.
- Supersede outdated facts.
- Propose category promotions with richer rationale.
- Produce user-facing digests that link to actionable dashboard items.

Implementation notes:

- The janitor should not physically delete memory by default.
- Category-level changes should remain proposals.
- Keep the janitor per-channel, not category-wide.

## 9. Conflict Handling

Current state:

- Conflict rules are included in assembled context.
- Silent durable overwrites are blocked for agent-created updates.

Missing:

- Explicit conflict records or metadata.
- Dashboard conflict view.
- Conflict resolution actions.
- Validity-date handling for stale preferences.

Implementation notes:

- Do not blindly merge conflicting facts.
- Prefer user-approved memory, newer sourced memory, more specific scope, then higher confidence.
- Supersede old facts instead of silently overwriting them.

## 10. Permissions and Team Use

Current state:

- `ContextPermissions` models owner IDs, approved role IDs, and approval policy.
- Dashboard snapshots expose node permissions.

Missing:

- Runtime enforcement for approval/editing APIs.
- Role checks for category and channel memory approval.
- Dashboard UI for permission management.

Implementation notes:

- Not every user should be able to approve shared memory.
- Category memory needs stricter checks than channel memory.

## 11. Agent Memory Write Integration

Current state:

- Stores support writing memory records.
- The running agent loop logs user and assistant messages.

Missing:

- A normal path for agents to create thread working memory.
- A normal path for agents to create channel working memory.
- A proposal path for agents to suggest category, task, procedural, semantic, episodic, or artifact memories.
- Tooling or commands that expose memory writes safely to the agent backend.

Implementation notes:

- Agents may write thread and channel working memory.
- Durable channel memories should be visibly marked as agent-created unless approved.
- Category writes must be proposals.

## 12. Provider and Legacy Surface Cleanup

Current state:

- `promptProvider` is restricted to Discord.
- `agentProvider` still accepts a broad set of pi-supported model providers.
- Self-improvement flows are not obvious in the current source tree.

Missing:

- Decide whether broad model providers are acceptable as backend providers.
- If not acceptable, narrow provider configuration to supported category/channel/thread-compatible providers.
- Ensure no repo-editing or self-improvement flows are reintroduced.

Implementation notes:

- Keep Discord-like interfaces as the only prompt surface.
- Avoid chat providers that cannot support category/channel/thread context.

## Suggested Implementation Order

1. Add dashboard write APIs for memory update/archive/delete/restore and proposal approve/reject.
2. Enforce `ContextPermissions` on those APIs.
3. Add dashboard UI for pending approvals and memory editing.
4. Add agent-facing memory write/proposal tools or commands.
5. Add per-channel tool/skill policy storage and enforcement.
6. Add topic summaries and SQLite full-text memory search.
7. Improve janitor extraction, supersession, and digest actions.
8. Add Discord category bootstrap and dashboard-managed setup.

## Verification Expectations

- Keep `bun test src/**/*.test.ts` passing.
- Add tests for every store-level write rule and dashboard API action.
- Add tests for permission enforcement before exposing write endpoints.
- Add tests that category memory cannot become active from an agent write without approval.
