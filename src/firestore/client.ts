import { z } from "zod";

import type { Session } from "../auth/session.ts";
import { BudgetSchema } from "../budget/model.ts";
import { DataSchema, DocumentRoot, newId, WireDocumentSchema, decode } from "./encoding.ts";
import type { CommitOptions, CommitResult, FirestoreDocument, Write } from "./encoding.ts";
import { FirestoreError } from "./error.ts";

export { FirestoreError } from "./error.ts";

export type Fetcher = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

const budgetIdPattern = /^[A-Za-z0-9_-]+$/u;
const requestIdPattern = /^[A-Za-z0-9]{20}$/u;

interface RequestOptions {
  method?: string;
  body?: unknown;
}

export class BeyondClient {
  readonly session: Session;
  readonly budgetId: string;
  private readonly fetcher: Fetcher;

  constructor(session: Session, options: { budget?: string; fetcher?: Fetcher } = {}) {
    const budgetId =
      options.budget ??
      session.selectedBudgetId ??
      (session.budgetIds.length === 1 ? session.budgetIds[0] : undefined);

    if (budgetId === undefined || budgetId === "") {
      throw new Error("Choose --budget <id>, or import a session with a selected budget");
    }

    if (!budgetIdPattern.test(budgetId)) {
      throw new Error("Invalid budget ID");
    }

    this.session = session;
    this.budgetId = budgetId;
    this.fetcher = options.fetcher ?? fetch;
  }

  get budgetPath(): string {
    return `${DocumentRoot}/budgets/${this.budgetId}`;
  }

  async request<T>(path: string, schema: z.ZodType<T>, options: RequestOptions = {}): Promise<T> {
    if (this.session.expiresAt <= Date.now()) {
      throw new Error("The session expired. Import the browser session again");
    }

    const headers = new Headers({ Authorization: `Bearer ${this.session.idToken}` });

    if (this.session.appCheckToken !== undefined && this.session.appCheckToken !== "") {
      headers.set("X-Firebase-AppCheck", this.session.appCheckToken);
    }

    if (options.body !== undefined) {
      headers.set("Content-Type", "application/json");
    }

    const response = await this.fetcher(`https://firestore.googleapis.com/v1/${path}`, {
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
      headers,
      method: options.method ?? "GET",
      signal: AbortSignal.timeout(30_000),
    });

    const result: unknown = await response.json();

    if (!response.ok) {
      const candidates = Array.isArray(result) ? result : [result];

      const error = candidates
        .map((candidate) => DataSchema.safeParse(candidate))
        .find((candidate) => candidate.success && Boolean(candidate.data.error));

      const details = DataSchema.safeParse(error?.success === true ? error.data.error : {});

      const status = z.string().safeParse(details.success ? details.data.status : undefined);
      const message = z.string().safeParse(details.success ? details.data.message : undefined);

      throw new FirestoreError(response.status, status.data ?? "UNKNOWN", message.data ?? "");
    }

    return schema.parse(result);
  }

  async document(path: string): Promise<FirestoreDocument>;
  async document<T>(path: string, schema: z.ZodType<T>): Promise<FirestoreDocument<T>>;
  async document(
    path: string,
    schema: z.ZodType = DataSchema
  ): Promise<FirestoreDocument<unknown>> {
    const raw = await this.request(path, WireDocumentSchema);

    const decoded = Object.fromEntries(
      Object.entries(raw.fields).map(([key, value]) => [key, decode(value)])
    );

    return { data: schema.parse(decoded), name: raw.name, raw, updateTime: raw.updateTime };
  }

  stashId(type: string): string {
    const stash = this.session.stashes.find(
      (entry) => entry.budgetId === this.budgetId && entry.type === type
    );

    if (!stash) {
      throw new Error(
        `The ${type} index is absent. Import the session for the selected budget again`
      );
    }

    return stash.id;
  }

  async stash(type: string): Promise<FirestoreDocument>;
  async stash<T>(type: string, schema: z.ZodType<T>): Promise<FirestoreDocument<T>>;
  async stash(type: string, schema: z.ZodType = DataSchema): Promise<FirestoreDocument<unknown>> {
    return await this.document(`${this.budgetPath}/stashes/${this.stashId(type)}`, schema);
  }

  async discover(): Promise<FirestoreDocument<z.infer<typeof BudgetSchema>>> {
    const budget = await this.document(this.budgetPath, BudgetSchema);
    const remaining = this.session.stashes.filter((entry) => entry.budgetId !== this.budgetId);

    for (const [type, id] of Object.entries(budget.data.stashIdentifiers)) {
      remaining.push({ budgetId: this.budgetId, id, type });
    }

    this.session.stashes = remaining;

    return budget;
  }

  async commit(writes: Write[], options: CommitOptions = {}): Promise<CommitResult> {
    const requestId = options.requestId ?? newId();

    if (!requestIdPattern.test(requestId)) {
      throw new Error("request-id must contain exactly 20 letters or digits");
    }

    for (const write of writes) {
      const path = write.update?.name ?? write.delete;

      if (path?.startsWith(`${this.budgetPath}/`) !== true) {
        throw new Error(
          "The write is outside the selected budget. Choose a record in the selected budget"
        );
      }
    }

    const marker = `${this.budgetPath}/saveMarkers/${requestId}`;
    const markerLifetimeMs = 29 * 24 * 60 * 60 * 1000;

    const body = {
      writes: [
        ...writes,
        {
          currentDocument: { exists: false },
          update: {
            fields: {
              expireAt: { timestampValue: new Date(Date.now() + markerLifetimeMs).toISOString() },
            },
            name: marker,
          },
          updateTransforms: [{ fieldPath: "createdAt", setToServerValue: "REQUEST_TIME" }],
        } satisfies Write,
      ],
    };

    if (options.dryRun === true) {
      return { body, dryRun: true, requestId };
    }

    try {
      const response = z.object({ commitTime: z.string() }).parse(
        await this.request(`${DocumentRoot}:commit`, z.object({ commitTime: z.string() }), {
          body,
          method: "POST",
        })
      );

      return { commitTime: response.commitTime, committed: true, requestId, writes: writes.length };
    } catch (error) {
      // A lost response can occur after a successful commit. The commit includes the marker atomically.
      // Marker existence does not bind this request ID to an operation or payload.
      const landed = await this.readMarker(marker);

      if (landed !== undefined && landed !== "") {
        return { alreadyCommitted: true, commitTime: landed, committed: true, requestId };
      }

      throw error;
    }
  }

  private async readMarker(path: string): Promise<string | undefined> {
    try {
      const marker = await this.document(path, z.object({ createdAt: z.string() }));

      return marker.data.createdAt;
    } catch {
      return undefined;
    }
  }
}
