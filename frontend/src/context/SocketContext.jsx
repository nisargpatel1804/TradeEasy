import React, { createContext, useContext, useEffect, useRef, useState } from 'react';
import { io } from 'socket.io-client';
import priceUpdateService from '@/services/priceUpdateService'; // Import the service
import { authService } from '@/services/auth.js';
import { toast } from 'react-hot-toast';

// 1. Create the context to hold the socket instance
const SocketContext = createContext(null);

/**
 * Custom hook to provide easy access to the socket instance and connection status
 * from any component wrapped in the SocketProvider.
 * @returns {object} An object containing the socket instance and connection status.
 */
export const useSocketContext = () => {
  return useContext(SocketContext);
};

/**
 * The provider component that establishes the WebSocket connection
 * and makes the socket instance available to all its children.
 * It is also responsible for initializing the real-time price update service.
 */
export const SocketProvider = ({ children }) => {
  const [socket, setSocket] = useState(null);
  const [isConnected, setIsConnected] = useState(false);
  const [reconnectAttempts, setReconnectAttempts] = useState(0);
  const [clientId, setClientId] = useState(authService.getClientId());
  const [isAuthenticated, setIsAuthenticated] = useState(authService.isAuthenticatedSync());
  const socketRef = useRef(null);
  const reconnectToastIdRef = useRef(null);

  useEffect(() => {
    const handleAuthChange = () => {
      setIsAuthenticated(authService.isAuthenticatedSync());
      setClientId(authService.getClientId());
    };

    window.addEventListener('authStateChanged', handleAuthChange);
    return () => {
      window.removeEventListener('authStateChanged', handleAuthChange);
    };
  }, []);

  // This effect runs only once when the application mounts
  useEffect(() => {
    // 2. Establish connection to the backend Socket.IO server
    // It reads the server URL from environment variables for flexibility between
    // development and production environments.
    if (!isAuthenticated || !clientId) {
      const existingSocket = socketRef.current;
      if (existingSocket) {
        existingSocket.disconnect();
        socketRef.current = null;
        setSocket(null);
      }
      priceUpdateService.reset();
      setIsConnected(false);
      setReconnectAttempts(0);
      return;
    }

    const socketIoUrl = import.meta.env.VITE_API_BASE_URL || "http://localhost:5000";

    const newSocket = io(socketIoUrl, {
      // `withCredentials: true` is important for sending session cookies,
      // which can be used for authenticating socket connections.
      withCredentials: true,
      auth: { clientId },
      // Enable robust auto-reconnection on flaky networks
      reconnection: true,
      reconnectionAttempts: 20,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 10000,
    });

    // Listen to connection events
    const handleConnect = () => {
      setIsConnected(true);
      setReconnectAttempts(0);
      if (reconnectToastIdRef.current) {
        toast.dismiss(reconnectToastIdRef.current);
        toast.success('Live market feed reconnected.', {
          id: reconnectToastIdRef.current,
          duration: 4000,
        });
        reconnectToastIdRef.current = null;
      }
    };
    const handleDisconnect = () => {
      setIsConnected(false);
      if (!reconnectToastIdRef.current) {
        reconnectToastIdRef.current = 'socket:status';
        toast.error('Live market feed disconnected. Attempting to reconnect…', {
          id: reconnectToastIdRef.current,
          duration: Infinity,
        });
      }
    };
    const handleReconnectAttempt = (attempt) => setReconnectAttempts(attempt || 0);
    const handleReconnectError = (err) => {
      console.warn('Socket reconnect error:', err?.message || err);
      if (!reconnectToastIdRef.current) {
        reconnectToastIdRef.current = 'socket:status';
        toast.error('Live market feed disconnected. Attempting to reconnect…', {
          id: reconnectToastIdRef.current,
          duration: Infinity,
        });
      }
    };
    const handleReconnectFailed = () => {
      console.warn('Socket reconnection failed after max attempts.');
      toast.error('Unable to reconnect to the live market feed. Please refresh the page.', {
        id: reconnectToastIdRef.current || 'socket:status',
        duration: 6000,
      });
      reconnectToastIdRef.current = 'socket:status';
    };

    newSocket.on('connect', handleConnect);
    newSocket.on('disconnect', handleDisconnect);
    newSocket.on('reconnect_attempt', handleReconnectAttempt);
    newSocket.on('reconnect_error', handleReconnectError);
    newSocket.on('reconnect_failed', handleReconnectFailed);

    // 3. Set the created socket instance into state
    setSocket(newSocket);
    socketRef.current = newSocket;
    
    // --- NEW: Initialize the price update service with the new socket instance ---
    // This activates the real-time price listeners for the entire application.
    priceUpdateService.init(newSocket);

    // 4. Define a cleanup function to run when the component unmounts
    // This is crucial for preventing memory leaks and orphaned connections.
    return () => {
      newSocket.off('connect', handleConnect);
      newSocket.off('disconnect', handleDisconnect);
      newSocket.off('reconnect_attempt', handleReconnectAttempt);
      newSocket.off('reconnect_error', handleReconnectError);
      newSocket.off('reconnect_failed', handleReconnectFailed);
      newSocket.close();
      priceUpdateService.reset();
      if (socketRef.current === newSocket) {
        socketRef.current = null;
      }
      setSocket((existing) => (existing === newSocket ? null : existing));
      setIsConnected(false);
    };
  }, [clientId, isAuthenticated]);

  // 5. Provide the socket instance and connection status to all child components
  return (
    <SocketContext.Provider value={{ socket, isConnected, reconnectAttempts, clientId, reconnect: () => socket?.connect?.() }}>
      {children}
    </SocketContext.Provider>
  );
};