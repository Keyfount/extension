import { render } from "preact";
import { App } from "../../options/App.js";
import "../../options/styles.css";

const root = document.getElementById("app");
if (root === null) {
  throw new Error("options root element #app is missing");
}
render(<App />, root);
