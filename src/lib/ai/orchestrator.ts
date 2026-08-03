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

function extractFunctionCalls(parts: Part[] | undefined) {
  if (!parts?.length) return [];
  return parts
    .filter((p): p is Part & { functionCall: { name: string; args?: object } } =>
      Boolean(p && typeof p === "object" && "functionCall" in p && p.functionCall)
    )
    .map((p) => p.functionCall);
}

function sanitizeModelParts(parts: Part[] | undefined): Part[] {
  if (!parts?.length) return [{ text: "" }];
  // Preserve thoughtSignature / functionCall fields required by newer Gemini models.
  return parts.map((p) => ({ ...p })) as Part[];
}

/** Keep only plain user/model text turns for short chat memory. */
function textOnlyHistory(contents: Content[]): Content[] {
  return contents.filter((c) => {
    if (c.role !== "user" && c.role !== "model") return false;
    const parts = c.parts || [];
    if (!parts.length) return false;
    if (parts.some((p) => "functionCall" in p || "functionResponse" in p)) {
      return false;
    }
    return parts.some((p) => "text" in p && Boolean(p.text));
  });
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
  const contents: Content[] = [
    ...textOnlyHistory(getChatHistory(chatId)),
    { role: "user", parts: [{ text }] },
  ];
  const usedTools: string[] = [];

  for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
    const result = await model.generateContent({ contents });
    const response = result.response;
    const parts = response.candidates?.[0]?.content?.parts;
    const functionCalls = extractFunctionCalls(parts);

    // Always append model turn (needed before function responses)
    contents.push({
      role: "model",
      parts: sanitizeModelParts(parts),
    });

    if (!functionCalls.length) {
      const reply =
        extractText(parts) ||
        response.text?.() ||
        "ما قدرتش أجاوب دلوقتي — جرّب تعيد صياغة السؤال.";

      setChatHistory(chatId, textOnlyHistory(contents));
      return { text: reply.trim(), usedTools };
    }

    const functionResponses: Part[] = [];
    for (const call of functionCalls) {
      usedTools.push(call.name);
      const toolResult = await executeBusinessTool(call.name, call.args ?? {});
      functionResponses.push({
        functionResponse: {
          name: call.name,
          response: toolResult,
        },
      });
    }

    // Newer Gemini models reject role "function"; send responses as user parts.
    contents.push({ role: "user", parts: functionResponses });
  }

  setChatHistory(chatId, textOnlyHistory(contents));
  return {
    text: "وصلت لحد أقصى من خطوات التحليل. جرّب سؤال أضيق شوية.",
    usedTools,
  };
}
