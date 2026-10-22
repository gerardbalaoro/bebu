# Source Reconstruction

Readable reconstruction is feasible for bounded parts of the Beyond Budget web client. Exact
original-source recovery is not established. This assessment uses the public build inspected in
October 2026 and an offline experiment on 2026-10-23.

For BeBu, the practical output is typed TypeScript with deterministic calculations and explicit
unsupported cases. Kotlin-like pseudocode preserves the recovered structure before implementation.
Compilable Kotlin business logic is also feasible, but it requires new declarations and
dependencies. None of these outputs recovers the original project, build files, comments, or tests.

## Artifact And Tool Results

The module from `app.beyondbudgetapp.com` is `4ef2928daa118d1b3431.wasm`, with 33,069,046 bytes. Its
SHA-256 is `1c9b9bb1e7699c7080cba0095485e04772285c200ab458f57346161d233a9eea`. All function and
struct numbers in this document belong to this artifact. They are not source names.

`wasm-tools 1.262.0` validates the complete module with `--features all`. Validation passed again
during this assessment. The existing complete WAT has 221,862,483 bytes and SHA-256
`dfa66d5044ec6cc1a31f53c6437d325d34d2190fc475f2894c899c474f7c6c9c`. Its hash also matched. The index
contains 82,952 defined functions and 92,294 imported string globals.

Earlier tool results remain relevant:

- REA MCP lacked its configured WABT provider.
- Standalone REA 6.7.0 rejected the module because its input limit was 8,388,608 bytes.
- WABT 1.0.42 failed with `0000018: error: expected valid field type (got -0x9)`.
- `wasm-tools 1.262.0` printed the complete module successfully.

This assessment reused those results instead of repeating the failed operations. The new experiment
used `wasm-tools` and Node.js directly. It did not produce new REA analysis records.

## What Survives

| Information                | Evidence And Recovery Limit                                                                                                                                                                                              |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Package and class identity | Runtime strings include `com.beyondbudget.infrastructure.model.dto.BalanceDto`, `AllocationServiceImpl`, and `AutoAllocationServiceImpl`. These provide partial identities, not a complete symbol table.                 |
| DTO schema                 | Serializer descriptors, encoders, decoders, and formatters expose field names, order, defaults, and representation types. They need cross-checks before code generation.                                                 |
| Enums                      | Initializers retain names, ordinals, and singleton references. For example, 46372 constructs `CarryOverStrategy.ALL` and `NONE`.                                                                                         |
| Signatures                 | WASM parameter/result types survive. Some callable-reference strings also retain Kotlin signatures, including `AutoAllocationServiceImpl.isEligibleForTargetAllocation(com.beyondbudget.infrastructure.model.Category)`. |
| Control flow               | Branches, loops, arithmetic, field access, and direct calls survive. `ref.func` captures and `call_ref` dispatch require additional analysis. A direct-call index alone is incomplete.                                   |
| Coroutines                 | Continuation structs retain saved values, state numbers, exception routes, and suspension checks. Original local names and source-level boundaries are incomplete.                                                       |

The binary's `name` custom section contains only the module name `beyondbudget`. It has no function
or local-name subsections. No DWARF custom section appears in the section inventory. A
`sourceMappingURL` section names `beyondbudget.wasm.map`. Earlier HTTP requests returned 404 for the
requested map URLs. That does not establish that every possible source-map location is absent.

