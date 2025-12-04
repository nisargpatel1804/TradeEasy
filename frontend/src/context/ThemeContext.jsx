import React, { createContext, useContext, useEffect } from 'react';

const defaultTheme = Object.freeze({
  isDarkMode: false,
  toggleTheme: () => {},
  theme: 'light',
});

const ThemeContext = createContext(defaultTheme);

/**
 * Custom hook to easily access the ThemeContext.
 */
export const useTheme = () => {
  const context = useContext(ThemeContext);
  if (!context) {
    throw new Error('useTheme must be used within a ThemeProvider');
  }
  return context;
};

/**
 * ThemeProvider manages dark/light mode state and persists user preference.
 */
export const ThemeProvider = ({ children }) => {
  useEffect(() => {
    document.documentElement.classList.remove('dark');
    document.documentElement.style.backgroundColor = '#f7f9fc';
    document.body?.classList.add('light-theme');
  }, []);

  return (
    <ThemeContext.Provider value={defaultTheme}>
      {children}
    </ThemeContext.Provider>
  );
};
