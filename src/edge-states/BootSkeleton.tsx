// React copy of the static boot skeleton in index.html — SAME markup, SAME
// tt-boot-* classes (their styles live in index.html's inline <style>, which
// stays in <head> for the page's lifetime). HomeRoute renders this while the
// flag file resolves so the handoff static skeleton → React → TrackerHome is
// pixel-identical; rendering anything else here flashes a mismatched layout
// (ADO-568). If you change one copy, change the other.
export function BootSkeleton() {
  return (
    <div className="tt-boot" role="status" aria-label="Loading TrumpyTracker">
      <div className="tt-boot-hd"><div className="tt-boot-hd-in">TRUMPY / TRACKER</div></div>
      <div className="tt-boot-main">
        <div className="tt-boot-bar" style={{ width: 'min(620px, 86%)', height: 64 }} />
        <div className="tt-boot-bar" style={{ width: 'min(230px, 48%)', height: 30, marginTop: 34 }} />
        <div className="tt-boot-bar" style={{ width: 'min(560px, 78%)', height: 12 }} />
        <div className="tt-boot-bar" style={{ width: 'min(640px, 90%)', marginTop: 30 }} />
        <div className="tt-boot-bar" style={{ width: 'min(480px, 68%)' }} />
        <div className="tt-boot-bar" style={{ width: 'min(560px, 78%)' }} />
      </div>
    </div>
  );
}
