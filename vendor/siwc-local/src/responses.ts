import OpenAI from "openai";
import { apiError, ChatGPTError, isObject } from "./errors.js";
import type { StreamResponseOptions } from "./types.js";

// Modified for Vegetate, 2026-10-25: pass documented optional research and
// structured-output fields, and expose only the completed response to the caller.
// store:false and stream:true, verified OAuth, and failure handling are retained.

export async function streamResponse(
  accessToken: string,
  options: StreamResponseOptions,
  signal: AbortSignal,
): Promise<{ text: string }> {
  const input = typeof options.input === "string" ? [{ role: "user" as const, content: options.input }] : options.input;
  if (!Array.isArray(input) || input.some((message) =>
    !isObject(message) || !["user", "assistant", "developer"].includes(String(message.role)) || typeof message.content !== "string"
  )) {
    throw new ChatGPTError("invalid_request", "Use text messages with user, assistant, or developer roles. Put system guidance in instructions.");
  }

  // The DevKit supplies the selected ChatGPT account's refreshed OAuth token.
  // Leave org/project unset; they are not placeholders for a Platform API account.
  const client = new OpenAI({
    apiKey: accessToken,
    baseURL: "https://api.openai.com/v1",
    organization: null,
    project: null,
    // Keep the SDK's default without inheriting OPENAI_LOG=debug, which can log clipboard text.
    logLevel: "warn",
    // Report ChatGPT sharing-limit errors immediately instead of retrying HTTP 429s.
    maxRetries: 0,
    // A redirect can forward the clipboard body to another origin.
    fetchOptions: { redirect: "error" },
    // Also prevent OPENAI_CUSTOM_HEADERS from replacing this account's credentials or tenant.
    defaultHeaders: {
      authorization: `Bearer ${accessToken}`,
      "openai-organization": null,
      "openai-project": null,
    },
  });
  // The SDK's timeout ends at headers; also bound the full streamed body.
  const timeoutMs = options.timeoutMs ?? 180_000;
  const deadline = AbortSignal.timeout(timeoutMs);
  const requestSignal = AbortSignal.any([signal, deadline]);
  let response: Response | undefined;
  try {
    const result = await client.responses.create({
      model: options.model,
      input: input.map((message) => ({ role: message.role, content: message.content })),
      ...(options.instructions !== undefined ? { instructions: options.instructions } : {}),
      ...(options.tools !== undefined ? { tools: options.tools } : {}),
      ...(options.text !== undefined ? { text: options.text } : {}),
      ...(options.reasoning !== undefined ? { reasoning: options.reasoning } : {}),
      ...(options.include !== undefined ? { include: options.include } : {}),
      store: false,
      stream: true,
    }, { signal: requestSignal, headers: { accept: "text/event-stream" } }).withResponse();
    response = result.response;
    const contentType = response.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase();
    // The direct route can return valid SSE without Content-Type. In that case,
    // validate the events below and still require response.completed for success.
    if (!response.body || (contentType && contentType !== "text/event-stream")) {
      await response.body?.cancel();
      throw new ChatGPTError("invalid_stream", "ChatGPT did not return the expected response stream.", true, response.status);
    }

    let completed = false;
    let text = "";
    for await (const event of result.data) {
      requestSignal.throwIfAborted();
      if (!isObject(event)) continue;
      if (event.type === "response.output_text.delta" && typeof event.delta === "string") {
        text += event.delta;
        if (text.length > 16 * 1024 * 1024) throw new ChatGPTError("response_too_large", "The response was too large. Try a smaller request.");
        options.onDelta?.(event.delta);
      } else if (event.type === "response.failed" || event.type === "error") {
        const detail = event.type === "response.failed" ? event.response : event;
        throw apiError(detail, response.status, result.request_id);
      } else if (event.type === "response.incomplete") {
        throw new ChatGPTError("response_incomplete", "ChatGPT stopped before completing the response. You can keep the partial text or try again.", true);
      } else if (event.type === "response.completed") {
        completed = true;
        options.onCompleted?.(event.response);
        break;
      }
    }
    // The SDK may finish iteration on an aborted connection without throwing.
    requestSignal.throwIfAborted();
    if (!completed) throw new ChatGPTError("stream_interrupted", "The connection ended before ChatGPT finished the recipe. Your original recipe is still available; try again.", true);
    return { text };
  } catch (error) {
    if (signal.aborted) throw new ChatGPTError("cancelled", "The response was cancelled.");
    if (deadline.aborted) throw new ChatGPTError("response_timeout", "ChatGPT took too long to finish this recipe. Your original recipe is still available; try again.", true);
    if (error instanceof ChatGPTError) throw error;
    // SDK errors can contain submitted text. Only expose our sanitized diagnostics,
    // including errors the SDK raises while decoding an SSE 'error' event.
    if (error instanceof OpenAI.APIError && !(error instanceof OpenAI.APIConnectionError) && !(error instanceof OpenAI.APIUserAbortError)) {
      // The SDK also unwraps the string in an OAuth { error: "code" } response.
      const detail = typeof error.error === "string" ? { error: error.error } : error.error;
      throw apiError(detail, error.status ?? response?.status, error.requestID ?? response?.headers.get("x-request-id"));
    }
    if (!response) throw new ChatGPTError("network_error", "Could not reach ChatGPT. Check your connection and try again.", true);
    if (error instanceof SyntaxError) throw new ChatGPTError("invalid_stream", "The response stream contained an invalid event. Try again.", true);
    throw new ChatGPTError("stream_interrupted", "The connection was interrupted before ChatGPT finished the recipe. Your original recipe is still available; try again.", true);
  }
}
