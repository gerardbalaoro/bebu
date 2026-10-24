# Review Existing Tests

Pruning guidance draws on [Useless Test Pruner](https://drummerduck.com/skills/useless-test-pruner).

## Find Candidates

Inspect tautologies, mock-only assertions, ignored skips, unreviewed snapshots, duplicates, and tests without meaningful assertions.
Check implicit failure contracts before treating assertion-free tests as empty.
Use existing mutation results where available.

## Establish Evidence

For each candidate, name its intended contract.
Introduce a representative fault and run the relevant test, or explain why its structure cannot detect that fault.
Restore production code after every probe.

A surviving mutation reveals a gap. It does not prove that the test protects nothing else.
Matching coverage alone does not prove duplication.

## Repair or Remove

Strengthen weak tests that protect useful behavior.
Remove a test only after establishing that it adds no meaningful protection.
Remove fixtures, mocks, and snapshots only after checking that no remaining tests use them.
Preserve security and regression protection.
Investigate failing or flaky tests instead of deleting them to obtain a passing suite.

## Complete the Review

Run affected tests and the repository's required checks, including applicable integration or end-to-end checks.
Account for any loss of behavioral protection.
Report each removal with evidence and each repair with its protected contract.
