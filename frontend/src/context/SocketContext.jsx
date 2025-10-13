import React, { createContext, useContext, useEffect, useState } from 'react';
import { io } from 'socket.io-client';
import { useAuth } from './AuthContext.jsx';
import priceUpdateService from '../services/priceUpdateService.js';

const SocketContext = createContext(null);

/**
 * Custom hook to easily access the SocketContext from any component.
 * @returns {object} The socket context value.
 */
export const useSocket = () => {
  const context = useContext(SocketContext);
  if (!context) {
    throw new Error('useSocket must be used within a SocketProvider');
  }
  return context;
};

/**
 * The SocketProvider component establishes and manages the WebSocket connection
 * based on the user's authentication state.
 */
export const SocketProvider = ({ children }) => {
  const { isAuthenticated } = useAuth();
  const [socket, setSocket] = useState(null);
  const [isConnected, setIsConnected] = useState(false);

  useEffect(() => {
    // Only attempt to connect if the user is authenticated.
    if (isAuthenticated) {
      // The connection URL is retrieved from environment variables for flexibility.
      const socketIoUrl = import.meta.env.VITE_API_BASE_URL || "http://localhost:5000";
      
      const newSocket = io(socketIoUrl, {
        withCredentials: true, // Sends session cookies for authentication.
        reconnection: true,
        reconnectionAttempts: 5,
        reconnectionDelay: 2000,
      });

      setSocket(newSocket);
      priceUpdateService.init(newSocket); // Initialize the price service with the socket.

      newSocket.on('connect', () => {
        console.log('Socket.IO connected successfully.');
        setIsConnected(true);
      });

      newSocket.on('disconnect', () => {
        console.warn('Socket.IO disconnected.');
        setIsConnected(false);
      });

      // Cleanup function to run when the component unmounts or auth state changes.
      return () => {
        console.log('Closing Socket.IO connection.');
        newSocket.close();
        setIsConnected(false);
        setSocket(null);
      };
    }
  }, [isAuthenticated]); // This effect re-runs whenever the auth state changes.

  const contextValue = {
    socket,
    isConnected,
  };

  return (
    <SocketContext.Provider value={contextValue}>
      {children}
    </SocketContext.Provider>
  );
};

