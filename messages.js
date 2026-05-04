const express = require("express");
const auth = require("../middleware/auth");
const User = require("../models/User");
const Message = require("../models/Message");
const { conversationKey, toClientMessage } = require("../utils/serializers");

const router = express.Router();
const AUTO_REPLY_ENABLED = String(process.env.AUTO_REPLY_ENABLED || "true").toLowerCase() !== "false";
const AUTO_REPLY_DELAY_MIN_MS = 80;
const AUTO_REPLY_DELAY_MAX_MS = 250;
const OLLAMA_ENABLED = String(process.env.OLLAMA_ENABLED || "true").toLowerCase() !== "false";
const OLLAMA_BASE_URL = String(process.env.OLLAMA_BASE_URL || "http://127.0.0.1:11434").replace(/\/+$/, "");
const OLLAMA_MODEL = String(process.env.OLLAMA_MODEL || "llama3.2:1b");
const OLLAMA_TIMEOUT_MS = Math.max(6000, Number(process.env.OLLAMA_TIMEOUT_MS) || 14000);
const OLLAMA_NUM_PREDICT = Math.max(40, Number(process.env.OLLAMA_NUM_PREDICT) || 70);
const OLLAMA_NUM_CTX = Math.max(512, Number(process.env.OLLAMA_NUM_CTX) || 1024);
const OLLAMA_TEMPERATURE = Math.max(0, Math.min(1, Number(process.env.OLLAMA_TEMPERATURE) || 0.4));
const BOT_DETAILED_FOLLOWUP_ENABLED =
  String(process.env.BOT_DETAILED_FOLLOWUP_ENABLED || "true").toLowerCase() !== "false";
const BOT_MIN_FOLLOWUP_CHARS = Math.max(80, Number(process.env.BOT_MIN_FOLLOWUP_CHARS) || 140);
const BOT_MESSAGE_MAX_LENGTH = 1200;
const BOT_HISTORY_LIMIT = 2;
const BOT_CONTEXT_CHARS = 120;
const DEFAULT_BOT_NAME = "Skill Bot";
const SKILL_EXPLANATIONS = {
  "api design": "API design is about clear resources, predictable endpoints, and clean request/response contracts.",
  aws: "AWS is about choosing managed services wisely and wiring scalable, secure cloud architecture.",
  canva: "Canva proficiency means structuring visual hierarchy quickly with templates, spacing, and brand consistency.",
  "content writing": "Content writing means matching tone to audience while keeping each paragraph focused on one intent.",
  "data analysis": "Data analysis is framing a question, cleaning data, then validating insights before communicating results.",
  "data visualization": "Data visualization is choosing the right chart type so patterns become obvious at a glance.",
  "digital marketing": "Digital marketing is using audience targeting, hooks, and conversion tracking to improve campaign ROI.",
  excel: "Excel proficiency means combining formulas, lookup logic, and pivot summaries to answer business questions fast.",
  figma: "Figma skill means building reusable components and consistent spacing so UI systems scale cleanly.",
  guitar: "Guitar proficiency is clean chord transitions, timing control, and targeted practice loops for weak sections.",
  "html/css": "HTML/CSS proficiency is semantic structure plus maintainable layout systems with responsive styling.",
  "interview prep": "Interview prep is combining strong stories, role-fit examples, and calm structured communication.",
  java: "Java proficiency means strong object-oriented design, readable class boundaries, and reliable error handling.",
  "machine learning": "Machine learning is selecting features, validating model quality, and avoiding overfitting with sound evaluation.",
  mongodb: "MongoDB skill means good schema decisions, indexes for query speed, and safe update/query patterns.",
  "node.js": "Node.js proficiency means event-driven backend design, async flow control, and maintainable API layering.",
  photography: "Photography skill is using light, framing, and depth intentionally to communicate mood and subject focus.",
  python: "Python proficiency means writing clean functions, choosing the right libraries, and debugging with fast feedback loops.",
  react: "React skill is managing state intentionally, composing components, and avoiding unnecessary re-renders.",
  sql: "SQL proficiency means accurate joins, filtering/aggregation logic, and query performance awareness with indexing.",
  "system design": "System design proficiency means balancing scale, reliability, and simplicity while explaining tradeoffs clearly.",
  "public speaking": "Public speaking skill means clear structure, controlled pacing, and audience-focused storytelling.",
  "video editing": "Video editing proficiency is pacing cuts, narrative flow, and audio/visual balance for engagement.",
};

