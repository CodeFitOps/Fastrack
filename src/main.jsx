import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { TodayScreen } from './ui/TodayScreen.jsx';
import './styles/app.css';

createRoot(document.getElementById('app')).render(
  <StrictMode>
    <TodayScreen />
  </StrictMode>
);
