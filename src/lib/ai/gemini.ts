import { GoogleGenerativeAI } from "@google/generative-ai";
import { JARVIS_SYSTEM_PROMPT } from "./system-prompt";
import { businessTools } from "./tools";
import { loadGeminiApiKey } from "./gemini-config";

const DEFAULT_MODEL = "gemini-flash-lite-latest";

export { isGeminiConfigured, loadGeminiApiKey } from "./gemini-config";

export function getGeminiModelName(): string {
  return (process.env.GEMINI_MODEL || DEFAULT_MODEL).trim() || DEFAULT_MODEL;
}

export async function createGeminiModel() {
  const loaded = await loadGeminiApiKey();
  if (!loaded?.key) {
    throw new Error(
      "مفتاح Gemini غير مضبوط — ابعت من تيليجرام: /gemini مفتاحك  أو احفظه من الإعدادات"
    );
  }

  const genAI = new GoogleGenerativeAI(loaded.key);
  return genAI.getGenerativeModel({
    model: getGeminiModelName(),
    systemInstruction: JARVIS_SYSTEM_PROMPT,
    tools: [{ functionDeclarations: businessTools }],
  });
}
