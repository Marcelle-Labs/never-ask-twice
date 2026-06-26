import { describe, expect, it } from "vitest";
import { ZodError } from "zod";

import { DistilledFactCandidateSchema } from "../src/contracts.js";

describe("predicate", () => {
  it("rejects arbitrary predicates outside the enum", () => {
    expect(() =>
      DistilledFactCandidateSchema.parse({
        subject: "Acme",
        predicate: "favorite_color",
        predicateClass: "profile",
        object: "blue",
        confidence: 0.8,
        metadata: {},
      }),
    ).toThrow(ZodError);
  });
});