function firstName(name = "") {
  const trimmed = String(name).trim();
  if (!trimmed) {
    return "there";
  }

  return trimmed.split(/\s+/)[0];
}

function isChatbotUser(user) {
  if (!user) {
    return false;
  }

  if (user.isBot === true) {
    return true;
  }

  return /@skillswap\.io$/i.test(String(user.email || ""));
}

function pickBySeed(options, seed) {
  if (!Array.isArray(options) || options.length === 0) {
    return "";
  }

  const safeSeed = Math.abs(Number(seed) || 0);
  return options[safeSeed % options.length];
}

function inferIntent(text = "") {
  const normalized = String(text).toLowerCase().trim();
  if (!normalized) {
    return "empty";
  }

  if (/\b(hi|hello|hey|yo|namaste)\b/.test(normalized)) {
    return "greeting";
  }
  if (/\b(thanks|thank you|thx)\b/.test(normalized)) {
    return "thanks";
  }
  if (/\b(when|time|schedule|today|tomorrow|weekend|available)\b/.test(normalized)) {
    return "scheduling";
  }
  if (/\b(stuck|confused|difficult|hard|not understand|help)\b/.test(normalized)) {
    return "stuck";
  }
  if (normalized.includes("?")) {
    return "question";
  }

  return "general";
}

