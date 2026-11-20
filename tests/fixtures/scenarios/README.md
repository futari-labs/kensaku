# Fixture scenarios

`FixtureExaPort` (src/exa/fixture-port.ts) replays one scenario file from this directory instead of calling Exa. It runs through the same guard as the live port, so every replayed call takes a budget token, and a cache or ledger passed in behaves as it does live.

## Replay rules

- A scenario is `<name>.json` with `name` (lowercase letters, digits, hyphens; must equal the file name), `description`, and `steps`.
- Step N answers the Nth Exa call. Replay is in order and never matches the request. A step whose `op` differs from the call (`answer` or `search`), or a call past the last step, fails as `upstream`.
- Each step has `op` (`answer` or `search`) and exactly one of `response` or `error`.
- `response.ref` is a path from the repository root to a frozen file under `evals/fixtures/`. The file's `response` is replayed. A ref outside `evals/fixtures/` is rejected.
- `response.candidates` (answer steps only) composes a synthetic candidate list with the frozen answer text: the frozen string becomes `answer.comparison`. Frozen live `/answer` replies with a plain string cannot be parsed without it.
- `error` is `{ kind, retryAfterMs?, message? }` with `kind` one of `EXA_FAILURE_KINDS` (src/exa/errors.ts). It is raised as an `ExaFailure`.
- `delayMs` waits before the step answers and is cancelled by the run's `AbortSignal`.

## Labels

Anything that did not come from a real Exa response is synthetic: composed `candidates` and every `error` step. Such a step must carry `label`, and the label must start with `SYNTHETIC` and say what is invented. The schema rejects a synthetic step without it. A step that only references a frozen file needs no label.

## Adding a scenario (JM-004, JM-005)

1. Copy the closest scenario, rename it, and set `name` to match the file.
2. Reference frozen files under `evals/fixtures/`. Never edit or add frozen files here.
3. Label every synthetic step.
4. Add a test that loads it with `FixtureExaPort.load("<name>")`. `tests/exa/fixture-port.test.ts` already checks every file in this directory for validity, labels, and existing refs.
