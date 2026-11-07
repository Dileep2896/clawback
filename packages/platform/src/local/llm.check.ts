import assert from "node:assert/strict";
import { withFakeCredentials } from "./fake-credentials.ts";
import llm from "./llm.ts";

const SCHEMA = {
  type: "object",
  properties: { total: { type: "integer" } },
  required: ["total"],
  additionalProperties: false,
};

// A 1x1 PNG. The parser retries with page images, so the image path has to work on the login too.
const PIXEL =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg==";

/** Real calls on the Claude Code login. Fake credentials are set, so a success can only have used the login. */
export default async function check() {
  await withFakeCredentials(async () => {
    const plain = await llm.structured<{ total: number }>({ prompt: "What is 2 + 3? Put it in total." }, SCHEMA);
    assert.equal(plain.total, 5);

    const withImage = await llm.structured<{ total: number }>(
      { prompt: "How many images did you get? Put it in total.", images: [{ mediaType: "image/png", base64: PIXEL }] },
      SCHEMA,
    );
    assert.equal(typeof withImage.total, "number");
  });
}
