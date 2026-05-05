"use client";

import { createContext, useContext } from "react";

export type ExternalExpandApi = {
  hasChildren: (entityId: string) => boolean;
  isExpanded: (entityId: string) => boolean;
  toggle: (entityId: string) => void;
};

const noopApi: ExternalExpandApi = {
  hasChildren: () => false,
  isExpanded: () => false,
  toggle: () => {},
};

export const ExternalExpandContext = createContext<ExternalExpandApi>(noopApi);

export function useExternalExpand(): ExternalExpandApi {
  return useContext(ExternalExpandContext);
}
