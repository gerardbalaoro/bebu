---
name: typescript-conventions
description: "Write, refactor, and review TypeScript with domain-oriented naming, inferred types, simple control flow, and clear module ownership."
---

# TypeScript Conventions

Write straightforward, domain-oriented TypeScript. Prefer clear intent, strong inference, and simple control flow.

For user-facing code, consider accessibility and usability.
For performance-sensitive code, consider execution time and resource use.

## Types

- Rely on type inference where possible.
- Use schemas, function signatures, and API definitions as the source of truth for types.
- Infer types from their source instead of duplicating definitions.
- Fix types at the source instead of casting at the point of use.
- Use explicit type annotations and interfaces only for exports or clarity.
- If the type is unknown, use `unknown` instead of `any`.
- Narrow types instead of asserting them at the point of use.
- To preserve literal types, use const assertions (`as const`). These assertions do not freeze values at runtime.

## Naming

- If the module or local scope supplies enough context, prefer short, single-word names.
- If domain meaning or ambiguity requires more words, use a longer name.
- Prefer domain vocabulary over generic names such as `data`, `manager`, or `helper`.
- In tightly scoped callbacks with obvious context, use short names.
- Use semantic boolean names such as `isLoading`, `hasChanges`, and `canPublish`.
- Use PascalCase for module-level singleton objects and constants.
- Use `<Concept>Schema` for schemas.
- Name functions by intent: `getX`, `createX`, `isX`, `hasX`, or a verb plus a domain noun.
- Replace magic numbers with constants that have descriptive names.

## Functions

- Prefer named function declarations for module-level functions.
- Use arrow functions mainly for callbacks and trivial factories.
- Keep standalone functions where they are useful independently.
- Group related operations that callers use together into an object export.
- Give each function one responsibility.
- Keep logic in one function unless extraction improves reuse, composition, or clarity.
- For helpers used once, extract only to give an important concept a name.
- Keep workflows visibly sequential.

## Variables and Control Flow

- Default to `const`.
- Use `let` only for reassignment that is part of the algorithm.
- Use `const` or `let` instead of `var`.
- To compute a value directly, prefer expressions, early returns, or an IIFE over reassignment through branches.
- Prefer early returns over nesting.
- If an early return makes the flow clearer, omit `else`.
- Prefer explicit `if` and `switch` statements over dense expression chains.
- Give complex conditions descriptive boolean names.
- Use ternaries only for simple value selection.
- Prefer `for...of` for iteration unless the algorithm needs an index or another loop form.

## Expressions and Object Access

- If the object name adds meaning, prefer property access such as `user.name` and `user.email`.
- If destructuring improves readability or matches the surrounding API, use it for object and array assignments.
- For potentially absent properties, use optional chaining (`?.`).
- For defaults that apply only to `null` or `undefined`, use nullish coalescing (`??`).
- Prefer template literals over string concatenation.

## Async Code and Errors

- Prefer `async`/`await` over promise chains.
- In async functions, await promises whose results or completion the function needs.
- If a promise returns a value that the operation needs, use that value.
- Keep `Promise` executors synchronous.
- Handle boundary cases and errors at the API or domain boundary that owns them.
- Throw `Error` objects with descriptive messages.
- Use `try`/`catch` where the function can recover, translate an error, or add useful context.
- Let other errors propagate to the caller unchanged, including errors from awaited promises.
- Remove temporary `console.log` calls, `debugger`, and `alert` statements from production code.
- Preserve intentional application output and logging.

## Abstraction

- Abstract for meaning, not solely for deduplication or fewer lines.
- Prefer obvious domain-specific code over generic abstractions with flags, callbacks, or complicated generics.
- Prefer expressive names and structure over comments.
- For complex logic, use comments to explain intent and non-obvious invariants.
- Add wrappers, forwarding files, or abstraction layers only for concrete behavior or a contract.

## Ownership and Structure

- Organize code by domain responsibility or workflow rather than language construct or execution mechanism.
- Keep related behavior, contracts, and data definitions with their domain owner.
- Reserve general-purpose locations for code without domain-specific meaning.
- Keep ownership stable across reuse. Multiple consumers can depend on one owner without moving the code to a shared location.
- Separate workflow coordination from domain policy. Workflows own execution order and interactions. Domains own their rules.
- Split files at responsibility boundaries instead of line-count targets.
- Keep related steps and invariants together across execution stages.
- Consider file complexity and directory complexity separately. Many small files can still make navigation difficult.
- Use names and locations that reveal purpose and ownership.
- After structural changes, update consumers and delete obsolete paths.
- If an external contract requires compatibility, retain that contract.
- Put file-specific lint exceptions in top-level comments in the affected file.
- State the reason for each lint exception.

## Imports

- Treat `../` imports as a signal to consider a stable public import path.
- For code shared outside its local module boundary, use path aliases in `tsconfig` or native subpath imports.
