// "Automatic analysis" panel for the workspace page. It is only shown to people who may
// analyse the song (the owner and admins). It asks the server to analyse the audio, waits
// for the result, shows what was found and lets the owner apply it to the song.
(() => {
  const songId = new URLSearchParams(window.location.search).get('id');
  const anchor = document.getElementById('editor');
  if (!songId || !anchor || !anchor.parentNode) return;

  const base = `/api/v1/songs/${encodeURIComponent(songId)}/analysis`;
  const POLL_MS = 3000;
  const MAX_POLLS = 100; // about five minutes

  const section = document.createElement('section');
  section.className = 'analysis-panel';
  section.hidden = true;
  anchor.parentNode.insertBefore(section, anchor);

  let busy = false;
  let message = '';
  let messageIsError = false;
  let view = { kind: 'idle' }; // idle | running | failed | done

  function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }

  function confidenceLabel(value) {
    if (typeof value !== 'number') return 'unknown';
    if (value < 0.34) return 'low';
    if (value < 0.67) return 'medium';
    return 'high';
  }

  function keyName(keyPc, mode) {
    const flats = Theory.usesFlats(keyPc, mode);
    return `${TimelineUtils.pcName(keyPc, flats)} ${mode}`;
  }

  async function api(url, options) {
    const response = await fetch(url, options);
    const data = await response.json().catch(() => ({}));
    return { ok: response.ok, status: response.status, data };
  }

  function say(text, isError) {
    message = text;
    messageIsError = Boolean(isError);
  }

  function render() {
    section.replaceChildren();
    section.appendChild(el('h2', 'section-title', 'Automatic analysis'));
    section.appendChild(
      el(
        'p',
        'analysis-note',
        'Estimates the tempo and key from the audio. These are estimates, so always check them by ear. Your saved chords, melody and lyrics are never changed.'
      )
    );

    if (view.kind === 'running') {
      section.appendChild(
        el('p', 'analysis-status', view.status === 'queued' ? 'Waiting to start…' : 'Analysing the audio…')
      );
    } else if (view.kind === 'failed') {
      section.appendChild(el('p', 'analysis-status error', `The last analysis failed: ${view.error}`));
    } else if (view.kind === 'done') {
      section.appendChild(renderResult(view.run));
    }

    if (view.kind !== 'running') {
      const label = view.kind === 'idle' ? 'Analyse this song' : 'Analyse again';
      const button = el('button', 'btn btn-small', busy ? 'Starting…' : label);
      button.type = 'button';
      button.disabled = busy;
      button.addEventListener('click', start);
      section.appendChild(button);
    }

    if (message) {
      const note = el('p', `analysis-status${messageIsError ? ' error' : ''}`, message);
      note.setAttribute('role', messageIsError ? 'alert' : 'status');
      section.appendChild(note);
    }
  }

  function renderResult(run) {
    const result = run.result || {};
    const box = el('div', 'analysis-result');
    const hasTempo = typeof result.bpm === 'number';
    const hasKey = Number.isInteger(result.keyPc) && result.mode;

    if (!hasTempo && !hasKey) {
      box.appendChild(el('p', 'analysis-status', 'The analysis did not find a tempo or a key.'));
      return box;
    }

    const lines = el('div', 'analysis-lines');
    let tempoRadios = [];
    let keyBox = null;
    let tempoBox = null;

    if (hasKey) {
      const row = el('div', 'analysis-line');
      keyBox = el('input');
      keyBox.type = 'checkbox';
      keyBox.checked = true;
      const label = el('label');
      label.appendChild(keyBox);
      label.appendChild(
        document.createTextNode(
          ` Key: ${keyName(result.keyPc, result.mode)} (${confidenceLabel(result.keyConfidence)} confidence)`
        )
      );
      row.appendChild(label);
      const alternatives = (result.keyAlternatives || [])
        .filter((a) => Number.isInteger(a.keyPc) && a.mode)
        .map((a) => keyName(a.keyPc, a.mode));
      if (alternatives.length) row.appendChild(el('p', 'analysis-sub', `Close alternatives: ${alternatives.join(', ')}`));
      if (typeof result.keyConfidence === 'number' && result.keyConfidence < 0.34) {
        row.appendChild(el('p', 'analysis-sub warn', 'Low confidence: listen and check before applying.'));
      }
      lines.appendChild(row);
    }

    if (hasTempo) {
      const row = el('div', 'analysis-line');
      tempoBox = el('input');
      tempoBox.type = 'checkbox';
      tempoBox.checked = true;
      const label = el('label');
      label.appendChild(tempoBox);
      label.appendChild(
        document.createTextNode(` Tempo (${confidenceLabel(result.bpmConfidence)} confidence)`)
      );
      row.appendChild(label);

      const options = [result.bpm, ...(Array.isArray(result.bpmAlternatives) ? result.bpmAlternatives : [])];
      options.forEach((bpm, index) => {
        const radio = el('input');
        radio.type = 'radio';
        radio.name = 'analysis-bpm';
        radio.value = String(bpm);
        radio.checked = index === 0;
        const optionLabel = el('label', 'analysis-option');
        optionLabel.appendChild(radio);
        optionLabel.appendChild(
          document.createTextNode(` ${bpm} BPM${index === 0 ? ' (detected)' : ' (half or double?)'}`)
        );
        row.appendChild(optionLabel);
        tempoRadios.push(radio);
      });
      if (typeof result.bpmConfidence === 'number' && result.bpmConfidence < 0.34) {
        row.appendChild(el('p', 'analysis-sub warn', 'Low confidence: tap along to the song to check.'));
      }
      lines.appendChild(row);
    }

    box.appendChild(lines);
    box.appendChild(
      el('p', 'analysis-sub', 'Applying replaces the key and tempo saved for this song. Chords, melody and lyrics stay as they are.')
    );

    const apply = el('button', 'btn btn-small', busy ? 'Applying…' : 'Apply to this song');
    apply.type = 'button';
    apply.disabled = busy;
    apply.addEventListener('click', async () => {
      const useKey = Boolean(keyBox && keyBox.checked);
      const useTempo = Boolean(tempoBox && tempoBox.checked);
      if (!useKey && !useTempo) {
        say('Choose the key, the tempo, or both.', true);
        render();
        return;
      }
      const body = { key: useKey, tempo: useTempo };
      const picked = tempoRadios.find((r) => r.checked);
      if (useTempo && picked) body.bpm = Number(picked.value);

      busy = true;
      say('');
      render();
      try {
        const { ok, data } = await api(`${base}/${encodeURIComponent(run._id)}/apply`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        });
        if (!ok) throw new Error(data.message || 'Could not apply the analysis.');
        say('Applied. Reloading the page…');
        render();
        setTimeout(() => window.location.reload(), 800);
        return;
      } catch (err) {
        say(err instanceof TypeError ? 'Cannot reach the server.' : err.message, true);
      }
      busy = false;
      render();
    });
    box.appendChild(apply);
    return box;
  }

  async function showFinished(runSummary) {
    if (runSummary.status === 'failed') {
      view = { kind: 'failed', error: runSummary.error || 'Unknown error.' };
      return;
    }
    const { ok, data } = await api(`${base}/${encodeURIComponent(runSummary._id)}`);
    view = ok && data.run ? { kind: 'done', run: data.run } : { kind: 'idle' };
  }

  async function poll(runId) {
    view = { kind: 'running', status: 'queued' };
    render();
    for (let i = 0; i < MAX_POLLS; i += 1) {
      await new Promise((resolve) => setTimeout(resolve, POLL_MS));
      let response;
      try {
        response = await api(`${base}/${encodeURIComponent(runId)}`);
      } catch (err) {
        continue; // a short network drop should not end the wait
      }
      if (!response.ok || !response.data.run) break;
      const run = response.data.run;
      if (run.status === 'queued' || run.status === 'running') {
        if (view.status !== run.status) {
          view = { kind: 'running', status: run.status };
          render();
        }
        continue;
      }
      view = run.status === 'failed'
        ? { kind: 'failed', error: run.error || 'Unknown error.' }
        : { kind: 'done', run };
      render();
      return;
    }
    view = { kind: 'idle' };
    say('The analysis is taking longer than expected. Reload the page to check again.', true);
    render();
  }

  async function start() {
    busy = true;
    say('');
    render();
    try {
      const { ok, status, data } = await api(base, { method: 'POST' });
      busy = false;
      if (ok || status === 409) {
        const run = data.run;
        if (run) {
          await poll(run._id);
          return;
        }
      }
      say(data.message || 'Could not start the analysis.', true);
    } catch (err) {
      busy = false;
      say(err instanceof TypeError ? 'Cannot reach the server.' : err.message, true);
    }
    render();
  }

  (async function init() {
    try {
      const { ok, data } = await api(base);
      if (!ok) return; // not signed in, or not allowed to analyse this song
      section.hidden = false;
      const latest = (data.runs || [])[0];
      if (latest && (latest.status === 'queued' || latest.status === 'running')) {
        poll(latest._id);
        return;
      }
      if (latest) await showFinished(latest);
      render();
    } catch (err) {
      // leave the panel hidden
    }
  })();
})();