/**
 * App entry point.
 * Initializes feature modules and handles step-rail navigation
 * (switching which inspector panel is shown). Steps 3-5 are wired
 * to render as disabled placeholders until their modules exist.
 */
(function () {

  function initStepRail() {
    const steps = document.querySelectorAll('.step');
    const panels = {
      1: document.getElementById('panel-pagesetup'),
      2: document.getElementById('panel-upload'),
      3: document.getElementById('panel-idsize'),
      4: document.getElementById('panel-print'),
      5: document.getElementById('panel-save'),
    };

    steps.forEach((btn) => {
      btn.addEventListener('click', () => {
        if (btn.classList.contains('is-disabled')) return;

        steps.forEach(b => b.classList.remove('is-active'));
        btn.classList.add('is-active');

        const stepNum = btn.dataset.step;
        Object.entries(panels).forEach(([num, panel]) => {
          panel.classList.toggle('is-hidden', num !== stepNum);
        });
      });
    });
  }

  document.addEventListener('DOMContentLoaded', () => {
    // Order matters: CanvasEditor and LivePreview must register their
    // "pagesetup:change" / "idsize:change" / "printlayout:change" listeners
    // *before* PageSetup.init() / IdSize.init() / PrintExport.init() fire
    // their first (synchronous) change event, or they'd miss the initial
    // state.
    CanvasEditor.init();
    LivePreview.init();
    BgRemoval.init();
    AutoEnhance.init();
    ModelProviders.init();
    FormalAttireCommand.init();
    PageSetup.init();
    IdSize.init();
    PrintExport.init();
    // SaveRecopy only reacts to its own button clicks (Save/Recopy/Import)
    // rather than firing an initial synchronous event, so load order
    // relative to the others doesn't matter — it just needs every module
    // it calls into (PageSetup, IdSize, PrintExport, CanvasEditor,
    // BgRemoval) to already be initialized.
    SaveRecopy.init();
    // JobLifecycle (the startup New Job/Open Job gate) must init last —
    // it calls SaveRecopy.applyJob() as soon as the user picks "New Job"
    // or a saved job, which in turn touches every module above.
    JobLifecycle.init();
    // HelpGuide/ProviderSettings are fully static/self-contained modal
    // wiring (no events into other modules) — order relative to the
    // others doesn't matter.
    HelpGuide.init();
    ProviderSettings.init();
    initStepRail();
  });
})();
