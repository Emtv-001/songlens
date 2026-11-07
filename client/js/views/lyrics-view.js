// Lyrics list: the active line is highlighted and scrolled into view.
// Like every view, it only reacts to the shared clock.
function createLyricsView(container, lyrics, onSeek) {
  const list = document.createElement('ol');
  list.className = 'lyrics-list';

  const items = [];
  let activeIndex = -1;

  lyrics.forEach((line) => {
    const item = document.createElement('li');
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'lyric-line';

    const stamp = document.createElement('span');
    stamp.className = 'lyric-time';
    stamp.textContent = TimelineUtils.formatTime(line.start);

    const text = document.createElement('span');
    text.className = 'lyric-text';
    text.textContent = line.text;

    button.append(stamp, text);
    button.addEventListener('click', () => onSeek(line.start));
    item.appendChild(button);
    list.appendChild(item);
    items.push(item);
  });

  container.replaceChildren(list);

  function scrollToItem(item) {
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const top = item.offsetTop - container.clientHeight / 2 + item.clientHeight / 2;
    container.scrollTo({ top: Math.max(top, 0), behavior: reduce ? 'auto' : 'smooth' });
  }

  function render(state) {
    const index = TimelineUtils.findActiveIndex(lyrics, state.time);
    if (index === activeIndex) return;

    if (activeIndex !== -1 && items[activeIndex]) {
      items[activeIndex].classList.remove('active');
      items[activeIndex].firstChild.removeAttribute('aria-current');
    }
    if (index !== -1) {
      items[index].classList.add('active');
      items[index].firstChild.setAttribute('aria-current', 'true');
      scrollToItem(items[index]);
    }
    activeIndex = index;
  }

  return { render };
}