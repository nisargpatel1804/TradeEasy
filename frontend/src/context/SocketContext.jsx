import React, { createContext, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { io } from 'socket.io-client';
import { toast } from 'react-hot-toast';
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
  const [connectionStatus, setConnectionStatus] = useState('idle');
  const [lastError, setLastError] = useState(null);

  const statusRef = useRef('idle');
  const toastRef = useRef(null);
  const hasConnectedOnce = useRef(false);

  useEffect(() => {
    if (!isAuthenticated) {
      setSocket(null);
      setIsConnected(false);
      setConnectionStatus('idle');
      setLastError(null);
      statusRef.current = 'idle';
      hasConnectedOnce.current = false;
      if (toastRef.current) {
        toast.dismiss(toastRef.current);
        toastRef.current = null;
      }
      priceUpdateService.reset();
      return undefined;
    }

    const socketIoUrl = import.meta.env.VITE_API_BASE_URL || 'http://localhost:5000';

    const newSocket = io(socketIoUrl, {
      withCredentials: true,
      reconnection: true,
      reconnectionAttempts: Infinity,
      reconnectionDelay: 2000,
      reconnectionDelayMax: 8000,
      timeout: 60000,
      // Use polling-only to prevent "Invalid frame header" errors
      // until the backend is configured with eventlet/gevent for native WebSocket support
      transports: ['polling'],
      upgrade: false,
    });

    let isShuttingDown = false;

    const transitionStatus = (nextStatus, { message, error } = {}) => {
      if (statusRef.current === nextStatus) {
        if (error) {
          setLastError(error);
        }
        return;
      }

      statusRef.current = nextStatus;
      setConnectionStatus(nextStatus);
      setIsConnected(nextStatus === 'connected');

      if (error) {
        setLastError(error);
      } else if (nextStatus === 'connected' || nextStatus === 'idle' || nextStatus === 'connecting') {
        setLastError(null);
      }

      switch (nextStatus) {
        case 'connected':
          if (toastRef.current) {
            toast.dismiss(toastRef.current);
            toastRef.current = null;
          }
          if (hasConnectedOnce.current) {
            toast.success('Live market updates reconnected.');
          } else {
            hasConnectedOnce.current = true;
          }
          break;
        case 'reconnecting': {
          const toastMessage = message || 'Reconnecting to live market data…';
          if (!toastRef.current) {
            toastRef.current = toast.loading(toastMessage);
          } else {
            toast.loading(toastMessage, { id: toastRef.current });
          }
          break;
        }
        case 'disconnected':
          if (toastRef.current) {
            toast.dismiss(toastRef.current);
            toastRef.current = null;
          }
          toast.error(message || 'Live data connection lost. Trying again…');
          break;
        case 'idle':
        case 'connecting':
          if (toastRef.current) {
            toast.dismiss(toastRef.current);
            toastRef.current = null;
          }
          break;
        default:
          break;
      }
    };

    transitionStatus('connecting');

    setSocket(newSocket);
    priceUpdateService.initialize(newSocket);

    const handleConnect = () => {
      if (isShuttingDown) {
        return;
      }
      console.log('Socket.IO connected successfully.');
      transitionStatus('connected');
    };

    const handleDisconnect = (reason) => {
      if (isShuttingDown) {
        return;
      }
      console.warn('Socket.IO disconnected.', reason);
      if (reason === 'io server disconnect') {
        newSocket.connect();
      }
      transitionStatus('reconnecting', {
        error: new Error(typeof reason === 'string' ? reason : 'disconnect'),
      });
    };

    const handleConnectError = (error) => {
      if (isShuttingDown) {
        return;
      }
      console.error('Socket.IO connection error:', error);
      transitionStatus('reconnecting', {
        message: 'Unable to reach live market data. Retrying…',
        error,
      });
    };

    const handleReconnectAttempt = () => {
      if (isShuttingDown) {
        return;
      }
      transitionStatus('reconnecting');
    };

    const handleReconnectFailed = () => {
      if (isShuttingDown) {
        return;
      }
      transitionStatus('disconnected', {
        message: 'Unable to restore live updates. Will keep trying in the background.',
        error: new Error('Reconnection failed'),
      });
    };

    newSocket.on('connect', handleConnect);
    newSocket.on('disconnect', handleDisconnect);
    newSocket.on('connect_error', handleConnectError);
    newSocket.io.on('reconnect_attempt', handleReconnectAttempt);
    newSocket.io.on('reconnect_error', handleConnectError);
    newSocket.io.on('reconnect_failed', handleReconnectFailed);

    return () => {
      isShuttingDown = true;
      console.log('Closing Socket.IO connection.');
      newSocket.off('connect', handleConnect);
      newSocket.off('disconnect', handleDisconnect);
      newSocket.off('connect_error', handleConnectError);
      newSocket.io.off('reconnect_attempt', handleReconnectAttempt);
      newSocket.io.off('reconnect_error', handleConnectError);
      newSocket.io.off('reconnect_failed', handleReconnectFailed);

      priceUpdateService.reset();
      newSocket.close();
      setIsConnected(false);
      setSocket(null);
      transitionStatus('idle');
    };
  }, [isAuthenticated]);

  const contextValue = useMemo(() => ({
    socket,
    isConnected,
    connectionStatus,
    isReconnecting: connectionStatus === 'reconnecting',
    lastError,
  }), [socket, isConnected, connectionStatus, lastError]);

  return (
    <SocketContext.Provider value={contextValue}>
      {children}
    </SocketContext.Provider>
  );
};