function normalizeSkillKey(skill = "") {
  return String(skill)
    .toLowerCase()
    .replace(/[^a-z0-9/+.#\s-]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function resolveSkillKey(skill = "") {
  const normalized = normalizeSkillKey(skill);
  if (!normalized) {
    return "";
  }

  const aliasMap = {
    javascript: "react",
    js: "react",
    "node": "node.js",
    "nodejs": "node.js",
    "node js": "node.js",
    "html css": "html/css",
    css: "html/css",
    html: "html/css",
    "ui design": "figma",
    "api": "api design",
    "data viz": "data visualization",
    "public speech": "public speaking",
  };

  return aliasMap[normalized] || normalized;
}

function inferTopic(text = "", recipient = {}) {
  const normalized = String(text).toLowerCase();
  const offered = Array.isArray(recipient.skillsOffered) ? recipient.skillsOffered : [];
  const wanted = Array.isArray(recipient.skillsWanted) ? recipient.skillsWanted : [];
  const candidates = [...offered, ...wanted].filter(Boolean);

  const matching = candidates.find((skill) => normalized.includes(String(skill).toLowerCase()));
  if (matching) {
    return matching;
  }

  if (offered.length) {
    return offered[0];
  }

  return recipient.category || "your goal";
}

function isSkillOverviewRequest(text = "") {
  const normalized = String(text).toLowerCase();
  return /\b(skill|skills|proficient|proficiency|good at|expertise|teach|can you teach|what can you|what do you know)\b/.test(
    normalized
  );
}

function isExampleRequest(text = "") {
  const normalized = String(text).toLowerCase();
  return /\b(example|sample|query|sql|join|code|syntax|show me|demo)\b/.test(normalized);
}

function buildPracticalExample(topic = "") {
  const resolved = resolveSkillKey(topic);
  if (resolved === "sql" || resolved === "mongodb" || /sql|database|join/.test(String(topic).toLowerCase())) {
    return [
      "Here is one SQL join example:",
      "SELECT u.name, s.skill",
      "FROM users u",
      "JOIN skills s ON s.user_id = u.id",
      "WHERE s.level = 'advanced';",
      "This INNER JOIN returns users and skills where both rows match by user_id.",
    ].join("\n");
  }

  return [
    `Here is one practical example for ${topic}:`,
    `1. Start with the core concept in ${topic}.`,
    "2. Apply it to one tiny real task.",
    "3. Review the result and improve one thing.",
  ].join("\n");
}

function skillExplanation(skill = "", recipient = {}) {
  const resolved = resolveSkillKey(skill);
  const canned = SKILL_EXPLANATIONS[resolved];
  if (canned) {
    return canned;
  }

  const category = String(recipient.category || "general").toLowerCase();
  return `${skill || category} proficiency means understanding fundamentals, practicing real use cases, and improving through feedback.`;
}

function buildSkillOverview(recipient = {}, seed = 0) {
  const offered = Array.isArray(recipient.skillsOffered) ? recipient.skillsOffered.filter(Boolean) : [];
  if (!offered.length) {
    return "I can coach through practical skill breakdowns and tailored exercises based on your goal.";
  }

  const primary = offered.slice(0, 3);
  const start = Math.abs(Number(seed) || 0) % primary.length;
  const rotated = primary.slice(start).concat(primary.slice(0, start));
  const lines = rotated.map((skill) => `${skill}: ${skillExplanation(skill, recipient)}`);
  return `I am most proficient in ${rotated.join(", ")}. ${lines.join(" ")}`;
}

function buildPersonaTone(recipient = {}) {
  const category = String(recipient.category || "").toLowerCase();
  const botName = firstName(recipient.name || DEFAULT_BOT_NAME);

  const styles = {
    programming: `I am ${botName}, your coding coach.`,
    design: `I am ${botName}, your design thinking partner.`,
    music: `I am ${botName}, your rhythm and practice buddy.`,
    language: `I am ${botName}, your language conversation partner.`,
    business: `I am ${botName}, your strategy and communication guide.`,
    creative: `I am ${botName}, your creativity sparring partner.`,
    other: `I am ${botName}, your SkillSwap chatbot.`,
  };

  return styles[category] || styles.other;
}

function normalizeDisplayText(text = "") {
  return String(text || "")
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function normalizeCompactText(text = "") {
  return String(text || "").replace(/\s+/g, " ").trim();
}

function removeMarkdownFormatting(text = "") {
  return String(text || "")
    .replace(/```[\w-]*\n?/g, "")
    .replace(/```/g, "")
    .replace(/\*\*(.*?)\*\*/g, "$1")
    .replace(/^\s*#{1,6}\s*/gm, "")
    .trim();
}

function clampDisplayText(text = "", maxLength = BOT_MESSAGE_MAX_LENGTH) {
  const value = normalizeDisplayText(removeMarkdownFormatting(text));
  if (value.length <= maxLength) {
    return value;
  }

  const sliced = value.slice(0, maxLength - 1);
  const lastSentenceStop = Math.max(sliced.lastIndexOf("."), sliced.lastIndexOf("!"), sliced.lastIndexOf("?"));
  if (lastSentenceStop >= 80) {
    return `${sliced.slice(0, lastSentenceStop + 1).trim()}`;
  }

  const lastLineBreak = sliced.lastIndexOf("\n");
  if (lastLineBreak >= 60) {
    return `${sliced.slice(0, lastLineBreak).trim()}`;
  }

  const lastSpace = sliced.lastIndexOf(" ");
  if (lastSpace >= 80) {
    return `${sliced.slice(0, lastSpace).trim()}...`;
  }

  return `${sliced.trim()}...`;
}

function clampCompactText(text = "", maxLength = BOT_CONTEXT_CHARS) {
  const value = normalizeCompactText(text);
  if (value.length <= maxLength) {
    return value;
  }

  const sliced = value.slice(0, maxLength - 1);
  const lastSpace = sliced.lastIndexOf(" ");
  if (lastSpace >= 20) {
    return `${sliced.slice(0, lastSpace).trim()}...`;
  }

  return `${sliced.trim()}...`;
}

function toBriefContext(text = "") {
  return clampCompactText(String(text || ""), BOT_CONTEXT_CHARS);
}

function normalizeCompareText(text = "") {
  return String(text || "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function shouldPostFollowup(initialText = "", generatedText = "") {
  const base = normalizeCompareText(initialText);
  const generated = normalizeCompareText(generatedText);
  if (!generated) {
    return false;
  }
  if (!base) {
    return true;
  }
  if (generated === base) {
    return false;
  }
  if (base.length >= 24 && generated.includes(base)) {
    return false;
  }
  if (generated.length < BOT_MIN_FOLLOWUP_CHARS) {
    return false;
  }

  return true;
}

function buildOllamaSystemPrompt({ sender, recipient, topic }) {
  const persona = buildPersonaTone(recipient);
  const offeredSkills = Array.isArray(recipient.skillsOffered) ? recipient.skillsOffered.filter(Boolean) : [];
  const wantedSkills = Array.isArray(recipient.skillsWanted) ? recipient.skillsWanted.filter(Boolean) : [];
  const skillSummary = offeredSkills.length ? offeredSkills.slice(0, 4).join(", ") : recipient.category || "general coaching";
  const focusExplanation = skillExplanation(topic, recipient);
  const senderName = firstName(sender?.name);

  return [
    `${persona} You are a friendly SkillSwap mentor.`,
    `Student: ${senderName}.`,
    `Teach using these skills: ${skillSummary}.`,
    wantedSkills.length ? `Likely interest: ${wantedSkills.slice(0, 4).join(", ")}.` : "",
    `Current topic: ${topic}.`,
    `Guide note: ${focusExplanation}`,
    `Answer in 4 short sentences: explanation + one example + one next step.`,
    `For SQL/database questions include one valid SQL query and a short explanation.`,
    `Keep reply under ${BOT_MESSAGE_MAX_LENGTH} chars, plain text.`,
  ]
    .filter(Boolean)
    .join(" ");
}

function mapHistoryToChatMessages({ recipient, recentMessages }) {
  const chronological = [...recentMessages].sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));
  return chronological.map((message) => {
    const isBotTurn = message.fromId === recipient.publicId;
    return {
      role: isBotTurn ? "assistant" : "user",
      content: toBriefContext(message.text || ""),
    };
  });
}

async function generateReplyFromOllama({ sender, recipient, originalText, recentMessages, fallbackText }) {
  if (!OLLAMA_ENABLED) {
    return fallbackText;
  }

  const topic = inferTopic(originalText, recipient);
  const systemPrompt = buildOllamaSystemPrompt({ sender, recipient, topic });
  const conversation = mapHistoryToChatMessages({ recipient, recentMessages });

  if (!conversation.length) {
    conversation.push({ role: "user", content: toBriefContext(originalText) });
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), OLLAMA_TIMEOUT_MS);

  try {
    let generated = "";

    const chatResponse = await fetch(`${OLLAMA_BASE_URL}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      signal: controller.signal,
      body: JSON.stringify({
        model: OLLAMA_MODEL,
        stream: false,
        keep_alive: "15m",
        messages: [{ role: "system", content: systemPrompt }, ...conversation],
        options: {
          temperature: OLLAMA_TEMPERATURE,
          top_p: 0.8,
          num_ctx: OLLAMA_NUM_CTX,
          num_predict: OLLAMA_NUM_PREDICT,
        },
      }),
    });

    if (chatResponse.ok) {
      const payload = await chatResponse.json();
      generated = clampDisplayText(payload?.message?.content || payload?.response || "");
    } else if (chatResponse.status === 404) {
      const transcript = conversation
        .map((entry) => `${entry.role === "assistant" ? "Mentor" : "Student"}: ${entry.content}`)
        .join("\n");
      const prompt = `${systemPrompt}\n\n${transcript}\nMentor:`;

      const legacyResponse = await fetch(`${OLLAMA_BASE_URL}/api/generate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: controller.signal,
        body: JSON.stringify({
          model: OLLAMA_MODEL,
          stream: false,
          keep_alive: "15m",
          prompt,
          options: {
            temperature: OLLAMA_TEMPERATURE,
            top_p: 0.8,
            num_ctx: OLLAMA_NUM_CTX,
            num_predict: OLLAMA_NUM_PREDICT,
          },
        }),
      });

      if (!legacyResponse.ok) {
        throw new Error(`Ollama HTTP ${legacyResponse.status}`);
      }

      const legacyPayload = await legacyResponse.json();
      generated = clampDisplayText(legacyPayload?.response || "");
    } else {
      throw new Error(`Ollama HTTP ${chatResponse.status}`);
    }

    if (!generated) {
      return fallbackText;
    }

    return generated;
  } catch (error) {
    if (fallbackText) {
      console.error("Ollama generation failed:", error.message);
    }
    return fallbackText;
  } finally {
    clearTimeout(timeout);
  }
}

