import eslint from "@eslint/js";
import tseslint from "typescript-eslint";

export default tseslint.config(
  { ignores: ["**/dist/**", "**/coverage/**", "**/node_modules/**"] },
  eslint.configs.recommended,
  ...tseslint.configs.strict,
  {
    rules: {
      // Los montos son enteros en centavos: prohibimos parseFloat y toFixed para no meter decimales por error.
      "no-restricted-globals": ["error", { name: "parseFloat", message: "Los montos se manejan en centavos enteros. Usá pesosACentavos()." }],
      "no-restricted-properties": [
        "error",
        { object: "Number", property: "parseFloat", message: "Los montos se manejan en centavos enteros. Usá pesosACentavos()." },
        { property: "toFixed", message: "No uses toFixed con montos: usá formatearPesos()." },
      ],
    },
  },
);
