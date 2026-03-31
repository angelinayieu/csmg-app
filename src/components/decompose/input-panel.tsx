"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Sparkles } from "lucide-react";

const MAX_LENGTH = 50000;

export function InputPanel() {
  const [text, setText] = useState("");

  function handleDecompose() {
    // Week 2: This will trigger the actual decomposition API call
    alert("Decomposition engine coming in Week 2!");
  }

  return (
    <div className="mx-auto max-w-2xl">
      <h1 className="text-2xl font-bold">New Decomposition</h1>
      <p className="mt-1 text-sm text-gray-600 dark:text-gray-400">
        Paste a business situation, research problem, strategic plan, or any
        complex text to decompose into a structured knowledge graph.
      </p>

      <div className="mt-6">
        <Textarea
          id="decompose-input"
          placeholder="Enter a concept, question, situation, or text to decompose..."
          value={text}
          onChange={(e) => setText(e.target.value.slice(0, MAX_LENGTH))}
          rows={12}
          className="resize-y"
        />
        <div className="mt-2 flex items-center justify-between">
          <span className="text-xs text-gray-400">
            {text.length.toLocaleString()} / {MAX_LENGTH.toLocaleString()}{" "}
            characters
          </span>
          <Button
            onClick={handleDecompose}
            disabled={text.trim().length < 20}
            size="lg"
          >
            <Sparkles className="mr-2 h-4 w-4" />
            Decompose
          </Button>
        </div>
      </div>
    </div>
  );
}
