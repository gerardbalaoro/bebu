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
