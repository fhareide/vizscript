import svelte from "rollup-plugin-svelte";
import resolve from "@rollup/plugin-node-resolve";
import commonjs from "@rollup/plugin-commonjs";
import { terser } from "rollup-plugin-terser";
import typescript from "@rollup/plugin-typescript";
import path from "path";
import fs from "fs";

const production = !process.env.ROLLUP_WATCH;

export default fs.readdirSync(path.join(__dirname, "webviews", "pages")).map((input) => {
  const name = input.split(".")[0];
  return {
    input: path.resolve(__dirname, "webviews", "pages", input),
    output: {
      sourcemap: true,
      format: "iife",
      name: "app",
      file: path.resolve(__dirname, "out", `${name}.js`),
    },
    plugins: [
      svelte({
        compilerOptions: {
          dev: !production,
          css: (css) => {
            css.write(path.resolve(__dirname, "out", `${name}.css`));
          },
        },
      }),
      resolve({
        browser: true,
        dedupe: ["svelte"],
      }),
      commonjs(),
      typescript({
        tsconfig: path.resolve(__dirname, "webviews", "tsconfig.json"), // Path to your tsconfig.json
        sourceMap: !production,
        inlineSources: !production,
      }),
      production && terser(),
    ],
    watch: {
      clearScreen: false,
    },
  };
});