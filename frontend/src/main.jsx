import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter as Router } from 'react-router-dom';
import App from '@/App.jsx';
import { AuthProvider } from '@/context/AuthContext.jsx';
import { DataProvider } from '@/context/DataContext.jsx';
import { SocketProvider } from '@/context/SocketContext.jsx';
import '@/index.css';

/**
 * The root of the React application.
 *
 * We wrap the entire App component with three essential providers:
 * 1. <Router>: Enables client-side routing for the entire application.
 * 2. <AuthProvider>: Manages and provides global authentication state (e.g., isLoggedIn).
 * It must be inside the Router because its hooks might use navigation.
 * 3. <DataProvider>: Manages and provides global application data (e.g., profile, watchlists).
 * It is placed inside AuthProvider so it can access authentication state if needed.
 */
ReactDOM.createRoot(document.getElementById('root')).render(
  <Router>
    <SocketProvider>
      <AuthProvider>
        <DataProvider>
          <App />
        </DataProvider>
      </AuthProvider>
    </SocketProvider>
  </Router>
);

