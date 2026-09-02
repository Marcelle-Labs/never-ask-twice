import { z } from "zod";

export const ESCALATION_CONTACT_SCHEMA = {
  type: "object",
  properties: {
    newContact: {
      type: "string",
      minLength: 1,
      maxLength: 120,
      description: "The confirmed replacement escalation contact.",
    },
    reason: {
      type: "string",
      maxLength: 240,
      description: "Optional short reason for the correction.",
    },
  },
  required: ["newContact"],
  additionalProperties: false,
} as const;

const CONTROL_OR_BIDI = /[\u0000-\u001F\u007F-\u009F\u200B-\u200F\u202A-\u202E\u2060-\u2064\u2066-\u2069\uFEFF]/;

function clean(value: string): string {
  return value.normalize("NFC").replace(/\s+/g, " ").trim();
}

export const EscalationContactInput = z.object({
  newContact: z.string().min(1).max(120),
  reason: z.string().max(240).optional(),
}).strict().transform((input, ctx) => {
  const newContact = clean(input.newContact);
  const reason = input.reason === undefined ? undefined : clean(input.reason);
  if (!newContact || CONTROL_OR_BIDI.test(input.newContact)) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: "newContact must be visible text." });
  }
  if (input.reason !== undefined && CONTROL_OR_BIDI.test(input.reason)) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: "reason must be visible text." });
  }
  return { newContact, reason };
});

export type EscalationContactInput = z.output<typeof EscalationContactInput>;
