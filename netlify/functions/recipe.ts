import type { Handler } from "@netlify/functions";
import { createApi } from "../../server/api";

export const handler: Handler = async (event) => {
  const headers = new Headers();
  for (const [key, value] of Object.entries(event.headers))
    if (value !== undefined) headers.set(key, value);
  const request = new Request(`https://vegetate.invalid${event.path}`, {
    method: event.httpMethod,
    headers,
    ...(["GET", "HEAD"].includes(event.httpMethod)
      ? {}
      : {
          body: event.isBase64Encoded
            ? Buffer.from(event.body || "", "base64").toString()
            : event.body || "",
        }),
  });
  const result = await createApi({
    apiKey: process.env.VEGETATE_OPENAI_API_KEY,
    accessCode: process.env.VEGETATE_ACCESS_CODE,
    model: process.env.VEGETATE_MODEL,
  })(request);
  return {
    statusCode: result.status,
    headers: Object.fromEntries(result.headers),
    body: await result.text(),
  };
};
