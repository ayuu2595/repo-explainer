import { useState, useEffect, useRef } from "react";
import "./App.css";

const API_URL = "http://localhost:4000";

function ChatMessage({ msg }) {
  return (
    <div style={{ marginBottom: "0.75rem", textAlign: msg.role === "user" ? "right" : "left" }}>
      <p style={{ margin: 0, fontWeight: msg.role === "user" ? "bold" : "normal" }}>
        {msg.content}
      </p>
      {msg.sources && msg.sources.length > 0 ? (
        <div style={{ fontSize: "0.8rem", marginTop: "0.25rem" }}>
          <span>Sources: </span>
          {msg.sources.map((s, j) => (
            <a key={j} href={s.url} target="_blank" rel="noopener noreferrer" style={{ marginRight: "0.5rem" }}>
              {s.path}
            </a>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function App() {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [repoUrl, setRepoUrl] = useState("");
  const [estimate, setEstimate] = useState(null);
  const [ingestState, setIngestState] = useState(null);
  const [summary, setSummary] = useState(null);
  const [error, setError] = useState(null);
  const [chatMessages, setChatMessages] = useState([]);
  const [chatInput, setChatInput] = useState("");
  const [chatLoading, setChatLoading] = useState(false);
  const [activeRepoId, setActiveRepoId] = useState(null);
  const eventSourceRef = useRef(null);

  useEffect(() => {
    fetch(API_URL + "/api/auth/me", { credentials: "include" })
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => setUser(data ? data.user : null))
      .finally(() => setLoading(false));

    return () => {
      if (eventSourceRef.current) eventSourceRef.current.close();
    };
  }, []);

  const handleLogin = () => {
    window.location.href = API_URL + "/api/auth/github";
  };

  const handleLogout = async () => {
    await fetch(API_URL + "/api/auth/logout", { method: "POST", credentials: "include" });
    setUser(null);
  };

  const handleEstimate = async () => {
    setError(null);
    setSummary(null);
    setIngestState(null);
    setChatMessages([]);
    setActiveRepoId(null);

    const res = await fetch(API_URL + "/api/repos/estimate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ repoUrl: repoUrl }),
    });
    const data = await res.json();
    if (!res.ok) {
      setError(data.error);
      return;
    }
    setEstimate(data);
  };

  const fetchSummary = async (repoId) => {
    const summaryRes = await fetch(API_URL + "/api/repos/" + repoId + "/summarize", {
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
      const res = await fetch(API_URL + "/api/repos/ingest", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ repoUrl: repoUrl }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);

      if (data.skipped) {
        setIngestState(null);
        setActiveRepoId(data.repoId);
        await fetchSummary(data.repoId);
        return;
      }

      const es = new EventSource(API_URL + "/api/repos/" + data.repoId + "/progress", {
        withCredentials: true,
      });
      eventSourceRef.current = es;

      es.onmessage = async (event) => {
        const update = JSON.parse(event.data);
        setIngestState(update);

        if (update.status === "ready") {
          es.close();
          setActiveRepoId(data.repoId);
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

  const handleResync = async () => {
    if (ingestState !== null || !activeRepoId) return;

    setError(null);

    try {
      const res = await fetch(API_URL + "/api/repos/" + activeRepoId + "/resync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);

      if (data.upToDate) {
        setError("Already up to date");
        return;
      }

      if (data.skipped) return;

      setIngestState({ status: "ingesting", progress: 0, step: "Checking for changes" });

      const es = new EventSource(API_URL + "/api/repos/" + activeRepoId + "/progress", {
        withCredentials: true,
      });
      eventSourceRef.current = es;

      es.onmessage = async (event) => {
        const update = JSON.parse(event.data);
        setIngestState(update);

        if (update.status === "ready") {
          es.close();
          await fetchSummary(activeRepoId);
          setIngestState(null);
        }

        if (update.status === "failed") {
          es.close();
          setError(update.error || "Resync failed");
          setIngestState(null);
        }
      };
    } catch (err) {
      setError(err.message);
      setIngestState(null);
    }
  };

  const handleSendMessage = async () => {
    if (!chatInput.trim() || !activeRepoId || chatLoading) return;

    const userMessage = chatInput.trim();
    setChatInput("");
    setChatLoading(true);

    const newMessages = chatMessages.concat([{ role: "user", content: userMessage }]);
    setChatMessages(newMessages);

    try {
      const res = await fetch(API_URL + "/api/repos/" + activeRepoId + "/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          message: userMessage,
          history: newMessages.slice(-6),
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);

      setChatMessages(newMessages.concat([{ role: "assistant", content: data.answer, sources: data.sources }]));
    } catch (err) {
      setChatMessages(newMessages.concat([{ role: "assistant", content: "Error: " + err.message, sources: [] }]));
    } finally {
      setChatLoading(false);
    }
  };

  if (loading) {
    return <p>Loading...</p>;
  }

  if (!user) {
    return (
      <div style={{ padding: "2rem", fontFamily: "sans-serif" }}>
        <h1>Repo Explainer</h1>
        <button onClick={handleLogin}>Login with GitHub</button>
      </div>
    );
  }

  return (
    <div style={{ padding: "2rem", fontFamily: "sans-serif" }}>
      <h1>Repo Explainer</h1>

      <p>
        Logged in as {user.username}
        <button onClick={handleLogout} style={{ marginLeft: "0.5rem" }}>Logout</button>
      </p>

      <div style={{ marginTop: "1rem" }}>
        <input
          type="text"
          placeholder="https://github.com/owner/repo"
          value={repoUrl}
          onChange={(e) => setRepoUrl(e.target.value)}
          style={{ width: "300px" }}
        />
        <button onClick={handleEstimate} disabled={!repoUrl} style={{ marginLeft: "0.5rem" }}>Analyze</button>
      </div>

      {error ? <p style={{ color: "red" }}>{error}</p> : null}

      {estimate ? (
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
      ) : null}

      {ingestState ? (
        <div style={{ marginTop: "1rem" }}>
          <p>{ingestState.step}</p>
          <div style={{ background: "#333", height: "8px", width: "300px", borderRadius: "4px" }}>
            <div
              style={{
                background: "#4ade80",
                height: "8px",
                width: ingestState.progress + "%",
                borderRadius: "4px",
                transition: "width 0.3s",
              }}
            />
          </div>
          <p>{ingestState.progress}%</p>
        </div>
      ) : null}

      {summary ? (
        <div style={{ marginTop: "1.5rem", border: "1px solid #ccc", padding: "1rem" }}>
          <h2>Summary</h2>
          <p>{summary.summary}</p>
          <p><strong>Tech Stack:</strong> {summary.techStack.join(", ")}</p>
          <p><strong>Patterns:</strong> {summary.patterns.join(", ")}</p>
          <p>{summary.stats.files} files, {summary.stats.lines} lines, {summary.stats.languages} languages</p>
          {activeRepoId ? (
            <button onClick={handleResync} disabled={ingestState !== null} style={{ marginTop: "0.5rem" }}>
              Check for Updates
            </button>
          ) : null}
        </div>
      ) : null}

      {summary && activeRepoId ? (
        <div style={{ marginTop: "1.5rem", border: "1px solid #ccc", padding: "1rem", maxWidth: "600px" }}>
          <h2>Chat</h2>
          <div style={{ maxHeight: "300px", overflowY: "auto", marginBottom: "1rem" }}>
            {chatMessages.map((msg, i) => (
              <ChatMessage key={i} msg={msg} />
            ))}
            {chatLoading ? <p>Thinking...</p> : null}
          </div>
          <div style={{ display: "flex", gap: "0.5rem" }}>
            <input
              type="text"
              value={chatInput}
              onChange={(e) => setChatInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") handleSendMessage();
              }}
              placeholder="Ask about this codebase..."
              style={{ flex: 1 }}
            />
            <button onClick={handleSendMessage} disabled={chatLoading || !chatInput.trim()}>
              Send
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

export default App;