function buildAutoReply({ sender, recipient, originalText, turnCount, recentMessages }) {
  const senderFirstName = firstName(sender?.name);
  const intent = inferIntent(originalText);
  const topic = inferTopic(originalText, recipient);
  const persona = buildPersonaTone(recipient);
  const seed = String(originalText || "").length + turnCount * 17 + String(topic).length;
  const topicExplanation = skillExplanation(topic, recipient);
  const hasQuestionFromBot = recentMessages.some(
    (message) =>
      message.fromId === recipient.publicId &&
      String(message.text || "").includes("?")
  );

  if (isExampleRequest(originalText)) {
    return `${buildPracticalExample(topic)}\nNext step: send your attempt and I will review it.`;
  }

  if (isSkillOverviewRequest(originalText)) {
    return `${persona} ${buildSkillOverview(recipient, seed)} Which one should we go deeper on first?`;
  }

  if (intent === "greeting") {
    return `${persona} Great to meet you, ${senderFirstName}. I am strong in ${topic}. ${topicExplanation} Want to start there?`;
  }

  if (intent === "thanks") {
    return `You are welcome, ${senderFirstName}. If you want, send one practical goal and I will turn it into a quick practice plan.`;
  }

  if (intent === "scheduling") {
    return pickBySeed(
      [
        `Perfect, I can do a 15-minute session. Share a time that works and we will focus on ${topic}. ${topicExplanation}`,
        `Sounds good. Let us plan a short session this week. What day works best for you?`,
        `Great idea. I am ready whenever you are. Prefer a quick drill or a full guided practice?`,
      ],
      seed
    );
  }

  if (intent === "stuck") {
    return pickBySeed(
      [
        `No worries, ${senderFirstName}. Let us break ${topic} into three tiny steps: concept, example, then your try. ${topicExplanation} Which step do you want first?`,
        `I have your back. We can simplify ${topic} together. Tell me the exact part that feels confusing and I will explain it plainly.`,
        `That is normal while learning. Let us start with one small example in ${topic} and build confidence from there.`,
      ],
      seed
    );
  }

  if (intent === "question") {
    return pickBySeed(
      [
        `Great question. For ${topic}, start with the core principle, then apply it to one mini task. ${topicExplanation} Want me to give you that mini task now?`,
        `Nice question, ${senderFirstName}. Here is the short answer: keep it simple, then iterate. Want a step-by-step for ${topic}?`,
        `Solid question. We can tackle ${topic} in a practical way. Should I suggest a 10-minute exercise?`,
      ],
      seed
    );
  }

  if (turnCount <= 1) {
    return `Nice start, ${senderFirstName}. ${persona} Tell me your target outcome for ${topic}, and I will map a quick plan.`;
  }

  if (turnCount <= 3) {
    return pickBySeed(
      [
        `Good progress so far. Next step: try one focused practice on ${topic}, then share your result here.`,
        `You are doing well. Let us make this concrete: what is one small deliverable you can create using ${topic} today?`,
        `Great momentum. I can quiz you lightly on ${topic} or give feedback on your attempt. Which do you prefer?`,
      ],
      seed
    );
  }

  if (!hasQuestionFromBot) {
    return `We are building great momentum. What part of ${topic} should we improve next: basics, speed, or real-world application?`;
  }

  return pickBySeed(
    [
      `Love the consistency, ${senderFirstName}. Keep sharing updates and I will keep coaching you step by step.`,
      `Your progress is clear. Send your next attempt on ${topic} and I will give detailed feedback with improvements.`,
      `Great work. We can keep this as an ongoing practice thread whenever you want.`,
    ],
    seed
  );
}

