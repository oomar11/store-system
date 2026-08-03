import type { Content, Part } from "@google/generative-ai";
import { createGeminiModel, isGeminiConfigured } from "./gemini";
import {
  looksLikeGeminiApiKey,
  saveGeminiApiKey,
} from "./gemini-config";
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

function extractGeminiKeyCommand(text: string): string | null {
  const trimmed = text.trim();
  const cmd = trimmed.match(
    /^\/(?:gemini|set_gemini|setkey|مفتاح)(?:@\w+)?(?:\s+|$)([\s\S]*)$/i
  );
  if (cmd) {
    const rest = (cmd[1] || "").trim();
    return rest || null;
  }
  if (looksLikeGeminiApiKey(trimmed)) return trimmed;
  return null;
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
    const ready = await isGeminiConfigured();
    return {
      text: ready
        ? JARVIS_START_MESSAGE
        : `${JARVIS_START_MESSAGE}\n\n⚠️ المفتاح لسه مش محفوظ. ابعت:\n/gemini مفتاح_Gemini`,
      usedTools: [],
    };
  }
  if (lower === "/help" || lower === "help" || text === "مساعدة") {
    return {
      text: `${JARVIS_HELP_MESSAGE}\n\nضبط المفتاح:\n/gemini YOUR_API_KEY`,
      usedTools: [],
    };
  }
  if (lower === "/reset" || lower === "reset") {
    clearChatHistory(chatId);
    return { text: "تم مسح سياق المحادثة. اسأل من جديد.", usedTools: [] };
  }

  const keyFromMsg = extractGeminiKeyCommand(text);
  if (keyFromMsg !== null) {
    if (!keyFromMsg) {
      return {
        text: "ابعت المفتاح بعد الأمر، مثال:\n/gemini AQ.xxxxx",
        usedTools: [],
      };
    }
    const saved = await saveGeminiApiKey({ api_key: keyFromMsg });
    if (!saved.ok) {
      return { text: `فشل حفظ المفتاح: ${saved.error}`, usedTools: [] };
    }
    return {
      text: `✅ تم حفظ مفتاح Gemini (${saved.key_masked}).\nتقدر تسألني عن المبيعات والمخزون دلوقتي.`,
      usedTools: [],
    };
  }

  if (!(await isGeminiConfigured())) {
    return {
      text: "المساعد غير جاهز — ابعت مفتاح Gemini كده:\n/gemini YOUR_API_KEY",
      usedTools: [],
    };
  }

  const model = await createGeminiModel();
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
