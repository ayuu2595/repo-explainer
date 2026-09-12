import { useState, useEffect } from "react";
import "./App.css";

function App() {
  const [state, setState] = useState("config"); // config | processing | ready
  const [apiStatus, setApiStatus] = useState("checking...");

  useEffect(() => {
    fetch("http://localhost:4000/api/health")
      .then((r) => r.json())
      .then((data) => setApiStatus(data.ok ? "connected ✅" : "error ❌"))
      .catch(() => setApiStatus("unreachable ❌"));
  }, []);

  return (
    <div style={{ padding: "2rem", fontFamily: "sans-serif" }}>
      <h1>Repo Explainer</h1>
      <p>Backend status: {apiStatus}</p>
      <p>Current state: {state}</p>
      {state === "config" && (
        <button onClick={() => setState("processing")}>
          Fake: go to processing
        </button>
      )}
    </div>
  );
}

export default App;