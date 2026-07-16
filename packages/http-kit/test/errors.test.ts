import { describe, expect, it } from "vitest";
import {
  ApiError,
  badRequest,
  conflict,
  notFound,
  unauthorized
} from "../src/errors.js";

describe("ApiError model", () => {
  it("carries statusCode, code and message", () => {
    const err = new ApiError(418, "teapot", "I'm a teapot");
    expect(err).toBeInstanceOf(Error);
    expect(err.statusCode).toBe(418);
    expect(err.code).toBe("teapot");
    expect(err.message).toBe("I'm a teapot");
  });

  it("factory helpers set the conventional status codes", () => {
    expect(badRequest("x").statusCode).toBe(400);
    expect(unauthorized().statusCode).toBe(401);
    expect(notFound().statusCode).toBe(404);
    expect(conflict("dup").statusCode).toBe(409);
  });

  it("uses default codes and messages", () => {
    expect(unauthorized().code).toBe("unauthorized");
    expect(notFound().message).toBe("Not found");
  });
});
