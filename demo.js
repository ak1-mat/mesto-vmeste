/* «Место вместе» — живое демо на главной: друг отметил место → задание → фото на месте → баллы и рейтинг.
   Это иллюстрация, а не настоящие данные. Играет, только пока блок виден; при «уменьшении движения» — один итоговый кадр. */
'use strict';
(function () {
  const stage = document.getElementById('dstage');
  if (!stage) return;
  const scr = stage.querySelector('.dscreen'), tap = stage.querySelector('#dTap');
  const steps = [...document.querySelectorAll('.dsteps li')];
  const pts = [stage.querySelector('#dPts'), stage.querySelector('#dPts2')];
  const STATES = ['s-note', 's-pin', 's-sheet', 's-done', 's-rank'];
  let run = 0;   // номер текущего прогона: старый прогон замечает, что его отменили

  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const on = (...c) => stage.classList.add(...c);
  const off = (...c) => stage.classList.remove(...c);
  const step = n => steps.forEach((li, i) => { li.classList.toggle('on', i + 1 === n); li.classList.toggle('done', i + 1 < n); });
  const setPts = v => pts.forEach(p => { if (p) p.textContent = v; });
  // координаты элемента внутри экрана телефона (без учёта масштаба на телефоне)
  function at(el) {
    let x = el.offsetWidth / 2, y = el.offsetHeight / 2;
    for (let e = el; e && e !== scr; e = e.offsetParent) { x += e.offsetLeft; y += e.offsetTop; }
    return [x, y];
  }
  async function press(el, id) {
    const [x, y] = at(el);
    tap.style.left = x + 'px'; tap.style.top = y + 'px';
    tap.classList.add('show'); await sleep(450); if (id !== run) return;
    tap.classList.add('press'); el.classList.add('press'); await sleep(170);
    tap.classList.remove('press'); el.classList.remove('press'); await sleep(160);
    tap.classList.remove('show');
  }
  function roll(from, to, ms) {
    const t0 = performance.now();
    return new Promise(res => {
      const f = t => { const k = Math.min(1, (t - t0) / ms), e = 1 - Math.pow(1 - k, 3); setPts(Math.round(from + (to - from) * e)); k < 1 ? requestAnimationFrame(f) : res(); };
      requestAnimationFrame(f);
    });
  }
  function reset() { off(...STATES); scr.classList.remove('dim'); setPts(960); step(1); tap.classList.remove('show', 'press'); }
  function poster() { reset(); on('s-pin', 's-sheet', 's-done', 's-rank'); setPts(980); step(4); }

  async function loop(id) {
    while (id === run) {
      reset();
      await sleep(900); if (id !== run) return;
      on('s-note');                                   // 1. друг отметил место
      await sleep(1500); if (id !== run) return;
      step(2); on('s-pin');                            // 2. на карте появилось задание
      await sleep(900); if (id !== run) return;
      off('s-note');
      await sleep(700); if (id !== run) return;
      await press(stage.querySelector('.dnew'), id); if (id !== run) return;
      on('s-sheet');                                   // карточка места
      await sleep(1300); if (id !== run) return;
      step(3);
      await press(stage.querySelector('.dgo'), id); if (id !== run) return;
      const fl = stage.querySelector('.dflash'); fl.classList.remove('go'); void fl.offsetWidth; fl.classList.add('go');  // снимок
      await sleep(420); if (id !== run) return;
      on('s-done');                                    // 3. задание выполнено
      await sleep(600); if (id !== run) return;
      step(4); stage.querySelector('.dpts').classList.add('bump');
      await roll(960, 980, 700); stage.querySelector('.dpts').classList.remove('bump'); if (id !== run) return;
      on('s-rank');                                    // 4. обогнал Аню
      await sleep(3800); if (id !== run) return;       // итог держим, чтобы успели прочитать
      off('s-sheet');
      await sleep(900); if (id !== run) return;
      scr.classList.add('dim');                        // телефон погас — новый круг
      await sleep(700); if (id !== run) return;
    }
  }
  const reduce = window.matchMedia('(prefers-reduced-motion: reduce)');
  function start() { if (reduce.matches) { run++; poster(); return; } const id = ++run; loop(id); }
  function stop() { run++; poster(); }
  poster();   // пока блок не виден (и для скриншотов) — итоговый кадр
  if ('IntersectionObserver' in window) {
    new IntersectionObserver(es => es.forEach(e => (e.isIntersecting ? start() : stop())), { threshold: 0.35 }).observe(stage);
  } else start();
  document.addEventListener('visibilitychange', () => { if (document.hidden) stop(); });
})();
