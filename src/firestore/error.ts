/* oxlint-disable max-classes-per-file -- Firestore response and commit outcome errors share one error boundary. */
import type { Write } from "./encoding.ts";

export class FirestoreError extends Error {
  readonly httpStatus: number;
  readonly status: string;

  constructor(httpStatus: number, status: string, message: string) {
    super(`Firestore ${httpStatus}: ${status}: ${message}`);
    this.name = "FirestoreError";
    this.httpStatus = httpStatus;
    this.status = status;
  }
}

const RejectionStatuses = new Set([
  "ABORTED",
  "FAILED_PRECONDITION",
  "ALREADY_EXISTS",
  "INVALID_ARGUMENT",
  "NOT_FOUND",
  "PERMISSION_DENIED",
  "UNAUTHENTICATED",
  "RESOURCE_EXHAUSTED",
  "OUT_OF_RANGE",
]);

export class FirestoreCommitError extends Error {
  readonly result;

  constructor(
    cause: unknown,
    requestId: string,
    writes: Write[],
    marker: "absent" | "unavailable"
  ) {
    const rejected = cause instanceof FirestoreError && RejectionStatuses.has(cause.status);
    const recovery = rejected && marker === "absent" ? "refresh-preview" : "inspect-before-retry";

    const instruction =
      recovery === "refresh-preview"
        ? "Read the current state and refresh the dry run. Review it before retrying with the original payload and request ID."
        : "The outcome needs inspection before any retry. Preserve the original payload and request ID; do not resend automatically.";

    super(`${cause instanceof Error ? cause.message : "Commit failed"}. ${instruction}`, { cause });
    this.name = "FirestoreCommitError";
    this.result = {
      conflict: rejected && (cause.status === "ABORTED" || cause.status === "FAILED_PRECONDITION"),
      httpStatus: cause instanceof FirestoreError ? cause.httpStatus : undefined,
      marker,
      outcome: rejected ? ("rejected" as const) : ("unknown" as const),
      preconditions: writes.flatMap((write) =>
        write.currentDocument === undefined
          ? []
          : [
              {
                ...write.currentDocument,
                document: write.update?.name ?? write.delete,
              },
            ]
      ),
      recovery,
      requestId,
      status: cause instanceof FirestoreError ? cause.status : undefined,
    };
  }
}
