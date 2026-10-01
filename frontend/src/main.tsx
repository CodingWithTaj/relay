import { StrictMode, useEffect } from "react";
import { createRoot } from "react-dom/client";
import { api } from "./api";
import { Shell } from "./components/Shell";
import { useRoute } from "./hooks";
import Dashboard from "./pages/Dashboard";
import Landing from "./pages/Landing";
import MonitorPage from "./pages/MonitorPage";
import ReplayPage from "./pages/ReplayPage";
import StatusPage from "./pages/StatusPage";
import "./styles.css";

function App() {
  const [page, arg] = useRoute();
  useEffect(() => {
    if (page === "dashboard") document.title = "Monitors | Relay";
    if (page === "monitors") document.title = "Monitor | Relay";
  }, [page]);
  // the marketing page is for the public demo; a self-hosted install opens on the dashboard
  if (!page) return api.demo ? <Landing /> : <Dashboard />;
  if (page === "dashboard") return <Dashboard />;
  if (page === "status") return <StatusPage />;
  if (page === "monitors" && Number(arg)) return <MonitorPage id={Number(arg)} />;
  if (page === "incidents" && Number(arg)) return <ReplayPage id={Number(arg)} />;
  return (
    <Shell>
      <div className="mx-auto max-w-[720px] px-6 py-24">
        <h1 className="text-[32px] font-semibold tracking-tight">That page doesn't exist</h1>
        <p className="mt-2 text-muted">Try the <a className="font-medium text-ink underline" href="#/dashboard">dashboard</a> or the <a className="font-medium text-ink underline" href="#/status">status page</a>.</p>
      </div>
    </Shell>
  );
}

createRoot(document.getElementById("root")!).render(<StrictMode><App /></StrictMode>);
