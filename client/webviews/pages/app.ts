import App from "../components/App.svelte";

declare global {
  interface Window {
    viewId: string;
  }
}

const app = new App({
  target: document.body,
  props: {
    viewId: window.viewId || "default", // Access the global variable set in the HTML
  },
});

export default app;
