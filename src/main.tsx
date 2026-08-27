import { createRoot } from 'react-dom/client';
import { App } from './App';
import { prefetchFlags } from './hooks/useFeatureFlag';
import './styles/base.css';

// Homepage routing blocks on the flag file — start that fetch now, in
// parallel with React startup, instead of after the first mount effect.
prefetchFlags();

const root = createRoot(document.getElementById('root')!);
root.render(<App />);
