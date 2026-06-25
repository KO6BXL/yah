# Plan for YAH Memory

YAH should have a memory model that helps agents stay useful across tasks without turning every old message into permanent truth. The goal is convenient context management: users should be able to see, edit, approve, and remove what YAH remembers, while agents should be able to retrieve the right context without dragging in unrelated work.

This plan borrows ideas from existing agent memory systems, but adapts them to YAH's Category -> Channel -> Thread hierarchy.

## Overview

YAH memory should be scoped to the context tree.
A category holds broad shared context.
A channel holds focused workspace context.
A thread holds active task context.

The important distinction is that memory is not the same thing as chat history. Chat history is evidence. Memory is curated context extracted from evidence.

Threads should remain mostly ephemeral. Their live session context is enough while work is happening. When a thread finishes, useful information can be promoted into channel or category memory.

Memory should be editable from the web dashboard. Discord is a poor interface for detailed memory management, especially for approvals, diffs, source links, and deletion.

## Influences

### Letta / MemGPT

Letta splits memory into always-visible memory blocks and searchable archival memory.
This is useful for YAH because some context should always be present, while less important facts should only be fetched when needed.

The useful parts:

- Memory blocks are small, structured, and pinned into context.
- Archival memory is searched on demand.
- Shared memory blocks can coordinate multiple agents.
- Read-only blocks protect policies and important user-owned context.
- Concurrent writes are dangerous, so shared memory needs ownership rules.

### LangGraph

LangGraph separates thread-scoped short-term memory from long-term memory stored under namespaces.
This maps cleanly onto YAH's hierarchy.

The useful parts:

- Thread state is separate from cross-thread memory.
- Long-term memory can be scoped by custom namespaces.
- Memory can be semantic, episodic, or procedural.
- Memory can be written during the agent turn or later in the background.

### Zep / Graphiti

Zep uses a temporal knowledge graph made from episodes, entities, relationships, and facts.
YAH does not need a graph database at first, but it should store enough metadata to support graph-like reasoning later.

The useful parts:

- Raw events are kept as episodes.
- Extracted facts point back to evidence.
- Facts can change over time.
- Time matters: what was true last month may not be true now.

### Mem0

Mem0 focuses on extracting, consolidating, and retrieving long-term memories from conversations.
The most useful part for YAH is the memory update loop.

The useful parts:

- Extract candidate memories from recent activity.
- Compare candidates against existing similar memories.
- Decide whether to add, update, delete, or do nothing.
- Use graph-style entity linking later if needed.

For YAH, delete should usually become archive or supersede. Real deletion should be user-controlled.

### MemoryOS

MemoryOS uses short-term memory, mid-term topic memory, and long-term personal memory.
This suggests YAH should not jump straight from raw thread history to permanent facts.

The useful parts:

- Recent conversation is short-term memory.
- Topic summaries are mid-term memory.
- Stable preferences and identity facts are long-term memory.
- Mid-term summaries reduce noise before anything becomes permanent.

### AutoGen

AutoGen's simple list memory is useful because it is predictable and easy to debug.

The useful part:

- Users and developers need a chronological view of what was remembered and why.

## Memory Scopes

### Category Memory

Category memory is shared by all channels under the category.
It should be treated as high-impact memory because changes here affect many agents.

Examples:

- User identity and durable preferences
- Team policies
- Shared project list
- Cross-channel coordination rules

Agents may propose category memory changes, but user approval is required before they become active.

### Channel Memory

Channel memory belongs to one field of work.
This should be the main useful memory layer.

Examples:

- Programming project context
- Email preferences
- Calendar constraints
- Ongoing travel details
- Repeated workflow preferences
- Current active work items

Agents may write channel working memory directly, but durable channel memories should either be proposed or clearly marked as agent-created.

### Thread Context

Thread context is the live work area.
It should not be treated as permanent memory by default.

Examples:

- Current task state
- Temporary findings
- Tool outputs
- Draft plans
- Pending questions

When a thread ends, YAH can summarize it and propose useful memory promotions.

