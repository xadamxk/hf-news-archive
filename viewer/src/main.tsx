import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import "./index.css";
import "react-datepicker/dist/react-datepicker.min.css";

const mosaicPath = `${import.meta.env.BASE_URL}mosaic_bl.png`;
document.documentElement.style.setProperty("--mosaic-url", `url("${mosaicPath}")`);

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>
);
