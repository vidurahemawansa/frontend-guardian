import { BrowserRouter, Routes, Route } from "react-router-dom";
import { Sidebar }         from "./components/Sidebar.js";
import { HealthPage }      from "./pages/HealthPage.js";
import { EventsPage }      from "./pages/EventsPage.js";
import { EventDetailPage } from "./pages/EventDetailPage.js";

export function App() {
  return (
    <BrowserRouter>
      <div style={{ display: "flex", minHeight: "100vh" }}>
        <Sidebar />
        <main style={{ flex: 1, overflow: "auto" }}>
          <Routes>
            <Route path="/"           element={<HealthPage />} />
            <Route path="/events"     element={<EventsPage />} />
            <Route path="/events/:id" element={<EventDetailPage />} />
          </Routes>
        </main>
      </div>
    </BrowserRouter>
  );
}
