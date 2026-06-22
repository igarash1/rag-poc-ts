// Flat config (ESLint 9+). Type-aware linting via typescript-eslint.
import tseslint from "typescript-eslint";

export default tseslint.config(
  {
    ignores: ["node_modules", "dist", "reference"],
  },
  ...tseslint.configs.recommended,
  {
    rules: {
      // Allow leading-underscore "intentionally unused" args, matching the
      // Python convention of `_name` for throwaway / private bindings.
      "@typescript-eslint/no-unused-vars": [
        "warn",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
    },
  },
);
