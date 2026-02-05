/**
 * Authentication Context
 * 
 * Provides authentication state and methods throughout the application:
 * - user: Current authenticated user object
 * - login/logout: Authentication methods
 * - register: New user registration
 * - resetPassword: Password reset functionality
 * - isAuthenticated: Boolean flag for auth status
 * 
 * Uses JWT tokens stored in localStorage for session persistence.
 */
import React, { createContext, useContext, useState, useEffect } from 'react';
import { fetchJSON } from '../lib/fetchJSON.js';

const AuthContext = createContext();

/**
 * Hook to access authentication context
 * Must be used within an AuthProvider
 */
export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth must be used within AuthProvider');
  return context;
};

export const AuthProvider = ({ children }) => {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  // Check authentication status on mount using stored token
  useEffect(() => {
    const token = localStorage.getItem('authToken');
    if (token) {
      fetchJSON('/api/v1/auth/me')
        .then(setUser)
        .catch(() => localStorage.removeItem('authToken'))
        .finally(() => setLoading(false));
    } else {
      setLoading(false);
    }
  }, []);

  /**
   * Authenticate user with email and password
   * Stores JWT token in localStorage on success
   */
  const login = async (email, password) => {
    const response = await fetchJSON('/api/v1/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    });
    localStorage.setItem('authToken', response.token);
    setUser(response.user);
    return response;
  };

  const logout = () => {
    localStorage.removeItem('authToken');
    setUser(null);
  };

  const register = async (userData) => {
    return await fetchJSON('/api/v1/auth/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(userData),
    });
  };

  const resetPassword = async (email) => {
    return await fetchJSON('/api/v1/auth/reset-password', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email }),
    });
  };

  const value = {
    user,
    login,
    logout,
    register,
    resetPassword,
    isAuthenticated: !!user,
  };

  if (loading) {
    return <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100vh' }}>
      Loading...
    </div>;
  }

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
};