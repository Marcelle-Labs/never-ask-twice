import type { SemanticFactRecord } from "../../../../src/memory/types.js";

export const ChatView = (messages: Array<{ role: string; message: string }>, sessionId: string, memoryOn: boolean, slaTier: string | null, qwenConfigured: boolean) => `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>NAT — Chat</title>
  <link rel="stylesheet" href="/static/index.css">
  <link rel="icon" href="data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'><text y='.9em' font-size='90'>🧠</text></svg>">
</head>
<body>
  <div class="app-container">
    <header>
      <div class="logo">Never Ask Twice</div>
      <div style="display:flex;gap:var(--sp-3);align-items:center;">
        <span class="badge ${memoryOn ? 'done' : 'todo'}" id="memory-status">${memoryOn ? 'Memory ON' : 'Memory OFF'}</span>
        <button class="secondary-btn" onclick="toggleMemory()">${memoryOn ? 'Simulate Cold Start' : 'Enable Memory'}</button>
        <button id="close-session-btn" onclick="closeSession()">Close session</button>
      </div>
    </header>

    <nav>
      <h3 class="panel-label">Scenario Context</h3>
      <div class="card">
        <div style="font-weight:700;margin-bottom:var(--sp-1);font-size:var(--text-base);">Customer: Jason</div>
        <div style="font-size:var(--text-sm);color:var(--text-muted);">SLA: ${slaTier ?? '—'}</div>
      </div>
      <div class="card">
        <div style="font-weight:700;margin-bottom:var(--sp-1);font-size:var(--text-sm);">Session</div>
        <div style="font-size:var(--text-xs);font-family:var(--font-mono);color:var(--text-muted);word-break:break-all;">${sessionId}</div>
      </div>
      <div style="margin-top:var(--sp-6);">
        <a href="/facts" style="color:var(--memory);font-size:var(--text-sm);text-decoration:none;">View Manager Dashboard →</a>
      </div>
    </nav>

    <main>
      <div class="message-list" id="chat-thread">
        ${messages.map(m => `
          <div class="message ${m.role}">
            <div class="content">${m.message}</div>
            <div class="message-meta">${m.role === 'customer' ? 'Jason' : 'Nat'} · Just now</div>
          </div>
        `).join('')}
      </div>
      <div style="padding:var(--sp-6);border-top:1px solid var(--border);background:var(--bg);">
        <form id="chat-form" style="display:flex;gap:var(--sp-3);">
          <input type="text" id="user-input" placeholder="Type a message…" required autocomplete="off">
          <button type="submit">Send</button>
        </form>
      </div>
    </main>

    <aside id="debug-panel">
      <h3 class="panel-label">Memory Trace</h3>
      <div id="trace-logs">
        <div class="trace-empty" id="trace-empty-state">
          <div class="trace-empty-ring"></div>
          <div>Awaiting first interaction</div>
        </div>
      </div>
    </aside>
  </div>

  <script>
    const sessionId = "${sessionId}";
    const form = document.getElementById('chat-form');
    const input = document.getElementById('user-input');
    const thread = document.getElementById('chat-thread');
    const trace = document.getElementById('trace-logs');
    const emptyState = document.getElementById('trace-empty-state');
    const closeBtn = document.getElementById('close-session-btn');
    const qwenConfigured = ${qwenConfigured};

    function escapeHtml(str) {
      return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
    }

    function hideEmpty() {
      if (emptyState) emptyState.style.display = 'none';
    }

    // status: 'semantic' | 'episodic' | 'working' | 'error'
    function addTrace(msg, status) {
      status = status || 'episodic';
      hideEmpty();
      var el = document.createElement('div');
      el.className = 'card trace-' + status + ' trace-new';
      var label = { semantic: 'RECALL', episodic: 'WRITE', working: '···', error: 'NOTICE' }[status] || 'WRITE';
      el.innerHTML = '<span class="badge badge-' + status + '" style="margin-bottom:var(--sp-2);">' + label + '</span>'
        + '<div style="font-size:var(--text-sm);margin-top:var(--sp-1);">' + escapeHtml(msg) + '</div>';
      trace.prepend(el);
    }

    function getMemoryMode() {
      return new URLSearchParams(window.location.search).get('memory') === 'off' ? 'off' : 'on';
    }

    // Parse "subject predicate object" → "predicate · object" chip label
    function chipLabel(fact) {
      var parts = fact.split(' ');
      return parts.length >= 3
        ? escapeHtml(parts[1]) + ' · ' + escapeHtml(parts.slice(2).join(' '))
        : escapeHtml(fact);
    }

    // Pre-populate a tagged semantic trace row; writeSweep fires on entry
    function addFactTrace(fact) {
      hideEmpty();
      var el = document.createElement('div');
      el.className = 'card trace-semantic trace-new';
      el.dataset.traceFact = fact;
      el.innerHTML = '<span class="badge badge-semantic" style="margin-bottom:var(--sp-2);">RECALL</span>'
        + '<div style="font-size:var(--text-xs);font-family:var(--font-mono);margin-top:var(--sp-1);">'
        + chipLabel(fact) + '</div>';
      trace.prepend(el);
    }

    // Single shared beat: chip render + trace-row glow in one synchronous call
    function fireRecallBeat(answer, citedFacts) {
      var chipsHtml = citedFacts.length > 0
        ? '<div class="recall-chips">'
            + citedFacts.map(function(f) {
                return '<span class="recall-chip">' + chipLabel(f) + '</span>';
              }).join('')
            + '</div>'
        : '';

      thread.innerHTML += '<div class="message agent">'
        + '<div class="content">' + escapeHtml(answer) + chipsHtml + '</div>'
        + '<div class="message-meta">Nat · Just now</div>'
        + '</div>';
      thread.scrollTop = thread.scrollHeight;

      // Glow all matching trace rows — same synchronous call
      citedFacts.forEach(function(fact) {
        trace.querySelectorAll('[data-trace-fact]').forEach(function(row) {
          if (row.dataset.traceFact === fact) {
            row.classList.remove('recall-glow');
            void row.offsetWidth; // force reflow to restart animation
            row.classList.add('recall-glow');
          }
        });
      });
    }

    form.onsubmit = async (e) => {
      e.preventDefault();
      const msg = input.value;
      input.value = '';

      thread.innerHTML += '<div class="message customer">'
        + '<div class="content">' + escapeHtml(msg) + '</div>'
        + '<div class="message-meta">Jason · Just now</div>'
        + '</div>';
      thread.scrollTop = thread.scrollHeight;

      try {
        const res = await fetch('/turn', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            accountId: 'acme_corp',
            customerId: 'jason_99',
            sessionId,
            role: 'customer',
            message: msg,
            memoryMode: getMemoryMode(),
          })
        });
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          throw new Error(body.error || 'Turn failed');
        }

        const data = await res.json();
        addTrace('Episodic event written', 'episodic');

        if (data.citedFacts && data.citedFacts.length > 0) {
          data.citedFacts.forEach(addFactTrace);
        } else {
          addTrace('No prior facts — memory ' + getMemoryMode(), 'episodic');
        }
        if (data.askedForMissingFacts) {
          addTrace('Requesting missing context from customer', 'working');
        }

        // 600ms beat: fireRecallBeat drives chips + glow from one call
        setTimeout(function() {
          fireRecallBeat(data.answer || 'Unable to process turn.', data.citedFacts || []);
        }, 600);

      } catch (err) {
        addTrace('Temporary issue — please retry', 'error');
      }
    };

    async function closeSession() {
      closeBtn.disabled = true;
      try {
        const res = await fetch(\`/sessions/\${sessionId}/close\`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ accountId: 'acme_corp', customerId: 'jason_99' })
        });
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          throw new Error(body.error || 'Close failed');
        }
        const data = await res.json();
        addTrace('Session closed', 'episodic');
        if (qwenConfigured) {
          if (data.factsDistilled > 0) {
            addTrace('Qwen distillation complete', 'episodic');
            addTrace(data.factsDistilled + ' semantic fact(s) written', 'semantic');
            addTrace('Supersession check complete', 'episodic');
          } else {
            addTrace('Distillation complete — no new facts', 'episodic');
          }
        } else {
          addTrace('Distillation skipped — local-safe mode (no DASHSCOPE_API_KEY)', 'episodic');
          addTrace('No semantic facts written', 'episodic');
        }
      } catch (err) {
        addTrace('Session close failed — retry', 'error');
        closeBtn.disabled = false;
      }
    }

    function toggleMemory() {
      const params = new URLSearchParams(window.location.search);
      params.set('sessionId', sessionId);
      params.set('memory', params.get('memory') === 'off' ? 'on' : 'off');
      window.location.search = params.toString();
    }
  </script>
</body>
</html>
`;

