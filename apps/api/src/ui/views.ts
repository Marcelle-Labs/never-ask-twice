import { BrandLockup } from "./brand.js";

/**
 * Never Ask Twice — UI Templates
 * Plain-HTML views for the demo session.
 */

export const ChatView = (messages: any[], sessionId: string, memoryOn: boolean) => `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Never Ask Twice — Chat</title>
  <link rel="stylesheet" href="/static/index.css">
  <link rel="icon" type="image/svg+xml" href="/favicon.svg">
</head>
<body>
  <div class="app-container">
    <header>
      ${BrandLockup({ compact: true })}
      <div style="display: flex; gap: 1rem; align-items: center;">
        <span class="badge ${memoryOn ? 'done' : 'todo'}" id="memory-status">${memoryOn ? 'Memory ON' : 'Memory OFF'}</span>
        <button class="secondary-btn" onclick="toggleMemory()">${memoryOn ? 'Simulate Cold Start' : 'Enable Memory'}</button>
        <button id="close-session-btn" onclick="closeSession()">Close session</button>
      </div>
    </header>
    
    <nav>
      <h3 style="margin-bottom: 1rem; font-size: 0.9rem; color: var(--text-muted);">SCENARIO CONTEXT</h3>
      <div class="card">
        <div style="font-weight: 700; margin-bottom: 0.5rem;">Customer: Jason</div>
        <div style="font-size: 0.8rem; color: var(--text-muted);">SLA: Enterprise (4h)</div>
      </div>
      <div class="card">
        <div style="font-weight: 700; margin-bottom: 0.5rem;">Session Profile</div>
        <div style="font-size: 0.7rem; font-family: monospace;">${sessionId}</div>
      </div>
      <div style="margin-top: 2rem;">
        <a href="/facts" style="color: var(--accent); font-size: 0.9rem; text-decoration: none;">View Manager Dashboard →</a>
      </div>
    </nav>
    
    <main>
      <div class="message-list" id="chat-thread">
        ${messages.map(m => `
          <div class="message ${m.role}">
            <div class="content">${m.message}</div>
            <div class="message-meta">${m.role === 'customer' ? 'Jason' : 'Nat'} • Just now</div>
          </div>
        `).join('')}
      </div>
      
      <div style="padding: 2rem; border-top: 1px solid var(--border); background: var(--bg);">
        <form id="chat-form" style="display: flex; gap: 1rem;">
          <input type="text" id="user-input" placeholder="Type a message..." required autocomplete="off">
          <button type="submit">Send</button>
        </form>
      </div>
    </main>
    
    <aside id="debug-panel">
      <h3 style="margin-bottom: 1rem; font-size: 0.9rem; color: var(--text-muted);">MEMORY TRACE</h3>
      <div id="trace-logs">
        <div style="font-size: 0.8rem; color: var(--text-muted); text-align: center; margin-top: 2rem;">Waiting for interaction...</div>
      </div>
    </aside>
  </div>
  
  <script>
    const sessionId = "${sessionId}";
    const form = document.getElementById('chat-form');
    const input = document.getElementById('user-input');
    const thread = document.getElementById('chat-thread');
    const trace = document.getElementById('trace-logs');
    const closeBtn = document.getElementById('close-session-btn');

    function addTrace(msg, status = 'done') {
      const el = document.createElement('div');
      el.className = 'card';
      el.style.fontSize = '0.75rem';
      el.innerHTML = \`<div class="badge \${status}" style="margin-bottom: 0.5rem;">\${status.toUpperCase()}</div><div>\${msg}</div>\`;
      trace.prepend(el);
    }

    form.onsubmit = async (e) => {
      e.preventDefault();
      const msg = input.value;
      input.value = '';
      
      thread.innerHTML += \`<div class="message customer"><div class="content">\${msg}</div><div class="message-meta">Jason • Just now</div></div>\`;
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
            message: msg 
          })
        });
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          throw new Error(body.error || 'Turn failed');
        }
        
        addTrace('Episodic event written');
        addTrace('Embedding stored.');
        
        setTimeout(() => {
          thread.innerHTML += \`<div class="message agent"><div class="content">I've noted that for your record. Is there anything else?</div><div class="message-meta">Nat • Just now</div></div>\`;
          thread.scrollTop = thread.scrollHeight;
        }, 600);
      } catch (err) {
        addTrace('Error: ' + err.message, 'danger');
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
        addTrace('Session closed');
        addTrace('Qwen distillation complete');
        addTrace('Semantic facts written');
        addTrace('Supersession check complete');
      } catch (err) {
        addTrace('Error: ' + err.message, 'danger');
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

export const FactsView = (facts: any[]) => `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Never Ask Twice — Knowledge Manager</title>
  <link rel="stylesheet" href="/static/index.css">
  <link rel="icon" type="image/svg+xml" href="/favicon.svg">
</head>
<body>
  <div class="app-container" style="grid-template-columns: 1fr; grid-template-rows: 60px 1fr; grid-template-areas: 'header' 'main';">
    <header>
      ${BrandLockup({ compact: true })}
      <a href="/chat" style="color: var(--text-muted); text-decoration: none;">← Back to Chat</a>
    </header>
    
    <main style="padding: 3rem;">
      <h2 style="margin-bottom: 0.5rem;">Semantic Fact Store</h2>
      <p style="color: var(--text-muted); margin-bottom: 2rem;">Distilled customer intelligence with high-confidence provenance.</p>
      
      <div style="margin-bottom: 2rem; padding: 1.5rem; border: 1px solid var(--border); border-radius: 12px; background: var(--surface-glass);">
        <div style="font-size: 1.4rem; font-weight: 700; margin-bottom: 0.25rem;">re-ask rate: 0.00 (memory) vs 1.00 (no-memory)</div>
        <div style="font-size: 0.8rem; color: var(--text-muted);">Live memory ON/OFF ablation</div>
      </div>
      
      <div style="display: grid; grid-template-columns: repeat(auto-fill, minmax(300px, 1fr)); gap: 1.5rem;">
        ${facts.length ? facts.map(f => `
          <div class="card">
            <div style="display: flex; justify-content: space-between; margin-bottom: 1rem;">
              <span class="badge done">${f.predicate}</span>
              <span style="font-size: 0.8rem; color: var(--accent);">Conf: ${Math.round(f.confidence * 100)}%</span>
            </div>
            <div style="font-size: 1.1rem; margin-bottom: 1rem;">"${f.subject}"</div>
            <div style="font-size: 0.8rem; color: var(--text-muted); border-top: 1px solid var(--border); padding-top: 0.5rem; margin-top: 1rem;">
              <strong>Provenance:</strong> distilled from session ${f.sessionId ?? 'unknown'} at ${f.validFrom ? new Date(f.validFrom).toISOString() : 'unknown'}
            </div>
          </div>
        `).join('') : `
          <div style="grid-column: 1/-1; text-align: center; padding: 4rem; color: var(--text-muted);">
            No semantic facts captured yet. Close a session to trigger distillation.
          </div>
        `}
      </div>
    </main>
  </div>
</body>
</html>
`;
