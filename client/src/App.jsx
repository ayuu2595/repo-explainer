import { useState, useEffect, useRef } from "react";
import "./App.css";

const API_URL = "http://localhost:4000";

function App() {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [repoUrl, setRepoUrl] = useState("");
  const [estimate, setEstimate] = useState(null);
  const [ingestState, setIngestState] = useState(null);
  const [summary, setSummary] = useState(null);
  const [error, setError] = useState(null);
  const eventSourceRef = useRef(null);

  useEffect(() => {
    fetch(`${API_URL}/api/auth/me`, { credentials: "include" })
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => setUser(data?.user || null))
      .finally(() => setLoading(false));

    return () => {
      eventSourceRef.current?.close();
    };
  }, []);

  const handleLogin = () => {
    window.location.href = `${API_URL}/api/auth/github`;
  };

  const handleLogout = async () => {
    await fetch(`${API_URL}/api/auth/logout`, { method: "POST", credentials: "include" });
    setUser(null);
  };

  const handleEstimate = async () => {
    setError(null);
    setSummary(null);
    setIngestState(null);
    const res = await fetch(`${API_URL}/api/repos/estimate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ repoUrl }),
    });
    const data = await res.json();
    if (!res.ok) {
      setError(data.error);
      return;
    }
    setEstimate(data);
  };

  const fetchSummary = async (repoId) => {
    const summaryRes = await fetch(`${API_URL}/api/repos/${repoId}/summarize`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
    });
    const summaryData = await summaryRes.json();
    setSummary(summaryData);
  };

  const handleIngest = async () => {
    if (ingestState !== null) return;

    setError(null);
    setEstimate(null);
    setIngestState({ status: "ingesting", progress: 0, step: "Starting" });

    try {
      const res = await fetch(`${API_URL}/api/repos/ingest`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ repoUrl }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);

      if (data.skipped) {
        setIngestState(null);
        await fetchSummary(data.repoId);
        return;
      }

      const es = new EventSource(`${API_URL}/api/repos/${data.repoId}/progress`, {
        withCredentials: true,
      });
      eventSourceRef.current = es;

      es.onmessage = async (event) => {
        const update = JSON.parse(event.data);
        setIngestState(update);

        if (update.status === "ready") {
          es.close();
          await fetchSummary(data.repoId);
          setIngestState(null);
        }

        if (update.status === "failed") {
          es.close();
          setError(update.error || "Ingestion failed");
          setIngestState(null);
        }
      };

      es.onerror = () => {
        es.close();
        setError("Lost connection to progress stream");
        setIngestState(null);
      };
    } catch (err) {
      setError(err.message);
      setIngestState(null);
    }
  };

  if (loading) return <p>Loading...</p>;

  return (
    <div style={{ padding: "2rem", fontFamily: "sans-serif" }}>
      <h1>Repo Explainer</h1>

      {!user ? (
        <button onClick={handleLogin}>Login with GitHub</button>
      ) : (
        <div>
          <p>Logged in as {user.username} <button onClick={handleLogout}>Logout</button></p>

          <div style={{ marginTop: "1rem" }}>
            <input
              type="text"
              placeholder="https://github.com/owner/repo"
              value={repoUrl}
              onChange={(e) => setRepoUrl(e.target.value)}
              style={{ width: "300px" }}
            />
            <button onClick={handleEstimate} disabled={!repoUrl}>Analyze</button>
          </div>

          {error && <p style={{ color: "red" }}>{error}</p>}

          {estimate && (
            <div style={{ marginTop: "1rem" }}>
              <p>Files: {estimate.fileCount}</p>
              <p>Size: {estimate.totalSizeKB} KB</p>
              <p>Estimated chunks: {estimate.estimatedChunks}</p>
              <p>Estimated cost: ${estimate.estimatedCostUSD}</p>
              {estimate.tooLarge ? (
                <p style={{ color: "red" }}>Repository too large to ingest.</p>
              ) : (
                <button onClick={handleIngest} disabled={ingestState !== null}>Confirm & Ingest</button>
              )}
            </div>
          )}

          {ingestState && (
            <div style={{ marginTop: "1rem" }}>
              <p>{ingestState.step}</p>
              <div style={{ background: "#333", height: "8px", width: "300px", borderRadius: "4px" }}>
                <div
                  style={{
                    background: "#4ade80",
                    height: "8px",
                    width: `${ingestState.progress}%`,
                    borderRadius: "4px",
                    transition: "width 0.3s",
                  }}
                />
              </div>
              <p>{ingestState.progress}%</p>
            </div>
          )}

          {summary && (
            <div style={{ marginTop: "1.5rem", border: "1px solid #ccc", padding: "1rem" }}>
              <h2>Summary</h2>
              <p>{summary.summary}</p>
              <p><strong>Tech Stack:</strong> {summary.techStack.join(", ")}</p>
              <p><strong>Patterns:</strong> {summary.patterns.join(", ")}</p>
              <p>{summary.stats.files} files · {summary.stats.lines} lines · {summary.stats.languages} languages</p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default App;