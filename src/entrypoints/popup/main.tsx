import { render } from "preact";
import { App } from "../../popup/App.js";
import "../../popup/styles.css";

const root = document.getElementById("app");
if (root === null) {
  throw new Error("popup root element #app is missing");
}
render(<App />, root);
