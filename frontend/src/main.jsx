import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter as Router } from 'react-router-dom';
import App from './App.jsx';
import { AuthProvider } from './context/AuthContext.jsx';
import { DataProvider } from './context/DataContext.jsx';
import { SocketProvider } from './context/SocketContext.jsx';
import { ThemeProvider } from './context/ThemeContext.jsx';
import './index.css';

/**
 * The root of the React application.
 *
 * We wrap the entire App component with essential providers:
 * 1. <Router>: Enables client-side routing for the entire application.
 * 2. <ThemeProvider>: Manages dark/light mode theme state globally.
 * 3. <AuthProvider>: Manages and provides global authentication state (e.g., isLoggedIn).
 *    It must be inside the Router because its hooks might use navigation.
 * 4. <SocketProvider>: Manages WebSocket connections based on authentication state.
 *    It must be inside AuthProvider because it uses the useAuth hook.
 * 5. <DataProvider>: Manages and provides global application data (e.g., profile, watchlists).
 *    It is placed inside SocketProvider so it can access both auth and socket state if needed.
 */
ReactDOM.createRoot(document.getElementById('root')).render(
  <Router>
    <ThemeProvider>
      <AuthProvider>
        <SocketProvider>
          <DataProvider>
            <App />
          </DataProvider>
        </SocketProvider>
      </AuthProvider>
    </ThemeProvider>
  </Router>
);

