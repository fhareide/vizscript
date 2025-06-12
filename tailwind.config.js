/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ["./client/webviews/**/*.{svelte,html,js,ts}"],
  theme: {
    extend: {},
  },
  plugins: [require("@githubocto/tailwind-vscode")],
};
