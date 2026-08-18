# PHASE_1_SPEC.md — tally

Built from `tally-PRD.md` (modernised, Step 10). Where this spec and the PRD appear to disagree, the
PRD's section 4 (Locked counting semantics) governs and the disagreement is a defect in this file.

---

## §0 Phase Plan Header

**Phase 1 of 1.**

The total phase count is **one**. This is a deliberate finding, not a placeholder. The confirmed
boundary describes a single-file CLI tool with four counts, one positional argument, no persistence,
no network, no configuration, and no third-party dependencies. There is no coherent way to split it
into a phase that ships something verifiable and a phase that finishes it: the acceptance criteria
are all-or-nothing (every one of them exercises the same read-count-print path), and a "Phase 1:
counting core / Phase 2: CLI wrapper" split would leave Phase 1 unable to satisfy a single
acceptance criterion, since all five are stated in terms of running the `tally` command.

Consequently: **there is no Phase 2.** When Phase 1 is approved, the build is complete. The review
agent should not generate a `PHASE_2_SPEC.md`; it should record the project as finished. Anything a
reviewer is tempted to defer to "Phase 2" is either in §9 (a permanent non-goal, most of it
boundary-protected) or is a Phase 1 defect being renamed.

---

## §1 Files Added or Modified

Eight files added, one modified. No other file in the repository may be touched — in particular
`loopr/`, `.loopr-state/`, `.loopr-answer.txt`, `.loopr-gate-response.json`,
`.loopr-judge-response.json`, and `prompts/` are **read-only for this phase**.

| # | Path | Action | Purpose | Approx. size |
| --- | --- | --- | --- | --- |
| 1 | `pyproject.toml` | **add** | Project metadata, `requires-python`, zero runtime deps, `[project.scripts]` entry point, `[tool.mypy]` strict config, `[tool.pytest.ini_options]`. | ~40 lines |
| 2 | `.gitattributes` | **add** | Neutralise `core.autocrlf=true` for the repo (PRD F8/C-11). | ~4 lines |
| 3 | `src/tally/__init__.py` | **add** | Package marker; re-exports `Counts` and `count_text`. Nothing else. | ~6 lines |
| 4 | `src/tally/counter.py` | **add** | The pure counting core. `Counts` dataclass + `count_text()`. No I/O. | ~45 lines |
| 5 | `src/tally/cli.py` | **add** | argparse, file reading, error mapping, output formatting, `main()`. | ~90 lines |
| 6 | `src/tally/__main__.py` | **add** | `python -m tally` support; delegates to `cli.main`. | ~5 lines |
| 7 | `tests/fixtures.py` | **add** | Byte-literal fixture definitions + a `tmp_path` writer. Runtime-generated, never committed as data files (PRD F8). | ~55 lines |
| 8 | `tests/test_counter.py` | **add** | Unit tests of the pure core against PRD §4.4. | ~90 lines |
| 9 | `tests/test_cli.py` | **add** | Subprocess/`main()`-level tests: exit codes, stderr text, output format. | ~110 lines |
| 10 | `README.md` | **modify** | Add usage, output format, exit codes, and the `LC_ALL=C.UTF-8 wc` verification note. Keep the existing title line. | +~35 lines |

`src/` layout is required (not flat `tally/`), so that tests import the *installed* package and the
console-script entry point is exercised as an end user would get it.

**No `docs/modernization_log.md`.** PRD §6 invariant 3 and §12 record why: there are no model strings
to pin. The review agent must not flag its absence.

---

## §2 Dependencies

**Runtime dependencies: none.** `[project].dependencies` MUST be an empty list. Only these standard
library modules may be imported anywhere in `src/tally/`:

`argparse`, `dataclasses`, `pathlib`, `sys`, and `typing` (if needed for annotations).

Any other import in `src/tally/` — stdlib or third-party — is a review finding. Specifically banned
by PRD §7.1: `re`, `locale`, `os`, `glob`, `fileinput`, `mmap`, `configparser`, `tomllib`,
`unicodedata`, `threading`, `multiprocessing`, `asyncio`, `concurrent.futures`, `itertools`.

**Development dependencies** (pinned exactly, PRD §10):

```
mypy==2.3.1
pytest==9.1.1
```

Declared under `[project.optional-dependencies] dev = [...]`. Tests may import `pytest` and stdlib
`subprocess`, `sys`, `pathlib` — the import restriction above applies to `src/tally/` only.

