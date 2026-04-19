import Anthropic from "@anthropic-ai/sdk";

let client: Anthropic | null = null;

export function getAnthropicClient(): Anthropic {
  if (!client) {
    if (!process.env.ANTHROPIC_API_KEY) {
      throw new Error("ANTHROPIC_API_KEY environment variable is not set");
    }
    client = new Anthropic({
      apiKey: process.env.ANTHROPIC_API_KEY,
      timeout: 10 * 60 * 1000, // 10 minutes — web_search calls can be slow
    });
  }
  return client;
}
