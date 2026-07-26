import { createRoot } from "react-dom/client";
// Aliased in vite.config.ts to ./App.tsx (admin dashboard) or
// ./alts/AltsApp.tsx (alterations POS) depending on VITE_APP_TARGET.
import RootApp from "@root-app";
import "./index.css";

createRoot(document.getElementById("root")!).render(<RootApp />);
