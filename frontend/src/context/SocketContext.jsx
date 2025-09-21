import React, { createContext, useContext, useEffect, useState } from 'react';
import { io } from 'socket.io-client';
import priceUpdateService from '@/services/priceUpdateService'; // Import the service

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

  // This effect runs only once when the application mounts
  useEffect(() => {
    // 2. Establish connection to the backend Socket.IO server
    // It reads the server URL from environment variables for flexibility between
    // development and production environments.
    const socketIoUrl = import.meta.env.VITE_API_BASE_URL || "http://localhost:5000";
    
    const newSocket = io(socketIoUrl, {
      // `withCredentials: true` is important for sending session cookies,
      // which can be used for authenticating socket connections.
      withCredentials: true,
    });

    // Listen to connection events
    newSocket.on('connect', () => setIsConnected(true));
    newSocket.on('disconnect', () => setIsConnected(false));

    // 3. Set the created socket instance into state
    setSocket(newSocket);
    
    // --- NEW: Initialize the price update service with the new socket instance ---
    // This activates the real-time price listeners for the entire application.
    priceUpdateService.init(newSocket);
    
    console.log("Socket connection established and price service initialized.");

    // 4. Define a cleanup function to run when the component unmounts
    // This is crucial for preventing memory leaks and orphaned connections.
    return () => {
      newSocket.close();
      console.log("Socket connection closed.");
    };
  }, []); // The empty dependency array ensures this effect runs only once

  // 5. Provide the socket instance and connection status to all child components
  return (
    <SocketContext.Provider value={{ socket, isConnected }}>
      {children}
    </SocketContext.Provider>
  );
};