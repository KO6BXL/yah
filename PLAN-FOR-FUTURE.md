# Plan for the Future of YAH

I want YAH to be a context-aware clone of hermes agent. As context is an important part of engineering AI models to do exactly what you want, I feel that this is a neccessary jump for agents.

## Overview

YAH will no longer support chat-interfaces like telegram/whatsapp. They do not have the existing tooling to make something like this viable. 
YAH will mostly support discord-like interfaces. They contain abstractions like channels, categories, and threads.
We will sunset existing code related to self improvement. It's too much of a distraction/security risk for what we plan.
We will focus on a Category -> Channel -> Thread hierarchy of context, getting deeper into a task as we go down.
All configuration - memory, channel creation, restrictions - will be done on a web dashboard. In practice, configuration through discord is a pain and leads to misconfigurations.

## The Idea

### Category

My idea is that when YAH is added to a discord server, it will create a new category called "YAH" (it can be changed later by user, we still keep the ID), which will contain nothing. 
This channel will be the root of the tree. All channels call it home and contain context it holds.

### Channel

Each channel is a given task/field. One might be "Programming", another "Personal", or whatever the user intends on it being. 
There is a strong division between channels. No one channel can communicate in any way with the other without going first through the category. The only time each channel can "communicate" is through the filesystem itself. Like if the "Assistant" agent is told to create a slideshow of the active projects in `~/proj`, that is a time where it may conflict with the "Programming" agent.
Each channel also has a different environment. For example, the "Email" channel shouldn't have a programming skill or a Codex tool. Those should be added to the appropriate channel.
When a user says something in a channel, consider it an order to start and work in a thread.

### Thread

This is the lowest level of context. This is where work is done.
The context in a thread is all the context, skills, and tools of it's parent nodes plus it's working context. 
Agents in threads can write to the memory of its channel, or even category. In the latter case, direct user permission is required for category writes as the changes will affect all other agents.
Once an agent is done here, a user can refine what it did or leave the thread and start another task.
Once a user feels like the thread is done, it can call a discord slash command to have the memory system take over
Threads should not be included in the memory system. Their memory is their context.

## Memory

The memory system will be comprised of three parts. The user can manually view and edit memory if they so desire. The memory is primarily targeted at agents.
The memory is one 

### Task Memory

This is the state given when the node is init-ed. It is the overall direction and focus of the node.
Task memory can be init-ed by an agent, but only edited by a user.

### Working Memory

For when an agent works on a task, it may put stuff in this memory. 
For example, an agent working in a thread in the "Email" channel is told to find out when the user's flight is leaving and what time to be there. If the agent has no clue about this flight, it will write this into memory. If it does, it will know details about this flight (like the confirmation email id or title) and call the email tool to verify it's info.
If an agent is told a task is done, it is free to delete the related memories from the working memory.

### Janitor

At a set interval (default 3 days), a global agent called the janitor is called to cleanup working memory across each channel. It will comapre threads with memory and determine what needs to go.
The janitor is NOT called for the entire category, only each channel. 
The user is notified with the janitor is called in every channel.
If no work had been done in the past interval, the janitor is not called.