/**
 * Uniform API error model. Services throw `ApiError`; the global error handler
 * serializes it to a consistent JSON shape so the gateway and clients can rely
 * on `{ error: { code, message } }`.
 */
export class ApiError extends Error {
  constructor(
    public readonly statusCode: number,
    public readonly code: string,
    message: string
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export const badRequest = (msg: string, code = "bad_request") => new ApiError(400, code, msg);
export const unauthorized = (msg = "Unauthorized", code = "unauthorized") =>
  new ApiError(401, code, msg);
export const forbidden = (msg = "Forbidden", code = "forbidden") => new ApiError(403, code, msg);
export const notFound = (msg = "Not found", code = "not_found") => new ApiError(404, code, msg);
export const conflict = (msg: string, code = "conflict") => new ApiError(409, code, msg);
