export type DomainErrorCode =
  | "validation"
  | "duplicate_command_in_batch"
  | "not_found"
  | "forbidden"
  | "stale_version"
  | "batch_id_reused"
  | "command_id_reused"
  | "rule_violation"
  | "needs_ruling"
  | "busy";

const HTTP_STATUS: Record<DomainErrorCode, number> = {
  validation: 422,
  duplicate_command_in_batch: 422,
  not_found: 404,
  forbidden: 403,
  stale_version: 409,
  batch_id_reused: 409,
  command_id_reused: 409,
  rule_violation: 422,
  needs_ruling: 422,
  busy: 503,
};

/** Očekivana, tipizirana pogreška domene. Nikad ne nosi tajne ni sadržaj DM-a. */
export class DomainError extends Error {
  readonly code: DomainErrorCode;
  readonly httpStatus: number;
  readonly details: Record<string, unknown>;

  constructor(code: DomainErrorCode, message: string, details: Record<string, unknown> = {}) {
    super(message);
    this.name = "DomainError";
    this.code = code;
    this.httpStatus = HTTP_STATUS[code];
    this.details = details;
  }
}

export function isDomainError(err: unknown): err is DomainError {
  return err instanceof DomainError;
}
