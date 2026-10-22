# Testing Rules

## Overview

A test exists to catch a specific break. Two principles govern everything here:

```
1. Every test names the break it catches
2. Every test exercises the real thing
```

Write the test first. Observe its failure against real code. Then implement the behavior. Use a mock
only for a dependency that is slow or external.

## Principle 1: Name the Error

Before you write a test, name a production error that makes the test fail. Distinguish that error
from an intentional design decision.

Tests detect wrong branches, missing side effects, wrong arguments, boundary errors, and broken
contracts.

Derive expectations independently. Use literals and fixtures that you inspect by hand. Prefer
table-driven tests with literal `want` values.

If the code under test computes the expected value, the comparison can pass with the same error on
both sides.

```typescript
// ❌ Mirror assertion: the same builder computes both sides — always true
const expected = buildSearchQuery({ tag: "urgent" });
expect(buildSearchQuery({ tag: "urgent" })).toBe(expected);

// ✅ Hand-derived literal
expect(buildSearchQuery({ tag: "urgent" })).toBe('tag:"urgent"');
```

Test behavior that depends on a decision. Avoid assertions that only repeat a constant, message, or
private structure. For example, a retry test must detect a sixth attempt after five retries. The
assertion `expect(MAX_RETRIES).toBe(5)` does not detect that error.

Run scripts with controlled inputs. Assert the outputs, side effects, or exit codes. For agent
instructions, observe the behavior of the agent that reads them (superpowers:writing-skills). Keep
tests that only search source text out of the suite. Prose for humans does not require tests.

Test the contracts at your code boundaries: registered routes, emitted queries, and generated
payloads. Leave tests for upstream mechanics to their maintainers. If upstream behavior contradicts
an assumption, add one narrow characterization test that names that assumption.

Give constructors, getters, constants, and forwarding code tests only for validation, normalization,
defaults, derived values, rules, or side effects. Otherwise, assert the first result that the
consumer can observe.

### Before You Write a Test

```
BEFORE writing the test body:
  Name the production change that would make this test fail.

  Cannot name one            → redesign around an observable behavior
  "The source text changed"  → run the artifact and assert its effects
  Only intentional decisions → change detector; test the behavior
                               that depends on the decision

  Confirm the expected value is derived without the code under test.
  IF it reuses the code's logic or helpers:
    Replace it with a literal or hand-checked fixture
```

## Principle 2: Exercise Real Behavior

Assert the behavior of the real component. If an assertion only detects the mock, use the real
component or delete the assertion.

```typescript
// ✅ Real behavior
expect(screen.getByRole("navigation")).toBeInTheDocument();

// ❌ Mock existence
expect(screen.getByTestId("sidebar-mock")).toBeInTheDocument();
```

Before you replace a method, identify all its side effects. Mock only the slow or external
operation. Keep the behavior that the test depends on real. If you are unsure, run the test against
the real implementation first.

```typescript
// ❌ The mock swallows the config write that duplicate detection reads
vi.mock("ToolCatalog", () => ({
  discoverAndCacheTools: vi.fn().mockResolvedValue(undefined),
}));

// ✅ Mock only the slow server startup; the config write stays real
vi.mock("MCPServerManager");
```

If arguments, call counts, or order are part of the contract, assert them. Give each branch
(success, error, malformed) its own fixture or spy. A wrong branch must not satisfy the expectation.

Include all documented fields in mock data. A partial mock can hide errors in downstream code that
reads an absent field.

Put cleanup methods that only tests need in test utilities. Keep production methods limited to
resources that the class owns.

If mock preparation exceeds the test logic, use an integration test with real components. If mocks
lack real methods or mock changes break the tests, use real components.

### Before You Add a Mock

```
BEFORE adding a mock or test helper:
  List the real method's side effects; keep the ones the test
  depends on real — mock the slow/external level below them.

  Mock responses mirror the complete real structure.

  A method only tests call lives in test utilities, not production.

  About to assert on the mock itself?
    Unmock it or delete the assertion.
```

## Complete the Implementation with Its Tests

Complete the TDD cycle: observe a test failure, implement the behavior, then refactor. Ship only
tests that the behavior needs. Keep tests for trivial code or human prose out of the suite. A
process requirement alone does not justify a test.

## The Mutation Check

Before you finish, consider realistic changes that introduce errors in production code. Make sure
that at least one test fails for each change:

- Wrong constant or argument
- Wrong branch handler
- Missing state change or side effect
- Empty or default return
- Missing validation for zero, empty, nil, unauthorized, or malformed input

A mutation that no test detects indicates an unprotected behavior or an assertion that proves
nothing.

## Quick Reference

| When you...                     | Do                                                             |
| ------------------------------- | -------------------------------------------------------------- |
| Write a test                    | Name the error that the test detects                           |
| Build an expected value         | Derive it independently from the code under test               |
| Test a script or document       | Run the script or observe the behavior of its consumer         |
| Consider a dependency test      | Test your boundary contract                                    |
| Assert on a mocked element      | Use the real component                                         |
| Mock a method                   | Identify its side effects. Mock the slow or external operation |
| Build a mock response           | Mirror the real structure completely                           |
| Add cleanup that only tests use | Put it in test utilities                                       |
| Find complex mock preparation   | Use an integration test with real components                   |
| Finish a test file              | Run the mutation check                                         |

## Warning Signs

- The input and assertion share the same object, so equality is certain
- The test can fail only through a panic, crash, or missing selector
- The test fails on every intentional change, never on accidental breakage
- Expected values are hidden behind loops, builders, or helpers
- The test greps source text, or asserts a removed symbol stays removed
- The test detects only framework behavior
- The test exists for coverage, checking no side effect or outcome
- An assertion checks a `*-mock` test ID, or fails if you remove the mock
- A method is called only from test files
- Mock preparation exceeds half the test, or the mock has no clear purpose
- Mocking "just to be safe"
