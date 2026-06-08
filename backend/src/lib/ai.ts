import { createGateway } from "@ai-sdk/gateway";
import { generateText, streamText } from "ai";

if (!process.env.AI_GATEWAY_API_KEY) {
  process.stderr.write("[ai] WARNING: AI_GATEWAY_API_KEY is not set — AI features will fail\n");
}

const _gateway = createGateway({
  apiKey: process.env.AI_GATEWAY_API_KEY ?? "",
});

// Default to the latest Sonnet — override per-call with gatewayModel("openai/gpt-5.4") etc.
export const DEFAULT_MODEL = "anthropic/claude-sonnet-4.6" as const;

export function gatewayModel(modelId: string = DEFAULT_MODEL) {
  return _gateway(modelId);
}

export { generateText, streamText };