**`requires-python = ">=3.10"`** (PRD §10; floor is mypy's and pytest's own declared
`Requires-Python`). Verified dev interpreter is CPython 3.14.4 on Windows 11.

**Build system:**

```toml
[build-system]
requires = ["setuptools"]
build-backend = "setuptools.build_meta"
```

**Entry point:**

```toml
[project.scripts]
tally = "tally.cli:main"
```

`[tool.mypy]` MUST set `strict = true` and `python_version = "3.10"`, and MUST include the `tests`
directory in the checked paths. `mypy --strict src tests` must exit 0.

---

## §3 Schemas and Data Models

`tally` has no request/response model and no persisted data. Its equivalent of a schema layer is a
single frozen dataclass. This is the *only* data structure in the project; the four counts never
travel as a `dict`, a `tuple`, a `NamedTuple` of untyped fields, or four loose `int` returns
(PRD §6 invariant 1).

### 3.1 `Counts` — `src/tally/counter.py`

```python
@dataclasses.dataclass(frozen=True, slots=True)
class Counts:
    lines: int
    words: int
    chars: int
    unique_words: int
```

| field | type | meaning | invariant |
| --- | --- | --- | --- |
| `lines` | `int` | `\n` count plus the trailing partial line. PRD §4.2. | `>= 0` |
| `words` | `int` | Whitespace-delimited token count. PRD §4.2. | `>= 0` |
| `chars` | `int` | Unicode **codepoint** count, including `\r` and `\n`. PRD §4.2. | `>= 0` |
| `unique_words` | `int` | Distinct token count, exact-string identity. PRD §4.2. | `0 <= unique_words <= words` |

Requirements on the dataclass, all checkable by grep:

- `frozen=True` — the counts are a computed result, never mutated after construction.
- `slots=True` — permitted from Python 3.10, which is the pinned floor.
- **No default values.** All four fields are required positionally/by keyword at construction, so a
  forgotten field is a `TypeError` at construction rather than a silent zero.
- **No methods** beyond what the decorator generates. No `__str__`, no `to_dict()`, no `total`
  property. Formatting lives in `cli.py` (§6.6), keeping `counter.py` pure.
- The field is named `unique_words`, **not** `unique` — `unique` is the *output label* (§4.2 of this
  spec), and conflating the two invites an output-format drift.

### 3.2 Type-annotation requirements

Every function in every added file — including test functions and fixtures — carries full parameter
and return annotations. `-> None` is written explicitly on procedures. `mypy --strict` treats a
missing annotation as an error (`--disallow-untyped-defs`, `--disallow-incomplete-defs`), so this is
mechanically enforced rather than reviewed by eye.

No `Any` anywhere. No `# type: ignore` without an adjacent comment giving the reason.

---

## §4 CLI Surface

`tally` has no HTTP routes. This section is its equivalent: the complete, exhaustive contract of the
command line.

### 4.1 Invocation forms

| form | availability |
| --- | --- |
| `tally <FILE>` | Console script installed by `[project.scripts]`. On Windows, pip generates `Scripts\tally.exe`. This is the form the acceptance criteria use. |
| `python -m tally <FILE>` | Via `src/tally/__main__.py`. Behaviourally identical — same parser, same exit codes, same output. |

### 4.2 Arguments

| name | kind | required | `nargs` | type | metavar | help text |
| --- | --- | --- | --- | --- | --- | --- |
| `path` | positional | yes | **default (exactly one)** | `str` | `FILE` | `path to the text file to count` |
| `-h`, `--help` | optional flag | no | — | — | — | argparse's automatic help. |

That is the entire surface. There are **no other flags**. In particular there is no `--version`, no
`-l/-w/-m/-c` selector flags, and no `--json`.

Hard requirements on the parser, each a grep target:

- `argparse.ArgumentParser(prog="tally", description=<one line>)`.
- The positional's `type` is **`str`** (or omitted, which defaults to `str`). It MUST NOT be
  `argparse.FileType(...)` — `FileType` opens the file with the wrong encoding/newline settings *and*
  silently accepts `-` as stdin, which is a PRD §7 boundary violation.
- `nargs` MUST NOT be specified on the positional. Leaving it at the default is what makes "zero
  arguments" and "two arguments" both usage errors, mechanically enforcing the single-file boundary.
- `exit_on_error` is left at its default (`True`), so argparse's documented exit-2 behaviour applies.

### 4.3 Success output

Exit code `0`. Exactly four lines to **stdout**, in this order, nothing else (PRD §4.6):

```
lines: <int>
words: <int>
chars: <int>
unique: <int>
```