export const FactsView = (facts: SemanticFactRecord[], memOnReaskRate: number) => `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>NAT — Manager Dashboard</title>
  <link rel="stylesheet" href="/static/index.css">
</head>
<body>
  <div class="page-simple">
    <header>
      <div class="logo">Manager Dashboard</div>
      <a href="/chat" style="color:var(--text-muted);font-size:var(--text-sm);text-decoration:none;">← Back to Chat</a>
    </header>

    <main style="padding:var(--sp-8) min(var(--sp-8), 4vw);max-width:960px;margin:0 auto;width:100%;">
      <h2 style="font-size:var(--text-xl);font-weight:700;margin-bottom:var(--sp-2);letter-spacing:-0.02em;">Semantic Fact Store</h2>
      <p style="color:var(--text-muted);font-size:var(--text-sm);margin-bottom:var(--sp-8);">Distilled customer intelligence with high-confidence provenance.</p>

      <!-- Ablation headline — derived from live fact store -->
      <div class="card" style="margin-bottom:var(--sp-8);border-color:var(--trace-semantic-border);background:var(--trace-semantic-bg);">
        <div style="font-size:var(--text-2xl);font-weight:800;letter-spacing:-0.03em;margin-bottom:var(--sp-1);color:var(--memory);">
          re-ask rate: ${memOnReaskRate.toFixed(2)} (memory) vs 1.00 (no-memory)
        </div>
        <div style="font-size:var(--text-xs);color:var(--text-muted);font-family:var(--font-mono);">
          live ablation — derived from current fact store · /eval-snapshot
        </div>
      </div>

      <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:var(--sp-5);">
        ${facts.length ? facts.map(f => `
          <div class="card trace-semantic">
            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:var(--sp-3);">
              <span class="badge badge-semantic">${f.predicate}</span>
              <span style="font-size:var(--text-xs);font-family:var(--font-mono);color:var(--memory);">${Math.round(f.confidence * 100)}% conf</span>
            </div>
            <div style="font-size:var(--text-lg);font-weight:600;margin-bottom:var(--sp-4);">"${f.object}"</div>
            <div style="font-size:var(--text-xs);font-family:var(--font-mono);color:var(--text-faint);border-top:1px solid var(--border);padding-top:var(--sp-3);">
              session ${f.sessionId ? f.sessionId.slice(0, 8) + '…' : '—'} · ${f.validFrom ? new Date(f.validFrom).toISOString().slice(0, 10) : '—'}
            </div>
          </div>
        `).join('') : `
          <div style="grid-column:1/-1;text-align:center;padding:var(--sp-8) var(--sp-4);color:var(--text-faint);">
            <div style="font-size:var(--text-lg);margin-bottom:var(--sp-3);">No semantic facts yet</div>
            <div style="font-size:var(--text-sm);">Close a session to trigger distillation.</div>
          </div>
        `}
      </div>
    </main>
  </div>
</body>
</html>
`;
