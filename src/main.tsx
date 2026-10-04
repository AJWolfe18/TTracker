import { createRoot } from 'react-dom/client';
import { App } from './App';
import { prefetchFlags } from './hooks/useFeatureFlag';
import { prefetchTrackerHome } from './lib/tracker-boot';
import './styles/base.css';

// The homepage's Tracker data does not depend on the flag file's contents, only
// on whether The Tracker shows at all — so on "/" start both at once instead of
// data after flags (ADO-605). If rap_sheet is off, the prefetch is never used.
if (window.location.pathname === '/') prefetchTrackerHome();

// Homepage routing blocks on the flag file — start that fetch now, in
// parallel with React startup, instead of after the first mount effect.
prefetchFlags();

const root = createRoot(document.getElementById('root')!);
root.render(<App />);
