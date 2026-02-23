import React from "react";
import { createRoot } from "react-dom/client";

import { App } from "./App";
import { ErrorBoundary } from "./ErrorBoundary";

const root = document.getElementById("root");
if (!root) {
  throw new Error("Root element #root not found. The HTML template may be missing or incorrect.");
}

createRoot(root).render(
  <React.StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </React.StrictMode>,
);
