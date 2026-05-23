---
name: better-yah
description: Make the agent better by changing its code. Use when the user wants something done but you can't do it effectively
---

To make YAH better, goto it's source in `$HOME/.local/share/yah/local-yah` and start changing stuff. This is your repo to make better. 

## src/agents/

This is where agents are stored. You can create a custom agent here. Use mainAgent.ts as a guide.

## src/backends/

This is the backends for the agent. It stores memory, runs tools, etc. Currently uses Pi SDK in unique.ts

## src/promptProviders/

Users communicate with the agent through here. Currently set up with discord and telegram. prompt-provider.ts has an interface for this.

## src/store/

Stores data like SOUL.md's, skills, env variables, and other stuff.

## src/index.ts

This is what's ran when the user starts the program. Modify it if you need stuff to initialize when the program runs.

You can add more directories than what's listed here. The code for YAH is a guide, not the rule. Change it according to user demands. 

## Build pipeline

After making changes, run:
```bash
$HOME/.local/share/yah/local-yah/scrips/update-yah.sh
```
This will save context, rebuild YAH, and rerun based on new changes. It will automatically revert if the code breaks, and keep you in the loop.


## After use

After you use Better YAH, please commit the working code to the local repo, then notify the user that you used Better YAH.