async function queueAutoReply({ sender, recipient, originalText }) {
  if (!AUTO_REPLY_ENABLED || !sender || !recipient || !isChatbotUser(recipient)) {
    return;
  }

  const key = conversationKey(sender.publicId, recipient.publicId);
  const recentMessages = await Message.find({ conversationKey: key }).sort({ createdAt: -1 }).limit(BOT_HISTORY_LIMIT);
  const senderTurns = recentMessages.filter((message) => message.fromId === sender.publicId).length;
  const delayRange = AUTO_REPLY_DELAY_MAX_MS - AUTO_REPLY_DELAY_MIN_MS + 1;
  const delayMs = AUTO_REPLY_DELAY_MIN_MS + Math.floor(Math.random() * delayRange);
  const fallbackText = buildAutoReply({ sender, recipient, originalText, turnCount: senderTurns, recentMessages });

  setTimeout(async () => {
    try {
      await Message.create({
        fromId: recipient.publicId,
        toId: sender.publicId,
        conversationKey: key,
        text: fallbackText,
      });

      if (!OLLAMA_ENABLED || !BOT_DETAILED_FOLLOWUP_ENABLED) {
        return;
      }

      const latestMessages = await Message.find({ conversationKey: key }).sort({ createdAt: -1 }).limit(BOT_HISTORY_LIMIT);
      const generatedReply = await generateReplyFromOllama({
        sender,
        recipient,
        originalText,
        recentMessages: latestMessages,
        fallbackText: "",
      });

      if (!shouldPostFollowup(fallbackText, generatedReply)) {
        return;
      }

      await Message.create({
        fromId: recipient.publicId,
        toId: sender.publicId,
        conversationKey: key,
        text: generatedReply,
      });
    } catch (error) {
      console.error("Auto-reply creation failed:", error.message);
    }
  }, delayMs);
}

