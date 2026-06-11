import { NextResponse } from "next/server";
import { safeAuth, safeJsonParse } from "@/lib/api-helpers";
import { llmGenerate, BEST_CLAUDE_MODEL, BEST_FAST_CLAUDE_MODEL, detectCreditError } from "@/lib/llm";
import type { AnyDb, KgCollection, KgNode } from "@/lib/trove/kg";

// Trove folder-agents — any collection can "become an agent": it gets a
// persona distilled from its contents and an iMessage-style thread.
//
//   GET    → thread messages + agent meta
//   POST   {enable:true}    → write persona + send the opening briefing
//   POST   {message}        → chat grounded in the folder + cross-trove context
//   POST   {briefing:true}  → "daily reminder": what matters most right now,
//                             cross-analyzed against the rest of the trove
//   DELETE → retire the agent (thread kept)

export const maxDuration = 90;

interface Body {
  enable?: unknown;
  briefing?: unknown;
  message?: unknown;
}

async function loadAgentContext(db: AnyDb, userId: string, collectionId: string) {
  const d = db;
  const [{ data: collection }, { data: nodes }, { data: elsewhere }] = await Promise.all([
    d.from("kg_collections").select("*").eq("id", collectionId).eq("user_id", userId).maybeSingle(),
    d
      .from("kg_nodes")
      .select("id, title, summary, kind, causal_role, depth, tags, created_at")
      .eq("collection_id", collectionId)
      .eq("user_id", userId)
      .order("created_at", { ascending: false })
      .limit(40),
    d
      .from("kg_nodes")
      .select("id, title, kind, collection_id, created_at")
      .eq("user_id", userId)
      .neq("collection_id", collectionId)
      .order("created_at", { ascending: false })
      .limit(30),
  ]);
  return {
    collection: collection as KgCollection | null,
    nodes: (nodes ?? []) as KgNode[],
    elsewhere: (elsewhere ?? []) as KgNode[],
  };
}

function folderDigest(nodes: KgNode[]): string {
  return nodes
    .map((n) => `- "${n.title}" (${n.kind}${n.causal_role ? `/${n.causal_role}` : ""}): ${n.summary ?? ""}`)
    .join("\n")
    .slice(0, 6000);
}

export async function GET(
  _request: Request,
  ctx: { params: Promise<{ collectionId: string }> },
) {
  const { collectionId } = await ctx.params;
  const auth = await safeAuth();
  if (auth.error) return auth.error;
  const { supabase: db, user } = auth;

  const [{ data: collection }, { data: messages }] = await Promise.all([
    db.from("kg_collections").select("*").eq("id", collectionId).eq("user_id", user.id).maybeSingle(),
    db
      .from("kg_agent_messages")
      .select("*")
      .eq("collection_id", collectionId)
      .eq("user_id", user.id)
      .order("created_at", { ascending: true })
      .limit(200),
  ]);
  if (!collection) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json({ collection, messages: messages ?? [] });
}