Kotlin's development tooling can serve source files for debugging. That capability does not
establish that this production deployment exposes them. See the
[Kotlin debugging documentation](https://kotlinlang.org/docs/wasm-debugging.html#debug-in-your-browser).

Without additional source assets, original formatting, comments, local identifiers, file boundaries,
and eliminated code remain unavailable. Optimized instructions do not uniquely determine original
expressions. Runtime types also do not restore every generic argument, annotation, or visibility
rule.

## Representative DTO And Calculation

Function 48813 names `com.beyondbudget.infrastructure.model.dto.BalanceDto` and registers five
fields. Function 48816 associates their names with struct slots. Decoder 48812 supplies zero for
each omitted field. Encoder 48811 can omit zero values unless its encoder requests defaults.

| Serialized Field    | Struct Slot | Decoder Presence Bit | Representation / Omission Default |
| ------------------- | ----------- | -------------------- | --------------------------------- |
| `spentAmount`       | `7002.4`    | 1                    | `i64` / 0                         |
| `allocatedAmount`   | `7002.5`    | 2                    | `i64` / 0                         |
| `carriedOverAmount` | `7002.6`    | 4                    | `i64` / 0                         |
| `upcomingAmount`    | `7002.7`    | 8                    | `i64` / 0                         |
| `otherAmount`       | `7002.8`    | 16                   | `i64` / 0                         |

The following Kotlin representation preserves those fields and the calculation in 48814–48815. The
`recovered*` method names and declaration syntax are reconstruction choices. This example does not
establish JSON coercion, explicit-null handling, or the original property mutability.

```kotlin
data class BalanceDto(
    val spentAmount: Long = 0,
    val allocatedAmount: Long = 0,
    val carriedOverAmount: Long = 0,
    val upcomingAmount: Long = 0,
    val otherAmount: Long = 0,
)
enum class CarryOverStrategy { ALL, NONE }

// 48814 compares the strategy with the NONE singleton returned by 46375.
fun BalanceDto.recoveredFunded(strategy: CarryOverStrategy): Long =
    if (strategy == CarryOverStrategy.NONE) allocatedAmount + otherAmount
    else allocatedAmount + otherAmount + carriedOverAmount

// 48815 calls 48814, then subtracts slot 7002.4.
fun BalanceDto.recoveredAvailable(strategy: CarryOverStrategy): Long =
    recoveredFunded(strategy) - spentAmount
```

Negative carryover remains signed. `upcomingAmount` does not enter these methods. Other model
construction can apply additional policy, so these methods alone do not define every category view.

### Offline Execution Proof

The experiment extracted 48814 and 48815 directly from WAT, without using existing CLI helpers. It
retained their instructions, including `struct.get`, `ref.eq`, branches, `i64.add`, and `i64.sub`.
It remapped type/function indices, supplied minimal GC structs, and replaced the enum initializer
with fixed ALL/NONE references. An exported wrapper supplied synthetic amounts.

`wasm-tools parse` compiled that isolated module. Node.js 24.22.1 ran it and compared the results
with a separate reconstruction that used `BigInt.asIntN(64, ...)`. All 9,604 comparisons passed.
Inputs covered both strategies, both upcoming values (-999 and 999), and every combination of four
amounts from `[-2^63, -(2^53+1), -1, 0, 1, 2^53+1, 2^63-1]`.

Four independent literal cases also passed. For `(spent, allocated, carryover, upcoming, other)` of
`(7, 20, 5, 999, -2)`, funded/available were `23/16` for ALL and `18/11` for NONE. Negative
carryover of `-5` produced `13/6` for ALL. Adding one to the maximum signed `i64` produced the
minimum signed `i64`.

This is differential validation against an extracted instruction slice with a synthetic runtime. It
is not full native-app equivalence. The experiment did not run the original DTO decoder, coroutine
runtime, UI, or Firebase client. The Kotlin example was not compiled. A production CLI can reject
overflow explicitly, but that policy differs from the observed wrapping arithmetic.

## Coroutine To Method Reconstruction

The allocation save captures arguments in struct 6635 through 50286 → 50287. Callback 50304 builds
the batch and reaches 44071 → 44070. Function 44070 passes `ref.func 44089` into coordinator 44140.
Function 44089 creates continuation 16437 and enters 44092. The coordinator remains a separate
boundary: this callback trace alone does not establish caller completion or retry behavior.

In 44092, field `16437.7` selects the state. State 0 stores resume state 1 and calls 22101. The
suspension sentinel returns to the caller. State 1 returns Unit. State 2 rethrows the stored
exception. Function 22101 enters the inner continuation at 22230.

In 22230, field `9688.7` selects the state, `.8` selects the exception route, and `.10` holds an
exception. Fields `.11` and `.12` hold the incoming and saved receiver. Its call to import 759
reaches `dev.gitlive.firebase.firestore.externals.commit_$external_fun`. The JavaScript glue
implements this import as `e => e.commit()`.

The inner method reduces to this pseudocode. The placeholder names preserve unresolved types and
helpers rather than invent original declarations:

```kotlin
suspend fun recoveredCommitBridge(batch: OpaqueBatch) {
    try {
        awaitThrough21023(jsCommit759(batch))
    } catch (error: NativeThrowable) {
        if (isNativeType17097(error)) throw convertThrough22189(error)
        throw error
    }
}
```

States 0–3 prepare the receiver, call commit, wait, and return Unit. States 4–5 convert or rethrow
errors. This reconstruction preserves the exception branch that a simple `await commit()` summary
loses. This bridge trace does not establish cancellation or coordinator retry behavior.
[Allocation Persistence](allocation-persistence.md) traces the coordinator, error conversion, and
direct writer completion separately. The
[Kotlin coroutine specification](https://kotlinlang.org/spec/asynchronous-programming-with-coroutines.html#coroutine-state-machine)
explains the state-machine transformation. The function-specific mapping comes from this artifact.

## Reproducible Extraction

1. Obtain the public module and matching JavaScript glue. Record their URL, byte length, and
   SHA-256.
2. Inspect custom sections and any explicitly referenced source map. Preserve unsuccessful HTTP
   results without inferring exhaustive absence.
3. Run `wasm-tools validate --features all app.wasm`, then `wasm-tools print app.wasm -o app.wat`
   with version 1.262.0.
4. Index function boundaries, imported strings, type layouts, and binary code-body offsets. Keep
   large outputs outside version control.
5. Join serializer descriptors, formatters, decoder masks, and enum initializers. Label proven names
   separately from assigned reconstruction names.
6. Trace direct calls, `ref.func` captures, and runtime dispatch separately. Preserve unresolved
   targets in the recovered call graph.
7. Translate one bounded method and its dependencies. Preserve signed arithmetic, omission defaults,
   iteration order, suspension, and exception routes.
8. Compile an isolated instruction slice with `wasm-tools parse slice.wat -o slice.wasm`. Compare
   synthetic inputs with the reconstructed method.
9. Add native read-only fixtures before claiming application parity. Use the existing
   [write validation procedure](README.md#validate-new-writes) for future authorized mutation work.

These binary anchors permit independent extraction from the identified module. Offsets are decimal,
zero-based body starts, including local declarations and excluding the body-size prefix.

| Function | Body Offset | Body Bytes | Purpose                            |
| -------- | ----------- | ---------- | ---------------------------------- |
| 48811    | 21191659    | 633        | Balance encoder                    |
| 48812    | 21192294    | 830        | Balance decoder and defaults       |
| 48813    | 21193126    | 170        | Balance schema descriptor          |
| 48814    | 21193297    | 51         | Funded amount                      |
| 48815    | 21193349    | 18         | Available amount                   |
| 48816    | 21193369    | 239        | Field-name formatter               |
| 44092    | 19773231    | 184        | Outer commit continuation          |
| 22230    | 13595402    | 328        | Commit bridge and exception routes |

Automated schema extraction is practical with these cross-checks. Automated module grouping can use
package strings and call relationships, but original source-file boundaries remain uncertain.
Direct-call extraction and mechanical coroutine recognition can assist reconstruction. They do not
replace manual resolution of dynamic dispatch and external effects.

## Next Module And Backend Limits

The next useful CLI module is savings/deadline target demand. Trace the SAVINGS branch in 49209, the
schedule logic in 49244–49245, and the associated date and rounding helpers. Recover clock,
timezone, deadline, repeat, historical-allocation, and dynamic-savings inputs before implementing
it. The output must be a deterministic demand calculation with explicit unsupported cases. It must
not save allocations or rely on agents for arithmetic.

The client artifact can establish client requests and local calculations. It cannot establish
deployed security rules, server triggers, server-side carryover propagation, or complete remote
effects of linked and surplus allocation. Request identity, concurrent updates, retries, and undo
also need backend or authorized runtime evidence. The recovered commit bridge does not close those
gaps. [Allocation Rules](allocation-contract.md) remains the bounded behavioral contract.