async function getCurrentUser(req) {
  return User.findById(req.user.id);
}

router.get("/", auth, async (req, res, next) => {
  try {
    const currentUser = await getCurrentUser(req);
    if (!currentUser) {
      return res.status(404).json({ message: "User not found" });
    }

    const otherId = req.query.otherId ? Number(req.query.otherId) : null;
    let filter;

    if (otherId) {
      filter = { conversationKey: conversationKey(currentUser.publicId, otherId) };
    } else {
      filter = {
        $or: [{ fromId: currentUser.publicId }, { toId: currentUser.publicId }],
      };
    }

    const messages = await Message.find(filter).sort({ createdAt: 1 });
    return res.status(200).json({ messages: messages.map(toClientMessage) });
  } catch (error) {
    return next(error);
  }
});

router.post("/:otherId", auth, async (req, res, next) => {
  try {
    const currentUser = await getCurrentUser(req);
    if (!currentUser) {
      return res.status(404).json({ message: "User not found" });
    }

    const otherId = Number(req.params.otherId);
    const text = String(req.body.text || "").trim();
    if (!Number.isInteger(otherId) || otherId <= 0) {
      return res.status(400).json({ message: "Invalid conversation user id" });
    }
    if (otherId === currentUser.publicId) {
      return res.status(400).json({ message: "You can't message yourself" });
    }
    if (!text) {
      return res.status(400).json({ message: "Message text is required" });
    }

    const recipient = await User.findOne({ publicId: otherId });
    if (!recipient) {
      return res.status(404).json({ message: "Recipient not found" });
    }

    const message = await Message.create({
      fromId: currentUser.publicId,
      toId: otherId,
      conversationKey: conversationKey(currentUser.publicId, otherId),
      text,
    });

    await queueAutoReply({
      sender: currentUser,
      recipient,
      originalText: text,
    });

    return res.status(201).json({ message: toClientMessage(message) });
  } catch (error) {
    return next(error);
  }
});

module.exports = router;
