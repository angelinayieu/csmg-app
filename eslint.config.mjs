// Direct flat-config import. Going through `FlatCompat.extends()`
// crashed with "Converting circular structure to JSON" because the
// modern eslint-config-next has circular references the legacy
// eslintrc compat layer can't serialize. eslint-config-next/dist/
// core-web-vitals already exports a flat-config array so we just
// spread it directly.
import nextCoreWebVitals from "eslint-config-next/core-web-vitals";

const eslintConfig = [
  ...nextCoreWebVitals,
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
