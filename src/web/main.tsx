import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./index.css";

function Shell() {
  return (
    <main className="mx-auto max-w-3xl p-6">
      <h1 className="text-2xl font-semibold">Kensaku</h1>
      <p className="text-muted-foreground">Local shopping research chat.</p>
    </main>
  );
}

const root = document.getElementById("root");
if (!root) throw new Error("Missing #root element");
createRoot(root).render(
  <StrictMode>
    <Shell />
  </StrictMode>,
);
