---
name: writing-tests
description: "Write, refactor, and review tests that catch concrete bugs through real behavior. Use also to assess test value or prune ineffective tests."
---

# Writing Tests

Every test must name a concrete bug it catches and exercise the real behavior that exposes that bug.

For a requested test audit or cleanup, read [Review Existing Tests](references/review-existing-tests.md).

## Choose the Behavior

Before you write the test body, name the production fault that makes the test fail.
Distinguish a bug from an intentional design decision.

- Cover wrong branches, missing side effects, wrong arguments, boundary errors, and broken contracts.
- Assert behavior that depends on constants or messages instead of repeating their current values.
- If exact wording or a value is a public contract, assert that contract.
- Give constructors, getters, and forwarding code tests only for validation, normalization, defaults, derived values, rules, or side effects.
- Otherwise, assert the first result that a consumer can observe.
- Choose tests for the behavior they protect, rather than coverage totals or process requirements.

A retry test must detect an extra attempt after the retry limit. An assertion on the limit constant alone cannot detect that error.

## Derive Expectations Independently

- Use literal expectations and fixtures that you inspect by hand.
- Prefer table-driven tests with literal expected values.
- Keep expected values independent of the implementation and its helpers.
- Avoid assertions where setup and expectation share mutable state that makes equality automatic.

```typescript
// The same implementation computes both sides.
const expected = buildSearchQuery({ tag: "urgent" });
expect(buildSearchQuery({ tag: "urgent" })).toBe(expected);

// The expected value comes from the contract.
expect(buildSearchQuery({ tag: "urgent" })).toBe('tag:"urgent"');
```

## Exercise Real Behavior

- Assert the behavior of the real component.
- Run scripts with controlled inputs. Assert their outputs, side effects, or exit codes.
- For configuration, assert the behavior that the configuration controls.
- For agent instructions, observe the behavior of the consuming agent.
- Keep source-text searches out of behavioral tests. Human prose does not need tests.
- Cover your boundary contracts: registered routes, emitted queries, and generated payloads.
- Leave documented framework mechanics to upstream tests.
- If upstream behavior contradicts an assumption, add one narrow characterization test that names the assumption.

## Use Mocks at External Boundaries

- Use real dependencies by default.
- Use mocks only for slow or external operations.
- Before replacing a method, identify its side effects.
- Keep every side effect that the test depends on real.
- If the boundary is unclear, run the real implementation first.
- Assert arguments, call counts, or order only where they belong to the contract.
- Give success, error, and malformed branches distinct fixtures or spies.
- Make sure that the wrong branch cannot satisfy the expectation.
- Include all documented fields of the represented response in mock data.
- If mock preparation outgrows the test logic, prefer an integration test with real components.
- If mock behavior diverges from real methods, prefer real components.

For duplicate detection that depends on a configuration write, keep the write real. Mock the external process startup beneath that operation.

An assertion that a mock returns its configured value proves nothing about the caller.
An assertion that the caller sends the required request can protect a boundary contract.

## Keep Test Support Separate

- Put cleanup that only tests need in test utilities.
- Keep production lifecycle methods limited to resources that the component owns.
- Keep helpers focused on fixture preparation rather than hidden computations of expected results.

## Completion

For a requested production behavior change, complete the test cycle:

1. Write the test before the implementation.
2. Run the test against real code.
3. Make sure that it fails because of the missing or incorrect behavior.
4. Implement the behavior until the test passes.
5. Refactor with the tests passing.
6. Run the relevant repository checks.

For test-only changes, run the affected tests and relevant repository checks.
For review-only tasks, report findings and the checks run.

## Check Fault Detection

Before completion, identify realistic faults in the affected behavior:

- A wrong constant or argument.
- A wrong branch handler.
- A missing state change or side effect.
- An empty or default return value.
- Missing validation for zero, empty, null, unauthorized, or malformed input.

For each applicable fault, identify the test that detects it.
If no test detects a meaningful fault, report the gap.
For implementation or test changes, strengthen the test to cover that gap.
For test changes that need evidence, introduce a temporary fault and run the relevant test.
Restore the original code after the probe, including after a failed test command.

Report the behavior protected, the checks run, and any remaining gaps.