Lowercase label, one colon, one space, decimal integer, no padding, no separators, no sign. The
input path is not echoed. Nothing is written to stderr on success.

Note the label is `unique`, while the dataclass field is `unique_words` (§3.1).

### 4.4 Exit codes

| code | meaning | stdout | stderr |
| --- | --- | --- | --- |
| `0` | Success. | four lines per §4.3 | empty |
| `1` | Input error (see §4.5). | **empty** | exactly one line |
| `2` | Usage error: zero arguments, two or more arguments, or an unknown flag. Produced by argparse itself; do not intercept or re-map it. | empty | argparse's usage message |

`main()` returns `int` and MUST NOT call `sys.exit()` itself for the 0/1 cases — it returns the code,
and the entry point (`if __name__ == "__main__"` in `__main__.py`, and the console script via
`[project.scripts]`) propagates it. This keeps `main()` directly callable from tests without
`pytest.raises(SystemExit)` gymnastics. Argparse's exit-2 path does raise `SystemExit`; tests for it
use `pytest.raises(SystemExit)` or a subprocess.

### 4.5 Error conditions (exit code 1)

Exact messages, one line each, written to stderr. `<path>` is the path string **exactly as the user
typed it** — not resolved, not absolutised, not normalised.

| condition | detection | exact stderr line |
| --- | --- | --- |
| Path does not exist | `FileNotFoundError` from `open()` | `tally: <path>: no such file or directory` |
| Path is a directory | **`Path(path).is_dir()` precheck, before `open()`** | `tally: <path>: is a directory` |
| Permission denied | `PermissionError` from `open()` (after the `is_dir()` precheck has already excluded directories) | `tally: <path>: permission denied` |
| Not valid UTF-8 | `UnicodeDecodeError` from the read | `tally: <path>: is not valid UTF-8 text` |
| Any other `OSError` | `OSError` catch-all | `tally: <path>: <e.strerror lowercased, or str(e) if strerror is None>` |

Absolute requirements:

- **No traceback ever reaches stderr for these conditions.** The substring `Traceback` must not
  appear in stderr for any input in this table.
- **Nothing is written to stdout** when exiting 1. In particular, do not print partial counts.
- The `is_dir()` precheck ordering is not stylistic. On the confirmed Windows target, `open()` on a
  directory raises `PermissionError` (errno 13), not `IsADirectoryError` (errno 21) — verified in PRD
  §12/C-5. Detecting the directory case from the exception type produces the wrong message on the one
  platform this project is actually built and run on.
- **No bare `except Exception:`** and no `except:`. Catch `OSError` and `UnicodeDecodeError`
  specifically. A `KeyboardInterrupt` or a genuine bug must still surface.

---

## §5 Migrations

**N/A.** `tally` has no database, no persisted schema, no on-disk state of its own, no cache, and no
config file (the last of those is boundary-forbidden, PRD §7). There is nothing to migrate, and no
migration tooling is to be added. This section is stated rather than omitted so the review agent
records it as deliberately empty rather than missing.

---

## §6 Implementation Logic Flow

Function by function, in dependency order. **The deterministic anchors are named explicitly** — they
are the three constants in §6.3 and the four formulas in §6.4. Every number `tally` prints traces to
one of those seven things, and to nothing else.

### 6.1 `src/tally/__init__.py`

Declares the package and re-exports the two public names:

```python
from tally.counter import Counts, count_text
__all__ = ["Counts", "count_text"]
```

Nothing else. No version string (there is no `--version`), no side effects, no imports from `cli.py`
(that would drag `argparse` into every import of the counting core).

### 6.2 `src/tally/counter.py` — module contract

**Purity is an invariant, not a preference.** This module imports only `dataclasses`. It must not
import `os`, `sys`, `pathlib`, `io`, `argparse`, or `locale`. It touches no filesystem, no
environment, no clock, no randomness. Given the same `str`, it returns an equal `Counts` on every
platform and every run. This is what makes PRD §4.4's worked-example table exhaustively testable
without a filesystem, and it is the first thing the review agent should verify.

### 6.3 Deterministic anchors — the read constants (in `cli.py`)

Three module-level constants, referenced by name at the single call site. They exist as named
constants specifically so the review agent can grep for them rather than eyeball an `open()` call:

```python
_ENCODING: Final[str] = "utf-8"
_ERRORS: Final[str] = "strict"
_NEWLINE: Final[str] = ""
```