## Memory Types

### Task Memory

Task memory defines what a node is for.
This is the overall direction, role, and purpose of a category or channel.

Task memory can be initialized by an agent, but should only be edited by a user.
Agents may propose edits when the current task definition is incomplete or outdated.

### Working Memory

Working memory stores active, mutable task state.
It is useful while work is ongoing, but it should be easy to archive when the task is complete.

Examples:

- "Need to confirm flight departure time."
- "Waiting on Sam for API credentials."
- "Current repo overhaul is focused on memory and dashboard design."

Agents may write working memory.
The janitor may archive stale working memory after review.

### Semantic Memory

Semantic memory stores durable facts.

Examples:

- "The user prefers concise engineering feedback."
- "The Email channel should not have coding tools."
- "The Programming channel works in ~/proj by default."

Semantic memory should have source links and timestamps.
If a fact changes, old records should be superseded, not silently overwritten.

### Episodic Memory

Episodic memory stores what happened.
It is closer to a summary of events than a fact database.

Examples:

- "On 2026-06-25, the user decided YAH should move away from self-improvement and toward productivity."
- "The thread about memory design reviewed Letta, LangGraph, Zep, Mem0, MemoryOS, and AutoGen."

Episodic memory is useful for audits, handoffs, and remembering decisions.

### Procedural Memory

Procedural memory stores how agents should work.

Examples:

- "Ask before writing category memory."
- "Use the dashboard for configuration."
- "Do not use coding tools in the Email channel."
- "When finishing a thread, propose memory promotions."

This memory should usually be user-owned or read-only.

### Artifact Memory

Artifact memory tracks durable outputs and references.

Examples:

- Files created
- URLs discovered
- Documents summarized
- Decisions recorded
- External IDs such as email message IDs or calendar event IDs

Artifact memory should not copy large content unless necessary. It should point to the source.

## Memory Records

Memory should be stored as structured records, not only freeform text.

```ts
type MemoryScope = "category" | "channel" | "thread"

type MemoryKind =
  | "task"
  | "working"
  | "semantic"
  | "episodic"
  | "procedural"
  | "artifact"

type MemoryStatus =
  | "active"
  | "proposed"
  | "superseded"
  | "archived"
  | "deleted"

type MemoryRecord = {
  id: string
  scope: MemoryScope
  nodeId: string
  kind: MemoryKind
  status: MemoryStatus
  content: string
  tags: string[]
  confidence: number
  agentWritable: boolean
  userApproved: boolean
  visibility: "private" | "channel" | "category"
  source: {
    discordGuildId?: string
    discordChannelId?: string
    discordThreadId?: string
    discordMessageId?: string
    toolCallId?: string
    createdBy: "user" | "agent" | "janitor" | "import"
  }
  validFrom?: string
  validUntil?: string
  supersedes?: string[]
  createdAt: string
  updatedAt: string
}
```

This shape keeps the system simple while preserving room for future search, graph extraction, approvals, and audits.

## Storage Model

### Pinned Blocks

Pinned blocks are small pieces of memory that are always included in context.
They should be used for important, stable context.

Examples:

- Task memory
- Procedural rules
- Current channel summary
- User-approved durable preferences

Pinned blocks should have size limits. If a block grows too large, it should be summarized or split.

### Thread Logs

Thread logs are raw evidence.
They should include user messages, assistant messages, tool calls, and important output.

Thread logs should not all be injected into future prompts.
They should be searchable and available for evidence lookup.

### Topic Summaries

Topic summaries are mid-term memory.
They sit between raw thread logs and durable facts.

Examples:

- "YAH overhaul direction"
- "Discord hierarchy design"
- "Memory model research"
- "Current travel planning"

Topic summaries should be updated after thread completion or during janitor runs.

### Fact Index

The fact index stores searchable semantic, episodic, procedural, and artifact memories.

The first version can be SQLite plus basic text search.
Embeddings can be added later.
A graph database should not be required for the first implementation.

## Write Rules

Agents can write thread working memory freely.

