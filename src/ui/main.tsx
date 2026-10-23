import { render } from "preact";
import { App } from "./app";

render(<App />, document.getElementById("app")!);

// Sense connexió l'app només s'obre si el service worker n'ha guardat una còpia (D-44)
if (import.meta.env.PROD && "serviceWorker" in navigator) {
  void navigator.serviceWorker.register(`${import.meta.env.BASE_URL}sw.js`).catch(() => { /* sense còpia: només amb connexió */ });
}
