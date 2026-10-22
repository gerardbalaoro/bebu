# Coding Standards

## Core Principles

Write accessible, fast, type-safe code that contributors can maintain. State the intent clearly.

- Use descriptive names for functions, variables, and types.
- Define the component structure, data flow, and API design.
- Handle boundary conditions and errors.
- Consider accessibility, speed, and usability.
- For complex logic, add comments that explain the intent. Prefer code that makes its purpose clear.

### Types

- If explicit types improve clarity, use them for function parameters and return values.
- If the type is unknown, prefer `unknown` over `any`.
- Use const assertions (`as const`) for immutable values and literal types.
- Use TypeScript type narrowing instead of type assertions.
- Replace magic numbers with constants that have descriptive names.

### JavaScript and TypeScript

- Use arrow functions for callbacks and short functions.
- Prefer `for...of` loops over `.forEach()` and indexed `for` loops.
- Use optional chaining (`?.`) and nullish coalescing (`??`) for safe property access.
- Prefer template literals over string concatenation.
- Use destructuring for object and array assignments.
- Use `const` by default. If the value needs reassignment, use `let`. Keep `var` out of the code.

### Async Functions and Promises

- Use `await` for promises in async functions. Use the return value.
- Prefer `async/await` syntax over promise chains.
- Handle errors in async code with `try-catch` blocks.
- Keep Promise executors synchronous.

### Errors and Debugging

- Delete `console.log`, `debugger`, and `alert` statements from production code.
- Throw `Error` objects with descriptive messages.
- Use `try-catch` blocks to handle errors. Let other errors reach the caller unchanged.
- Prefer early returns over nested conditions for errors.

### Code Organization

- Give each function one responsibility. Keep its logic within the complexity limits.
- Extract complex conditions into boolean variables with descriptive names.
- Use early returns to reduce nesting.
- Prefer simple conditions over nested ternary operators.
- Group related code by responsibility.
- Keep file-specific lint exceptions in top-level comments in the affected files. State the reason
  for each exception.

#### Ownership and Structure

- Organize code by responsibility instead of language construct, technical form, or execution
  mechanism.
- Keep related behavior, contracts, and data definitions with their domain owner. Use
  general-purpose locations only for code without domain-specific meaning.
- Keep ownership stable across reuse. Multiple consumers can depend on one owner without a shared
  code location.
- Separate workflow coordination from domain policy. Workflows own execution order and interactions.
  Domains own their rules.
- Manage file complexity and directory complexity separately. One large file can have a coherent
  responsibility. Many small files can still make navigation difficult.
- Split files at responsibility boundaries instead of line-count targets. Keep related steps and
  invariants together.
- Group files by responsibility or workflow. Keep domain behavior with its owner across execution
  stages.
- Use names and locations that reveal purpose and ownership.
- Add wrappers, forwarding files, or abstraction layers only for a concrete behavior or contract.
- Complete structural changes. Update consumers and delete obsolete paths. If an external contract
  requires compatibility, retain it.
