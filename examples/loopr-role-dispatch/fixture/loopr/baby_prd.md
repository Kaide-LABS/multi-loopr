# Baby PRD

## TL;DR
A developer can run a single CLI command against a text file and get back accurate line, word, and character counts, plus the count of unique words -- like wc, extended with a unique-word count. Success: the counts are correct on real files, including edge cases (empty file, no trailing newline, unicode text). -- 2 acceptance criterion(ia), 1 scope edge(s) named.

## Problem statement
A developer can run a single CLI command against a text file and get back accurate line, word, and character counts, plus the count of unique words -- like wc, extended with a unique-word count. Success: the counts are correct on real files, including edge cases (empty file, no trailing newline, unicode text).

## Acceptance criteria
- Run `tally <file>` against a handful of prepared fixture files (empty file, a file with no trailing newline, a file with unicode/multi-byte characters, a normal multi-line file with repeated words) and diff the tool's line/word/char/unique-word counts against independently-computed expected values (e.g. `wc -lwc` for line/word/char, and a hand-counted or Python-computed unique-word set). If every fixture's four numbers match exactly, it worked. A third party can run the same fixtures and get the same verdict without needing to read any code.
- Acceptance criteria, each independently checkable by a third party:
1. Given an empty file, `tally empty.txt` prints line count = 0, word count = 0, char count = 0, unique word count = 0.
2. Given a file with no trailing newline, `tally noeol.txt` reports the same line count as `wc -l noeol.txt` plus any final partial line counted once (matches POSIX wc behavior on that file).
3. Given a file containing multi-byte UTF-8 characters, `tally unicode.txt` reports a char count equal to the number of Unicode codepoints (not raw bytes), verified against `wc -m unicode.txt`.
4. Given a file where the word "the" appears 5 times and 20 distinct words appear total, `tally repeats.txt` reports word count = the total word occurrences and unique word count = 20.
5. `tally` exits with a non-zero exit code and a stderr message (not a stack trace) when given a path that does not exist.
Each criterion is a direct comparator (equals/matches) between the tool's output and an independently computable expected value -- no subjective judgment required.

## Scope edges
- **out**: Out of scope for now: no config file or flags for custom delimiters/locale-specific word-splitting rules (uses simple whitespace-based word splitting only); no directory/recursive mode (single file argument only, no globbing or multi-file aggregation); no streaming/stdin support (must be a real file path); no performance work for files above a few tens of megabytes -- correctness on small-to-medium files is the target, not throughput at scale. -- user-stated

## Boundary
This build covers a single-file CLI tool (`tally`) that reports line count, word count, character count, and unique-word count for a given text file, correct on real files including empty files, files with no trailing newline, and files with multi-byte Unicode text. It explicitly does not cover: configurable delimiters or locale-specific word-splitting rules (whitespace-based splitting only); directory, recursive, or multi-file/glob input; stdin or streaming input (a real file path is required); or performance work for files beyond a few tens of megabytes.
