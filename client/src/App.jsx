import { useState, useEffect, useRef } from "react";
import "./App.css";

const API_URL = "http://localhost:4000";

function IconGithub() {
  return (
    <svg width="26" height="26" viewBox="0 0 24 24" fill="currentColor">
      <path d="M12 0C5.37 0 0 5.5 0 12.3c0 5.44 3.44 10.04 8.21 11.67.6.11.82-.27.82-.6 0-.29-.01-1.06-.02-2.08-3.34.75-4.04-1.65-4.04-1.65-.55-1.43-1.34-1.82-1.34-1.82-1.09-.77.08-.75.08-.75 1.21.09 1.85 1.27 1.85 1.27 1.07 1.87 2.81 1.33 3.5 1.02.11-.79.42-1.33.76-1.64-2.67-.31-5.47-1.37-5.47-6.1 0-1.35.47-2.45 1.24-3.31-.12-.31-.54-1.57.12-3.28 0 0 1.01-.33 3.3 1.27a11.2 11.2 0 0 1 6.02 0c2.29-1.6 3.3-1.27 3.3-1.27.66 1.71.24 2.97.12 3.28.77.86 1.24 1.96 1.24 3.31 0 4.74-2.81 5.78-5.49 6.09.43.38.81 1.13.81 2.28 0 1.65-.02 2.98-.02 3.38 0 .33.22.72.83.6C20.57 22.33 24 17.74 24 12.3 24 5.5 18.63 0 12 0Z" />
    </svg>
  );
}

function IconSend() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
      <line x1="12" y1="19" x2="12" y2="5" />
      <polyline points="6 11 12 5 18 11" />
    </svg>
  );
}

function IconLogout() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
      <polyline points="16 17 21 12 16 7" />
      <line x1="21" y1="12" x2="9" y2="12" />
    </svg>
  );
}

function IconPlus() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round">
      <line x1="12" y1="5" x2="12" y2="19" />
      <line x1="5" y1="12" x2="19" y2="12" />
    </svg>
  );
}

function IconRefresh() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="23 4 23 10 17 10" />
      <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10" />
    </svg>
  );
}

function ChatMessage({ msg }) {
  return (
    <div className={"message-row " + msg.role}>
      <div className={"bubble " + msg.role}>
        {msg.content}
        {msg.sources && msg.sources.length > 0 ? (
          <div className="bubble-sources">
            {msg.sources.map((s, j) => (
              <a key={j} href={s.url} target="_blank" rel="noopener noreferrer" className="source-chip">
                {s.path}
              </a>
            ))}
          </div>
        ) : null}
      </div>
    </div>
  );
}

