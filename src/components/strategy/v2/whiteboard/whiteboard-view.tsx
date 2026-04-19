"use client";

import { useMemo } from "react";
import { useSpaceData } from "@/contexts/space-data-context";
import type { StrategicRecommendationData } from "@/types/strategy";
import type { SynthesisData } from "@/types/synthesis";
import type { CascadeRowVM } from "../strategy-view-model";
import { WhiteboardCanvas } from "./whiteboard-canvas";
import { buildWhiteboardModel } from "./build-whiteboard-model";

interface Props {
  synthData: SynthesisData | null | undefined;
  recommendation: StrategicRecommendationData | null | undefined;
  /** Cascade rows from the parent view-model — so the whiteboard embeds the SAME
   *  perspective → objective structure the Cascade tab shows. */
  cascade: CascadeRowVM[];
}

export function WhiteboardView({ synthData, recommendation, cascade }: Props) {
  const ctx = useSpaceData();

  const model = useMemo(
    () =>
      buildWhiteboardModel({
        spaceName: ctx.space.name,
        spaceInputPreview: ctx.space.input_text ?? null,
        entities: ctx.entities,
        synthData,
        recommendation,
        cascade,
        goals: ctx.goalList,
        activeGoal: ctx.activeGoal,
      }),
    [
      ctx.space.name,
      ctx.space.input_text,
      ctx.entities,
      synthData,
      recommendation,
      cascade,
      ctx.goalList,
      ctx.activeGoal,
    ]
  );

  return (
    <div
      className="relative rounded-[16px] border border-gray-200 bg-white/60 backdrop-blur overflow-hidden shadow-sm"
      style={{ height: "calc(100vh - 240px)", minHeight: 720 }}
    >
      <WhiteboardCanvas model={model} spaceId={ctx.space.id} />
    </div>
  );
}
