import { GoogleGenerativeAI } from "@google/generative-ai";
import dotenv from "dotenv";

dotenv.config();

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const embeddingModel = genAI.getGenerativeModel({ model: "gemini-embedding-001" });

async function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function embedTexts(texts, retries = 3) {
  const BATCH_SIZE = 20;
  const allEmbeddings = [];

  for (let i = 0; i < texts.length; i += BATCH_SIZE) {
    const batch = texts.slice(i, i + BATCH_SIZE);

    let attempt = 0;
    while (attempt <= retries) {
      try {
        const result = await embeddingModel.batchEmbedContents({
          requests: batch.map((text) => ({
            content: { parts: [{ text }] },
            outputDimensionality: 1536,
          })),
        });
        allEmbeddings.push(...result.embeddings.map((e) => e.values));
        break;
      } catch (err) {
        const is429 = err.message?.includes("429") || err.message?.includes("Too Many Requests");
        if (is429 && attempt < retries) {
          const waitMs = 15000 * (attempt + 1);
          console.log(`Rate limited, waiting ${waitMs / 1000}s before retry...`);
          await sleep(waitMs);
          attempt++;
        } else {
          throw err;
        }
      }
    }

    if (i + BATCH_SIZE < texts.length) {
      await sleep(1500);
    }
  }

  return allEmbeddings;
}

export async function embedText(text) {
  const [embedding] = await embedTexts([text]);
  return embedding;
}

export function toVectorLiteral(embedding) {
  return `[${embedding.join(",")}]`;
}

export async function generateChatCompletion(systemPrompt, userPrompt) {
  const model = genAI.getGenerativeModel({
    model: "gemini-3.6-flash",
    systemInstruction: systemPrompt,
  });
  const result = await model.generateContent(userPrompt);
  return result.response.text();
}

export { genAI };