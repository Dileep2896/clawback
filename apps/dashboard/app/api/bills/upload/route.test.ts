import { afterAll, beforeAll, expect, it, vi } from "vitest";

vi.mock("../../../../lib/session.ts", () => ({ currentSession: async () => ({ cid: "sandbox-c", uid: "u" }) }));
const noFetch = vi.fn<typeof fetch>(() => Promise.reject(new Error("fetch must not be called")));

beforeAll(() => {
  process.env.SANDBOX = "1";
  vi.stubGlobal("fetch", noFetch);
});
afterAll(() => {
  delete process.env.SANDBOX;
  vi.unstubAllGlobals();
});

it("refuses a bill upload in the sandbox before reading its body", async () => {
  const { POST } = await import("./route.ts");
  const formData = vi.fn(() => Promise.reject(new Error("the body must not be read")));
  const response = await POST({ formData } as unknown as Request);
  expect(response.status).toBe(403);
  expect(formData).not.toHaveBeenCalled();
  expect(noFetch).not.toHaveBeenCalled();
});
