import { StrictMode } from "react";
import { createRoot, hydrateRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import App from "./App";
import { installSsrFetchCache, readAdminSsrPayload, setAdminSsrPayload } from "./ssr-data";
import { installCsrfFetch } from "./fetch-client";
import "./styles/admin.css";
import { installAdminPathNavigation } from "./admin-path";

const payload = readAdminSsrPayload();
setAdminSsrPayload(payload);
installSsrFetchCache(payload);
installCsrfFetch();
installAdminPathNavigation();

const tree = (
  <StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </StrictMode>
);
const root = document.getElementById("root")!;
if (payload) hydrateRoot(root, tree);
else createRoot(root).render(tree);
