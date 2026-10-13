import { ConversationProvider } from "@elevenlabs/react";
import { BrowserRouter, Route, Routes } from "react-router-dom";
import { ElderScreen } from "./elder/ElderScreen";
import { Dashboard } from "./family/Dashboard";
import { HouseholdProvider, useHousehold } from "./lib/household-context";
import { Setup } from "./Setup";

function Gate({ children, forFamily }: { children: React.ReactNode; forFamily?: boolean }) {
  const { connection, household, error } = useHousehold();
  if (!connection) return <Setup forFamily={forFamily} />;
  if (!household) return <main className="loading">{error ?? "Loading…"}</main>;
  return <>{children}</>;
}

export function App() {
  return (
    <HouseholdProvider>
      <ConversationProvider>
        <BrowserRouter>
          <Routes>
            <Route path="/family" element={<Gate forFamily><Dashboard /></Gate>} />
            <Route path="*" element={<Gate><ElderScreen /></Gate>} />
          </Routes>
        </BrowserRouter>
      </ConversationProvider>
    </HouseholdProvider>
  );
}