function App() {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [repos, setRepos] = useState([]);
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
  const chatEndRef = useRef(null);

  useEffect(() => {
    fetch(API_URL + "/api/auth/me", { credentials: "include" })
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => setUser(data ? data.user : null))
      .finally(() => setLoading(false));

    return () => {
      if (eventSourceRef.current) eventSourceRef.current.close();
    };
  }, []);

  useEffect(() => {
    if (user) refreshRepoList();
  }, [user]);

  useEffect(() => {
    if (chatEndRef.current) {
      chatEndRef.current.scrollIntoView({ behavior: "smooth" });
    }
  }, [chatMessages, chatLoading]);

  const refreshRepoList = async () => {
    const res = await fetch(API_URL + "/api/repos", { credentials: "include" });
    if (res.ok) {
      const data = await res.json();
      setRepos(data.repos || []);
    }
  };

  const handleLogin = () => {
    window.location.href = API_URL + "/api/auth/github";
  };

  const handleLogout = async () => {
    await fetch(API_URL + "/api/auth/logout", { method: "POST", credentials: "include" });
    setUser(null);
  };

  const resetToNewAnalysis = () => {
    if (eventSourceRef.current) eventSourceRef.current.close();
    setError(null);
    setEstimate(null);
    setIngestState(null);
    setSummary(null);
    setChatMessages([]);
    setActiveRepoId(null);
    setRepoUrl("");
  };

  const handleEstimate = async () => {
    setError(null);
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

  const attachProgressStream = (repoId, onDone) => {
    const es = new EventSource(API_URL + "/api/repos/" + repoId + "/progress", {
      withCredentials: true,
    });
    eventSourceRef.current = es;

    es.onmessage = async (event) => {
      const update = JSON.parse(event.data);
      setIngestState(update);

      if (update.status === "ready") {
        es.close();
        await fetchSummary(repoId);
        setIngestState(null);
        refreshRepoList();
        if (onDone) onDone();
      }

      if (update.status === "failed") {
        es.close();
        setError(update.error || "Ingestion failed");
        setIngestState(null);
        refreshRepoList();
      }
    };

    es.onerror = () => {
      es.close();
      setError("Lost connection to progress stream");
      setIngestState(null);
    };
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

      setActiveRepoId(data.repoId);
      refreshRepoList();

      if (data.skipped) {
        setIngestState(null);
        await fetchSummary(data.repoId);
        return;
      }

      attachProgressStream(data.repoId);
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
      attachProgressStream(activeRepoId);
    } catch (err) {
      setError(err.message);
      setIngestState(null);
    }
  };

  const handleSelectRepo = async (repo) => {
    if (eventSourceRef.current) eventSourceRef.current.close();
    setError(null);
    setEstimate(null);
    setSummary(null);
    setChatMessages([]);
    setIngestState(null);
    setActiveRepoId(repo.id);
    setRepoUrl("");

    if (repo.status === "ready") {
      await fetchSummary(repo.id);
      const msgRes = await fetch(API_URL + "/api/repos/" + repo.id + "/messages", { credentials: "include" });
      if (msgRes.ok) {
        const msgData = await msgRes.json();
        setChatMessages((msgData.messages || []).map((m) => ({ role: m.role, content: m.content })));
      }
    } else if (repo.status === "ingesting") {
      setIngestState({ status: "ingesting", progress: repo.progress, step: repo.step });
      attachProgressStream(repo.id);
    } else if (repo.status === "failed") {
      setError(repo.error || "Ingestion failed");
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
    return (
      <div className="login-screen">
        <p style={{ color: "var(--text-secondary)" }}>Loading…</p>
      </div>
    );
  }

  if (!user) {
    return (
      <div className="login-screen">
        <div className="login-mark"><IconGithub /></div>
        <h1 className="login-title">Repo Explainer</h1>
        <p className="login-subtitle">
          Point it at any public GitHub repository and ask questions about the actual code — grounded answers, real source links, no guessing.
        </p>
        <button className="btn btn-primary" onClick={handleLogin}>
          <IconGithub /> Continue with GitHub
        </button>
      </div>
    );
  }

  const activeRepo = repos.find((r) => r.id === activeRepoId);

  return (
    <div className="app-shell">
      <div className="sidebar">
        <div className="sidebar-header">
          <div className="sidebar-header-mark"><IconGithub /></div>
          <span className="sidebar-header-title">Repo Explainer</span>
        </div>

        <div className="sidebar-new">
          <button className="btn btn-secondary btn-full" onClick={resetToNewAnalysis}>
            <IconPlus /> New analysis
          </button>
        </div>

        <div className="sidebar-repos">
          <div className="sidebar-label">Analyzed repos</div>
          {repos.map((repo) => (
            <div
              key={repo.id}
              className={"repo-item" + (repo.id === activeRepoId ? " active" : "")}
              onClick={() => handleSelectRepo(repo)}
            >
              <span className={"status-dot " + repo.status}></span>
              <span className="repo-item-name">{repo.namespace}</span>
            </div>
          ))}
        </div>

        <div className="sidebar-footer">
          <div className="user-chip">
            <span className="user-avatar">{user.username.slice(0, 2).toUpperCase()}</span>
            <span>{user.username}</span>
          </div>
          <button className="btn-ghost btn" onClick={handleLogout} title="Log out">
            <IconLogout />
          </button>
        </div>
      </div>

      <div className="main">
        {activeRepo ? (
          <div className="main-topbar">
            <span className="main-topbar-name">{activeRepo.namespace}</span>
          </div>
        ) : null}

        <div className="main-scroll">
          {!activeRepoId && !estimate ? (
            <div className="hero">
              <h1 className="hero-title">What repo do you want to understand?</h1>
              <p className="hero-subtitle">Paste a public GitHub URL to get started.</p>
              <div className="hero-form">
                <input
                  className="input"
                  style={{ flex: 1 }}
                  type="text"
                  placeholder="https://github.com/owner/repo"
                  value={repoUrl}
                  onChange={(e) => setRepoUrl(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && handleEstimate()}
                />
                <button className="btn btn-primary" onClick={handleEstimate} disabled={!repoUrl}>
                  Analyze
                </button>
              </div>
              {error ? <div className="error-banner" style={{ maxWidth: 520 }}>{error}</div> : null}
            </div>
          ) : (
            <div className="content">
              {error ? <div className="error-banner">{error}</div> : null}

              {estimate ? (
                <div className="panel">
                  <div className="panel-row">
                    <span className="panel-row-label">Files</span>
                    <span className="panel-row-value">{estimate.fileCount}</span>
                  </div>
                  <div className="panel-row">
                    <span className="panel-row-label">Size</span>
                    <span className="panel-row-value">{estimate.totalSizeKB} KB</span>
                  </div>
                  <div className="panel-row">
                    <span className="panel-row-label">Estimated chunks</span>
                    <span className="panel-row-value">{estimate.estimatedChunks}</span>
                  </div>
                  <div className="panel-row">
                    <span className="panel-row-label">Estimated cost</span>
                    <span className="panel-row-value">${estimate.estimatedCostUSD}</span>
                  </div>
                  {estimate.tooLarge ? (
                    <p style={{ color: "var(--error)", fontSize: 13, marginTop: 12 }}>Repository too large to ingest.</p>
                  ) : (
                    <button className="btn btn-primary btn-full" style={{ marginTop: 14 }} onClick={handleIngest} disabled={ingestState !== null}>
                      Confirm & Ingest
                    </button>
                  )}
                </div>
              ) : null}

              {ingestState ? (
                <div className="panel">
                  <p className="progress-step">{ingestState.step}</p>
                  <div className="progress-track">
                    <div className="progress-fill" style={{ width: ingestState.progress + "%" }} />
                  </div>
                  <p className="progress-percent">{ingestState.progress}%</p>
                </div>
              ) : null}

              {summary ? (
                <div className="panel">
                  <h2 className="summary-title">Summary</h2>
                  <p className="summary-text">{summary.summary}</p>
                  {summary.techStack.length > 0 ? (
                    <div className="badge-row">
                      {summary.techStack.map((t, i) => <span key={i} className="badge">{t}</span>)}
                    </div>
                  ) : null}
                  {summary.patterns.length > 0 ? (
                    <div className="badge-row">
                      {summary.patterns.map((p, i) => <span key={i} className="badge">{p}</span>)}
                    </div>
                  ) : null}
                  <div className="summary-stats">
                    {summary.stats.files} files · {summary.stats.lines} lines · {summary.stats.languages} languages
                  </div>
                  {activeRepoId ? (
                    <button className="btn btn-secondary" style={{ marginTop: 14 }} onClick={handleResync} disabled={ingestState !== null}>
                      <IconRefresh /> Check for updates
                    </button>
                  ) : null}
                </div>
              ) : null}

              {summary && activeRepoId ? (
                <div className="chat-messages">
                  {chatMessages.map((msg, i) => (
                    <ChatMessage key={i} msg={msg} />
                  ))}
                  {chatLoading ? <p className="thinking">Thinking…</p> : null}
                  <div ref={chatEndRef} />
                </div>
              ) : null}
            </div>
          )}
        </div>

        {summary && activeRepoId ? (
          <div className="chat-input-bar">
            <div className="chat-input-inner">
              <textarea
                className="chat-input"
                rows={1}
                value={chatInput}
                onChange={(e) => setChatInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    handleSendMessage();
                  }
                }}
                placeholder="Ask about this codebase…"
              />
              <button className="btn btn-primary btn-icon" onClick={handleSendMessage} disabled={chatLoading || !chatInput.trim()}>
                <IconSend />
              </button>
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}

export default App;