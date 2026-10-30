import { createRoot } from 'react-dom/client';
import App, { Preview } from './App.js';
import './styles.css';
import './visual-theme.css';
import './atelier.css';
import { TooltipProvider } from './components/ui/tooltip';
const preview = new URLSearchParams(location.search).get('preview') === '1';
document.body.classList.add(preview ? 'preview-body' : 'studio-shell');
createRoot(document.getElementById('root')!).render(
  preview ? (
    <Preview />
  ) : (
    <TooltipProvider delayDuration={250}>
      <App />
    </TooltipProvider>
  ),
);
