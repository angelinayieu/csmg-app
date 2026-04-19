import OpenAI from "openai";

let embeddingClient: OpenAI | null = null;

function getEmbeddingClient(): OpenAI {
  if (!embeddingClient) {
    embeddingClient = new OpenAI({ apiKey: process.env.OPENAI_API_KEY! });
  }
  return embeddingClient;
}

export const DEFAULT_EMBEDDING_MODEL = "text-embedding-3-small";
export const DEFAULT_EMBEDDING_VERSION = "v1";

export async function embedTexts(
  texts: string[],
  model: string = DEFAULT_EMBEDDING_MODEL
): Promise<number[][]> {
  if (texts.length === 0) return [];

  const client = getEmbeddingClient();
  const response = await client.embeddings.create({
    model,
    input: texts,
  });

  return response.data.map((d) => d.embedding);
}
