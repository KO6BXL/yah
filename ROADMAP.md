# YAH Overhaul Roadmap

This roadmap turns `PLAN-FOR-FUTURE.md` and `PLAN-FOR-MEMORY.md` into an implementation sequence. The goal is to move the repo from the old single-agent/session shape into a clean Category -> Channel -> Thread system that can be refined safely.

## 1. Stabilize the Current Branch

- [x] Remove remaining self-improvement assumptions from code, docs, install scripts, and prompts.
- [x] Keep only Discord-style prompt-provider concepts.
- [x] Keep thread context persistence separate from future durable memory.
- [x] Confirm the app builds after each cleanup step.
- [x] Add a minimal smoke-test path for config loading, provider startup wiring, and thread context path creation.

## 2. Define Core Domain Types

- [x] Add shared types for `Category`, `Channel`, and `Thread`.
- [x] Add stable IDs for Discord guilds, categories, channels, threads, and messages.
- [x] Add types for node task memory, working memory, and future durable memory records.
- [x] Add ownership and permission fields needed for category-level approval.
- [x] Keep these types independent from Discord SDK classes.

## 3. Introduce a Context Store

- [x] Replace ad hoc config/session files with a small storage layer for context nodes.
- [x] Store category metadata keyed by Discord category ID.
- [x] Store channel metadata keyed by Discord channel ID.
- [x] Store thread metadata keyed by Discord thread ID.
- [x] Persist parent-child relationships: category -> channel -> thread.
- [x] Add simple read/write/list APIs before adding search or embeddings.

## 4. Align Discord With the Context Tree

- [x] On startup, validate the configured Discord channel/category setup.
- [x] When mentioned in a configured channel, create or register a task thread.
- [x] When a message arrives in a task thread, resolve its parent channel and category context.
- [x] Stop treating the configured channel as the whole app root.
- [x] Prepare for multiple channels under one YAH category.

## 5. Build Context Assembly

- [ ] Create one module that assembles agent context for a thread.
- [ ] Include base system instructions.
- [ ] Include category task/procedural context.
- [ ] Include channel task/working context.
- [ ] Include thread-local live context.
- [ ] Keep durable memory retrieval stubbed until the memory store exists.
- [ ] Make context assembly inspectable for debugging.

## 6. Create Structured Memory Records

- [ ] Implement the `MemoryRecord` shape from `PLAN-FOR-MEMORY.md`.
- [ ] Support scopes: `category`, `channel`, `thread`.
- [ ] Support kinds: `task`, `working`, `semantic`, `episodic`, `procedural`, `artifact`.
- [ ] Support statuses: `active`, `proposed`, `superseded`, `archived`, `deleted`.
- [ ] Store source metadata for Discord messages and tool calls.
- [ ] Store timestamps, approval fields, confidence, visibility, and supersession links.

## 7. Add Basic Memory Storage

- [ ] Start with a simple local store.
- [ ] Add create, update, archive, supersede, and list operations.
- [ ] Avoid physical deletion except through an explicit user-owned path.
- [ ] Add audit events for every write.
- [ ] Keep search basic at first: scope, kind, status, and text filtering.

## 8. Implement Write Rules

- [ ] Allow agents to write thread working memory.
- [ ] Allow agents to write channel working memory.
- [ ] Mark agent-created durable channel memory clearly.
- [ ] Require proposals for category memory writes.
- [ ] Require proposals for task and procedural memory changes.
- [ ] Prevent agents from silently overwriting active durable facts.

## 9. Wire Memory Into Agent Turns

- [ ] Load pinned category and channel memory before creating a backend session.
- [ ] Inject relevant working memory into thread context.
- [ ] Include source-aware summaries instead of raw history dumps.
- [ ] Prefer nearer scopes over broader scopes when assembling context.
- [ ] Add conflict handling rules before automatic memory merging.

## 10. Add Thread Completion Flow

- [ ] Add a Discord command or lightweight action to mark a thread complete.
- [ ] Summarize completed thread activity.
- [ ] Propose useful channel/category memory promotions.
- [ ] Archive stale thread working context when appropriate.
- [ ] Keep raw thread logs as evidence, not prompt material.

## 11. Add the Janitor Process

- [ ] Add a scheduled per-channel janitor runner.
- [ ] Skip channels with no relevant activity since the last interval.
- [ ] Archive stale working memory.
- [ ] Summarize completed threads.
- [ ] Extract candidate semantic, episodic, procedural, and artifact memory.
- [ ] Merge duplicates only when source and scope rules allow it.
- [ ] Produce a digest for the user.

## 12. Build the Dashboard Foundation

- [ ] Add a web app shell.
- [ ] Add config views for categories, channels, restrictions, and model/provider settings.
- [ ] Add memory views for category memory, channel memory, pending approvals, archived memory, source history, and janitor digests.
- [ ] Keep Discord as notification/task input, not detailed configuration.
- [ ] Make every memory record inspectable: belief, source, approval, scope, and freshness.

## 13. Add Approval Workflows

- [ ] Show proposed category memories in the dashboard.
- [ ] Let the user approve, reject, edit, archive, or move a proposal to a lower scope.
- [ ] Track who approved a memory and when.
- [ ] Add role/owner checks for shared category and channel memory.
- [ ] Notify Discord when approvals are waiting, but do not manage detailed approvals in Discord.

## 14. Add Restrictions and Per-Channel Capabilities

- [ ] Define available tools and skills per category/channel.
- [ ] Prevent unrelated channel agents from sharing context directly.
- [ ] Allow controlled category-level coordination only through approved memory.
- [ ] Keep filesystem conflicts explicit and visible.
- [ ] Make channel restrictions editable from the dashboard.

## 15. Add Search

- [ ] Add SQLite full-text search for memory records and thread logs.
- [ ] Search within scope first, then broader scopes.
- [ ] Return source references with retrieved memories.
- [ ] Keep embeddings out until full-text search and lifecycle rules are reliable.

## 16. Add Temporal and Graph-Like Features

- [ ] Add validity windows for facts and preferences.
- [ ] Track superseded facts instead of overwriting them.
- [ ] Add lightweight entity and relationship metadata only where useful.
- [ ] Use graph-style reasoning as an enhancement, not as the first storage model.

## 17. Harden the System

- [ ] Add tests for config loading, context tree storage, memory write rules, approval rules, and context assembly.
- [ ] Add migration helpers for old data directories.
- [ ] Add failure handling for Discord thread creation and missing permissions.
- [ ] Add logging for memory writes, janitor runs, and context assembly.
- [ ] Document operational setup and recovery paths.

## 18. Refinement Phase

- [ ] Review real usage traces.
- [ ] Tighten prompts around memory proposal quality.
- [ ] Adjust default janitor interval and digest format.
- [ ] Improve dashboard ergonomics.
- [ ] Add only the integrations needed by real channels.
- [ ] Keep features removable until the core lifecycle proves reliable.
