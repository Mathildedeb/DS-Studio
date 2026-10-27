import { createRoot } from 'react-dom/client';
import App, { Preview } from './App.js';
import './styles.css';
const preview = new URLSearchParams(location.search).get('preview') === '1';
if (preview) document.body.classList.add('preview-body');
createRoot(document.getElementById('root')!).render(
  preview ? <Preview /> : <App />,
);
