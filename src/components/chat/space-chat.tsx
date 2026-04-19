"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import {
  X,
  Send,
  MessageCircle,
  Search,
  Pencil,
  Plus,
  Check,
  XCircle,
  Loader2,
  Trash2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  useSpaceChat,
  type ChatOperation,
  type ProposedChange,
  type ChatMessage,
  type ShellLevel,
} from "@/lib/hooks/use-space-chat";
import type { Entity } from "@/types";

const OPERATIONS: {
  id: ChatOperation;
  label: string;
  icon: typeof MessageCircle;
  description: string;
  color: string;
  bg: string;
}[] = [
  {
    id: "question",
    label: "Ask",
    icon: MessageCircle,
    description: "Ask about the graph",
    color: "text-blue-600",
    bg: "bg-blue-50 border-blue-200 hover:bg-blue-100",
  },
  {
    id: "explore",
    label: "Explore",
    icon: Search,
    description: "Explore a concept deeper",
    color: "text-purple-600",
    bg: "bg-purple-50 border-purple-200 hover:bg-purple-100",
  },
  {
    id: "update",
    label: "Update",
    icon: Pencil,
    description: "Modify existing graph",
    color: "text-amber-600",
    bg: "bg-amber-50 border-amber-200 hover:bg-amber-100",
  },
  {
    id: "extend",
    label: "Extend",
    icon: Plus,
    description: "Add new concepts",
    color: "text-green-600",
    bg: "bg-green-50 border-green-200 hover:bg-green-100",
  },
];

// ── Proposed Change Card ──

function ChangeCard({
  change,
  onAccept,
  onReject,
}: {
  change: ProposedChange;
  onAccept: () => void;
  onReject: () => void;
}) {
  const typeLabels: Record<string, string> = {
    add_entity: "Add entity",
    add_edge: "Add edge",
    update_entity: "Update entity",
    update_edge: "Update edge",
    remove_edge: "Remove edge",
  };

  const typeColors: Record<string, string> = {
    add_entity: "bg-green-50 border-green-200",
    add_edge: "bg-blue-50 border-blue-200",
    update_entity: "bg-amber-50 border-amber-200",
    update_edge: "bg-amber-50 border-amber-200",
    remove_edge: "bg-red-50 border-red-200",
  };

  return (
    <div
      className={cn(
        "rounded-lg border p-2.5 text-xs",
        change.status === "accepted"
          ? "border-green-300 bg-green-50/50 opacity-70"
          : change.status === "rejected"
            ? "border-gray-200 bg-gray-50 opacity-50"
            : typeColors[change.type] ?? "border-gray-200 bg-gray-50"
      )}
    >
      <div className="flex items-center justify-between">
        <span className="font-medium text-gray-700">
          {typeLabels[change.type] ?? change.type}
        </span>
        {change.status === "accepted" && change.analyzing && (
          <span className="flex items-center gap-1 text-amber-600">
            <Loader2 className="h-3 w-3 animate-spin" /> Analyzing...
          </span>
        )}
        {change.status === "accepted" && !change.analyzing && (
          <span className="flex items-center gap-1 text-green-600">
            <Check className="h-3 w-3" /> Applied
          </span>
        )}
        {change.status === "rejected" && (
          <span className="flex items-center gap-1 text-gray-400">
            <XCircle className="h-3 w-3" /> Rejected
          </span>
        )}
      </div>
      <p className="mt-1 text-gray-600">{change.description}</p>
      {change.status === "pending" && (
        <div className="mt-2 flex gap-1.5">
          <button
            onClick={onAccept}
            className="flex items-center gap-1 rounded-md bg-green-600 px-2.5 py-1 text-white hover:bg-green-700 transition-colors"
          >
            <Check className="h-3 w-3" /> Accept
          </button>
          <button
            onClick={onReject}
            className="flex items-center gap-1 rounded-md border border-gray-300 px-2.5 py-1 text-gray-600 hover:bg-gray-100 transition-colors"
          >
            <XCircle className="h-3 w-3" /> Reject
          </button>
        </div>
      )}
    </div>
  );
}

// ── Message Bubble ──

