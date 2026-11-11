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
  // how many chords and melody notes the song has saved now (null = unknown)
  let existing = { chords: null, melody: null };

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

  async function loadExisting() {
    existing = { chords: null, melody: null };
    try {
      const { ok, data } = await api(`/api/v1/songs/${encodeURIComponent(songId)}/timeline`);
      const timeline = ok && data.timeline;
      if (timeline) {
        if (Array.isArray(timeline.chords)) existing.chords = timeline.chords.length;
        if (Array.isArray(timeline.melody)) existing.melody = timeline.melody.length;
      }
    } catch (err) {
      // the counts stay unknown
    }
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
        'Estimates the tempo, key, chords and melody from the audio. These are estimates, so always check them by ear. Nothing changes in your song until you press Apply.'
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
    const chordList = Array.isArray(result.chords) ? result.chords : [];
    const hasChords = chordList.length > 0;
    const noteList = Array.isArray(result.melody) ? result.melody : [];
    const hasMelody = noteList.length > 0;

    if (!hasTempo && !hasKey && !hasChords && !hasMelody) {
      box.appendChild(el('p', 'analysis-status', 'The analysis did not find a tempo, a key, chords or a melody.'));
      return box;
    }

    const lines = el('div', 'analysis-lines');
    let tempoRadios = [];
    let keyBox = null;
    let tempoBox = null;
    let chordBox = null;
    let melodyBox = null;

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

    if (hasChords) {
      const row = el('div', 'analysis-line');
      chordBox = el('input');
      chordBox.type = 'checkbox';
      chordBox.checked = existing.chords === 0; // never replace saved chords unless asked
      const label = el('label');
      label.appendChild(chordBox);
      label.appendChild(document.createTextNode(` Chords: ${chordList.length} found`));
      row.appendChild(label);

      const flats = hasKey ? Theory.usesFlats(result.keyPc, result.mode) : false;
      const preview = chordList.slice(0, 8).map((c) => TimelineUtils.chordSymbol(c, flats));
      row.appendChild(
        el('p', 'analysis-sub', `Starts with: ${preview.join(' · ')}${chordList.length > 8 ? ' …' : ''}`)
      );
      if (existing.chords > 0) {
        row.appendChild(
          el('p', 'analysis-sub warn', `Applying replaces the ${existing.chords} chord${existing.chords === 1 ? '' : 's'} saved for this song.`)
        );
      } else if (existing.chords === null) {
        row.appendChild(el('p', 'analysis-sub warn', 'Applying replaces any chords saved for this song.'));
      }
      row.appendChild(el('p', 'analysis-sub', 'Chord times are estimates. Fine-tune them in the editor afterwards.'));
      lines.appendChild(row);
    }

    if (hasMelody) {
      const row = el('div', 'analysis-line');
      melodyBox = el('input');
      melodyBox.type = 'checkbox';
      melodyBox.checked = existing.melody === 0; // never replace a saved melody unless asked
      const label = el('label');
      label.appendChild(melodyBox);
      label.appendChild(document.createTextNode(` Melody: ${noteList.length} notes found`));
      row.appendChild(label);

      const flats = hasKey ? Theory.usesFlats(result.keyPc, result.mode) : false;
      const preview = noteList.slice(0, 8).map((n) => TimelineUtils.midiName(n.midi, flats));
      row.appendChild(
        el('p', 'analysis-sub', `Starts with: ${preview.join(' · ')}${noteList.length > 8 ? ' …' : ''}`)
      );
      if (existing.melody > 0) {
        row.appendChild(
          el('p', 'analysis-sub warn', `Applying replaces the ${existing.melody} note${existing.melody === 1 ? '' : 's'} saved for this song.`)
        );
      } else if (existing.melody === null) {
        row.appendChild(el('p', 'analysis-sub warn', 'Applying replaces any melody saved for this song.'));
      }
      row.appendChild(
        el('p', 'analysis-sub', 'Rough draft: it follows the main line only. Listen with the piano view and fix it in the editor.')
      );
      lines.appendChild(row);
    }

    box.appendChild(lines);
    box.appendChild(
      el('p', 'analysis-sub', 'Only what you tick is applied. Your lyrics are never changed.')
    );

    const apply = el('button', 'btn btn-small', busy ? 'Applying…' : 'Apply to this song');
    apply.type = 'button';
    apply.disabled = busy;
    apply.addEventListener('click', async () => {
      const useKey = Boolean(keyBox && keyBox.checked);
      const useTempo = Boolean(tempoBox && tempoBox.checked);
      const useChords = Boolean(chordBox && chordBox.checked);
      const useMelody = Boolean(melodyBox && melodyBox.checked);
      if (!useKey && !useTempo && !useChords && !useMelody) {
        say('Tick at least one thing to apply.', true);
        render();
        return;
      }
      const body = { key: useKey, tempo: useTempo, chords: useChords, melody: useMelody };
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
    if (ok && data.run) {
      await loadExisting();
      view = { kind: 'done', run: data.run };
    } else {
      view = { kind: 'idle' };
    }
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
      if (run.status === 'succeeded') await loadExisting();
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