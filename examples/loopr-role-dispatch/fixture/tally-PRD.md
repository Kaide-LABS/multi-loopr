# tally — PRD (canonical)

**Status:** modernised, Step 10 complete. This file is the single canonical reference the
execution agent builds from and the review agent verifies against. There is no second PRD.

**Scope of this document:** the confirmed problem statement, acceptance criteria, scope edges and
boundary carried forward verbatim from `loopr/baby_prd.md` and `loopr/context.md`; the locked
counting semantics; the system map; the universal invariants; the failure-mode analysis; and the
modernization changelog.

---

## 1. Problem statement (confirmed, verbatim)

A developer can run a single CLI command against a text file and get back accurate line, word, and
character counts, plus the count of unique words — like `wc`, extended with a unique-word count.
Success: the counts are correct on real files, including edge cases (empty file, no trailing
newline, unicode text).

---

## 2. Boundary (confirmed at Gate 2, hash `49d6438505ac9f1afb5571a64b9b16677ce446452078c3a82b592e44722944d7`)

This build covers a single-file CLI tool (`tally`) that reports line count, word count, character
count, and unique-word count for a given text file, correct on real files including empty files,
files with no trailing newline, and files with multi-byte Unicode text. It explicitly does not
cover: configurable delimiters or locale-specific word-splitting rules (whitespace-based splitting
only); directory, recursive, or multi-file/glob input; stdin or streaming input (a real file path
is required); or performance work for files beyond a few tens of megabytes.

---

## 3. Soft context (confirmed)

> Watch-out: this is being built and run on **Windows**, not a POSIX environment. If the
> implementation silently assumes a POSIX-only toolchain or POSIX-only line-ending handling in a way
> that isn't already covered by the stated acceptance criteria, that would be judged a failure even
> if it technically "works" in the author's own dev loop.

This note is load-bearing. Section 4 and section 8 exist largely to discharge it, and three of the
modernization corrections in section 12 are direct consequences of it.

---

## 4. Locked counting semantics (NORMATIVE)

This section is the heart of the spec. Every number `tally` prints is defined here as a total
function of the file's bytes. There is no locale input, no configuration, and no ambiguity. An
implementation that produces a different number for any input in section 4.4 is wrong.

### 4.1 Reading the file

The file is read exactly once, fully, into a single `str`:

```
open(path, mode="r", encoding="utf-8", errors="strict", newline="")
```

All three keyword arguments are **mandatory and non-negotiable**:

| argument | value | why this exact value |
| --- | --- | --- |
| `encoding` | `"utf-8"` | Omitting `encoding` makes Python use `locale.getencoding()` ([docs.python.org — `open()`](https://docs.python.org/3/library/functions.html#open): "if *encoding* is not specified the encoding used is platform-dependent: `locale.getencoding()` is called to get the current locale encoding"). On the confirmed Windows target that value is **`cp1252`** (verified: `python -c "import locale; print(locale.getencoding())"` → `cp1252`). cp1252 decodes almost every byte without raising, so a UTF-8 file is decoded *silently wrong*: `café naïve\n` (13 bytes, 11 codepoints) decodes under cp1252 to **13** characters — i.e. the char count silently becomes a **byte** count, which is precisely the failure AC3 forbids. Explicit `encoding="utf-8"` is also the forward-compatible choice: PEP 686 makes UTF-8 mode the default only in Python 3.15 ([peps.python.org/pep-0686](https://peps.python.org/pep-0686/), status **Final**, target 3.15), so the default differs between 3.14 and 3.15. Pinning it explicitly makes the result version-independent. |
| `errors` | `"strict"` | A file that is not valid UTF-8 must fail loudly with a non-zero exit, never produce a plausible-looking wrong number. `errors="replace"`/`"ignore"` would silently corrupt the char count. Verified: reading bytes `b"abc\xff\xfe def"` under `utf-8`/`strict` raises `UnicodeDecodeError: 'utf-8' codec can't decode byte 0xff in position 3: invalid start byte`. |
| `newline` | `""` | With the default `newline=None`, Python performs universal-newline translation: [docs.python.org — `open()`](https://docs.python.org/3/library/functions.html#open) — "if *newline* is `None`, universal newlines mode is enabled. Lines in the input can end in `'\n'`, `'\r'`, or `'\r\n'`, and these are translated into `'\n'` before being returned to the caller"; "if it is `''`, universal newlines mode is enabled, but line endings are returned to the caller untranslated." On a CRLF file — the Windows default — translation **destroys the character count**. Verified on `a\r\nb\r\n`: `newline=None` → `'a\nb\n'`, len **4**; `newline=""` → `'a\r\nb\r\n'`, len **6**. `wc -m` reports **6**. This is the single most likely way a POSIX-brained implementation silently fails the Windows watch-out. |

`pathlib.Path.read_text()` is **not** an acceptable substitute: its `newline` parameter was only
added in Python 3.13 ([docs.python.org — `Path.read_text`](https://docs.python.org/3/library/pathlib.html#pathlib.Path.read_text),
"Changed in version 3.13: The *newline* parameter was added"), which is above this project's
supported floor (section 10). Use `open()`.

### 4.2 The four counts

Let `text` be the string produced by 4.1.

| count | definition | formula |
| --- | --- | --- |
| **chars** | Number of **Unicode codepoints** — not bytes, not grapheme clusters, not display columns. `\r` and `\n` each count as one character. | `len(text)` |
| **lines** | Number of `\n` characters, **plus one** if the file is non-empty and does not end in `\n` (the trailing partial line). | `text.count("\n") + (1 if text and not text.endswith("\n") else 0)` |
| **words** | Number of whitespace-delimited tokens, using Python's default `str.split()` (no separator argument). | `len(text.split())` |
| **unique** | Number of **distinct** word tokens, compared by exact string identity — case-sensitive, punctuation retained, no normalization of any kind. | `len(set(text.split()))` |

Notes that close off guessing:

- **`chars` is codepoints.** `len()` on a `str` counts codepoints. A grapheme-cluster count (e.g.
  treating an emoji ZWJ sequence as one) is **wrong** here, and so is a byte count.
- **`lines` deliberately diverges from `wc -l`.** POSIX specifies `-l` as "write to the standard
  output the number of **`<newline>` characters** in each input file"
  ([POSIX.1-2024, `wc`](https://pubs.opengroup.org/onlinepubs/9799919799/utilities/wc.html)). `tally`
  reports newlines **plus the trailing partial line**, per acceptance criterion 2. On `a\nb`:
  `wc -l` → 1, `tally` → **2**. On the empty file both → 0. See 4.3 and changelog entry C-1.
- **`words` uses `str.split()` with no arguments.** [docs.python.org — `str.split`](https://docs.python.org/3/library/stdtypes.html#str.split):
  "If *sep* is not specified or is `None`, a different splitting algorithm is applied: runs of
  consecutive whitespace are regarded as a single separator, and the result will contain no empty
  strings at the start or end if the string has leading or trailing whitespace. Consequently,
  splitting an empty string or a string consisting of just whitespace with a `None` separator
  returns `[]`." This gives the POSIX word definition — "a non-zero-length string of characters
  delimited by white space" ([POSIX `wc`](https://pubs.opengroup.org/onlinepubs/9799919799/utilities/wc.html))
  — for free, including correct handling of tabs, runs of spaces, blank lines, and leading/trailing
  whitespace. Do **not** hand-roll a splitter, and do **not** use `re.split`.
- **Whitespace is Python's Unicode definition, not the C locale's.** A character is whitespace if
  "in the Unicode character database … either its general category is `Zs` … or its bidirectional
  class is one of `WS`, `B`, or `S`" ([docs.python.org — `str.isspace`](https://docs.python.org/3/library/stdtypes.html#str.isspace)).
  This is broader than the C locale's `iswspace`. Verified on `a\u00a0b\n` (NBSP): `tally` → 2
  words; `LC_ALL=C.UTF-8 wc -w` → 2 (agrees); bare `wc -w` with `LANG` unset → **1** (disagrees).
  This is a locale artefact of the comparison tool, not a defect in `tally`; see 4.3.
- **`unique` is exact-string.** `"The"` and `"the"` are two distinct words. `"dog"` and `"dog."` are
  two distinct words. Case-folding, punctuation stripping, or Unicode normalization would each be a
  *locale/delimiter rule*, which the boundary (section 2) explicitly excludes. See changelog C-3.

### 4.3 Verifying against `wc` on Windows (NORMATIVE for the test harness)

Acceptance criteria 2 and 3 name `wc` as the independent oracle. On the confirmed Windows target,
`wc` is GNU coreutils 8.32 shipped with Git for Windows at `/usr/bin/wc` (verified:
`wc --version` → `wc (GNU coreutils) 8.32`), and **`LANG` and `LC_ALL` are unset**, i.e. the C
locale. That matters, because GNU documents `-m` as printing "only the character counts, **as per
the current locale**" and notes that "the current locale determines which characters are white
space" ([GNU coreutils manual — `wc` invocation](https://www.gnu.org/software/coreutils/manual/html_node/wc-invocation.html)).

Verified consequence, on a file containing `café naïve\n` (13 bytes, 11 codepoints):

```
$ wc -m unicode.txt                  # LANG/LC_ALL unset -> C locale
13 unicode.txt                       # <- BYTES, not codepoints
$ LC_ALL=C.UTF-8 wc -m unicode.txt
11 unicode.txt                       # <- codepoints, matches tally
```

**Therefore:** every `wc` comparison in the test harness and in any manual verification MUST be run
as `LC_ALL=C.UTF-8 wc …`. Running bare `wc -m` would report a byte count and fail a *correct*
implementation. This is the POSIX-toolchain assumption the section 3 watch-out warned about, caught
empirically. See changelog C-2.

### 4.4 Worked examples (NORMATIVE — these are the expected outputs)

Every row below was computed empirically against both the formulas in 4.2 and GNU coreutils
`wc 8.32` under `LC_ALL=C.UTF-8`. An implementation MUST reproduce the four `tally` columns exactly.

| fixture | exact bytes | tally lines | tally words | tally chars | tally unique | `wc -l` | `wc -w` | `wc -m` | `wc -c` |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `empty.txt` | *(zero bytes)* | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| `noeol.txt` | `a\nb` | **2** | 2 | 3 | 2 | **1** | 2 | 3 | 3 |
| `unicode.txt` | `café naïve\n` as UTF-8 | 1 | 2 | **11** | 2 | 1 | 2 | 11 | **13** |
| `crlf.txt` | `a\r\nb\r\n` | 2 | 2 | **6** | 2 | 2 | 2 | 6 | 6 |
| `cronly.txt` | `x\ry\r` | **1** | 2 | 4 | 2 | **0** | 2 | 4 | 4 |
| `nbsp.txt` | `a\xc2\xa0b\n` | 1 | 2 | 4 | 2 | 1 | 2 | 4 | **5** |
| `tabs.txt` | `  a\t\tb  \n\n\nc  \n` | 4 | 3 | 15 | 3 | 4 | 3 | 15 | 15 |
| `repeats.txt` | see 4.5 | 5 | **24** | 118 | **20** | 5 | 24 | 118 | 118 |

Bolded cells are the ones where a careless implementation goes wrong, or where `tally` deliberately
differs from `wc`:

- `noeol.txt`, `cronly.txt`: `tally` counts the trailing partial line; `wc -l` does not.
- `unicode.txt`, `nbsp.txt`: `chars` (11 / 4) ≠ bytes (13 / 5). A cp1252 or byte-count
  implementation produces the `wc -c` column instead.
- `crlf.txt`: `chars` is 6, not 4. A `newline=None` implementation produces 4.

### 4.5 `repeats.txt` fixture content (NORMATIVE, satisfies acceptance criterion 4)

Exact content, LF line endings, with a trailing newline (118 bytes, 118 codepoints):

```
the quick brown fox jumps over
the lazy dog and then runs away
into the dark forest near
the quiet river dawn
the end
```

Verified properties: `"the"` occurs exactly **5** times; total word occurrences **24**; distinct
words **20**; lines **5**. This fixture is fully specified so the execution agent does not invent
one whose numbers do not satisfy AC4.

### 4.6 Output format (NORMATIVE)

On success, `tally` writes exactly four lines to **stdout**, in this order, and nothing else:

```
lines: <int>
words: <int>
chars: <int>
unique: <int>
```

- Lowercase label, a single colon, a single space, then the decimal integer with no padding, no
  thousands separators, no sign.
- The input path is **not** echoed. Nothing else — no header, no totals line, no blank line.
- Written with `print()`, so the physical line terminator is platform-native (`\r\n` on Windows).
  **Tests MUST NOT assert raw-byte equality of the stdout stream**; they must compare parsed
  integers, or compare after splitting lines. Asserting `stdout == "lines: 0\n…"` will pass on Linux
  CI and fail on the confirmed Windows target — another instance of the section 3 watch-out.

### 4.7 Exit codes and errors (NORMATIVE)

| exit code | condition | destination |
| --- | --- | --- |
| `0` | Counts computed and printed. | stdout |
| `1` | Input error: path does not exist, path is a directory, permission denied, or file is not valid UTF-8. | one line on stderr, nothing on stdout |
| `2` | Command-line usage error: no argument, more than one argument, unknown flag. Produced by `argparse` itself. | argparse's usage message on stderr |

`2` is not a choice — it is argparse's documented behaviour:
[docs.python.org — argparse](https://docs.python.org/3/library/argparse.html) — "Normally, when you
pass an invalid argument list to the `parse_args()` method of an `ArgumentParser`, it will print a
*message* to `sys.stderr` and exit with a status code of 2." Do not override it.

Exact stderr messages for exit code 1 (single line each, no traceback, no `Traceback (most recent
call last)` anywhere in the output):

```
tally: <path>: no such file or directory
tally: <path>: is a directory
tally: <path>: permission denied
tally: <path>: is not valid UTF-8 text
```

**Windows-specific requirement:** the "is a directory" case MUST be detected by an explicit
`Path(path).is_dir()` check *before* opening the file. Verified divergence: on Windows, `open(".")`
raises `PermissionError` (errno 13), **not** `IsADirectoryError` (errno 21) as it does on POSIX. An
implementation that infers "is a directory" from the exception type will report "permission denied"
for a directory on the confirmed target platform. See changelog C-4.

---

## 5. System map / architecture

`tally` is a single small Python package with a console-script entry point. Proportionate to the
problem: four source files, no framework, no runtime dependencies.

```
                       argv
                        |
                        v
              +---------------------+
              |  cli.py             |   argparse: one positional FILE
              |  build_parser()     |   -> usage errors exit 2
              +---------------------+
                        |  path: str
                        v
              +---------------------+
              |  cli.py             |   is_dir precheck, open(utf-8/strict/newline="")
              |  read_source_text() |   -> OSError/UnicodeDecodeError => exit 1
              +---------------------+
                        |  text: str
                        v
              +---------------------+
              |  counter.py         |   PURE. no I/O, no sys, no os.
              |  count_text()       |   -> Counts frozen dataclass
              +---------------------+
                        |  Counts
                        v
              +---------------------+
              |  cli.py             |   four lines, exact format (4.6)
              |  format_counts()    |
              +---------------------+
                        |
                        v
                      stdout, exit 0
```

The split is deliberate and is itself an invariant: **`counter.py` is a pure function of a `str`**.
It imports nothing from `os`, `sys`, `pathlib`, or `io`. That is what makes the counting semantics
in section 4 exhaustively unit-testable without touching the filesystem, and it is what the review
agent checks first.

---

## 6. Universal invariants

1. **Typed return shapes.** Every function that parses or transforms text has full type hints on
   every parameter and its return, and returns a single explicit shape. The four counts travel as a
   frozen dataclass (`Counts`), never as a bare `dict`, never as a 4-tuple, never as separate
   out-parameters.
2. **`mypy --strict` clean**, zero errors, on the whole package including tests. `--strict` "enables
   a defined subset of optional error-checking flags", among them `--disallow-untyped-defs`,
   `--disallow-incomplete-defs` and `--warn-return-any`
   ([mypy docs — command line](https://mypy.readthedocs.io/en/stable/command_line.html)). No
   `# type: ignore` without an adjacent comment justifying it.
3. **No LLM anywhere.** `tally` has **no** LLM, model, prompt, embedding, or inference component in
   any execution path. The template invariants about "deterministic rules engines anchoring LLM
   extraction" and "Google-native (Gemini/Vertex) LLM routing" are **N/A for this project** and are
   recorded here explicitly so the review agent does not go looking for an LLM call that was never
   meant to exist. Correspondingly, `docs/modernization_log.md` (whose purpose is pinning model
   strings) is **N/A and intentionally absent** — there are no model strings to pin. Dependency
   version pinning, the other half of that file's job, lives in section 10 of this document instead.
4. **Determinism.** Every count is a total, deterministic function of the file's bytes alone. No
   locale input, no environment variables, no clock, no randomness, no filesystem state beyond the
   file's contents. Running `tally` twice on the same bytes on any machine must produce byte-identical
   stdout.
5. **Commits stay neutral.** No AI attribution in commit messages, no `Co-Authored-By` trailer, no
   generated-with footer. The repo's existing convention (commit `init`) is plain and neutral.

---

## 7. PROJECT HARD BOUNDARY (inviolable)

`tally` never implements any of the confirmed out-of-scope items. A modernization "enhancement" that
adds any of these is **auto-rejected, not applied**, regardless of how reasonable it looks in
isolation. The confirmed scope edges outrank any newer or better method research surfaces.

Out, permanently, for this build:

- **No custom delimiters or locale-specific word-splitting.** Whitespace splitting via bare
  `str.split()` only. No config file, no flags, no environment variables that alter splitting.
- **No directory, recursive, multi-file, or glob input.** Exactly one file path argument.
- **No stdin or streaming input.** A real file path is required. `-` is not a magic filename.
- **No performance work for files beyond a few tens of megabytes.** Whole-file read is correct and
  intended. Correctness on small-to-medium files is the target, not throughput at scale.

### 7.1 What code VIOLATES this boundary (grep targets for the review agent)

If any of the following appears in `src/tally/`, the review agent must **HALT** and reject the
phase. This list is deliberately mechanical so it can be grepped, not judged.

| violation | grep for | why it violates |
| --- | --- | --- |
| stdin / streaming | `sys.stdin`, `argparse.FileType`, `fileinput`, `- ` treated as a path sentinel, `iter(f)` / `for line in f` streaming loops | `argparse.FileType` in particular silently accepts `-` as stdin — a boundary breach hidden inside a stdlib convenience |
| multi-file / glob | `nargs=` on the positional, `glob`, `iglob`, `Path.glob`, `Path.rglob`, `os.walk`, `os.scandir`, `os.listdir` | single file argument only |
| config / delimiters | `configparser`, `tomllib`, `json.load` of a config, `os.environ.get`, `.tallyrc`, `tally.toml`, any flag named `--delimiter` / `--sep` / `--separator` / `--locale` / `--split` / `--ignore-case` / `--normalize` | no configurable splitting |
| locale-dependent splitting | `locale.setlocale`, `locale.getlocale`, `re.split`, `re.findall`, `str.casefold`, `str.lower` applied to tokens, `unicodedata.normalize` | splitting and uniqueness must be locale-free and exact-string |
| scale/perf machinery | `mmap`, `threading`, `multiprocessing`, `concurrent.futures`, `asyncio`, chunked read loops (`f.read(<size>)` in a loop), `itertools.islice` over the file | whole-file read is the intended design |
| third-party runtime dependency | any `import` in `src/tally/` outside the Python standard library; any non-empty `[project].dependencies` in `pyproject.toml` | section 10 pins zero runtime dependencies |

Note the asymmetry: `str.lower()` is banned **on tokens** (it would change `unique`), and the
`re` module is banned **for splitting**. Neither is banned as a general Python feature — but in a
package this small, there is no legitimate use for either, so their presence anywhere in
`src/tally/` should be treated as a violation until justified in review.

---

## 8. FAILURE-MODE ANALYSIS

These are the ways a lazy or careless implementation of this specific tool goes wrong. Each is
paired with its detection and its prevention. Phase 1 must bake in all of them.

| # | Failure mode | How it manifests | Detection | Prevention |
| --- | --- | --- | --- | --- |
| **F1** | **Byte count instead of codepoint count.** Reading in binary and taking `len(data)`, or reading text without `encoding=`. | `unicode.txt` reports 13 instead of 11. On Windows this happens **silently** because `locale.getencoding()` is `cp1252`, which decodes almost any byte without raising. | Fixture `unicode.txt`; assert `chars == 11`, and separately assert `chars != len(file_bytes)`. | Mandatory `encoding="utf-8"` (4.1). Never `open(path, "rb")`. Never `os.path.getsize()`. |
| **F2** | **CRLF translation deflating the char count.** Using default `newline=None` (or `Path.read_text()` without `newline`). | `crlf.txt` reports 4 chars instead of 6. Invisible on a Linux dev box that only ever sees LF files — the exact POSIX-assumption trap in section 3. | Fixture `crlf.txt`; assert `chars == 6`. | Mandatory `newline=""` (4.1). |
| **F3** | **Off-by-one on the trailing line.** Either `len(text.splitlines())` (over-counts a CR-only file's structure differently and mishandles other Unicode line boundaries), or `text.count("\n")` alone (drops the trailing partial line). | `noeol.txt` reports 1 instead of 2, or `empty.txt` reports 1 instead of 0. | Fixtures `empty.txt` (expect 0), `noeol.txt` (expect 2), `crlf.txt` (expect 2), `cronly.txt` (expect 1). The empty-file case is what kills the naive `count("\n") + 1`. | The exact formula in 4.2, including the `if text and …` guard. **`str.splitlines()` is banned** — it also splits on `\v`, `\f`, `\x1c`–`\x1e`, `\x85`, `\u2028`, `\u2029`, which is not the specified behaviour. |
| **F4** | **Whitespace-splitting edge cases.** Hand-rolled `text.split(" ")`, or `re.split(r"\s")`, or `split("\n")` then `split(" ")`. | `tabs.txt` (`  a\t\tb  \n\n\nc  \n`) reports 8 or 9 words instead of 3, because empty strings from runs of whitespace and from leading/trailing whitespace get counted. | Fixture `tabs.txt`; assert `words == 3` and `unique == 3`. | Bare `str.split()` with no arguments, whose documented behaviour collapses runs and drops leading/trailing empties (4.2). |
| **F5** | **Path-not-found handled as a crash.** Letting `FileNotFoundError` propagate. | A Python traceback on stderr and exit code 1 — accidentally non-zero, so a weak test passes, but AC5 explicitly requires "a stderr message (not a stack trace)". | Assert the stderr text matches `tally: <path>: no such file or directory` **and** that `Traceback` does not appear in stderr **and** exit code is 1 **and** stdout is empty. | Catch `OSError` and `UnicodeDecodeError` in `main()`; map to a message; `return 1`. No bare `except Exception`. |
| **F6** | **Directory misreported on Windows.** Inferring the error from the exception type. | `tally .` prints `permission denied` instead of `is a directory`, because Windows raises `PermissionError` (errno 13) where POSIX raises `IsADirectoryError` (errno 21). Verified empirically on the target. | Test `tally <dir>` asserting the exact message `tally: <path>: is a directory` on the confirmed Windows target. | Explicit `Path(path).is_dir()` precheck **before** `open()` (4.7). |
| **F7** | **Silent corruption on non-UTF-8 input.** Using `errors="replace"` or `errors="ignore"`. | A latin-1 or binary file produces a confident, wrong char count instead of an error. | Fixture of bytes `b"abc\xff\xfe def"`; assert exit code 1 and the `is not valid UTF-8 text` message. | `errors="strict"` (4.1) and an explicit `UnicodeDecodeError` handler. |
| **F8** | **Test fixtures mangled by git.** Committing `noeol.txt` / `crlf.txt` as tracked text files. | Verified hazard: `core.autocrlf=true` is set globally on the target machine (`file:C:/Program Files/Git/etc/gitconfig core.autocrlf=true`). Git will rewrite LF↔CRLF on checkout, so `noeol.txt` and `crlf.txt` silently stop testing what they were written to test, and F2/F3 regressions become invisible. | Compare `Path(fixture).read_bytes()` against the expected byte literal at the top of every fixture-based test. | **Generate all byte-exact fixtures at test runtime** by writing `bytes` to a `tmp_path`, never by committing them. Additionally commit a `.gitattributes` marking any fixture directory `-text` as belt-and-braces. |
| **F9** | **`wc` oracle disagreeing under the C locale.** Comparing against bare `wc -m` on the Windows target. | A *correct* implementation is marked failing, because `wc -m` under the unset-`LANG` C locale returns bytes (13, not 11) — verified in 4.3. | Any harness invoking `wc` must set `LC_ALL=C.UTF-8`; a harness that does not is itself the defect. | 4.3 is normative for the harness. Prefer independently-computed Python expected values as the primary oracle and treat `wc` as a secondary cross-check. |
| **F10** | **UnicodeEncodeError while reporting an error.** Interpolating a non-ASCII path into the stderr message. | `sys.stderr.encoding` is `cp1252` on the target (verified). A path containing, say, a CJK character raises `UnicodeEncodeError` *inside the error handler*, producing a traceback for what should have been a clean one-line message — turning F5 back on. | Test with a filename containing a non-cp1252 character; assert exit 1 and no `Traceback`. | Call `sys.stderr.reconfigure(errors="backslashreplace")` once at the top of `main()` (available on `TextIOWrapper`; verified present on the target), or write the message through a helper that cannot raise. |
| **F11** | **Unique-word count quietly normalized.** Case-folding or stripping punctuation to make the number "nicer". | `unique` disagrees with the hand-computed set; `"The"` and `"the"` collapse. Also a section 7 boundary breach (a locale/delimiter rule by the back door). | Fixture containing `The the dog dog.`; assert `unique == 4`. | `len(set(text.split()))` with no transformation (4.2). Grep for `.lower()`, `.casefold()`, `unicodedata.normalize`, `strip(punctuation)`. |

---

## 9. Acceptance criteria (confirmed, with modernization corrections applied)

Carried forward from `loopr/baby_prd.md`. Corrections C-1 and C-2 (section 12) are applied inline
and marked; everything else is verbatim.

**AC-0 (harness-level).** Run `tally <file>` against prepared fixture files (empty file, a file with
no trailing newline, a file with unicode/multi-byte characters, a normal multi-line file with
repeated words) and diff the tool's line/word/char/unique-word counts against independently-computed
expected values. If every fixture's four numbers match exactly, it worked. A third party can run the
same fixtures and get the same verdict without needing to read any code.
*(Correction C-2 applied: any `wc` cross-check must be invoked as `LC_ALL=C.UTF-8 wc -lwm`.)*

**AC-1.** Given an empty file, `tally empty.txt` prints line count = 0, word count = 0, char
count = 0, unique word count = 0.

**AC-2.** Given a file with no trailing newline, `tally noeol.txt` reports the number of `\n`
characters in the file plus one for the final partial line — i.e. for `a\nb`, **2**.
*(Correction C-1 applied: the original criterion's parenthetical "(matches POSIX wc behavior on that
file)" is factually wrong and has been removed; POSIX `wc -l` counts newline characters only and
reports 1 for this file. The criterion's own operative clause — "the same line count as `wc -l` plus
any final partial line counted once" — is preserved exactly and is what governs.)*

**AC-3.** Given a file containing multi-byte UTF-8 characters, `tally unicode.txt` reports a char
count equal to the number of Unicode codepoints (not raw bytes), verified against
`LC_ALL=C.UTF-8 wc -m unicode.txt`. *(Correction C-2 applied.)*

**AC-4.** Given a file where the word "the" appears 5 times and 20 distinct words appear total,
`tally repeats.txt` reports word count = the total word occurrences (24) and unique word count = 20.
The exact fixture is specified in 4.5.

**AC-5.** `tally` exits with a non-zero exit code and a stderr message (not a stack trace) when given
a path that does not exist.

---

## 10. Environment and pinned versions

There is no `docs/modernization_log.md` for this project (see invariant 6.3 — no model strings
exist to pin). Dependency pinning lives here instead.

**Runtime dependencies: none.** `tally` uses only the Python standard library — `argparse`,
`pathlib`, `sys`, `dataclasses`. `[project].dependencies` in `pyproject.toml` MUST be empty. This
expectation was carried into research and confirmed: nothing in section 4 requires a third-party
package.

| item | pinned value | source / verification |
| --- | --- | --- |
| `requires-python` | `>=3.10` | Floor set by the dev toolchain, not by `tally` itself: both mypy and pytest declare `Requires-Python: >=3.10` (PyPI JSON API for [mypy](https://pypi.org/pypi/mypy/json) and [pytest](https://pypi.org/pypi/pytest/json)). Python 3.10 reaches EOL in October 2026 and 3.9 is already EOL ([Python devguide — versions](https://devguide.python.org/versions/)). |
| Verified dev interpreter | CPython **3.14.4** on Windows 11 | `python --version` on the target machine. 3.14 is the current stable branch, released 2025-10-07 ([devguide](https://devguide.python.org/versions/)). |
| mypy (dev) | `mypy==2.3.1` | Latest release per [PyPI JSON](https://pypi.org/pypi/mypy/json). Installed locally: 2.3.0 — the spec pins 2.3.1 and the execution agent should upgrade. |
| pytest (dev) | `pytest==9.1.1` | Latest release per [PyPI JSON](https://pypi.org/pypi/pytest/json); matches the locally installed version. |
| build backend | `setuptools` via `[build-system] requires = ["setuptools"]` | [Python Packaging User Guide — pyproject.toml specification](https://packaging.python.org/en/latest/specifications/pyproject-toml/). |
| entry point | `[project.scripts] tally = "tally.cli:main"` | Same source: "The `[project.scripts]` table corresponds to the `console_scripts` group in the entry points specification." This is what makes the literal command `tally <file>` in the acceptance criteria work on Windows (pip generates a `tally.exe` shim in `Scripts\`). |
| comparison oracle | GNU coreutils `wc` **8.32** (Git for Windows, `/usr/bin/wc`), invoked as `LC_ALL=C.UTF-8 wc` | `wc --version` on the target machine; locale requirement established in 4.3. |

---

## 11. OPEN ARCHITECTURE QUESTIONS

**None open.** No research finding falsified or cast serious doubt on a locked architectural
decision, so nothing is escalated and the loop is not blocked.

Two defects *were* found in the acceptance criteria (C-1, C-2 below). Both were handled as factual
corrections rather than escalations, and the reasoning is recorded here so the decision is auditable
rather than silent:

- **C-1** corrects a parenthetical gloss that contradicts the same sentence's own operative clause.
  The clause ("`wc -l` count plus any final partial line counted once") is unambiguous, is consistent
  with AC-1 (empty file → 0 lines) and with the project's "like `wc`, **extended**" premise, and
  admits exactly one implementation. The parenthetical asserts a factual claim about POSIX `wc` that
  the POSIX specification directly refutes. Removing a demonstrably false factual claim, while
  preserving the criterion's operative rule byte-for-byte, changes no architectural decision.
- **C-2** corrects a *verification procedure*, not a *behaviour*. The behaviour AC-3 specifies
  (count codepoints) is unchanged and is correct; only the shell command used to independently
  confirm it needed a locale prefix to stop it silently reporting bytes.

If the human disagrees with either judgement, the fix is local: C-1 would change `lines` to plain
`text.count("\n")`, and C-2 would change one line in the test harness. Neither ripples.

---

## 12. MODERNIZATION CHANGELOG

Every change made in this Step 10 pass, each with a primary-source citation or an explicit
`[UNVERIFIED]` tag. Empirical results were produced on the confirmed target machine (Windows 11,
CPython 3.14.4, Git for Windows coreutils 8.32) and the exact commands are given so they are
reproducible.

### Corrections to the confirmed spec

- **C-1 — AC-2's POSIX claim removed as factually false.** The original criterion read: "reports the
  same line count as `wc -l noeol.txt` plus any final partial line counted once *(matches POSIX wc
  behavior on that file)*." The parenthetical is wrong. POSIX specifies `-l` as "write to the
  standard output the number of `<newline>` characters in each input file"
  ([POSIX.1-2024 `wc`](https://pubs.opengroup.org/onlinepubs/9799919799/utilities/wc.html)) — no
  partial-line addition. Confirmed empirically: on `a\nb`, `wc -l` → 1, while the criterion's own
  operative rule demands 2. **Applied:** the parenthetical is deleted; the operative rule is
  preserved verbatim and locked in 4.2 as
  `text.count("\n") + (1 if text and not text.endswith("\n") else 0)`; the divergence from `wc -l` is
  now documented explicitly in 4.2 and 4.4 rather than being an unexamined contradiction the
  execution agent would have had to guess about. Rationale for correcting rather than escalating: see
  section 11.
- **C-2 — every `wc` comparison must set `LC_ALL=C.UTF-8`.** AC-0 and AC-3 name bare `wc` as the
  oracle. On the confirmed target, `LANG` and `LC_ALL` are unset, and GNU documents `-m` as counting
  characters "as per the current locale"
  ([GNU coreutils manual — `wc` invocation](https://www.gnu.org/software/coreutils/manual/html_node/wc-invocation.html)).
  Verified: on `café naïve\n`, bare `wc -m` → **13** (bytes), `LC_ALL=C.UTF-8 wc -m` → **11**
  (codepoints). The unqualified oracle would have failed a correct implementation. **Applied:** 4.3
  is now normative for the harness; AC-0 and AC-3 carry the locale prefix; F9 in the failure analysis
  captures it.
- **C-3 — unique-word identity pinned as exact-string.** AC-4 does not state whether `"The"` and
  `"the"` are one word or two, or whether trailing punctuation is stripped. Left open, two
  implementations would both "pass" while producing different numbers. **Applied:** 4.2 locks
  exact-string identity — case-sensitive, punctuation retained, no Unicode normalization. This is
  the reading the boundary forces (case-folding and punctuation stripping are *locale/delimiter
  rules*, which section 2 excludes), not a preference. F11 guards it.

### Pinned current reality

- **C-4 — `open()` keyword arguments made mandatory and justified.** The PRD now requires
  `encoding="utf-8"`, `errors="strict"`, `newline=""` (4.1), each with a documented reason:
  `locale.getencoding()` is the documented default when `encoding` is omitted
  ([docs.python.org — `open()`](https://docs.python.org/3/library/functions.html#open)) and is
  **cp1252** on the target (verified), which silently turns AC-3's codepoint count into a byte count;
  and `newline=None` performs universal-newline translation (same source), verified to deflate the
  CRLF char count from 6 to 4. Also pinned: **`pathlib.Path.read_text()` is rejected** because its
  `newline` parameter only exists from Python 3.13
  ([docs.python.org — `Path.read_text`](https://docs.python.org/3/library/pathlib.html#pathlib.Path.read_text)),
  above the `>=3.10` floor.
- **C-5 — Windows directory-error divergence pinned.** Verified on the target: `open(".")` raises
  `PermissionError` (errno 13), not the `IsADirectoryError` (errno 21) a POSIX-trained implementation
  expects. **Applied:** 4.7 mandates an `is_dir()` precheck before `open()`; F6 guards it. Directly
  discharges the section 3 Windows watch-out. *(The POSIX-side errno 21 behaviour is stated from
  general knowledge and was not re-verified on a POSIX box in this pass — the load-bearing half, the
  Windows behaviour, was verified directly.)*
- **C-6 — dependency versions pinned from primary sources.** `requires-python = ">=3.10"`,
  `mypy==2.3.1`, `pytest==9.1.1`, zero runtime dependencies. Versions read from the PyPI JSON API
  ([mypy](https://pypi.org/pypi/mypy/json), [pytest](https://pypi.org/pypi/pytest/json)); the `>=3.10`
  floor is those two packages' own declared `Requires-Python`; support status cross-checked against
  the [Python devguide versions page](https://devguide.python.org/versions/) (3.14 current stable,
  3.9 EOL, 3.10 EOL October 2026).
- **C-7 — exit code 2 attributed, not invented.** Usage-error exit code 2 is argparse's documented
  behaviour ([docs.python.org — argparse](https://docs.python.org/3/library/argparse.html): "exit with
  a status code of 2"), so 4.7 reserves 2 for argparse and uses 1 for input errors rather than
  overriding argparse's default.
- **C-8 — packaging shape pinned.** `[project.scripts] tally = "tally.cli:main"` with a `setuptools`
  build backend, per the
  [pyproject.toml specification](https://packaging.python.org/en/latest/specifications/pyproject-toml/)
  ("The `[project.scripts]` table corresponds to the `console_scripts` group"). This is what makes the
  bare command `tally` in the acceptance criteria real on Windows.

### Enhancements applied within the locked architecture

- **C-9 — `str.splitlines()` explicitly banned.** It splits on `\v`, `\f`, `\x1c`–`\x1e`, `\x85`,
  `\u2028`, `\u2029` in addition to `\n` and `\r\n`, which is not the specified line definition. The
  ban is recorded in F3 so the review agent can grep for it. *(Documented in the [`str.splitlines`
  universal-newlines table](https://docs.python.org/3/library/stdtypes.html#str.splitlines).)*
- **C-10 — `str.split()` behaviour cited rather than assumed.** The runs-of-whitespace collapsing and
  the empty-string-returns-`[]` behaviour that AC-1 depends on are quoted verbatim from
  [docs.python.org — `str.split`](https://docs.python.org/3/library/stdtypes.html#str.split), and the
  Unicode whitespace definition from
  [`str.isspace`](https://docs.python.org/3/library/stdtypes.html#str.isspace) ("general category is
  `Zs` … or its bidirectional class is one of `WS`, `B`, or `S`"). The resulting divergence from the
  C locale is documented with a verified example (NBSP: `tally` 2 words, `LC_ALL=C.UTF-8 wc -w` 2,
  bare `wc -w` 1) rather than left as a lurking surprise.
- **C-11 — git `core.autocrlf` fixture hazard caught (F8).** Verified on the target:
  `core.autocrlf=true` is set in `C:/Program Files/Git/etc/gitconfig`. Committing `noeol.txt` and
  `crlf.txt` as tracked files would let git rewrite their line endings on checkout, silently
  disarming the two fixtures that exist specifically to catch F2 and F3. **Applied:** byte-exact
  fixtures must be generated at test runtime from `bytes` literals, plus a `.gitattributes` as
  belt-and-braces. This failure mode is invisible on Linux CI and would have been found only by a
  human noticing wrong numbers.
- **C-12 — stderr encoding hazard caught (F10).** `sys.stderr.encoding` is `cp1252` on the target
  (verified), so a non-ASCII path interpolated into an error message can raise `UnicodeEncodeError`
  *inside the error handler*, defeating AC-5's "not a stack trace" requirement.
  `sys.stderr.reconfigure(errors="backslashreplace")` is mandated; `TextIOWrapper.reconfigure` was
  verified present on the target interpreter.
- **C-13 — stdout line-terminator trap documented (4.6).** `print()` emits `\r\n` on Windows, so a
  raw-byte stdout assertion passes on Linux and fails on the confirmed target. Tests must compare
  parsed integers or split lines. Another direct discharge of the section 3 watch-out. *[UNVERIFIED
  as a doc citation]* — this follows from `open()`'s documented `newline=None` write-side translation
  applied to `sys.stdout`, and was not separately re-verified by capturing raw stdout bytes in this
  pass; the mitigation (do not assert raw bytes) is safe whether or not the translation occurs.
- **C-14 — worked-example table (4.4) added.** Eight fixtures with all four `tally` counts and all
  four `wc` counts, computed empirically rather than by hand, so the execution agent has exact
  expected values and the review agent has an oracle it does not have to derive.

### Categories with no changes

- **Model strings / LLM SDK versions: no changes — none exist.** `tally` has no LLM, model, prompt,
  or inference component in any execution path. `docs/modernization_log.md` is therefore N/A and
  intentionally absent; dependency pins live in section 10. This is stated rather than left silent so
  the review agent does not hunt for a missing file or a missing LLM call.
- **Research literature: no relevant literature found.** Constrained 2024–2026 searches were run
  against arXiv (via the `arxiv` MCP, categories `cs.CL`/`cs.SE`, queries covering Unicode text
  segmentation / word counting / codepoint semantics, and a broader `cs.SE` query on command-line
  text-processing correctness) and against the `paper-search` MCP's arXiv index (query on POSIX `wc`
  counting semantics and Unicode codepoint correctness). **All three searches returned zero results.**
  The two tools did not disagree — both returned empty. This is a null finding, and it is the
  expected one: `tally` is a small, well-understood text-counting utility with no novel algorithmic
  content. No papers are cited because none exist that bear on it, and none were manufactured to look
  thorough.
- **Architectural decisions: none overruled.** See section 11.
