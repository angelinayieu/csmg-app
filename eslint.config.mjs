import { dirname } from "path";
import { fileURLToPath } from "url";
import { FlatCompat } from "@eslint/eslintrc";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const compat = new FlatCompat({
  baseDirectory: __dirname,
});

const eslintConfig = [
  ...compat.extends("next/core-web-vitals"),
  {
    rules: {
      "@typescript-eslint/no-unused-vars": ["warn", { argsIgnorePattern: "^_" }],
      "@typescript-eslint/no-explicit-any": "off",
      // Catches the class of bug that wiped the canvas on pan/zoom:
      // <Context.Provider value={{ ... }}> creates a fresh object every
      // render, cascading re-renders to every consumer. With ~30 kg-node
      // cards each consuming the context, this dropped frames mid-pan.
      // Force callers to memoize via useMemo/useCallback or extract to
      // a stable variable.
      "react/jsx-no-constructed-context-values": "error",
    },
  },
];

export default eslintConfig;