Agents can write channel working memory, but durable channel memories should be visibly marked as agent-created unless approved by a user.

Agents can propose category memory changes, but cannot activate them without user approval.

Agents should not physically delete memory unless the user asks.
They should archive or supersede records.

Task memory is user-owned.
Agents can propose changes, but users approve them.

Procedural memory should usually be user-owned or read-only.

Every memory write should create an audit event.

## Approval Flow

Category writes should become pending proposals.

A proposal should show:

- The new or changed memory
- The source thread or message
- Why the agent thinks it matters
- The scope it will affect
- The old memory it supersedes, if any

The user can approve, reject, edit, or move it to a lower scope.

This matters because category memory affects all child channels.

## Retrieval

YAH should assemble context in layers.

For a thread, include:

1. System and safety rules
2. Category pinned blocks
3. Channel pinned blocks
4. Thread task context
5. Relevant working memories
6. Relevant topic summaries
7. Search results from the fact index
8. Source excerpts only when needed

Retrieval should prefer nearer scopes.
Thread beats channel.
Channel beats category.
Category is broad and should be used carefully.

When memories conflict, prefer:

1. User-approved memory
2. Newer memory with source
3. More specific scope
4. Higher confidence

## Janitor

The janitor should be a memory maintenance process, not just a cleanup agent.

At a set interval, it should review recent channel activity and:

- Archive stale working memory
- Summarize completed threads
- Extract candidate semantic memories
- Merge duplicates
- Supersede outdated facts
- Propose category memory promotions
- Produce a digest for the user

The janitor should not run if no relevant work happened.

The janitor should not physically delete memory by default.

The janitor should operate per channel. It gets a new context for each channel.
Category-level changes should only happen through proposals.

## Dashboard

The dashboard should make memory inspectable and editable.

Minimum useful views:

- Category memory
- Channel memory
- Pending approvals
- Archived memory
- Source history
- Janitor digest

Users should be able to:

- Edit task memory
- Edit or remove working memory
- Approve or reject proposals
- Search memory
- View why a memory exists
- Move memory between scopes
- Archive or restore memory

Discord should be used for lightweight notifications, not detailed memory editing.

## Edge Cases

### Conflicting Facts

Two memories may disagree.
YAH should not blindly merge them.
It should keep both, mark the conflict, and prefer the memory with better scope, source, approval, and timestamp.

### Stale Preferences

Preferences change.
Old preference memories should be superseded with validity dates instead of overwritten.

### Team Use

In a team, not every user should be able to approve shared memory.
Category and channel memory need owner or role rules.

### Sensitive Data

Some memories should stay private or channel-local.
YAH should avoid promoting sensitive data to category memory unless a user explicitly approves it.

### Tool-Created State

External systems are sources of truth.
For example, email, calendar, GitHub, and files may change outside YAH.
Memory should store references and verification hints, not pretend copied data is always current.

### Race Conditions

Multiple agents may update shared memory at once.
Shared blocks should have ownership rules or append-only writes.
Large rewrites should be done by the janitor or dashboard.

### Memory Bloat

If everything is remembered, memory becomes useless.
YAH should favor summaries, source links, and explicit promotion over automatic permanent storage.

## Implementation Order

### Phase 1

Add structured memory records and scope them to category and channel IDs.
Build dashboard views for reading and editing memory.
Keep retrieval simple.

### Phase 2

Add thread completion summaries and memory proposals.
Agents can propose channel/category memories, but category writes require approval.

### Phase 3

Add janitor runs.
Start with archive, summarize, and propose.
Avoid physical deletion.

### Phase 4

Add semantic search.
SQLite full-text search is enough at first.
Embeddings can come later.

### Phase 5

Add temporal and graph-like relationships.
Do this only after the basic memory lifecycle is reliable.

## The Core Rule

Memory must remain explainable.

Every important memory should answer:

- What does YAH believe?
- Where did that belief come from?
- Who approved it?
- What scope can see it?
- Is it still current?

If YAH cannot answer those questions, the memory system will become hard to trust.
