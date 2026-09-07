/**
 * HelpGuide module
 * Wires the "?" button in the header (top-right) to a static reference
 * modal covering every step and feature — no state, no events, just
 * open/close. Content lives directly in index.html (#helpGuideModal),
 * same pattern as the Print Preview modal.
 */
const HelpGuide = (() => {

  let modal, openBtn, closeBtn;

  function open() { modal.classList.remove('is-hidden'); }
  function close() { modal.classList.add('is-hidden'); }

  function init() {
    modal = document.getElementById('helpGuideModal');
    openBtn = document.getElementById('helpBtn');
    closeBtn = document.getElementById('helpGuideCloseBtn');

    openBtn.addEventListener('click', open);
    closeBtn.addEventListener('click', close);
    modal.addEventListener('click', (e) => {
      if (e.target === modal) close(); // backdrop click
    });
  }

  return { init };
})();
