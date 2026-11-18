import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { createHash, timingSafeEqual } from "crypto";

export const unlockPortal = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => z.object({ password: z.string().max(100) }).parse(d))
  .handler(async ({ data }) => {
    const expected = process.env["PORTAL_ADMIN_PASSWORD"] || "T16T85HQL9F";
    const a = createHash("sha256").update(data.password.trim().toUpperCase()).digest();
    const b = createHash("sha256").update(expected.toUpperCase()).digest();
    return { ok: timingSafeEqual(a, b) };
  });
