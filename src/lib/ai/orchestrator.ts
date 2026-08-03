import type { Content, Part } from "@google/generative-ai";
import { createGeminiModel, isGeminiConfigured } from "./gemini";
import { executeBusinessTool } from "./tool-handlers";
import { getChatHistory, setChatHistory, clearChatHistory } from "./history";
import {
  JARVIS_HELP_MESSAGE,
  JARVIS_START_MESSAGE,
} from "./system-prompt";

const MAX_TOOL_ROUNDS = 6;

export type JarvisReply = {
  text: string;
  usedTools: string[];
};

function extractText(parts: Part[] | undefined): string {
  if (!parts?.length) return "";
  return parts
    .map((p) => ("text" in p && p.text ? p.text : ""))
    .filter(Boolean)
    .join("\n")
    .trim();
}

export async function handleJarvisMessage(
  chatId: string,
  userText: string
): Promise<JarvisReply> {
  const text = userText.trim();
  if (!text) {
    return { text: "اكتب سؤالك عن بيانات المحل.", usedTools: [] };
  }

  const lower = text.toLowerCase();
  if (lower === "/start" || lower === "start") {
    clearChatHistory(chatId);
    return { text: JARVIS_START_MESSAGE, usedTools: [] };
  }
  if (lower === "/help" || lower === "help" || text === "مساعدة") {
    return { text: JARVIS_HELP_MESSAGE, usedTools: [] };
  }
  if (lower === "/reset" || lower === "reset") {
    clearChatHistory(chatId);
    return { text: "تم مسح سياق المحادثة. اسأل من جديد.", usedTools: [] };
  }

  if (!isGeminiConfigured()) {
    return {
      text: "المساعد غير جاهز — لازم يتعمل إعداد GEMINI_API_KEY على السيرفر.",
      usedTools: [],
    };
  }

  const model = createGeminiModel();
  const history = getChatHistory(chatId);
  const chat = model.startChat({ history });
  const usedTools: string[] = [];

  let result = await chat.sendMessage(text);

  for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
    const response = result.response;
    const functionCalls = response.functionCalls?.() ?? [];
    if (!functionCalls.length) {
      const reply =
        extractText(response.candidates?.[0]?.content?.parts) ||
        response.text?.() ||
        "ما قدرتش أجاوب دلوقتي — جرّب تعيد صياغة السؤال.";

      try {
        const newHistory = await chat.getHistory();
        setChatHistory(chatId, newHistory as Content[]);
      } catch {
        // ignore history persistence failures
      }

      return { text: reply.trim(), usedTools };
    }

    const functionResponses: Part[] = [];
    for (const call of functionCalls) {
      usedTools.push(call.name);
      const toolResult = await executeBusinessTool(call.name, call.args);
      functionResponses.push({
        functionResponse: {
          name: call.name,
          response: toolResult,
        },
      });
    }

    result = await chat.sendMessage(functionResponses);
  }

  const fallback =
    "وصلت لحد أقصى من خطوات التحليل. جرّب سؤال أضيق شوية.";
  try {
    const newHistory = await chat.getHistory();
    setChatHistory(chatId, newHistory as Content[]);
  } catch {
    // ignore
  }
  return { text: fallback, usedTools };
}