export async function POST(
  request: Request,
  ctx: { params: Promise<{ collectionId: string }> },
) {
  const { collectionId } = await ctx.params;
  const auth = await safeAuth();
  if (auth.error) return auth.error;
  const { supabase: db, user } = auth;

  const parsed = await safeJsonParse<Body>(request);
  if (parsed.error) return parsed.error;
  const body = parsed.data;

  const { collection, nodes, elsewhere } = await loadAgentContext(db, user.id, collectionId);
  if (!collection) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const digest = folderDigest(nodes);

  try {
    // ── Enable: distill a persona + opening message ──
    if (body.enable === true) {
      const persona = await llmGenerate({
        provider: "anthropic",
        model: BEST_FAST_CLAUDE_MODEL,
        maxTokens: 400,
        system:
          "Write a 3-5 sentence persona for a personal companion agent that lives inside one " +
          "folder of the user's knowledge base. Define: its voice (warm, texts like a sharp " +
          "friend — short iMessage-length lines), its job (connect this folder to the user's " +
          "life and goals, nudge daily, surface what matters most), and its domain expertise " +
          "based on the folder contents. Second person ('You are…'). No preamble.",
        user: `Folder: "${collection.name}"\nContents:\n${digest || "(empty so far)"}`,
      });

      await db
        .from("kg_collections")
        .update({
          is_agent: true,
          agent_persona: persona.slice(0, 2000),
          agent_enabled_at: new Date().toISOString(),
        })
        .eq("id", collectionId)
        .eq("user_id", user.id);

      const opener = await llmGenerate({
        provider: "anthropic",
        model: BEST_CLAUDE_MODEL,
        maxTokens: 500,
        system:
          `${persona}\n\nWrite your FIRST text to the user: introduce what you'll watch over ` +
          "in one line, then 2-3 short observations about what's already in the folder and one " +
          "question that helps you understand what they're optimizing for. iMessage style — " +
          "short lines, line breaks between thoughts, no markdown headers, max ~80 words.",
        user: `Folder "${collection.name}" contents:\n${digest || "(empty)"}`,
      });
      const { data: msg } = await db
        .from("kg_agent_messages")
        .insert({
          user_id: user.id,
          collection_id: collectionId,
          role: "agent",
          body: opener.trim(),
          kind: "chat",
        })
        .select("*")
        .single();
      return NextResponse.json({ enabled: true, persona, message: msg });
    }

    const persona =
      collection.agent_persona ??
      `You are a warm, sharp companion agent for the user's "${collection.name}" folder. You text like a close friend who happens to be an expert in this domain.`;

    // ── Daily briefing: cross-analyze the folder against the rest of the trove ──
    if (body.briefing === true) {
      const recentElsewhere = elsewhere
        .map((n) => `- "${n.title}" (${n.kind})`)
        .join("\n")
        .slice(0, 2000);
      const text = await llmGenerate({
        provider: "anthropic",
        model: BEST_CLAUDE_MODEL,
        maxTokens: 700,
        system:
          `${persona}\n\nWrite today's briefing text. Structure (no headers, just short ` +
          "iMessage-style lines with line breaks):\n" +
          "1. The ONE thing in this folder that matters most right now, and why\n" +
          "2. A cross-connection: how something they collected ELSEWHERE recently relates to " +
          "this folder (this is your superpower — name both sides)\n" +
          "3. One small concrete action for today (≤15 min)\n" +
          "4. One question that sharpens what success looks like for them\n" +
          "Max ~120 words. Warm, specific, zero fluff.",
        user:
          `Folder "${collection.name}":\n${digest || "(empty)"}\n\n` +
          `Collected elsewhere recently:\n${recentElsewhere || "(nothing else yet)"}`,
      });
      const { data: msg } = await db
        .from("kg_agent_messages")
        .insert({
          user_id: user.id,
          collection_id: collectionId,
          role: "agent",
          body: text.trim(),
          kind: "briefing",
        })
        .select("*")
        .single();
      return NextResponse.json({ message: msg });
    }

    // ── Chat turn ──
    const message = typeof body.message === "string" ? body.message.trim().slice(0, 2000) : "";
    if (!message) return NextResponse.json({ error: "Empty message" }, { status: 400 });

    const { data: userMsg } = await db
      .from("kg_agent_messages")
      .insert({
        user_id: user.id,
        collection_id: collectionId,
        role: "user",
        body: message,
        kind: "chat",
      })
      .select("*")
      .single();

    const { data: recent } = await db
      .from("kg_agent_messages")
      .select("role, body")
      .eq("collection_id", collectionId)
      .eq("user_id", user.id)
      .order("created_at", { ascending: false })
      .limit(12);
    const thread = (recent ?? [])
      .reverse()
      .map((m) => `${m.role === "agent" ? "You" : "Them"}: ${m.body}`)
      .join("\n");

    const reply = await llmGenerate({
      provider: "anthropic",
      model: BEST_CLAUDE_MODEL,
      maxTokens: 600,
      system:
        `${persona}\n\nYou know the folder inside out and can see the rest of their trove. ` +
        "Reply like a text conversation: short lines, concrete, reference their actual saved " +
        "items by name when relevant. No markdown headers or bullets-with-asterisks. ≤100 words " +
        "unless they asked for depth.",
      user:
        `Folder "${collection.name}":\n${digest || "(empty)"}\n\n` +
        `Elsewhere in their trove: ${elsewhere.map((n) => n.title).join("; ").slice(0, 1200)}\n\n` +
        `Thread so far:\n${thread}\n\nReply to their last message.`,
    });
    const { data: agentMsg } = await db
      .from("kg_agent_messages")
      .insert({
        user_id: user.id,
        collection_id: collectionId,
        role: "agent",
        body: reply.trim(),
        kind: "chat",
      })
      .select("*")
      .single();

    return NextResponse.json({ userMessage: userMsg, message: agentMsg });
  } catch (err) {
    const credit = detectCreditError(err);
    if (credit.isCredit) {
      return NextResponse.json({ error: credit.message, credit: true }, { status: 402 });
    }
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Agent failed" },
      { status: 500 },
    );
  }
}

export async function DELETE(
  _request: Request,
  ctx: { params: Promise<{ collectionId: string }> },
) {
  const { collectionId } = await ctx.params;
  const auth = await safeAuth();
  if (auth.error) return auth.error;
  const { supabase: db, user } = auth;
  const { error } = await db
    .from("kg_collections")
    .update({ is_agent: false })
    .eq("id", collectionId)
    .eq("user_id", user.id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ disabled: true });
}