Rationale for each is PRD §4.1 and is not restated here. What matters for review: **all three must
be passed at the one and only `open()` call in the project.** Omitting any one of them is a silent
correctness failure (PRD F1, F2, F7), not a style issue.

### 6.4 `count_text(text: str) -> Counts`

The single deterministic counting anchor. Signature:

```python
def count_text(text: str) -> Counts: ...
```

Logic, in order:

1. Split once: `tokens = text.split()` — bare `str.split()`, **no arguments**. Bind the result to a
   local and reuse it for both `words` and `unique_words`. Splitting twice is not a correctness bug
   but is a review finding (it makes the two counts able to drift if one call is later edited).
2. `lines` — anchor formula, exactly:
   `text.count("\n") + (1 if text and not text.endswith("\n") else 0)`
   The `text and` guard is what makes the empty file report `0` rather than `1` (PRD F3, AC-1).
3. `words` — anchor formula: `len(tokens)`.
4. `chars` — anchor formula: `len(text)`. This counts Unicode codepoints, and counts `\r` and `\n`
   as one character each. It is correct **only because** the caller read with `newline=""`
   (§6.3); with universal-newline translation the same expression silently under-counts CRLF files
   (PRD F2).
5. `unique_words` — anchor formula: `len(set(tokens))`. No `.lower()`, no `.casefold()`, no
   punctuation stripping, no `unicodedata.normalize` (PRD F11, C-3).
6. Return `Counts(lines=..., words=..., chars=..., unique_words=...)`, constructed with **keyword
   arguments** so a field-order mistake is impossible.

Banned in this function, each a grep target: `str.splitlines()` (PRD C-9 — it also splits on `\v`,
`\f`, `\x1c`–`\x1e`, `\x85`, `U+2028`, `U+2029`), `re.split`, `re.findall`, `split(" ")`,
`split("\n")`, any loop over characters, any accumulator counting bytes.

`count_text("")` must return `Counts(0, 0, 0, 0)` — the empty-string case is a normal input, not an
error, and must not be special-cased with an early return that could drift from the formulas.

### 6.5 `read_source_text(path: str) -> str` (in `cli.py`)

Signature:

```python
def read_source_text(path: str) -> str: ...
```

Logic, in order:

1. **`if Path(path).is_dir():` raise `IsADirectoryError`** (or return a sentinel the caller maps —
   but raising is preferred, since it keeps `main()`'s handling uniform). This precheck runs *first*,
   before any `open()`. Rationale: PRD C-5 / F6, the Windows `PermissionError`-vs-`IsADirectoryError`
   divergence.
   - `Path(path).is_dir()` returns `False` rather than raising for a non-existent path, so the
     not-found case falls through to `open()` naturally and raises `FileNotFoundError` there. Do not
     add an `exists()` precheck — it introduces a TOCTOU gap and a second code path for the same
     outcome.
2. Open and read in one expression, with all three anchors:
   `open(path, mode="r", encoding=_ENCODING, errors=_ERRORS, newline=_NEWLINE)` used as a context
   manager, returning `.read()`.
3. Let `OSError` and `UnicodeDecodeError` propagate to `main()`. This function does **not** catch,
   log, or print. Exactly one place in the project maps exceptions to messages and exit codes, and it
   is `main()`.

The whole file is read into memory in one call. That is intended, not a defect: PRD §7 puts
performance work for files beyond a few tens of megabytes permanently out of scope, and a chunked or
streamed read would be a boundary violation.

### 6.6 `format_counts(counts: Counts) -> str` (in `cli.py`)

Signature:

```python
def format_counts(counts: Counts) -> str: ...
```

Returns the four-line block of §4.3 as a single `str` with `\n` separators and **no trailing
newline** (the trailing newline comes from `print()`). Pure — no printing, no `sys` access — so the
exact output format is unit-testable without capturing stdout.

The four labels in order: `lines`, `words`, `chars`, `unique`. Note again that the fourth label is
`unique` while the field is `unique_words`.

### 6.7 `build_parser() -> argparse.ArgumentParser` (in `cli.py`)

Signature:

```python
def build_parser() -> argparse.ArgumentParser: ...
```

Constructs and returns the parser per §4.2. Returns it rather than parsing, so tests can inspect the
parser and exercise it without a subprocess. Adds exactly one positional and relies on argparse's
automatic `-h/--help`.

### 6.8 `emit_error(message: str) -> None` (in `cli.py`)

Signature:

```python
def emit_error(message: str) -> None: ...
```

Writes `f"tally: {message}"` plus a newline to `sys.stderr`. This function **must not be able to
raise**. Rationale: PRD C-12 / F10 — `sys.stderr.encoding` is `cp1252` on the confirmed target, so a
non-ASCII path interpolated into the message can raise `UnicodeEncodeError` inside the error handler
and produce the traceback AC-5 forbids.

Mitigation (either is acceptable; the first is preferred):

- `main()` calls `sys.stderr.reconfigure(errors="backslashreplace")` once, before any other work.
  `TextIOWrapper.reconfigure` was verified present on the target interpreter.
- or `emit_error` writes inside a `try` and, on `UnicodeEncodeError`, retries with an
  ASCII-sanitised message.

### 6.9 `main(argv: Sequence[str] | None = None) -> int` (in `cli.py`)

Signature:

```python
def main(argv: Sequence[str] | None = None) -> int: ...
```

The `argv` parameter defaults to `None` (meaning "use `sys.argv[1:]`", argparse's own default) and
exists so tests can drive `main()` in-process. It must be forwarded to `parse_args(argv)`.

Logic, in order:

1. Reconfigure stderr error handling (§6.8).
2. `args = build_parser().parse_args(argv)`. A usage error exits 2 here via argparse; `main()` does
   nothing to catch or alter that.
3. `try: text = read_source_text(args.path)` with these handlers, **in this order** (`FileNotFoundError`,
   `PermissionError` and `IsADirectoryError` are all `OSError` subclasses, so the specific handlers
   must precede the general one):
   - `except IsADirectoryError:` → `emit_error(f"{args.path}: is a directory")` → `return 1`
   - `except FileNotFoundError:` → `emit_error(f"{args.path}: no such file or directory")` → `return 1`
   - `except PermissionError:` → `emit_error(f"{args.path}: permission denied")` → `return 1`
   - `except UnicodeDecodeError:` → `emit_error(f"{args.path}: is not valid UTF-8 text")` → `return 1`
   - `except OSError as exc:` → `emit_error(f"{args.path}: {(exc.strerror or str(exc)).lower()}")` → `return 1`
4. `counts = count_text(text)`.
5. `print(format_counts(counts))`.
6. `return 0`.

No branch may write to stdout before step 5, and no branch may reach step 5 after an error.

### 6.10 `src/tally/__main__.py`

```python
from tally.cli import main
if __name__ == "__main__":
    raise SystemExit(main())
```

Nothing else. No duplicated argument parsing, no duplicated error handling.

### 6.11 `tests/fixtures.py`

Defines the eight fixtures of PRD §4.4 as **`bytes` literals** plus their expected four counts, and
exposes a helper that writes one into a `tmp_path` and returns the `Path`.

Required shape:

- A typed record per fixture (a frozen dataclass or a `NamedTuple`, fully annotated) carrying:
  `name: str`, `data: bytes`, `lines: int`, `words: int`, `chars: int`, `unique_words: int`.
- A module-level sequence of all eight, with the values taken **verbatim from PRD §4.4** — the
  execution agent must not recompute them, and must not "fix" one that appears wrong. If a value in
  PRD §4.4 genuinely disagrees with a correct implementation, that is an escalation, not an edit.
- `def write_fixture(tmp_path: Path, fixture: Fixture) -> Path:` — writes with
  `path.write_bytes(fixture.data)`. **`write_bytes`, never `write_text`**: `write_text` would apply
  encoding and newline translation and destroy the very byte sequences (`a\nb`, `a\r\nb\r\n`,
  `x\ry\r`) the fixtures exist to test.

**These fixtures are never committed as data files.** PRD F8/C-11: `core.autocrlf=true` is set
globally on the target machine, so a committed `noeol.txt` or `crlf.txt` would have its line endings
rewritten on checkout and would silently stop testing anything. Generating them at runtime from byte
literals makes them immune.

The eight fixtures, with their exact byte content (expected counts are in PRD §4.4 and §8 below):

| name | bytes |
| --- | --- |
| `empty` | `b""` |
| `noeol` | `b"a\nb"` |
| `unicode` | `"café naïve\n".encode("utf-8")` |
| `crlf` | `b"a\r\nb\r\n"` |
| `cronly` | `b"x\ry\r"` |
| `nbsp` | `"a\u00a0b\n".encode("utf-8")` (U+00A0 NO-BREAK SPACE, written as an escape so it survives copy-paste) |
| `tabs` | `b"  a\t\tb  \n\n\nc  \n"` |
| `repeats` | the five lines of PRD §4.5, LF endings, trailing newline (118 bytes) |

Plus two non-fixture byte blobs used only by the CLI error tests: `b"abc\xff\xfe def"` (invalid
UTF-8) and a fixture asserting `unique` case-sensitivity, `b"The the dog dog.\n"` → `unique == 4`.

### 6.12 `tests/test_counter.py`

Unit tests of `count_text` only. No filesystem, no subprocess — the fixtures' `bytes` are decoded
in-test with `data.decode("utf-8")` (which performs no newline translation, matching §6.3) and passed
straight to `count_text`.

Must include, at minimum:

- One parametrised test over all eight fixtures asserting all four counts equal PRD §4.4.
- `count_text("") == Counts(0, 0, 0, 0)`.
- The case-sensitivity test: `count_text("The the dog dog.\n").unique_words == 4`.
- A test asserting `Counts` is frozen (assigning to a field raises `FrozenInstanceError`).
- A test asserting `unique_words <= words` across all fixtures.

### 6.13 `tests/test_cli.py`

End-to-end tests. Both drive-modes are exercised: `main([...])` in-process for speed and precise
exception control, and at least one `subprocess.run([sys.executable, "-m", "tally", ...])` test to
prove the real process boundary, exit code propagation, and `__main__.py` wiring work.

Must include, at minimum:

- Success path on `repeats`: exit `0`, stdout parses to `lines: 5 / words: 24 / chars: 118 /
  unique: 20`, stderr empty.
- Output-format test: stdout, after splitting into lines, is exactly four entries with exactly the
  labels `lines`, `words`, `chars`, `unique` in that order. **Must not assert raw-byte equality of
  the stdout stream** (PRD C-13 / §4.6): `print()` emits `\r\n` on the target platform, so a raw
  comparison passes on Linux and fails on Windows.
- Missing path: exit `1`, stdout empty, stderr is exactly
  `tally: <path>: no such file or directory`, and `"Traceback" not in stderr`.
- Directory path (`tmp_path` itself): exit `1`, stderr exactly `tally: <path>: is a directory`.
- Invalid UTF-8 (`b"abc\xff\xfe def"`): exit `1`, stderr exactly
  `tally: <path>: is not valid UTF-8 text`.
- Zero arguments: exit `2`. Two arguments: exit `2`. (Via subprocess, or `pytest.raises(SystemExit)`
  asserting `.code == 2`.)
- Non-ASCII filename: exit `1` with the not-found message and no traceback (PRD F10 regression guard).

---

## §7 Failure-Mode Guards

One row per anticipated Phase 1 failure mode from PRD §8. "What the review agent checks" is written
to be mechanically actionable — a grep or a named test — not a judgement call.

| PRD ref | Failure mode | Guard in the implementation | What the review agent checks |
| --- | --- | --- | --- |
| **F1** | Byte count instead of codepoint count | `_ENCODING = "utf-8"` passed at the single `open()` (§6.3, §6.5) | Grep `src/tally/` for `open(` — there must be **exactly one** call, and it must pass `encoding=`. Grep for `"rb"`, `read_bytes`, `getsize`, `os.stat` → must be absent. Test: `unicode` fixture asserts `chars == 11`, not 13. |
| **F2** | CRLF translation deflating `chars` | `_NEWLINE = ""` passed at the same `open()` | The one `open()` call passes `newline=`. Grep for `Path(...).read_text(` → must be absent from `src/tally/`. Test: `crlf` fixture asserts `chars == 6`, not 4. |
| **F3** | Off-by-one on the trailing line | The exact formula in §6.4 step 2, including the `text and` guard | Grep `src/tally/` for `splitlines` → must be absent. Read `count_text`: the `lines` expression must match §6.4 character-for-character in substance. Tests: `empty`→0, `noeol`→2, `crlf`→2, `cronly`→1. All four must be present; `empty`→0 is the one that catches a naive `count("\n") + 1`. |
| **F4** | Whitespace-splitting edge cases | Bare `text.split()` with no arguments (§6.4 step 1) | Grep for `split(" ")`, `split('\n')`, `re.split`, `re.findall` → must be absent. Test: `tabs` fixture asserts `words == 3` and `unique_words == 3`. |
| **F5** | Path-not-found handled as a crash | Specific `except` clauses in `main()` (§6.9) returning 1 after `emit_error` | Grep for `except Exception`, `except:`, `raise SystemExit` inside `cli.py` (outside `__main__.py`) → must be absent. Test asserts exit 1, exact stderr line, empty stdout, and `"Traceback" not in stderr`. |
| **F6** | Directory misreported on Windows | `Path(path).is_dir()` precheck **before** `open()` (§6.5 step 1) | Read `read_source_text`: the `is_dir()` check must textually precede the `open()` call. Test: passing `tmp_path` yields exactly `tally: <path>: is a directory`, not `permission denied`. This test must pass **on Windows**, which is the confirmed target. |
| **F7** | Silent corruption on non-UTF-8 input | `_ERRORS = "strict"` (§6.3) plus the `UnicodeDecodeError` handler (§6.9) | Grep for `errors="replace"`, `errors="ignore"`, `errors="surrogateescape"` → must be absent. Test: `b"abc\xff\xfe def"` yields exit 1 and the exact `is not valid UTF-8 text` message. |
| **F8** | Test fixtures mangled by git | Fixtures generated at runtime from `bytes` literals via `write_bytes` (§6.11); `.gitattributes` as backup | `git ls-files` must show **no** `tests/fixtures/` data directory and no committed `.txt` fixture files. Grep `tests/` for `write_text(` used on a fixture → must be `write_bytes`. `.gitattributes` must exist and mark fixture-ish paths `-text`. |
| **F9** | `wc` oracle disagreeing under the C locale | Expected values are Python-computed constants taken from PRD §4.4; `wc` is a manual secondary cross-check only | The test suite must **not** shell out to `wc` (grep `tests/` for `"wc"` / `subprocess` invoking `wc` → must be absent; the suite must be self-contained and runnable where `wc` does not exist). `README.md` must document the `LC_ALL=C.UTF-8 wc` requirement for anyone doing the manual cross-check. |
| **F10** | `UnicodeEncodeError` while reporting an error | `sys.stderr.reconfigure(errors="backslashreplace")` at the top of `main()`, or a non-raising `emit_error` (§6.8) | Grep `cli.py` for `reconfigure` or a `try`/`except UnicodeEncodeError` in `emit_error` → one must be present. Test: non-ASCII filename yields exit 1 and no traceback. |
| **F11** | Unique-word count quietly normalized | `len(set(tokens))` with no transformation (§6.4 step 5) | Grep `src/tally/` for `.lower()`, `.casefold()`, `unicodedata`, `strip(`, `punctuation`, `translate(` → must be absent. Test: `"The the dog dog.\n"` yields `unique_words == 4`. |

### 7.1 Boundary-violation halt list

Reproduced from PRD §7.1 as the review agent's grep checklist. **Any hit in `src/tally/` is a HALT,
not a comment.**

`sys.stdin` · `argparse.FileType` · `fileinput` · `nargs=` on the positional · `glob` · `iglob` ·
`Path.glob` · `Path.rglob` · `os.walk` · `os.scandir` · `os.listdir` · `configparser` · `tomllib` ·
`os.environ` · `.tallyrc` · `tally.toml` · `--delimiter` · `--sep` · `--separator` · `--locale` ·
`--split` · `--ignore-case` · `--normalize` · `locale.setlocale` · `locale.getlocale` · `re.split` ·
`re.findall` · `unicodedata.normalize` · `mmap` · `threading` · `multiprocessing` ·
`concurrent.futures` · `asyncio` · a chunked `f.read(<n>)` loop · any non-stdlib import · any
non-empty `[project].dependencies`.

Also a HALT: a `-` sentinel treated as a special path anywhere in `cli.py`.

### 7.2 Commit-hygiene guard

PRD §6 invariant 5. The phase commit message must be plain and factual, matching the repo's existing
`init` convention. **No `Co-Authored-By:` trailer, no "Generated with", no AI attribution of any
kind.** The review agent checks `git log -1 --format=%B` for `Co-Authored-By`, `Claude`, `AI`,
`Generated with` → all must be absent.

---

## §8 Phase Acceptance Criteria

Phase 1 is approved only when **every** item below passes. These are the five confirmed criteria
from `tally-PRD.md` §9 turned into concrete, runnable checks, plus the mechanical gates.

### 8.1 The five confirmed acceptance criteria, as test cases

| # | Criterion | Concrete test |
| --- | --- | --- |
| **AC-1** | Empty file → all four counts 0 | Write `b""`; `tally <f>` exits 0 and prints `lines: 0`, `words: 0`, `chars: 0`, `unique: 0`. |
| **AC-2** | No trailing newline → newlines + trailing partial line | Write `b"a\nb"`; `tally <f>` prints `lines: 2`. (`wc -l` reports 1; the divergence is intended — PRD C-1.) Also `words: 2`, `chars: 3`, `unique: 2`. |
| **AC-3** | Multi-byte UTF-8 → codepoints, not bytes | Write `"café naïve\n".encode("utf-8")` (13 bytes); `tally <f>` prints `chars: 11`. Manual cross-check, documented in README: `LC_ALL=C.UTF-8 wc -m <f>` → 11. Bare `wc -m` → 13 and must **not** be used (PRD C-2). |
| **AC-4** | "the" ×5, 20 distinct → `words: 24`, `unique: 20` | Write the exact fixture of PRD §4.5; `tally <f>` prints `lines: 5`, `words: 24`, `chars: 118`, `unique: 20`. |
| **AC-5** | Missing path → non-zero exit, stderr message, no stack trace | `tally nonexistent.txt` exits **1**, stdout empty, stderr exactly `tally: nonexistent.txt: no such file or directory`, and `"Traceback" not in stderr`. |

### 8.2 The full worked-example table

All eight fixtures of PRD §4.4 pass with their exact four counts:

| fixture | lines | words | chars | unique |
| --- | ---: | ---: | ---: | ---: |
| `empty` | 0 | 0 | 0 | 0 |
| `noeol` | 2 | 2 | 3 | 2 |
| `unicode` | 1 | 2 | 11 | 2 |
| `crlf` | 2 | 2 | 6 | 2 |
| `cronly` | 1 | 2 | 4 | 2 |
| `nbsp` | 1 | 2 | 4 | 2 |
| `tabs` | 4 | 3 | 15 | 3 |
| `repeats` | 5 | 24 | 118 | 20 |

### 8.3 Mechanical gates

1. `python -m pytest` exits 0 with **zero failures and zero errors**, run **on Windows** (the
   confirmed target). Every test in §6.12 and §6.13 is present.
2. `python -m mypy --strict src tests` exits 0 with zero errors. No `# type: ignore` without an
   adjacent justifying comment.
3. `python -m pip install -e .` succeeds, and the bare command `tally --help` then works from a
   fresh shell — proving the `[project.scripts]` entry point, which is what makes the literal
   `tally <file>` invocation in the acceptance criteria real.
4. `python -m tally <file>` produces byte-identical stdout to `tally <file>` for the `repeats`
   fixture.
5. Every grep target in §7 and §7.1 returns no hits in `src/tally/`.
6. `git ls-files` shows no committed fixture data files (§7, F8).
7. The commit message is neutral (§7.2).

### 8.4 Definition of done

All of §8.1, §8.2 and §8.3 pass. At that point the project is complete — see §0, there is no
Phase 2.

---

## §9 Explicit NON-GOALS

### 9.1 Permanently out — boundary-protected (PRD §7)

These are not deferred. They are **never** built, and proposing them in review is itself the error:

- Custom delimiters, configurable word-splitting, locale-aware splitting, a config file, or any
  environment-variable configuration.
- Directory, recursive, multi-file, or glob input. Multi-file aggregation or a totals line.
- stdin, streaming, or `-`-as-stdin. Any chunked or lazy read.
- Performance work for files beyond a few tens of megabytes: `mmap`, threading, multiprocessing,
  incremental counting, or benchmarking infrastructure.

### 9.2 Out of Phase 1 — and, since there is no Phase 2, out of this build

Not boundary-forbidden, but deliberately not built. Adding any of them is scope creep, not
initiative:

- `--version`, `--json`, `--quiet`, `-l/-w/-m/-c` selector flags, colourised output, or any output
  format other than the exact four lines of §4.3.
- Echoing the input path in the output, or a `wc`-compatible single-line output mode.
- Grapheme-cluster counting, display-width/column counting, byte counting, or a `--bytes` flag. PRD
  §4.2 fixes `chars` as codepoints; the others are different measurements, not options.
- Case-insensitive or punctuation-stripped unique-word counting, stop-word filtering, or a
  most-common-words report.
- Encoding auto-detection, a `--encoding` flag, BOM stripping, or any encoding other than strict
  UTF-8. (Note in particular: a UTF-8 BOM is *not* stripped — U+FEFF is a codepoint and counts as one
  character, which is also what `wc -m` reports.)
- CI configuration, packaging to PyPI, a changelog, a logging framework, or a plugin system.
- Shelling out to `wc` from the test suite (§7, F9) — the suite must be self-contained.
- `docs/modernization_log.md` (PRD §6 invariant 3 — N/A, no model strings exist).
