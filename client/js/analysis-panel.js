// "Automatic analysis" panel for the workspace page. It is only shown to people who may
// analyse the song (the owner and admins). It asks the server to analyse the audio, waits
// for the result, shows what was found and lets the owner apply it to the song.
(() => {
  const songId = new URLSearchParams(window.location.search).get('id');
  const anchor = document.getElementById('editor');
  if (!songId || !anchor || !anchor.parentNode) return;

  const base = `/api/v1/songs/${encodeURIComponent(songId)}/analysis`;
  const POLL_MS = 3000;
  const MAX_POLLS = 400; // about twenty minutes (voice-only runs are slower)

  const section = document.createElement('section');
  section.className = 'analysis-panel';
  section.hidden = true;
  anchor.parentNode.insertBefore(section, anchor);

  let busy = false;
  let voiceOnly = false; // the tickbox: follow the singer's voice only
  let runVoice = false; // the run being waited for is a voice-only run
  let voiceStatus = 'none'; // the song's voice track: none | preparing | ready | failed
  let reviewing = false; // an applied result stays folded away until the owner opens it
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
    if (value < 0.34) return 'not sure';
    if (value < 0.67) return 'fairly sure';
    return 'very sure';
  }

  function keyName(keyPc, mode) {
    return KeyNames.label(keyPc, mode);
  }

  function clock(seconds) {
    const total = Math.max(0, Math.round(seconds));
    return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
  }

  // "C minor 0:00-1:28, then D minor 1:28-2:32" when the key changes, otherwise null.
  function keyChangeText(result) {
    const list = Array.isArray(result.keySections) ? result.keySections : [];
    if (list.length < 2) return null;
    return list
      .map((k) => `${keyName(k.keyPc, k.mode)} ${clock(k.start)}-${clock(k.end)}`)
      .join(', then ');
  }

  // One line per section: the repeating progression, or "no repeating pattern".
  function sectionLines(result, flats) {
    const list = Array.isArray(result.chordSections) ? result.chordSections : [];
    return list.map((s) => {
      const when = `${clock(s.start)}-${clock(s.end)}`;
      if (s.kind === 'loop' && Array.isArray(s.pattern) && s.pattern.length) {
        const names = s.pattern.map((c) => TimelineUtils.chordSymbol(c, flats)).join(' · ');
        return `${when}: ${names} (repeats about ${Math.round(s.cycles || 0)} times)`;
      }
      return `${when}: no repeating pattern`;
    });
  }

  async function api(url, options) {
    const response = await fetch(url, options);
    const data = await response.json().catch(() => ({}));
    return { ok: response.ok, status: response.status, data };
  }

  async function loadExisting() {
    existing = { chords: null, melody: null, analysisId: null };
    try {
      const { ok, data } = await api(`/api/v1/songs/${encodeURIComponent(songId)}/timeline`);
      const timeline = ok && data.timeline;
      if (timeline) {
        if (Array.isArray(timeline.chords)) existing.chords = timeline.chords.length;
        if (Array.isArray(timeline.melody)) existing.melody = timeline.melody.length;
        if (timeline.analysisId) existing.analysisId = String(timeline.analysisId);
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
    section.appendChild(el('h2', 'section-title', 'Automatic song check'));
    section.appendChild(
      el(
        'p',
        'analysis-note',
        'Listens to the song and guesses its speed, key, chords and melody. These are guesses, so always check them by ear. Nothing changes in your song until you press Apply.'
      )
    );

    if (view.kind === 'running') {
      section.appendChild(
        el(
          'p',
          'analysis-status',
          view.status === 'queued'
            ? 'Waiting to start…'
            : runVoice
              ? "Separating the singer's voice and analysing… this takes about as long as the song."
              : 'Analysing the audio…'
        )
      );
    } else if (view.kind === 'failed') {
      section.appendChild(el('p', 'analysis-status error', `The last analysis failed: ${view.error}`));
    } else if (view.kind === 'done') {
      const applied = existing.analysisId && String(view.run._id) === existing.analysisId;
      if (applied && !reviewing) {
        section.appendChild(
          el(
            'p',
            'analysis-status',
            '✓ This analysis has been applied to your song. Check it by ear and fix anything in the editor below.'
          )
        );
        const open = el('button', 'btn btn-small btn-outline', 'Review the result or apply more');
        open.type = 'button';
        open.addEventListener('click', () => {
          reviewing = true;
          render();
        });
        section.appendChild(open);
      } else {
        section.appendChild(renderResult(view.run));
      }
    }

    if (view.kind !== 'running') {
      const option = el('div', 'analysis-line');
      const optionLabel = el('label');
      const optionBox = el('input');
      optionBox.type = 'checkbox';
      optionBox.checked = voiceOnly;
      optionBox.disabled = busy;
      optionBox.addEventListener('change', () => {
        voiceOnly = optionBox.checked;
      });
      optionLabel.appendChild(optionBox);
      optionLabel.appendChild(document.createTextNode(" Follow the singer's voice only for the melody"));
      option.appendChild(optionLabel);
      option.appendChild(
        el('p', 'analysis-sub', voiceHint())
      );
      section.appendChild(option);

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
      box.appendChild(el('p', 'analysis-status', 'The analysis did not find a speed, a key, chords or a melody.'));
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
          ` Key: ${keyName(result.keyPc, result.mode)} (${confidenceLabel(result.keyConfidence)})`
        )
      );
      row.appendChild(label);
      const alternatives = (result.keyAlternatives || [])
        .filter((a) => Number.isInteger(a.keyPc) && a.mode)
        .map((a) => keyName(a.keyPc, a.mode))
        .filter((name, i, all) => all.indexOf(name) === i && name !== keyName(result.keyPc, result.mode));
      if (alternatives.length) row.appendChild(el('p', 'analysis-sub', `Other possible keys: ${alternatives.join(', ')}`));
      const changes = keyChangeText(result);
      if (changes) {
        row.appendChild(el('p', 'analysis-sub', `The key changes during the song: ${changes}.`));
        row.appendChild(
          el('p', 'analysis-sub', 'Applying saves these key changes. The main key is the one heard longest.')
        );
      }
      if (typeof result.keyConfidence === 'number' && result.keyConfidence < 0.34) {
        row.appendChild(el('p', 'analysis-sub warn', 'Not sure about this one: listen and check before applying.'));
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
        document.createTextNode(` Speed (${confidenceLabel(result.bpmConfidence)})`)
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
          document.createTextNode(` ${bpm} BPM${index === 0 ? ' (found)' : ' (half or double speed?)'}`)
        );
        row.appendChild(optionLabel);
        tempoRadios.push(radio);
      });
      if (typeof result.bpmConfidence === 'number' && result.bpmConfidence < 0.34) {
        row.appendChild(el('p', 'analysis-sub warn', 'Not sure about this one: tap along to the song to check.'));
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
      sectionLines(result, flats).forEach((line, index) => {
        row.appendChild(el('p', 'analysis-sub', index === 0 ? `Chord pattern: ${line}` : line));
      });
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
        el(
          'p',
          'analysis-sub',
          result.melodySource === 'voice'
            ? "Rough draft from the singer's voice only. Listen with the piano view and fix it in the editor."
            : "Rough draft: it follows the loudest line, which may include instruments. Tick \"Follow the singer's voice only\" and analyse again for the singing alone."
        )
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

function voiceHint() {
    if (voiceStatus === 'ready') return 'The voice track is ready, so this takes only a few seconds.';
    if (voiceStatus === 'preparing') {
      return 'Preparing the voice track in the background. You can already start; it will use it when it is ready.';
    }
    return 'Slower: takes about as long as the song. Use it when the melody picks up instruments or backing singers.';
  }

  // While the voice track is being prepared, check now and then so the hint updates by itself.
  async function watchVoice() {
    for (let i = 0; i < 120 && voiceStatus === 'preparing'; i += 1) {
      await new Promise((resolve) => setTimeout(resolve, 10000));
      try {
        const { ok, data } = await api(base);
        const next = ok && data.voice && data.voice.status;
        if (next && next !== voiceStatus) {
          voiceStatus = next;
          if (view.kind !== 'running' && !busy) render();
        }
      } catch (err) {
        // try again at the next check
      }
    }
  }

  async function start() {
    reviewing = false;
    runVoice = voiceOnly;
    busy = true;
    say('');
    render();
    try {
      const { ok, status, data } = await api(base, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ voiceOnly }),
      });
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
      voiceStatus = (data.voice && data.voice.status) || 'none';
      if (voiceStatus === 'preparing') watchVoice();
      const latest = (data.runs || [])[0];
      if (latest && (latest.status === 'queued' || latest.status === 'running')) {
        runVoice = Boolean(latest.options && latest.options.voiceOnly);
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