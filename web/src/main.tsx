import { createRoot } from 'react-dom/client';
import './styles.css';
import { App } from './App';
import { SharedAlbum } from './SharedAlbum';

// /s/<token> is an album share link: a separate, read-only page that never touches the owner's session.
const share = /^\/s\/([A-Za-z0-9_-]+)\/?$/.exec(location.pathname)?.[1];
createRoot(document.getElementById('root')!).render(share ? <SharedAlbum token={share} /> : <App />);
