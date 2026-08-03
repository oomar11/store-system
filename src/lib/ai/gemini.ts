import { GoogleGenerativeAI } from "@google/generative-ai";
import { JARVIS_SYSTEM_PROMPT } from "./system-prompt";
import { businessTools } from "./tools";

const DEFAULT_MODEL = "gemini-2.0-flash";

export function isGeminiConfigured(): boolean {
  return Boolean(process.env.GEMINI_API_KEY?.trim());
}

export function getGeminiModelName(): string {
  return (process.env.GEMINI_MODEL || DEFAULT_MODEL).trim() || DEFAULT_MODEL;
}

export function createGeminiModel() {
  const apiKey = process.env.GEMINI_API_KEY?.trim();
  if (!apiKey) {
    throw new Error(
      "مفتاح Gemini غير مضبوط — أضف GEMINI_API_KEY في متغيرات البيئة على Vercel"
    );
  }

  const genAI = new GoogleGenerativeAI(apiKey);
  return genAI.getGenerativeModel({
    model: getGeminiModelName(),
    systemInstruction: JARVIS_SYSTEM_PROMPT,
    tools: [{ functionDeclarations: businessTools }],
  });
}
