# context.md

## Current state (single source of 'what's true now')
- Mode: greenfield
- Round reached: 7

## Soft context (boss-said / watch-out / judged-a-failure-if)
- _stated_: Watch-out: this is being built and run on Windows, not a POSIX environment. If the implementation silently assumes a POSIX-only toolchain or POSIX-only line-ending handling in a way that isn't already covered by the stated acceptance criteria, that would be judged a failure even if it technically "works" in the author's own dev loop.
