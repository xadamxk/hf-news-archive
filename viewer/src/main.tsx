import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import "./index.css";
import "react-datepicker/dist/react-datepicker.min.css";

// Resolve to an absolute URL up-front. A relative `url()` inside a CSS custom
// property is resolved by some browsers against the using stylesheet (e.g.
// `/hf-news-archive/assets/index-*.css`) rather than the document, which would
// 404 on `mosaic_bl.png` since the asset lives at the deployment root.
const mosaicPath = new URL(
  `${import.meta.env.BASE_URL}mosaic_bl.png`,
  window.location.href,
).href;
document.documentElement.style.setProperty("--mosaic-url", `url("${mosaicPath}")`);

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>
);