function MessageBubble({
  message,
  onAcceptChange,
  onRejectChange,
}: {
  message: ChatMessage;
  onAcceptChange: (changeId: string) => void;
  onRejectChange: (changeId: string) => void;
}) {
  const isUser = message.role === "user";

  // Strip the <<<CHANGES>>>...<<<END_CHANGES>>> block from displayed text
  const displayContent = message.content.replace(
    /<<<CHANGES>>>[\s\S]*?<<<END_CHANGES>>>/g,
    ""
  ).trim();

  return (
    <div className={cn("flex flex-col gap-1", isUser ? "items-end" : "items-start")}>
      {/* Operation badge for user messages */}
      {isUser && message.operation && (
        <span className="text-[10px] font-medium text-gray-400 uppercase tracking-wider px-1">
          {message.operation}
          {message.entityContext && ` · ${message.entityContext.name}`}
        </span>
      )}

      <div
        className={cn(
          "max-w-[85%] rounded-xl px-3.5 py-2.5 text-sm leading-relaxed",
          isUser
            ? "bg-interaxis-600 text-white rounded-br-sm"
            : "bg-gray-100 text-gray-800 rounded-bl-sm"
        )}
      >
        {/* Render text with basic line breaks */}
        {displayContent ? (
          displayContent.split("\n").map((line, i) => (
            <span key={i}>
              {i > 0 && <br />}
              {line}
            </span>
          ))
        ) : (
          !isUser && <Loader2 className="h-4 w-4 animate-spin text-gray-400" />
        )}
      </div>

      {/* Proposed changes */}
      {message.proposedChanges && message.proposedChanges.length > 0 && (
        <div className="mt-1 w-full max-w-[85%] space-y-1.5">
          <span className="text-[10px] font-medium text-gray-400 uppercase tracking-wider px-1">
            Proposed changes ({message.proposedChanges.length})
          </span>
          {message.proposedChanges.map((change) => (
            <ChangeCard
              key={change.id}
              change={change}
              onAccept={() => onAcceptChange(change.id)}
              onReject={() => onRejectChange(change.id)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

// ── Entity Context Selector ──

function EntitySelector({
  entities,
  selected,
  onSelect,
}: {
  entities: Entity[];
  selected: { id: string; name: string } | null;
  onSelect: (ctx: { id: string; name: string } | null) => void;
}) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");

  const filtered = entities
    .filter((e) =>
      e.name.toLowerCase().includes(search.toLowerCase()) ||
      e.entity_id.toLowerCase().includes(search.toLowerCase())
    )
    .slice(0, 15);

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className={cn(
          "flex items-center gap-1 rounded-md border px-2 py-1 text-xs transition-colors",
          selected
            ? "border-interaxis-300 bg-interaxis-50 text-interaxis-700"
            : "border-gray-200 text-gray-400 hover:text-gray-600 hover:border-gray-300"
        )}
      >
        {selected ? (
          <>
            <span className="font-medium">{selected.id}</span>
            <span className="truncate max-w-[80px]">{selected.name}</span>
            <button
              onClick={(e) => {
                e.stopPropagation();
                onSelect(null);
              }}
              className="ml-1 text-gray-400 hover:text-gray-600"
            >
              <X className="h-3 w-3" />
            </button>
          </>
        ) : (
          "Focus entity..."
        )}
      </button>
    );
  }

  return (
    <div className="relative">
      <input
        autoFocus
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        placeholder="Search entities..."
        className="w-40 rounded-md border border-interaxis-300 px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-interaxis-400"
      />
      {filtered.length > 0 && (
        <div className="absolute bottom-full left-0 mb-1 max-h-40 w-56 overflow-y-auto rounded-lg border border-gray-200 bg-white shadow-lg z-50">
          {filtered.map((e) => (
            <button
              key={e.id}
              onMouseDown={() => {
                onSelect({ id: e.entity_id, name: e.name });
                setOpen(false);
                setSearch("");
              }}
              className="flex w-full items-center gap-2 px-2.5 py-1.5 text-xs text-left hover:bg-gray-50"
            >
              <span className="font-mono text-gray-400">{e.entity_id}</span>
              <span className="truncate text-gray-700">{e.name}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Focus Breadcrumb ──

function FocusBreadcrumb({
  stack,
  onPopToIndex,
  onClear,
}: {
  stack: ShellLevel[];
  onPopToIndex: (index: number) => void;
  onClear: () => void;
}) {
  if (stack.length === 0) return null;

  return (
    <div className="flex items-center gap-1 px-4 py-1.5 border-b border-gray-100 bg-gray-50/50 text-[11px] overflow-x-auto">
      <button
        onClick={onClear}
        className="flex-shrink-0 text-gray-400 hover:text-gray-600 font-medium transition-colors"
      >
        Space
      </button>
      {stack.map((level, i) => {
        const isLast = i === stack.length - 1;
        const label =
          level.type === "entity"
            ? `${level.entityId}: ${level.name}`
            : level.type === "edge"
              ? level.label
              : level.type === "insight"
                ? level.summary.slice(0, 30) + (level.summary.length > 30 ? "…" : "")
                : level.label;

        const typeColor =
          level.type === "entity"
            ? "text-purple-600 bg-purple-50"
            : level.type === "edge"
              ? "text-blue-600 bg-blue-50"
              : level.type === "insight"
                ? "text-amber-600 bg-amber-50"
                : "text-gray-600";

        return (
          <span key={i} className="flex items-center gap-1 flex-shrink-0">
            <span className="text-gray-300">›</span>
            {isLast ? (
              <span className={cn("rounded px-1.5 py-0.5 font-medium", typeColor)}>
                {label}
              </span>
            ) : (
              <button
                onClick={() => onPopToIndex(i)}
                className="text-gray-500 hover:text-gray-700 hover:underline transition-colors truncate max-w-[120px]"
              >
                {label}
              </button>
            )}
          </span>
        );
      })}
    </div>
  );
}

// ── Main Chat Panel ──

export function SpaceChat({
  spaceId,
  entities,
  onClose,
  onGraphChanged,
  mode = "overlay",
  /** External ref to access pushFocus from outside (e.g., graph clicks) */
  onChatReady,
}: {
  spaceId: string;
  entities: Entity[];
  onClose?: () => void;
  onGraphChanged?: () => void;
  mode?: "overlay" | "inline";
  onChatReady?: (api: { pushFocus: (level: ShellLevel) => void; clearFocus: () => void }) => void;
}) {
  const {
    messages, streaming, error, sendMessage, acceptChange, rejectChange, clearChat,
    focusStack, pushFocus, popFocus, popToIndex, clearFocus, derivedEntityContext,
  } = useSpaceChat(spaceId, onGraphChanged);

  const [input, setInput] = useState("");
  const [operation, setOperation] = useState<ChatOperation>("question");
  const [entityContext, setEntityContext] = useState<{ id: string; name: string } | null>(null);

  // Expose pushFocus to parent so graph clicks can trigger drilling
  useEffect(() => {
    onChatReady?.({ pushFocus, clearFocus });
  }, [onChatReady, pushFocus, clearFocus]);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Auto-scroll to bottom
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  // Close on Escape (overlay mode only)
  useEffect(() => {
    if (mode !== "overlay" || !onClose) return;
    function handleKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose!();
    }
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [onClose, mode]);

  const handleSend = useCallback(() => {
    if (!input.trim() || streaming) return;
    // Manual entityContext takes precedence, otherwise the hook derives from focus stack
    sendMessage(input.trim(), operation, entityContext ?? undefined);
    setInput("");
    // Don't clear entity context — user may want to keep asking about the same entity
  }, [input, operation, entityContext, streaming, sendMessage]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const activeOp = OPERATIONS.find((o) => o.id === operation)!;

  const isInline = mode === "inline";

  const chatContent = (
    <div
      className={cn(
        "flex flex-col bg-white",
        isInline
          ? "h-full"
          : "fixed right-0 top-0 z-50 h-full w-[420px] border-l border-gray-200 shadow-xl"
      )}
    >
      {/* Header */}
      <div className="flex items-center justify-between border-b border-gray-200 px-4 py-3">
        <div className="flex items-center gap-2">
          <MessageCircle className="h-4 w-4 text-interaxis-500" />
          <h2 className="text-sm font-semibold">Chat with Graph</h2>
          {focusStack.length > 0 && (
            <span className="rounded-full bg-purple-100 px-1.5 py-0.5 text-[10px] font-semibold text-purple-600">
              {focusStack.length} deep
            </span>
          )}
        </div>
        <div className="flex items-center gap-1">
          {messages.length > 0 && (
            <button
              onClick={clearChat}
              className="rounded p-1.5 text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition-colors"
              title="Clear chat"
            >
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          )}
          {!isInline && onClose && (
            <button
              onClick={onClose}
              className="rounded p-1.5 text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition-colors"
            >
              <X className="h-4 w-4" />
            </button>
          )}
        </div>
      </div>

      {/* Focus breadcrumb */}
      <FocusBreadcrumb
        stack={focusStack}
        onPopToIndex={popToIndex}
        onClear={clearFocus}
      />

      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-4 py-3 space-y-3">
        {messages.length === 0 && (
          <div className="flex flex-col items-center justify-center h-full text-center px-6">
            <MessageCircle className="h-10 w-10 text-gray-200 mb-3" />
            <p className="text-sm font-medium text-gray-500">
              Ask questions, explore concepts, or propose changes
            </p>
            <p className="mt-1.5 text-xs text-gray-400 leading-relaxed">
              Use <strong>Ask</strong> to query the graph, <strong>Explore</strong> to dive deeper into a concept,{" "}
              <strong>Update</strong> to modify existing nodes, or <strong>Extend</strong> to add new ones.
            </p>
          </div>
        )}

        {messages.map((msg) => (
          <MessageBubble
            key={msg.id}
            message={msg}
            onAcceptChange={(changeId) => acceptChange(msg.id, changeId)}
            onRejectChange={(changeId) => rejectChange(msg.id, changeId)}
          />
        ))}
        <div ref={messagesEndRef} />
      </div>

      {/* Error */}
      {error && (
        <div className="mx-4 mb-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-600">
          {error}
        </div>
      )}

      {/* Input area */}
      <div className="border-t border-gray-200 p-3 space-y-2.5">
        {/* Operation selector */}
        <div className="flex items-center gap-1.5 flex-wrap">
          {OPERATIONS.map((op) => {
            const Icon = op.icon;
            const isActive = operation === op.id;
            return (
              <button
                key={op.id}
                onClick={() => setOperation(op.id)}
                title={op.description}
                className={cn(
                  "flex items-center gap-1 rounded-md border px-2 py-1 text-xs font-medium transition-colors",
                  isActive
                    ? `${op.bg} ${op.color} border-current`
                    : "border-transparent text-gray-400 hover:text-gray-600 hover:bg-gray-50"
                )}
              >
                <Icon className="h-3 w-3" />
                {op.label}
              </button>
            );
          })}
        </div>

        {/* Entity context + input row */}
        <div className="flex items-center gap-2">
          {(operation === "explore" || operation === "update") && (
            <EntitySelector
              entities={entities}
              selected={entityContext}
              onSelect={(ctx) => {
                setEntityContext(ctx);
                // Also push to focus stack when user selects an entity
                if (ctx) {
                  pushFocus({ type: "entity", entityId: ctx.id, name: ctx.name });
                }
              }}
            />
          )}
          {/* Show current focus from stack if no manual entity selected */}
          {operation !== "explore" && operation !== "update" && derivedEntityContext && (
            <div className="flex items-center gap-1 rounded-md border border-purple-200 bg-purple-50 px-2 py-1 text-xs text-purple-700">
              <span className="font-medium">{derivedEntityContext.id}</span>
              <span className="truncate max-w-[80px]">{derivedEntityContext.name}</span>
              <button
                onClick={clearFocus}
                className="ml-1 text-purple-400 hover:text-purple-600"
              >
                <X className="h-3 w-3" />
              </button>
            </div>
          )}
        </div>

        <div className="flex items-center gap-2">
          <input
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={
              derivedEntityContext
                ? `Ask about ${derivedEntityContext.name}...`
                : operation === "question"
                  ? "Ask about the graph..."
                  : operation === "explore"
                    ? "What do you want to explore?"
                    : operation === "update"
                      ? "What should change?"
                      : "What should be added?"
            }
            disabled={streaming}
            className="flex-1 rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm placeholder-gray-400 focus:border-interaxis-400 focus:outline-none focus:ring-1 focus:ring-interaxis-400/30 disabled:opacity-50"
          />
          <Button
            onClick={handleSend}
            disabled={!input.trim() || streaming}
            size="sm"
            className="h-9 w-9 p-0 flex-shrink-0"
          >
            {streaming ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Send className="h-4 w-4" />
            )}
          </Button>
        </div>
      </div>
    </div>
  );

  if (isInline) return chatContent;

  return (
    <>
      {/* Backdrop */}
      <div className="fixed inset-0 z-40 bg-black/10" onClick={onClose} />
      {chatContent}
    </>
  );
}
